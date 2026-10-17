// Rooms over our own WebSocket server (server.ts), shaped like the claude.ai `room` capability the game was
// first written against: use('room') gives a lobby room; lobby.join(name) gives a named room. Each room has
// emit/on (broadcast moments), presence/peers/onPeers (per-peer state that newcomers see), connected/onConnection,
// and leave. The game's net layer (game.js) only ever talks to this shape, so it runs unchanged either way.
//
// Peer ids: each tab keeps a random secret in sessionStorage and the server shows everyone a hash of it, so a
// reload rejoins as the same peer (and the host gives the seat back), but nobody can claim someone else's id.
(() => {
  const SECRET_KEY = 'shed-peer-secret';
  let secret = null;
  try { secret = sessionStorage.getItem(SECRET_KEY); } catch (e) {}
  if (!secret) {
    secret = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem(SECRET_KEY, secret); } catch (e) {}
  }

  let ws = null, me = null, open = false, backoff = 500, ready = null;
  const rooms = new Map();            // name -> room object
  const connHandlers = new Set();

  const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const send = m => { if (open) ws.send(JSON.stringify(m)); };

  function connect() {
    if (ready) return ready;
    ready = new Promise(resolve => {
      if (!/^https?:$/.test(location.protocol)) { resolve(false); return; }
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      const start = () => {
        try { ws = new WebSocket(wsUrl()); } catch (e) { done(false); return; }
        ws.onopen = () => { send0({ t: 'hello', secret }); };
        ws.onmessage = ev => {
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.t === 'welcome') {
            me = m.peer; open = true; backoff = 500;
            // after a reconnect, rejoin every room and restate our presence there
            for (const r of rooms.values()) { send({ t: 'join', room: r.name }); if (Object.keys(r._mine).length) send({ t: 'presence', room: r.name, patch: r._mine }); }
            connHandlers.forEach(f => f(true));
            done(true);
          } else if (m.t === 'peers') { const r = rooms.get(m.room); if (r) r._peers(m.peers); }
          else if (m.t === 'msg') { const r = rooms.get(m.room); if (r) r._msg(m); }
        };
        ws.onclose = () => {
          const was = open; open = false;
          if (was) connHandlers.forEach(f => f(false));
          setTimeout(start, backoff); backoff = Math.min(backoff * 2, 8000);
        };
        ws.onerror = () => {};
        setTimeout(() => done(false), 6000);
      };
      const send0 = m => ws.send(JSON.stringify(m));
      start();
    });
    return ready;
  }

  function makeRoom(name) {
    if (rooms.has(name)) return rooms.get(name);
    let peers = Object.freeze([]);
    const topics = new Map(), peerFns = new Set();
    const room = {
      name,
      _mine: {},
      _peers(list) {
        const prev = new Map(peers.map(p => [p.peer, p]));
        peers = Object.freeze(list.map(p => {
          const old = prev.get(p.peer);
          if (old && JSON.stringify(old.presence) === JSON.stringify(p.presence)) return old;
          return Object.freeze({ peer: p.peer, by: null, isMe: p.peer === me, sameTab: p.peer === me, kind: 'viewer', guest: false, presence: Object.freeze(p.presence || {}), updatedAt: Date.now() });
        }));
        const now = new Set(peers.map(p => p.peer));
        const change = { peers, joined: peers.filter(p => !prev.has(p.peer)), left: [...prev.values()].filter(p => !now.has(p.peer)), updated: peers.filter(p => prev.has(p.peer) && prev.get(p.peer) !== p) };
        peerFns.forEach(f => { try { f(change); } catch (e) { console.warn(e); } });
      },
      _msg(m) {
        const fns = topics.get(m.topic);
        if (fns) fns.forEach(f => { try { f({ topic: m.topic, data: m.data, peer: m.from, by: null, isMe: m.from === me, sameTab: m.from === me, kind: 'viewer', guest: false }); } catch (e) { console.warn(e); } });
      },
      emit(topic, data) { send({ t: 'emit', room: name, topic, data }); return Promise.resolve(); },
      on(topic, fn) { if (!topics.has(topic)) topics.set(topic, new Set()); topics.get(topic).add(fn); return () => topics.get(topic).delete(fn); },
      presence(patch) {
        for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete room._mine[k]; else room._mine[k] = v; }
        send({ t: 'presence', room: name, patch });
        return Promise.resolve();
      },
      peers: () => peers,
      onPeers(fn) { peerFns.add(fn); setTimeout(() => fn({ peers, joined: peers, left: [], updated: [] }), 0); return () => peerFns.delete(fn); },
      connected: () => open,
      onConnection(fn) { connHandlers.add(fn); setTimeout(() => fn(open), 0); return () => connHandlers.delete(fn); },
      join(n) {
        if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(n)) return Promise.reject({ code: 'invalid_argument', message: 'Bad room name.' });
        const r = makeRoom(n);
        send({ t: 'join', room: n });
        return new Promise(res => setTimeout(() => res(r), 60));
      },
      leave() { send({ t: 'leave', room: name }); rooms.delete(name); peerFns.clear(); topics.clear(); return Promise.resolve(); },
    };
    rooms.set(name, room);
    return room;
  }

  window.ChonkRooms = {
    async use(cap) {
      if (cap !== 'room') return null;
      if (!(await connect())) return null;
      const lobby = makeRoom('lobby');
      send({ t: 'join', room: 'lobby' });
      return lobby;
    },
  };
})();
