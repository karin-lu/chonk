// End-to-end room test: starts the real server, opens three browsers (a host and two guests), plays a whole
// match through WebSocket rooms with animations off, reloads one guest mid-match, and checks that every page
// ends with the same game. Run: npm run test:e2e   (needs Bun on PATH and Playwright's Chromium)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 8765 + Math.floor(Math.random() * 200);
const URL = `http://localhost:${PORT}/`;
const server = spawn('bun', ['server.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {
  server.stdout.on('data', d => { if (String(d).includes("Chonk on")) res(); });
  server.on('exit', c => rej(new Error(`server exited ${c}`)));
  setTimeout(() => rej(new Error('server did not start')), 8000);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
const errors = [];
let failed = false;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed = true; };

async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => { window.__fast = 1; });
  // skip the web fonts so the test does not depend on the network
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await pg.goto(URL);
  await pg.waitForFunction(() => window.__shed && window.__shed.net.api);
  await pg.fill('#pname', name);
  return pg;
}
const tap = async (pg, sel) => { const el = await pg.$(sel); if (!el) return false; try { await el.click({ timeout: 1500 }); return true; } catch { return false; } };
const state = pg => pg.evaluate(() => JSON.stringify([window.__shed.s.players.map(p => [p.name, p.fish, p.coins, p.jokers]), window.__shed.s.deck.length, window.__shed.s.handNo, window.__shed.s.phase]));

try {
  const host = await open('Kat'), g1 = await open('Tristan'), g2 = await open('Lin');
  await tap(host, '[data-act=opps][data-v="3"]');
  await tap(host, '[data-act=create]');
  await host.waitForFunction(() => window.__shed.net.code && window.__shed.net.mode === 'host');
  const code = await host.evaluate(() => window.__shed.net.code);
  check(/^[A-Z]{4}$/.test(code), `host opened room ${code}`);

  await g1.fill('#joincode', code); await tap(g1, '.ts-join [data-act=join]');
  await g2.waitForSelector('.ts-room', { timeout: 4000 }).catch(() => {});
  check(!!(await g2.$('.ts-room')), 'open room is listed on the title screen');
  for (let i = 0; i < 10 && (await g2.evaluate(() => window.__shed.net.mode)) !== 'guest'; i++) { await tap(g2, '.ts-room'); await sleep(200); }
  await host.waitForFunction(() => window.__shed.net.seats.filter(Boolean).length === 3, null, { timeout: 5000 }).catch(async e => {
    for (const [n, pg] of [['host', host], ['g1', g1], ['g2', g2]]) console.log(n, await pg.evaluate(() => JSON.stringify({ mode: window.__shed.net.mode, code: window.__shed.net.code, seats: window.__shed.net.seats, hi: window.__shed.net.hostInfo, me: window.__shed.net.me, msg: window.__shed.ui.roomMsg, ov: window.__shed.ui.ov, peers: window.__shed.net.room && window.__shed.net.room.peers().map(p => [p.peer, p.presence]) })));
    throw e;
  });
  check(true, 'both guests took seats');
  await tap(host, '[data-act=start]');
  await g2.waitForFunction(() => window.__shed.net.cfg && window.__shed.ME === 2, null, { timeout: 5000 });
  check(true, 'guests were dealt in as seats 1 and 2');

  const pages = [host, g1, g2];
  let reloaded = false;
  for (let step = 0; step < 3000; step++) {
    if (!reloaded && step === 60) {
      await g2.reload();
      await g2.waitForFunction(() => window.__shed && window.__shed.net.cfg && window.__shed.ME === 2, null, { timeout: 8000 }).then(() => check(true, 'reloaded guest rejoined its seat and caught up'), () => check(false, 'reloaded guest rejoined its seat'));
      reloaded = true;
    }
    let done = 0;
    for (const pg of pages) {
      if (await pg.$('.end-rows')) { done++; continue; }
      if (await tap(pg, '#pcont:not([hidden])')) continue;
      const deal = await pg.$('[data-act=deal]:not([aria-disabled=true])');
      if (deal && await deal.isVisible()) { await tap(pg, '[data-act=deal]:not([aria-disabled=true])'); continue; }
      if (await pg.evaluate(() => window.__shed.busy || window.__shed.net.waiting)) continue;
      if (!(await tap(pg, '[data-act=hint]:not([aria-disabled=true])'))) continue;
      for (const a of ['discard', 'play', 'pass']) if (await tap(pg, `[data-act=${a}]:not([aria-disabled=true])`)) break;
    }
    if (done === pages.length) break;
    await sleep(20);
  }
  const ends = await Promise.all(pages.map(pg => pg.$('.end-rows')));
  check(ends.every(Boolean), 'every page reached the final standings');
  const sigs = await Promise.all(pages.map(state));
  check(new Set(sigs).size === 1, 'all three pages agree on the final game');
  if (new Set(sigs).size !== 1) sigs.forEach(s => console.log('   ', s.slice(0, 200)));
} catch (e) {
  check(false, String(e));
} finally {
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
