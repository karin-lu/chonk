const E = require('../public/js/engine.js');
const assert = require('assert');
const F = (r, s) => E.RANKS.indexOf(r) * 4 + ['paws', 'mice', 'yarn', 'fish'].indexOf(s);
const k = (list, wild = []) => E.classifyObjs(list.map((f, i) => ({ f, wild: wild.includes(i) })));
const st = (...rs) => rs.map((r, i) => F(r, ['paws', 'mice', 'yarn', 'fish', 'mice'][i]));
const fl = (s, ...rs) => rs.map(r => F(r, s));
assert(E.beats(k([F('2', 'paws')]), k([F('A', 'fish')])));
assert.equal(k(st('A', '2', '3', '4', '5')).label, 'Straight');
assert.equal(k(st('J', 'Q', 'K', 'A', '2')), null);
assert(E.beats(k(st('2', '3', '4', '5', '6')), k(st('A', '2', '3', '4', '5'))));
assert(E.beats(k(fl('yarn', '9', '7', '6', '5', '3')), k(fl('mice', '2', 'J', '9', '6', '4'))));
assert(E.beats(k(fl('mice', '3', '5', '7', '9', 'J')), k(st('10', 'J', 'Q', 'K', 'A'))));
// duplicates
const five = [F('7', 'paws'), F('7', 'mice'), F('7', 'yarn'), F('7', 'fish'), F('7', 'fish')];
assert.equal(k(five).label, 'Five of a kind');
assert(E.beats(k(five), k(fl('fish', '9', '10', 'J', 'Q', 'K'))), 'five kind beats straight flush');
const fh = [F('9', 'yarn'), F('9', 'yarn'), F('9', 'yarn'), F('4', 'yarn'), F('4', 'yarn')];
assert.equal(k(fh).label, 'Flush house');
assert.equal(k([F('9', 'yarn'), F('9', 'yarn'), F('9', 'yarn'), F('9', 'yarn'), F('9', 'yarn')]).label, 'Flush five');
assert(!E.beats(k([F('K', 'fish')]), k([F('K', 'fish')])), 'identical ties');
// wild
assert.equal(k([F('3', 'yarn'), F('7', 'yarn'), F('9', 'fish'), F('J', 'yarn'), F('K', 'yarn')], [2]).label, 'Flush');
// upside-down
const kr = list => E.classifyObjs(list.map(f => ({ f })), { rev: true });
assert(E.beats(kr([F('3', 'paws')]), kr([F('2', 'fish')])), '3 beats 2 when reversed');
assert(E.beats(kr([F('3', 'fish')]), kr([F('3', 'paws')])), 'suits still decide');
assert(E.beats(kr(st('A', '2', '3', '4', '5')), kr(st('10', 'J', 'Q', 'K', 'A'))), 'low straight wins reversed');
console.log('combo tests passed');

function runMatch(seed, onHand) {
  const s = E.newMatch(seed, ['A', 'B', 'C', 'D'].slice(0, +(process.argv[3] || 4)), -1);
  let guard = 0;
  while (s.phase !== 'matchEnd') {
    if (s.phase !== 'play') { if (s.phase === 'handEnd') E.openShop(s); E.startHand(s); continue; }
    const a = E.botChoose(s, s.turn);
    const err = E.act(s, s.turn, a);
    if (err) throw new Error(`seed ${seed}: ${err} ${JSON.stringify(a)}`);
    if (s.phase !== 'play' && onHand) onHand(s);
    if (++guard > 6000) throw new Error('stuck ' + seed);
  }
  return s;
}
const N = +(process.argv[2] || 2000);
let digs = 0, flips = 0, flipHands = 0, hands = 0, pounceHands = 0, pays = [], mults = [], capHits = 0, deckSizes = [], legends = 0, plays = 0;
const jw = {}, jh = {}, lvlWin = [0, 0];
for (let i = 1; i <= N; i++) {
  const s = runMatch(i, s => {
    s.lastResult.rows.forEach(r => pays.push(r.pay));
    mults.push(s.lastResult.mult);
    if (s.lastResult.mult >= E.BASE_CAP) capHits++;
  });
  hands += s.handNo;
  pounceHands += new Set(s.log.filter(l => l.cls === 'pounce').map(l => l.hand)).size;
  legends += s.log.filter(l => /plays (five of a kind|flush house|flush five)/.test(l.text)).length;
  plays += s.log.filter(l => l.cls === 'play').length;
  deckSizes.push(s.deck.length);
  digs += s.log.filter(l => l.cls === 'dig').length;
  flips += s.log.filter(l => /^(Upside-down!|Flipped back)/.test(l.text)).length;
  flipHands += s.log.filter(l => / Upside-Down\. /.test(l.text)).length;
  const w = s.standings[0].id;
  s.players.forEach(p => p.jokers.forEach(j => { jh[j] = (jh[j] || 0) + 1; if (p.id === w) jw[j] = (jw[j] || 0) + 1; }));
  const lv = s.players.map(p => Object.values(p.levels).reduce((a, b) => a + b, 0));
  if (lv[w] === Math.max(...lv)) lvlWin[0]++; lvlWin[1]++;
  const total = s.players.reduce((a, p) => a + p.fish, 0);
  if (total !== 100 * s.players.length) throw new Error('fish not conserved ' + i);
}
pays.sort((a, b) => a - b);
const q = x => pays[Math.floor(x * (pays.length - 1))];
console.log(`${N} matches, avg hands ${(hands / N).toFixed(2)}`);
console.log(`pounce hands ${(100 * pounceHands / hands).toFixed(1)}%  | winner Mult avg ${(mults.reduce((a, b) => a + b, 0) / mults.length).toFixed(2)}, at/above cap ${(100 * capHits / mults.length).toFixed(1)}%`);
console.log(`payment median ${q(0.5)}, p90 ${q(0.9)}, max ${pays[pays.length - 1]}, >30: ${(100 * pays.filter(p => p > 30).length / pays.length).toFixed(1)}%`);
console.log(`deck size at end: min ${Math.min(...deckSizes)}, avg ${(deckSizes.reduce((a, b) => a + b, 0) / N).toFixed(1)}, max ${Math.max(...deckSizes)} | copy-only hands played: ${legends} of ${plays} plays`);
console.log(`digs per hand ${(digs / hands).toFixed(2)} | Upside-Down hands ${flipHands}, flips ${flips} (${(100 * flips / Math.max(1, flipHands)).toFixed(0)} per 100 such hands, incl. Belly Up)`);
console.log(`most star levels won: ${(100 * lvlWin[0] / lvlWin[1]).toFixed(1)}%`);
console.log(`joker holder win rate (${Math.round(100 / +(process.argv[3] || 4))}% = no edge):`);
Object.keys(jh).sort().forEach(j => console.log(`  ${j.padEnd(10)} ${(100 * (jw[j] || 0) / jh[j]).toFixed(1)}%  n=${jh[j]}`));
