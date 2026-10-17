// Shed! server: serves public/ and relays rooms over WebSocket at /ws.
//
// The server never runs the game. In a room, the host's browser is the referee: it applies every move and
// broadcasts a numbered log; guests replay it with the same deterministic engine (see CLAUDE.md, "Rooms").
// The server only does three things per room:
//   - presence: each peer's small state object, re-sent to everyone in the room whenever it changes
//   - emit: a one-off message broadcast to everyone in the room (the sender included)
//   - membership: who is in which room; a closed socket leaves all its rooms
//
// Peer ids are a hash of a per-tab secret the client keeps in sessionStorage, so a reload rejoins as the
// same peer without anyone being able to claim another tab's id.

import { join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC = join(import.meta.dir, "public");
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const TOPIC_RE = /^[a-z][a-z0-9_.-]{0,47}$/;
const MAX_MSG = 16 * 1024; // bytes per WebSocket frame
const MAX_PRESENCE = 4 * 1024; // bytes of merged presence per peer per room
const MAX_ROOMS_PER_SOCKET = 16;
const RATE = { perSec: 60, burst: 120 };

type Sock = Bun.ServerWebSocket<{ peer: string | null; rooms: Set<string>; tokens: number; last: number }>;
type Member = { ws: Sock; presence: Record<string, unknown> };

const rooms = new Map<string, Map<string, Member>>();
const pending = new Set<string>(); // rooms whose peer list must be re-sent

async function peerIdFor(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`shed:${secret}`)));
  return "p" + Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

function send(ws: Sock, msg: unknown) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {}
}

// coalesce peer-list updates: at most one snapshot per room per tick
function touch(room: string) {
  if (pending.size === 0) setTimeout(flush, 15);
  pending.add(room);
}
function flush() {
  for (const name of pending) {
    const members = rooms.get(name);
    if (!members) continue;
    const peers = [...members].map(([peer, m]) => ({ peer, presence: m.presence }));
    const text = JSON.stringify({ t: "peers", room: name, peers });
    for (const m of members.values()) {
      try {
        m.ws.send(text);
      } catch {}
    }
  }
  pending.clear();
}

function leave(ws: Sock, name: string) {
  const members = rooms.get(name);
  ws.data.rooms.delete(name);
  if (!members || !ws.data.peer) return;
  const m = members.get(ws.data.peer);
  if (m && m.ws === ws) members.delete(ws.data.peer);
  if (members.size === 0) rooms.delete(name);
  else touch(name);
}

function allowed(ws: Sock): boolean {
  const now = Date.now();
  ws.data.tokens = Math.min(RATE.burst, ws.data.tokens + ((now - ws.data.last) / 1000) * RATE.perSec);
  ws.data.last = now;
  if (ws.data.tokens < 1) return false;
  ws.data.tokens -= 1;
  return true;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

async function serveStatic(pathname: string): Promise<Response> {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let path = join(PUBLIC, rel);
  if (!path.startsWith(PUBLIC)) return new Response("Not found", { status: 404 });
  if (pathname.endsWith("/")) path = join(path, "index.html");
  const f = Bun.file(path);
  if (!(await f.exists())) return new Response("Not found", { status: 404 });
  const ext = path.slice(path.lastIndexOf("."));
  return new Response(f, {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      // short cache: the files are not fingerprinted, and a deploy should reach players quickly
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=300",
    },
  });
}

const server = Bun.serve<{ peer: string | null; rooms: Set<string>; tokens: number; last: number }>({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (srv.upgrade(req, { data: { peer: null, rooms: new Set(), tokens: RATE.burst, last: Date.now() } })) return;
      return new Response("Expected a WebSocket", { status: 400 });
    }
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, rooms: rooms.size });
    }
    return serveStatic(url.pathname);
  },
  websocket: {
    maxPayloadLength: MAX_MSG,
    idleTimeout: 120,
    async message(ws, raw) {
      if (!allowed(ws)) return;
      let m: any;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!m || typeof m !== "object") return;

      if (m.t === "hello") {
        if (ws.data.peer || typeof m.secret !== "string" || m.secret.length < 16 || m.secret.length > 128) return;
        ws.data.peer = await peerIdFor(m.secret);
        send(ws, { t: "welcome", peer: ws.data.peer });
        return;
      }
      const peer = ws.data.peer;
      if (!peer || typeof m.room !== "string" || !ROOM_RE.test(m.room)) return;
      const name: string = m.room;

      if (m.t === "join") {
        if (!ws.data.rooms.has(name) && ws.data.rooms.size >= MAX_ROOMS_PER_SOCKET) return;
        let members = rooms.get(name);
        if (!members) rooms.set(name, (members = new Map()));
        const old = members.get(peer);
        // the same tab reconnecting (or reloading) replaces its old socket; the page restates its own presence
        if (old && old.ws !== ws) old.ws.data.rooms.delete(name);
        if (!old || old.ws !== ws) members.set(peer, { ws, presence: {} });
        ws.data.rooms.add(name);
        touch(name);
        return;
      }
      if (m.t === "leave") {
        leave(ws, name);
        return;
      }
      const member = rooms.get(name)?.get(peer);
      if (!member || member.ws !== ws) return;

      if (m.t === "presence") {
        if (!m.patch || typeof m.patch !== "object" || Array.isArray(m.patch)) return;
        const next = { ...member.presence };
        for (const [k, v] of Object.entries(m.patch)) {
          if (v === null) delete next[k];
          else next[k] = v;
        }
        if (JSON.stringify(next).length > MAX_PRESENCE) return;
        member.presence = next;
        touch(name);
        return;
      }
      if (m.t === "emit") {
        if (typeof m.topic !== "string" || !TOPIC_RE.test(m.topic)) return;
        const text = JSON.stringify({ t: "msg", room: name, topic: m.topic, data: m.data ?? null, from: peer });
        for (const other of rooms.get(name)!.values()) {
          try {
            other.ws.send(text);
          } catch {}
        }
      }
    },
    close(ws) {
      for (const name of [...ws.data.rooms]) leave(ws, name);
    },
  },
});

console.log(`Shed! on http://localhost:${server.port}`);
