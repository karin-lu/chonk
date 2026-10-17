/* server/index.mjs — static file server for public/ plus a WebSocket room relay for Chonk, on $PORT (8086).

   Same box and shape as the other kat.lu games (Node + ws, one systemd unit, a Caddy site block), but unlike
   them this server never runs the game. In a room the host's browser is the referee: it applies every move
   and broadcasts a numbered log; guests replay it with the same deterministic engine (CLAUDE.md, "Rooms").
   Per room the server only keeps:
     - presence: each peer's small state object, re-sent to everyone in the room whenever it changes
     - emit: one-off messages broadcast to everyone in the room (the sender included)
     - membership: who is in which room; a closed socket leaves all its rooms

   Peer ids are a hash of a per-tab secret the client keeps in sessionStorage, so a reload rejoins as the same
   peer without anyone being able to claim another tab's id.

   Rooms live in this process's memory, so run exactly one instance. */

import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8086);
const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const TOPIC_RE = /^[a-z][a-z0-9_.-]{0,47}$/;
const MAX_MSG = 16 * 1024;        // bytes per WebSocket frame
const MAX_PRESENCE = 4 * 1024;    // bytes of merged presence per peer per room
const MAX_ROOMS_PER_SOCKET = 16;
const RATE = { perSec: 60, burst: 120 };
const PING_MS = 30 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2',
};

// ---------- static files ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { rel = '/'; }
  if (rel.endsWith('/')) rel += 'index.html';
  const path = normalize(join(ROOT, rel));
  if (!path.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(path);
    const ext = extname(path);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      // short cache: files are not fingerprinted, and a deploy should reach players quickly
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

// ---------- rooms ----------
const rooms = new Map();     // name -> Map(peer -> { ws, presence })
const pending = new Set();   // rooms whose peer list must be re-sent

const peerIdFor = secret => 'p' + createHash('sha256').update(`shed:${secret}`).digest('hex').slice(0, 16);
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };

// coalesce peer-list updates: at most one snapshot per room per tick
function touch(name) {
  if (pending.size === 0) setTimeout(flush, 15);
  pending.add(name);
}
function flush() {
  for (const name of pending) {
    const members = rooms.get(name);
    if (!members) continue;
    const text = JSON.stringify({ t: 'peers', room: name, peers: [...members].map(([peer, m]) => ({ peer, presence: m.presence })) });
    for (const m of members.values()) send(m.ws, text);
  }
  pending.clear();
}
function leave(ws, name) {
  const members = rooms.get(name);
  ws.data.rooms.delete(name);
  if (!members || !ws.data.peer) return;
  const m = members.get(ws.data.peer);
  if (m && m.ws === ws) members.delete(ws.data.peer);
  if (members.size === 0) rooms.delete(name);
  else touch(name);
}
function allowed(ws) {
  const now = Date.now(), d = ws.data;
  d.tokens = Math.min(RATE.burst, d.tokens + ((now - d.last) / 1000) * RATE.perSec);
  d.last = now;
  if (d.tokens < 1) return false;
  d.tokens -= 1;
  return true;
}

function onMessage(ws, raw) {
  if (!allowed(ws)) return;
  let m;
  try { m = JSON.parse(String(raw)); } catch { return; }
  if (!m || typeof m !== 'object') return;

  if (m.t === 'hello') {
    if (ws.data.peer || typeof m.secret !== 'string' || m.secret.length < 16 || m.secret.length > 128) return;
    ws.data.peer = peerIdFor(m.secret);
    send(ws, { t: 'welcome', peer: ws.data.peer });
    return;
  }
  const peer = ws.data.peer;
  if (!peer || typeof m.room !== 'string' || !ROOM_RE.test(m.room)) return;
  const name = m.room;

  if (m.t === 'join') {
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
  if (m.t === 'leave') { leave(ws, name); return; }

  const member = rooms.get(name)?.get(peer);
  if (!member || member.ws !== ws) return;

  if (m.t === 'presence') {
    if (!m.patch || typeof m.patch !== 'object' || Array.isArray(m.patch)) return;
    const next = { ...member.presence };
    for (const [k, v] of Object.entries(m.patch)) { if (v === null) delete next[k]; else next[k] = v; }
    if (JSON.stringify(next).length > MAX_PRESENCE) return;
    member.presence = next;
    touch(name);
    return;
  }
  if (m.t === 'emit') {
    if (typeof m.topic !== 'string' || !TOPIC_RE.test(m.topic)) return;
    const text = JSON.stringify({ t: 'msg', room: name, topic: m.topic, data: m.data ?? null, from: peer });
    for (const other of rooms.get(name).values()) send(other.ws, text);
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG });
wss.on('connection', ws => {
  ws.data = { peer: null, rooms: new Set(), tokens: RATE.burst, last: Date.now() };
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => onMessage(ws, raw));
  ws.on('close', () => { for (const name of [...ws.data.rooms]) leave(ws, name); });
  ws.on('error', () => {});
});
// drop sockets that stopped answering (a phone that went to sleep), so their seat can go to a bot
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, PING_MS).unref();

server.listen(PORT, () => console.log(`Chonk on http://localhost:${PORT}`));
