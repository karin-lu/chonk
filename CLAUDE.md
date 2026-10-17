# Chonk 锄大猫 (chonk.kat.lu)

A browser card game: Big Two (锄大地) climbing, with Balatro-style jokers, packs and a shared deck that
players change between hands. Cat-themed. 2–4 players: bots, or friends in a room.

## Running

```sh
npm install        # once: the ws package (and Playwright for the e2e test)
npm run dev        # http://localhost:8086 — static files + WebSocket rooms, restarts on server changes
npm test           # engine checks + bot simulations at 4, 3 and 2 players (Node, no browser)
npm run test:e2e   # real server + three browsers playing a whole room match (needs Playwright's Chromium:
                   # `npx playwright install chromium` once)
npm run build:artifact   # one-file dist/chonk.html for publishing as a claude.ai artifact
```

Front-end files are plain scripts loaded in order by `public/index.html`. There is no bundler and no build
step: edit, reload.

## Layout

| Path | What |
|------|------|
| `public/js/engine.js` | The rules. Pure, no DOM. Also `require`-able from Node (tests). |
| `public/js/art.js` | Procedural SVG: cat portraits, face cards, card backs, icons. |
| `public/js/game.js` | Everything on screen: rendering, the animation director, input, the move queue, the room layer. |
| `public/js/rooms.js` | WebSocket client for `server/index.mjs`, shaped like claude.ai's `room` capability. |
| `public/styles.css` | Tokens (`:root`) and all styles. |
| `server/index.mjs` | Node + `ws`: serves `public/`, relays rooms on `/ws`, `/healthz`. Port 8086. |
| `tests/sim.cjs` | Combo assertions + N bot-only matches with balance stats. `node tests/sim.cjs 2000 [players]` |
| `tests/e2e.mjs` | Host + two guests through the real server, including a guest reload mid-match. |
| `redeploy.ps1` | Ship to the games EC2 box and (re)start it. |

## How it fits together

**The engine must stay deterministic.** Every page in a room runs its own copy of the engine and they stay
identical only because they apply the same moves, in the same order, from the same seed.
- Randomness that changes the shared game comes only from `s.rng` (seeded `mulberry32`).
- Bot *decisions* use `s.botRng`; only the host runs bots, and their choices travel as moves.
- No `Math.random`, `Date`, or iteration over unordered keys inside engine logic.

**Every change to the game is a move**: `{op, pid, ...}` with `op` one of `act` (play/pass/dig/discard/pounce),
`buy`, `sell`, `move`, `open`, `skip`, `choose`, `edit`, `ready`, plus host-only `bot` / `human` (seat handed
to or back from a bot). `applyEngine(c)` in `game.js` is the single place moves touch the engine, and it also
runs the automatic transitions (hand ends → shop opens; everyone ready → deal). The UI never calls `E.act`,
`E.buy`, … directly: it calls `submit(move)`.

`submit` → `enqueue` → `drain` applies moves one at a time, awaiting each move's animation. Solo games and
the host apply moves immediately; guests send them to the host.

**Rooms** (host-authoritative log):
- The host's page is the referee. It applies each move, appends it to a numbered log, and broadcasts it on the
  `log` topic. Guests replay that log.
- Guests send their moves through their room *presence* (`cmds`, numbered), the host acks them in its own
  presence (`acks`, `rej` for refusals).
- Each guest's presence says which log entry it needs next (`want`); the host re-sends from there (in chunks
  under 4 KB), so dropped messages, late joiners and reloads all catch up. Far-behind guests replay silently.
- A guest who disappears for 8 s is replaced by a bot (`bot` move); if they come back (same tab, the peer id
  survives a reload) they get the seat back (`human` move). If the host leaves, guests can finish against bots.
- Known gap: the log lives in the host's tab, so a host reload ends the room.

**Same code on claude.ai.** `game.js` uses `window.claude.use('room')` when it exists (artifact) and
`window.ChonkRooms` (our server) otherwise. Keep `rooms.js` to that shape.

## UI conventions

- A fixed 1024×576 landscape stage, scaled to fit (`fit()`), so layout is in stage pixels.
- Very little text on screen. Explanations live in tooltips: put `data-tt` (title) and `data-tb` (body) on an
  element, via `tip(title, body)`; they show on mouse hover or press-and-hold on touch.
- Disabled controls use `aria-disabled="true"` plus `data-why`, never the `disabled` attribute, so tapping one
  can say why it's off.
- Animations go through `D(ms)` (respects speed, reduced motion and the test fast mode `window.__fast`).
- Night-market parlour palette: tokens on `:root` in `styles.css`; fonts Bagel Fat One, Figtree, Ma Shan Zheng.

## Deploying

Same box and pattern as the other kat.lu games (Bananagrams, Cabo, Rummikub, Big Two): from Windows,

```powershell
.\redeploy.ps1            # key defaults to $env:USERPROFILE\Downloads\key.pem
```

It tars the project, uploads it, runs `npm install --omit=dev`, and on the first run creates the `chonk`
systemd unit and the `chonk.kat.lu` Caddy block, then restarts and checks https://chonk.kat.lu/.

| | |
|---|---|
| Host | `16.16.219.170`, `ec2-user` |
| Remote dir | `/opt/chonk` |
| Service | `chonk` (systemd), Node on port **8086** |
| DNS | A record `chonk.kat.lu -> 16.16.219.170` at EuroDNS |
| Logs | `sudo journalctl -u chonk -f` |

Ports on the box: Half Baked 8080, Star Drop 8081, Bananagrams 8082, Cabo 8083, Rummikub 8084, Big Two 8085,
Chonk 8086. Rooms live in the process's memory, so run exactly one instance.

GitHub Actions (`.github/workflows/ci.yml`) only runs `npm test`; it does not deploy.
