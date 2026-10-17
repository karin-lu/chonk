// Shed! 锄大猫 — rules engine v2 (pure JS, no DOM). Used by the page and by sim.js.
// Cards are instances: every card has a uid and a face (rank * 4 + suit), so the shared deck can hold copies.
const Engine = (() => {
  'use strict';

  // ---------- faces ----------
  const SUITS = ['paws', 'mice', 'yarn', 'fish'];
  const SUIT_NAMES = ['Paws', 'Mice', 'Yarn', 'Fish'];
  const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const rankOfF = f => f >> 2;
  const suitOfF = f => f & 3;
  const natural = r => (r === 12 ? 2 : r + 3);
  const faceName = f => `${SUIT_NAMES[suitOfF(f)]} ${RANKS[rankOfF(f)]}`;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

  // ---------- combos ----------
  // five-card kinds, weakest to strongest; the last three need copied cards
  const FIVE_LABEL = ['Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush', 'Five of a kind', 'Flush house', 'Flush five'];

  function straightInfo(faces) {
    const ranks = faces.map(rankOfF);
    if (new Set(ranks).size !== 5) return null;
    for (const aLow of [false, true]) {
      const nat = faces.map(f => (rankOfF(f) === 11 && aLow ? 1 : natural(rankOfF(f))));
      const sorted = [...nat].sort((a, b) => a - b);
      let ok = true;
      for (let i = 1; i < 5; i++) if (sorted[i] !== sorted[0] + i) { ok = false; break; }
      if (ok) { const topNat = sorted[4]; return { topNat, topFace: faces[nat.indexOf(topNat)] }; }
    }
    return null;
  }

  // objs: [{ f: face, wild: bool }]
  // opt.rev: Upside-Down is active, so rank order runs 2 (low) to 3 (high); suit order stays the same
  function classifyObjs(objs, opt = {}) {
    const n = objs.length;
    if (!n) return null;
    const R = r => (opt.rev ? 12 - r : r);
    const FF = f => R(rankOfF(f)) * 4 + suitOfF(f);
    const TN = t => (opt.rev ? 20 - t : t);
    const os = [...objs].sort((a, b) => a.f - b.f);
    const faces = os.map(o => o.f);
    const ranks = faces.map(rankOfF);
    const allSame = ranks.every(r => r === ranks[0]);
    if (n === 1) return { type: 'single', size: 1, key: FF(faces[0]), rankKey: R(ranks[0]), label: 'Single', cat: 'single' };
    if (n === 2 && allSame) return { type: 'pair', size: 2, key: Math.max(FF(faces[0]), FF(faces[1])), rankKey: R(ranks[0]), label: 'Pair', cat: 'pair' };
    if (n === 3 && allSame) return { type: 'triple', size: 3, key: R(ranks[0]), rankKey: R(ranks[0]), label: 'Triple', cat: 'triple' };
    if (n === 4 && allSame && opt.quad4) return { type: 'quad4', size: 4, key: R(ranks[0]), rankKey: R(ranks[0]), label: 'Four of a kind', cat: 'quads' };
    if (n !== 5) return null;
    const counts = {};
    ranks.forEach(r => (counts[r] = (counts[r] || 0) + 1));
    const groups = Object.entries(counts).map(([r, c]) => [+r, c]).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const suitSet = new Set(os.filter(o => !o.wild).map(o => suitOfF(o.f)));
    const flush = suitSet.size <= 1;
    const fsuit = suitSet.size ? [...suitSet][0] : 3;
    const st = straightInfo(faces);
    const isFull = groups[0][1] === 3 && groups[1] && groups[1][1] === 2;
    let sub = -1, k = 0, rk = 0;
    const g0 = R(groups[0][0]);
    if (groups[0][1] === 5) {
      if (flush) { sub = 7; k = g0 * 4 + fsuit; } else { sub = 5; k = g0 * 4 + suitOfF(faces[4]); }
      rk = g0;
    } else if (isFull && flush) { sub = 6; k = g0 * 4 + fsuit; rk = g0; }
    else if (st && flush) { sub = 4; k = TN(st.topNat) * 4 + fsuit; rk = TN(st.topNat); }
    else if (groups[0][1] === 4) { sub = 3; k = rk = g0; }
    else if (isFull) { sub = 2; k = rk = g0; }
    else if (flush) {
      sub = 1;
      const rd = ranks.map(R).sort((a, b) => b - a);
      k = fsuit; rk = 0;
      for (const r of rd) { k = k * 13 + r; rk = rk * 13 + r; }
    } else if (st) { sub = 0; k = TN(st.topNat) * 4 + suitOfF(st.topFace); rk = TN(st.topNat); }
    if (sub < 0) return null;
    const cat = ['straight', 'flush', 'fullhouse', 'quads', 'straightflush', 'legend', 'legend', 'legend'][sub];
    return { type: 'five', size: 5, sub, key: sub * 1e8 + k, rankKey: sub * 1e8 + rk, label: FIVE_LABEL[sub], cat };
  }

  const beats = (a, b) => a.type === b.type && a.key > b.key;
  const copyTie = (a, b) => a.type === b.type && a.rankKey === b.rankKey;

  function combos(arr, k) {
    const out = [];
    const rec = (start, pickd) => {
      if (pickd.length === k) { out.push([...pickd]); return; }
      for (let i = start; i < arr.length; i++) { pickd.push(arr[i]); rec(i + 1, pickd); pickd.pop(); }
    };
    rec(0, []);
    return out;
  }

  // ---------- content ----------
  const JOKERS = {
    loaf: { name: 'Loaf', cost: 4, kind: 'Mult', rarity: 'common', text: '+1 Mult when you win a trick you passed on earlier in that same trick.' },
    zoomies: { name: '3am Zoomies', cost: 4, kind: 'Mult', rarity: 'common', text: '+1 Mult on the first trick you win each hand.' },
    chonk: { name: 'Big Chonk', cost: 4, kind: 'Mult', rarity: 'common', text: '+1 Mult when you win a trick with a play that includes a 2.' },
    kneading: { name: 'Kneading', cost: 4, kind: 'Mult', rarity: 'common', text: '+1 Mult when you win a trick with a pair.' },
    fits: { name: 'If It Fits, I Sits', cost: 5, kind: 'Rule', rarity: 'uncommon', text: 'You may play four of a kind with no fifth card. Only higher four-card quads beat it.' },
    copycat: { name: 'Copycat', cost: 5, kind: 'Rule', rarity: 'uncommon', text: "Once per hand, you may match the current play's rank instead of beating it." },
    offtable: { name: 'Off the Table', cost: 5, kind: 'Interaction', rarity: 'uncommon', text: 'Once per hand, after you win a trick, the next player cannot pass on your lead if they can beat it.' },
    hiss: { name: 'Hiss', cost: 6, kind: 'Interaction', rarity: 'uncommon', text: "Once per hand, cancel the first time an opponent gains 2 or more Mult from one trick." },
    alley: { name: 'Alley Cat', cost: 4, kind: 'Economy', rarity: 'common', text: '+1 coin each time an opponent passes on your play.' },
    catnap: { name: 'Cat Nap', cost: 3, kind: 'Economy', rarity: 'common', text: '+3 coins in any hand where you win no tricks.' },
    fatcat: { name: 'Fat Cat', cost: 3, kind: 'Economy', rarity: 'common', text: 'Your interest cap rises from 3 to 5 coins.' },
    tuxedo: { name: 'Tuxedo', cost: 4, kind: 'Economy', rarity: 'common', text: '+2 coins at the end of every hand.' },
    ninelives: { name: 'Nine Lives', cost: 5, kind: 'Defence', rarity: 'uncommon', text: 'Once per match, halve a payment of 8 fish or more.' },
    lasereyes: { name: 'Laser Eyes', cost: 5, kind: 'Mult', rarity: 'uncommon', text: 'Pouncing gives +2 Mult instead of +1.' },
    kitten: { name: 'Growing Kitten', cost: 5, kind: 'Mult', rarity: 'rare', text: 'Each hand you win with this joker adds +1 to your starting Mult, up to +3.' },
    bellyup: { name: 'Belly Up', cost: 5, kind: 'Rule', rarity: 'uncommon', text: 'Whenever you play three or more cards of one rank, rank order flips upside down (or back) for the rest of the hand.' },
    mimic: { name: 'Mimic', cost: 6, kind: 'Rule', rarity: 'rare', text: 'Copies the joker to its right in your row. Reorder jokers in the shop.' },
  };
  const JOKER_IDS = Object.keys(JOKERS);
  const RARITY_W = { common: 6, uncommon: 3, rare: 1 };

  const STARS = {
    single: { name: 'Lone Star', label: 'Singles' },
    pair: { name: 'Twin Moons', label: 'Pairs' },
    triple: { name: 'Three Sisters', label: 'Triples' },
    straight: { name: 'Milky Way', label: 'Straights' },
    flush: { name: 'Nebula', label: 'Flushes' },
    fullhouse: { name: "Saturn's Ring", label: 'Full houses' },
    quads: { name: 'Four Winds', label: 'Four of a kind' },
    straightflush: { name: 'Comet', label: 'Straight flushes' },
  };
  const STAR_IDS = Object.keys(STARS);
  const BASE_GAIN = { single: 0, pair: 0, triple: 1, straight: 1, flush: 1, fullhouse: 1, quads: 2, straightflush: 2, legend: 3 };
  const MAX_LEVEL = 3;

  const FORTUNES = {
    scent: { name: 'Scent Mark', text: '+1 Mult for you whenever this card is in a trick you win.' },
    hairball: { name: 'Hairball', text: 'Whoever else holds this card when a hand ends pays you 3 fish.' },
    gold: { name: 'Golden Collar', text: '+1 coin for you whenever anyone plays this card.' },
    box: { name: 'Cardboard Box', text: 'If you are holding this card when someone else goes out, you pay 3 fish less.' },
    tabby: { name: 'Tabby', text: 'Counts as any suit in flushes, for whoever holds it.' },
    vase: { name: 'Fragile Vase', text: '+2 Mult for you when it is in a trick you win, then the vase breaks.' },
    twin: { name: 'Litter Twin', text: 'Add a copy of this card to the deck, carrying your scent mark.' },
    eat: { name: 'Midnight Snack', text: 'Remove a copy of this card from the deck for good, effect and all.' },
  };
  const FORTUNE_IDS = Object.keys(FORTUNES);
  const MODS = ['scent', 'hairball', 'gold', 'box', 'tabby', 'vase'];

  const HOUSE = {
    none: { name: 'Regular hand', text: 'No house rule this hand.' },
    bath: { name: 'Bath Time', text: 'Once you pass, you sit out until the trick ends.' },
    vacuum: { name: 'The Vacuum', text: 'Every pass costs 1 fish, paid into the pot.' },
    laser: { name: 'Laser Pointer', text: 'The Mult cap is one higher this hand.' },
    flip: { name: 'Upside-Down', text: 'The hand starts with rank order upside down: 3 is the highest rank and 2 the lowest. Playing four or more cards of one rank flips it back, and again flips it over.' },
  };
  const PACKS = {
    kitten: { name: 'Kitten pack', cost: 4, text: 'Choose 1 of 3 jokers.' },
    star: { name: 'Star pack', cost: 3, text: 'Choose 1 of 3 star charts. Each levels up one kind of play for you.' },
    fortune: { name: 'Fortune pack', cost: 4, text: 'Choose 1 of 3 fortune cards and use it on a card in the shared deck.' },
  };
  const EDIT_COST = { scent: 3, hairball: 3 };
  const MAX_JOKERS = 4, MAX_HANDS = 6, START_FISH = 100, POUNCE_COST = 5, HAIRBALL_FINE = 3, BOX_SAVE = 3;
  const BASE_CAP = 5, DECK_MIN = 44, DECK_MAX = 60;
  const PLACEMENT = [30, 10, -10, -30];
  const PLACEMENTS = { 2: [30, -30], 3: [30, 0, -30], 4: PLACEMENT };

  // ---------- state helpers ----------
  const P = (s, i) => s.players[i];
  const log = (s, text, cls = '') => s.log.push({ text, cls, hand: s.handNo });
  // structured events for the animation layer; the simulator ignores them
  const ev = (s, type, d = {}) => { if (s.events) s.events.push({ type, ...d }); };
  const faceOf = (s, uid) => s.cards[uid].f;
  const rankOf = (s, uid) => rankOfF(s.cards[uid].f);
  const cardName = (s, uid) => faceName(s.cards[uid].f);
  const objs = (s, uids) => uids.map(u => ({ f: s.cards[u].f, wild: !!(s.cards[u].mod && s.cards[u].mod.kind === 'tabby') }));
  const classify = (s, uids, opt) => classifyObjs(objs(s, uids), opt);
  // count of a joker's effect, including a Mimic copying it
  function jcount(p, j) {
    let n = p.jokers.filter(x => x === j).length;
    const mi = p.jokers.indexOf('mimic');
    if (mi >= 0 && p.jokers[mi + 1] === j) n++;
    return n;
  }
  const has = (p, j) => jcount(p, j) > 0;
  const capOf = (s, p) => BASE_CAP + (p.pounced ? 1 : 0) + (s.houseRule === 'laser' ? 1 : 0);
  const optFor = (s, p) => ({ quad4: has(p, 'fits'), rev: !!s.rev });
  const effRank = (s, uid) => (s.rev ? 12 - rankOf(s, uid) : rankOf(s, uid));
  const STOCK_MIN = 4;
  const sortHand = (s, uids) => uids.sort((a, b) => faceOf(s, a) - faceOf(s, b) || a - b);

  // humans: a seat index (solo) or an array of booleans, one per seat (rooms)
  function newMatch(seed, names = ['You', 'Mochi', 'Biscuit', 'Tofu'], humans = 0) {
    const isHuman = id => (Array.isArray(humans) ? !!humans[id] : id === humans);
    const s = {
      // rng drives everything every client must agree on; botRng is only for bot decisions, which travel as moves
      seed, rng: mulberry32(seed), botRng: mulberry32((seed ^ 0x5bd1e995) >>> 0), handNo: 0, maxHands: MAX_HANDS,
      cards: {}, deck: [], nextUid: 52,
      players: names.map((name, id) => ({
        id, name, human: isHuman(id), fish: START_FISH, coins: 8, jokers: [],
        hand: [], dealt: 13, mult: 1, pounced: false, tricksWon: 0,
        usedCopycat: false, usedOff: false, zoomDone: false, nineUsed: false, hissUsed: false,
        levels: Object.fromEntries(STAR_IDS.map(k => [k, 1])), kittenStacks: 0,
        edited: false, bought: [], opened: {}, pending: null, shopLog: [], mustDiscard: false, drawn: null, digs: 0,
      })),
      houseRule: 'none', nextHouse: 'none', pot: 0, shop: null, stock: [], discards: [], rev: false,
      trick: null, turn: 0, phase: 'shop', mustLead: null, nextLeader: null,
      log: [], events: [], lastResult: null, standings: null,
    };
    for (let f = 0; f < 52; f++) { s.cards[f] = { uid: f, f, mod: null }; s.deck.push(f); }
    openShop(s, true);
    return s;
  }

  // ---------- shop ----------
  function weightedJoker(s, exclude) {
    const pool = JOKER_IDS.filter(j => !exclude.includes(j));
    const total = pool.reduce((a, j) => a + RARITY_W[JOKERS[j].rarity], 0);
    let x = s.rng() * total;
    for (const j of pool) { x -= RARITY_W[JOKERS[j].rarity]; if (x <= 0) return j; }
    return pool[pool.length - 1];
  }

  function openShop(s, first = false) {
    s.phase = 'shop';
    const jk = [];
    while (jk.length < 2) jk.push(weightedJoker(s, jk));
    const kit = [];
    while (kit.length < 3) kit.push(weightedJoker(s, [...kit, ...jk]));
    s.shop = {
      jokers: jk,
      packs: {
        kitten: kit,
        star: shuffle([...STAR_IDS], s.rng).slice(0, 3),
        fortune: shuffle([...FORTUNE_IDS], s.rng).slice(0, 3),
      },
    };
    s.nextHouse = first ? 'none' : pick(['none', 'bath', 'vacuum', 'laser', 'flip', 'flip'], s.rng);
    s.players.forEach(p => { p.edited = false; p.bought = []; p.opened = {}; p.pending = null; p.shopLog = []; });
    s.players.forEach(p => { if (!p.human) botShop(s, p.id); });
  }

  function buy(s, pid, jid) {
    const p = P(s, pid), j = JOKERS[jid];
    if (s.phase !== 'shop') return 'The shop is closed.';
    if (!s.shop.jokers.includes(jid)) return 'That joker is not on offer.';
    return addJoker(s, p, jid, j.cost);
  }
  function addJoker(s, p, jid, cost) {
    if (p.jokers.includes(jid)) return 'You already have this joker.';
    if (p.jokers.length >= MAX_JOKERS) return 'All 4 joker slots are full. Sell one first.';
    if (p.coins < cost) return `You need ${cost} coins.`;
    p.coins -= cost; p.jokers.push(jid); p.bought.push(JOKERS[jid].name);
    return null;
  }
  function sell(s, pid, jid) {
    const p = P(s, pid);
    if (s.phase !== 'shop') return 'The shop is closed.';
    const i = p.jokers.indexOf(jid);
    if (i < 0) return 'You do not have that joker.';
    p.jokers.splice(i, 1); p.coins += 2;
    return null;
  }
  function moveJoker(s, pid, jid, dir) {
    const p = P(s, pid), i = p.jokers.indexOf(jid), k = i + dir;
    if (i < 0 || k < 0 || k >= p.jokers.length) return 'Cannot move that joker.';
    [p.jokers[i], p.jokers[k]] = [p.jokers[k], p.jokers[i]];
    return null;
  }

  function openPack(s, pid, type) {
    const p = P(s, pid), pk = PACKS[type];
    if (s.phase !== 'shop') return 'The shop is closed.';
    if (p.pending) return 'Finish choosing from the pack you opened first.';
    if (p.opened[type]) return `You already opened the ${pk.name.toLowerCase()} this shop.`;
    if (type === 'fortune' && p.edited) return 'You already changed the deck this shop.';
    if (type === 'kitten' && p.jokers.length >= MAX_JOKERS) return 'All 4 joker slots are full. Sell one first.';
    if (p.coins < pk.cost) return `You need ${pk.cost} coins.`;
    p.coins -= pk.cost; p.opened[type] = true;
    p.pending = { type, options: [...s.shop.packs[type]] };
    return null;
  }
  function skipPack(s, pid) { P(s, pid).pending = null; return null; }

  function choosePack(s, pid, choice, face) {
    const p = P(s, pid), pd = p.pending;
    if (!pd) return 'Open a pack first.';
    if (!pd.options.includes(choice)) return 'That card is not in the pack.';
    if (pd.type === 'kitten') {
      const err = addJoker(s, p, choice, 0);
      if (err) return err;
    } else if (pd.type === 'star') {
      if (p.levels[choice] >= MAX_LEVEL) return `${STARS[choice].label} are already at level ${MAX_LEVEL}.`;
      p.levels[choice]++;
      p.bought.push(`${STARS[choice].name} (${STARS[choice].label} Lv ${p.levels[choice]})`);
    } else if (pd.type === 'fortune') {
      const err = applyFortune(s, pid, choice, face);
      if (err) return err;
    }
    p.pending = null;
    return null;
  }

  const copiesOf = (s, face) => s.deck.filter(u => s.cards[u].f === face);

  function applyFortune(s, pid, kind, face) {
    const p = P(s, pid);
    if (p.edited) return 'You already changed the deck this shop.';
    const copies = copiesOf(s, face);
    if (kind === 'twin') {
      if (!copies.length) return 'That card is not in the deck, so there is nothing to copy.';
      if (s.deck.length >= DECK_MAX) return `The deck is at its ${DECK_MAX}-card limit.`;
      const uid = s.nextUid++;
      s.cards[uid] = { uid, f: face, mod: { owner: pid, kind: 'scent' } };
      s.deck.push(uid);
      p.edited = true; p.bought.push(`a twin of ${faceName(face)}`);
      return null;
    }
    if (kind === 'eat') {
      if (!copies.length) return 'That card is not in the deck.';
      if (s.deck.length <= DECK_MIN) return `The deck can't go below ${DECK_MIN} cards.`;
      const target = copies.find(u => s.cards[u].mod && s.cards[u].mod.owner !== pid) ?? copies.find(u => !s.cards[u].mod) ?? copies[0];
      s.deck = s.deck.filter(u => u !== target);
      p.edited = true; p.bought.push(`ate ${faceName(face)}`);
      return null;
    }
    if (!MODS.includes(kind)) return 'Unknown fortune.';
    if (!copies.length) return 'That card is not in the deck.';
    const free = copies.find(u => !s.cards[u].mod);
    if (free === undefined) return 'Every copy of that card already carries an effect.';
    s.cards[free].mod = { owner: pid, kind };
    p.edited = true; p.bought.push(`${FORTUNES[kind].name} on ${faceName(face)}`);
    return null;
  }

  function deckEdit(s, pid, face, kind) {
    const p = P(s, pid);
    if (s.phase !== 'shop') return 'The shop is closed.';
    if (p.edited) return 'You already changed the deck this shop.';
    if (p.coins < EDIT_COST[kind]) return `You need ${EDIT_COST[kind]} coins.`;
    const err = applyFortune(s, pid, kind, face);
    if (err) return err;
    p.coins -= EDIT_COST[kind];
    return null;
  }

  function botShop(s, pid) {
    const p = P(s, pid), rng = s.rng;
    for (const jid of s.shop.jokers) if (rng() < 0.6) addJoker(s, p, jid, JOKERS[jid].cost);
    if (p.coins >= 3 && rng() < 0.55 && !openPack(s, pid, 'star')) {
      const pref = p.pending.options.filter(k => p.levels[k] < MAX_LEVEL);
      if (pref.length) choosePack(s, pid, pick(pref, rng)); else skipPack(s, pid);
    }
    if (p.coins >= 4 && p.jokers.length < MAX_JOKERS && rng() < 0.45 && !openPack(s, pid, 'kitten')) {
      const opts = p.pending.options.filter(j => !p.jokers.includes(j));
      if (opts.length) choosePack(s, pid, opts[0]); else skipPack(s, pid);
    }
    const highFaces = () => { const out = []; for (let f = 40; f < 52; f++) if (copiesOf(s, f).some(u => !s.cards[u].mod)) out.push(f); return out; };
    if (!p.edited && p.coins >= 4 && rng() < 0.5 && !openPack(s, pid, 'fortune')) {
      const kind = p.pending.options[0];
      let face;
      if (kind === 'eat') {
        const rival = s.deck.filter(u => s.cards[u].mod && s.cards[u].mod.owner !== pid);
        face = rival.length ? s.cards[pick(rival, rng)].f : pick(highFaces().length ? highFaces() : [48], rng);
      } else if (kind === 'tabby') face = Math.floor(rng() * 52);
      else face = pick(highFaces().length ? highFaces() : [51], rng);
      if (choosePack(s, pid, kind, face)) skipPack(s, pid);
    }
    if (!p.edited && p.coins >= 3 && rng() < 0.5) {
      const hf = highFaces();
      if (hf.length) deckEdit(s, pid, pick(hf, rng), rng() < 0.55 ? 'scent' : 'hairball');
    }
    p.pending = null;
  }

  // ---------- hands ----------
  function startHand(s) {
    s.handNo++;
    s.houseRule = s.nextHouse;
    s.pot = 0;
    const deck = shuffle([...s.deck], s.rng);
    const N = s.players.length;
    const per = Math.min(13, Math.floor((deck.length - STOCK_MIN) / N));
    s.stock = deck.slice(per * N);
    s.discards = [];
    s.rev = s.houseRule === 'flip';
    s.players.forEach((p, i) => {
      p.hand = sortHand(s, deck.slice(i * per, i * per + per));
      p.dealt = per;
      Object.assign(p, { mustDiscard: false, drawn: null, digs: 0, mult: 1 + (has(p, 'kitten') ? p.kittenStacks : 0), pounced: false, tricksWon: 0, usedCopycat: false, usedOff: false, zoomDone: false, hissUsed: false });
    });
    let leader;
    if (s.handNo === 1) {
      let best = null;
      s.players.forEach(p => p.hand.forEach(u => { if (best === null || faceOf(s, u) < faceOf(s, best) || (faceOf(s, u) === faceOf(s, best) && u < best)) best = u; }));
      leader = s.players.findIndex(p => p.hand.includes(best));
      s.mustLead = best;
    } else { leader = s.nextLeader; s.mustLead = null; }
    s.trick = newTrick(leader);
    s.turn = leader;
    s.phase = 'play';
    s.lastResult = null;
    ev(s, 'deal', { leader, per, house: s.houseRule });
    log(s, `Hand ${s.handNo} of ${s.maxHands}: ${HOUSE[s.houseRule].name}. ${per} cards each from a ${deck.length}-card deck, ${s.stock.length} in the litter box. ${P(s, leader).name} leads.`, 'head');
  }
  const newTrick = leader => ({ leader, play: null, lastBy: null, passedEver: new Set(), out: new Set(), forced: null });

  function checkPlay(s, pid, cards) {
    const p = P(s, pid), t = s.trick;
    if (s.phase !== 'play' || s.turn !== pid) return { err: "It isn't your turn." };
    if (p.mustDiscard) return { err: 'Bury one card first: pick it and press Discard.' };
    if (!cards.length) return { err: 'Pick some cards first.' };
    if (!cards.every(c => p.hand.includes(c))) return { err: 'Those cards are not in your hand.' };
    const cb = classify(s, cards, optFor(s, p));
    if (!cb) return { err: cards.length === 4 ? 'Four cards only work as four of a kind with If It Fits, I Sits.' : "That isn't a playable combo." };
    if (!t.play) {
      if (s.mustLead !== null && !cards.includes(s.mustLead)) return { err: `The first play of the match must include the ${cardName(s, s.mustLead)}.` };
      return { combo: cb };
    }
    const cur = t.play.combo;
    if (cb.type !== cur.type) return { err: `Beat the ${cur.label.toLowerCase()} with ${cur.size} card${cur.size > 1 ? 's' : ''} of the same kind, or pass.` };
    if (beats(cb, cur)) return { combo: cb };
    if (has(p, 'copycat') && !p.usedCopycat && copyTie(cb, cur)) return { combo: cb, copycat: true };
    if (cb.key === cur.key) return { err: 'An identical play ties, and a tie doesn\'t beat.' };
    return { err: `That ${cb.label.toLowerCase()} doesn't beat the one on the table.` };
  }

  function enumerate(s, hand, opt = {}) {
    const byRank = Array.from({ length: 13 }, () => []);
    hand.forEach(u => byRank[rankOf(s, u)].push(u));
    byRank.forEach(a => sortHand(s, a));
    const isWild = u => !!(s.cards[u].mod && s.cards[u].mod.kind === 'tabby');
    const wilds = hand.filter(isWild);
    const bySuit = [[], [], [], []];
    hand.forEach(u => { if (!isWild(u)) bySuit[suitOfF(faceOf(s, u))].push(u); });
    bySuit.forEach((a, i) => { bySuit[i] = sortHand(s, [...a, ...wilds]); });
    const out = [], seen = new Set();
    const add = cards => {
      if (new Set(cards).size !== cards.length) return;
      const sorted = sortHand(s, [...cards]);
      const sig = sorted.map(u => faceOf(s, u) + (isWild(u) ? 'w' : '')).join(',');
      if (seen.has(sig)) return;
      const cb = classify(s, sorted, opt);
      if (cb) { seen.add(sig); out.push({ cards: sorted, combo: cb }); }
    };
    hand.forEach(u => add([u]));
    byRank.forEach(g => {
      if (g.length >= 2) combos(g, 2).forEach(add);
      if (g.length >= 3) combos(g, 3).slice(0, 12).forEach(add);
      if (g.length >= 4 && opt.quad4) combos(g, 4).slice(0, 6).forEach(add);
      if (g.length >= 5) combos(g, 5).slice(0, 6).forEach(add);
    });
    for (let t = 0; t < 13; t++) {
      if (byRank[t].length >= 3) {
        const trip = byRank[t].slice(0, 3);
        for (let q = 0; q < 13; q++) if (q !== t && byRank[q].length >= 2) add([...trip, ...byRank[q].slice(0, 2)]);
      }
      if (byRank[t].length >= 4) {
        const kicker = hand.filter(u => rankOf(s, u) !== t).sort((a, b) => faceOf(s, a) - faceOf(s, b))[0];
        if (kicker !== undefined) add([...byRank[t].slice(0, 4), kicker]);
      }
    }
    for (let st = 1; st <= 10; st++) {
      const ranks = [0, 1, 2, 3, 4].map(i => { const nat = st + i; return nat === 1 || nat === 14 ? 11 : nat === 2 ? 12 : nat - 3; });
      if (ranks.every(r => byRank[r].length)) {
        add(ranks.map(r => byRank[r][0]));
        add(ranks.map((r, i) => (i === 4 ? byRank[r][byRank[r].length - 1] : byRank[r][0])));
      }
      for (let su = 0; su < 4; su++) {
        const used = new Set();
        const cards = ranks.map(r => { const u = byRank[r].find(x => !used.has(x) && (suitOfF(faceOf(s, x)) === su || isWild(x))); if (u !== undefined) used.add(u); return u; });
        if (cards.every(u => u !== undefined)) add(cards);
      }
    }
    bySuit.forEach(g => {
      if (g.length >= 5) {
        add(g.slice(0, 5));
        for (let i = 5; i < g.length; i++) add([...g.slice(0, 4), g[i]]);
      }
    });
    return out;
  }
  const legalBeats = (s, pid) => enumerate(s, P(s, pid).hand, optFor(s, P(s, pid))).filter(o => !checkPlay(s, pid, o.cards).err);

  function passBlock(s, pid) {
    const p = P(s, pid), t = s.trick;
    if (s.phase !== 'play' || s.turn !== pid) return "It isn't your turn.";
    if (p.mustDiscard) return 'Bury one card first.';
    if (!t.play) return 'You are leading, so you have to play.';
    const locked = p.pounced || t.forced === pid;
    if (locked && legalBeats(s, pid).length) return p.pounced ? "You've pounced, so you must beat the play when you can." : 'Off the Table: you must beat this lead if you can.';
    return null;
  }
  const canPounce = (s, pid) => {
    const p = P(s, pid);
    return s.phase === 'play' && s.turn === pid && !p.mustDiscard && !p.pounced && p.hand.length <= 5 && p.fish >= POUNCE_COST;
  };
  const canDig = (s, pid) => s.phase === 'play' && s.stock.length > 0 && !passBlock(s, pid);

  function doPass(s, pid, how, kind = 'pass') {
    const p = P(s, pid), t = s.trick;
    t.passedEver.add(pid);
    if (s.houseRule === 'bath') t.out.add(pid);
    let extra = '';
    if (s.houseRule === 'vacuum' && p.fish > 0) { p.fish -= 1; s.pot += 1; extra = ' (−1 fish to the pot)'; }
    log(s, `${how}${extra}.`, 'pass');
    ev(s, 'pass', { pid, kind, vacuum: !!extra });
    const lb = t.lastBy !== null ? P(s, t.lastBy) : null;
    if (lb && jcount(lb, 'alley')) { lb.coins += jcount(lb, 'alley'); ev(s, 'coin', { pid: lb.id, n: jcount(lb, 'alley'), why: 'Alley Cat' }); }
    advance(s, pid);
  }

  function act(s, pid, a) {
    if (a.type === 'pounce') {
      if (!canPounce(s, pid)) return 'You can pounce on your turn with 5 or fewer cards and at least 5 fish.';
      const p = P(s, pid);
      p.fish -= POUNCE_COST; s.pot += POUNCE_COST; p.pounced = true;
      const gain = has(p, 'lasereyes') ? 2 : 1;
      p.mult = Math.min(capOf(s, p), p.mult + gain);
      ev(s, 'pounce', { pid, mult: p.mult, gain });
      log(s, `${p.name} pounces! 5 fish into the pot, Mult ×${p.mult}${gain > 1 ? ' (Laser Eyes)' : ''}.`, 'pounce');
      return null;
    }
    if (a.type === 'pass') {
      const err = passBlock(s, pid);
      if (err) return err;
      doPass(s, pid, `${P(s, pid).name} passes`);
      return null;
    }
    if (a.type === 'dig') {
      const err = passBlock(s, pid);
      if (err) return err;
      if (!s.stock.length) return 'The litter box is empty.';
      const p = P(s, pid);
      const u = s.stock.shift();
      p.hand = sortHand(s, [...p.hand, u]);
      p.drawn = u; p.mustDiscard = true; p.digs++;
      log(s, `${p.name} digs in the litter box (${s.stock.length} left).`, 'dig');
      ev(s, 'dig', { pid, uid: u });
      return null;
    }
    if (a.type === 'discard') {
      const p = P(s, pid);
      if (s.phase !== 'play' || s.turn !== pid || !p.mustDiscard) return 'You can only discard right after digging.';
      if (!p.hand.includes(a.card)) return 'That card is not in your hand.';
      p.hand = p.hand.filter(u => u !== a.card);
      s.discards.push(a.card);
      p.mustDiscard = false; p.drawn = null;
      ev(s, 'discard', { pid, uid: a.card });
      doPass(s, pid, `${p.name} buries ${cardName(s, a.card)} in the litter tray`, 'bury');
      return null;
    }
    if (a.type === 'play') {
      const r = checkPlay(s, pid, a.cards);
      if (r.err) return r.err;
      const p = P(s, pid), t = s.trick;
      p.hand = p.hand.filter(c => !a.cards.includes(c));
      if (r.copycat) p.usedCopycat = true;
      t.play = { cards: sortHand(s, [...a.cards]), combo: r.combo, by: pid };
      t.lastBy = pid;
      s.mustLead = null;
      let flipped = false;
      const need = has(p, 'bellyup') ? 3 : s.houseRule === 'flip' ? 4 : 99;
      if (need < 99) {
        const cnt = {};
        a.cards.forEach(u => { const rr = rankOf(s, u); cnt[rr] = (cnt[rr] || 0) + 1; });
        if (Object.values(cnt).some(c => c >= need)) { s.rev = !s.rev; flipped = true; t.play.combo = classify(s, t.play.cards, optFor(s, p)); }
      }
      log(s, `${p.name} plays ${r.combo.label.toLowerCase()}: ${t.play.cards.map(u => cardName(s, u)).join(', ')}${r.copycat ? ' (Copycat match)' : ''}.`, 'play');
      ev(s, 'play', { pid, cards: [...t.play.cards], label: t.play.combo.label, copycat: !!r.copycat, out: !p.hand.length });
      if (flipped) ev(s, 'flip', { pid, rev: s.rev });
      if (flipped) log(s, s.rev ? 'Upside-down! Rank order is reversed: 3 is now the highest rank, 2 the lowest.' : 'Flipped back: 2 is the highest rank again.', 'pounce');
      a.cards.forEach(u => {
        const m = s.cards[u].mod;
        if (m && m.kind === 'gold') { P(s, m.owner).coins += 1; ev(s, 'coin', { pid: m.owner, n: 1, why: 'Golden Collar' }); log(s, `Golden Collar: ${P(s, m.owner).name} +1 coin.`, 'joker'); }
      });
      if (!p.hand.length) { winTrick(s, pid, true); endHand(s, pid); return null; }
      advance(s, pid);
      return null;
    }
    return 'Unknown action.';
  }

  function advance(s, from) {
    const t = s.trick;
    let i = from;
    for (let k = 0; k < 8; k++) {
      i = (i + 1) % s.players.length;
      if (i === t.lastBy) { winTrick(s, i, false); return; }
      if (t.out.has(i)) continue;
      s.turn = i;
      return;
    }
  }

  function multGain(s, w) {
    const p = P(s, w), t = s.trick, cb = t.play.combo, parts = [];
    const lvl = cb.cat === 'legend' ? 1 : p.levels[cb.cat];
    const base = BASE_GAIN[cb.cat] + (lvl - 1);
    if (base) parts.push([`${cb.label}${lvl > 1 ? ` Lv ${lvl}` : ''}`, base]);
    const add = (j, label, n) => { const c = jcount(p, j); if (c) parts.push([label, n * c]); };
    if (t.passedEver.has(w)) add('loaf', 'Loaf', 1);
    if (!p.zoomDone && has(p, 'zoomies')) { add('zoomies', '3am Zoomies', 1); p.zoomDone = true; }
    if (t.play.cards.some(u => rankOf(s, u) === 12)) add('chonk', 'Big Chonk', 1);
    if (cb.type === 'pair') add('kneading', 'Kneading', 1);
    let scents = 0, vases = [];
    t.play.cards.forEach(u => {
      const m = s.cards[u].mod;
      if (m && m.owner === w && m.kind === 'scent') scents++;
      if (m && m.owner === w && m.kind === 'vase') vases.push(u);
    });
    if (scents) parts.push([`Scent mark${scents > 1 ? 's' : ''}`, scents]);
    if (vases.length) { parts.push(['Fragile Vase', 2 * vases.length]); vases.forEach(u => { s.cards[u].mod = null; }); }
    return { parts, vases: vases.length };
  }

  function winTrick(s, w, final) {
    const p = P(s, w);
    const { parts, vases } = multGain(s, w);
    let total = parts.reduce((a, b) => a + b[1], 0);
    let why = parts.length ? ` ${parts.map(([n, v]) => `${n} +${v}`).join(', ')}` : '';
    if (total >= 2) {
      const hisser = s.players.find(o => o.id !== w && has(o, 'hiss') && !o.hissUsed);
      if (hisser) { hisser.hissUsed = true; total = 0; why += `, but ${hisser.name}'s Hiss cancels it`; var hissBy = hisser.id; }
    }
    const before = p.mult;
    p.mult = Math.min(capOf(s, p), p.mult + total);
    p.tricksWon++;
    ev(s, 'trick', { pid: w, parts, total, mult: p.mult, capped: p.mult < before + total, hissBy: typeof hissBy === 'number' ? hissBy : null, vases, final });
    log(s, `${p.name} wins the trick.${why}${total ? ` → Mult ×${p.mult}${p.mult < before + total ? ' (capped)' : ''}` : ''}.${vases ? ' The vase breaks.' : ''}`, 'win');
    if (final) return;
    s.trick = newTrick(w);
    if (has(p, 'offtable') && !p.usedOff) {
      p.usedOff = true;
      s.trick.forced = (w + 1) % s.players.length;
      ev(s, 'forced', { pid: (w + 1) % s.players.length, by: w });
      log(s, `Off the Table: ${P(s, (w + 1) % s.players.length).name} can't pass on ${p.name}'s lead if they can beat it.`, 'joker');
    }
    s.turn = w;
  }

  const penaltyCards = (n, dealt) => (n === dealt && n >= 10 ? n * 3 : n >= 10 ? n * 2 : n);

  function endHand(s, w) {
    const W = P(s, w);
    const rows = [];
    let biggest = null;
    s.players.forEach(L => {
      if (L.id === w) return;
      const n = L.hand.length;
      const base = penaltyCards(n, L.dealt);
      let pay = base * W.mult;
      const notes = [];
      const boxes = L.hand.filter(u => s.cards[u].mod && s.cards[u].mod.kind === 'box' && s.cards[u].mod.owner === L.id).length;
      if (boxes) { pay = Math.max(0, pay - BOX_SAVE * boxes); notes.push(`Cardboard Box saved ${BOX_SAVE * boxes}`); }
      if (has(L, 'ninelives') && !L.nineUsed && pay >= 8) { pay = Math.ceil(pay / 2); L.nineUsed = true; notes.push('Nine Lives halved it'); }
      pay = Math.min(pay, Math.max(L.fish, 0));
      L.fish -= pay; W.fish += pay;
      let fines = 0;
      L.hand.forEach(u => {
        const m = s.cards[u].mod;
        if (m && m.kind === 'hairball' && m.owner !== L.id) {
          const amt = Math.min(HAIRBALL_FINE, Math.max(L.fish, 0));
          L.fish -= amt; P(s, m.owner).fish += amt; fines += amt;
        }
      });
      rows.push({ id: L.id, cards: n, base, mult: W.mult, pay, fines, note: notes.join('; '), leftover: [...L.hand] });
      if (!biggest || pay + fines > biggest.total) biggest = { id: L.id, total: pay + fines };
    });
    const pot = s.pot;
    W.fish += pot; s.pot = 0;
    if (has(W, 'kitten')) W.kittenStacks = Math.min(3, W.kittenStacks + 1);
    const income = {};
    s.players.forEach(p => {
      const icap = 3 + 2 * jcount(p, 'fatcat');
      let inc = 4 + p.tricksWon + Math.min(icap, Math.floor(p.coins / 5));
      if (p.tricksWon === 0) inc += 3 * jcount(p, 'catnap');
      inc += 2 * jcount(p, 'tuxedo');
      if (biggest && p.id === biggest.id) inc += 2;
      p.coins += inc; income[p.id] = inc;
    });
    s.nextLeader = biggest ? biggest.id : w;
    s.lastResult = { winner: w, mult: W.mult, pot, rows, income, hand: s.handNo };
    ev(s, 'handEnd', { ...s.lastResult });
    log(s, `${W.name} sheds every card and collects ${rows.reduce((a, r) => a + r.pay, 0)} fish${pot ? ` plus a ${pot}-fish pot` : ''}.`, 'head');
    const over = s.handNo >= s.maxHands || s.players.some(p => p.fish <= 0);
    if (over) finishMatch(s); else s.phase = 'handEnd';
  }

  function finishMatch(s) {
    s.phase = 'matchEnd';
    const order = [...s.players].sort((a, b) => b.fish - a.fish || a.id - b.id);
    s.standings = order.map((p, i) => ({ id: p.id, name: p.name, fish: p.fish, place: i + 1, points: PLACEMENTS[s.players.length][i] }));
  }

  // ---------- bots ----------
  function botDiscard(s, pid) {
    const p = P(s, pid);
    const hair = p.hand.find(u => s.cards[u].mod && s.cards[u].mod.kind === 'hairball' && s.cards[u].mod.owner !== pid);
    if (hair !== undefined) return hair;
    const cnt = {};
    p.hand.forEach(u => { const r = rankOf(s, u); cnt[r] = (cnt[r] || 0) + 1; });
    const lone = p.hand.filter(u => cnt[rankOf(s, u)] === 1 && !(s.cards[u].mod && s.cards[u].mod.owner === pid));
    const pool = lone.length ? lone : p.hand;
    return pool.reduce((best, u) => (effRank(s, u) < effRank(s, best) ? u : best), pool[0]);
  }

  function botChoose(s, pid) {
    const p = P(s, pid), t = s.trick, rng = s.botRng || s.rng;
    if (p.mustDiscard) return { type: 'discard', card: botDiscard(s, pid) };
    const passOrDig = () => {
      if (canDig(s, pid)) {
        const cnt = {};
        p.hand.forEach(u => { const r = rankOf(s, u); cnt[r] = (cnt[r] || 0) + 1; });
        const junk = p.hand.some(u => cnt[rankOf(s, u)] === 1 && effRank(s, u) <= 4);
        if (junk && rng() < 0.4) return { type: 'dig' };
      }
      return { type: 'pass' };
    };
    if (canPounce(s, pid)) {
      const strong = p.hand.filter(u => effRank(s, u) >= 11).length;
      if (((strong >= 2 && p.hand.length <= 4) || p.hand.length <= 2) && rng() < 0.3) return { type: 'pounce' };
    }
    const opts = enumerate(s, p.hand, optFor(s, p));
    const others = s.players.filter(o => o.id !== pid);
    const threat = Math.min(...others.map(o => o.hand.length));
    const nextP = P(s, (pid + 1) % s.players.length);
    if (!t.play) {
      const cand = s.mustLead !== null ? opts.filter(o => o.cards.includes(s.mustLead)) : opts;
      const whole = cand.find(o => o.cards.length === p.hand.length);
      if (whole) return { type: 'play', cards: whole.cards };
      let best = null, bestScore = Infinity;
      cand.forEach(o => {
        const rs = o.cards.map(u => effRank(s, u));
        let sc = Math.min(...rs) * 3 + Math.max(...rs) * 0.5 - o.cards.length * 2.2;
        if (o.cards.length === 1 && nextP.hand.length === 1) sc += 25;
        if (rs.includes(12) && p.hand.length > 3) sc += 8;
        if (has(p, 'bellyup') && o.cards.length >= 3 && p.hand.filter(u => effRank(s, u) <= 3).length >= 4) sc -= 10;
        if (o.cards.length === 1) { const same = p.hand.filter(u => effRank(s, u) === rs[0]).length; if (same >= 2) sc += 4; }
        if (o.cards.some(u => s.cards[u].mod && s.cards[u].mod.kind === 'hairball' && s.cards[u].mod.owner !== pid)) sc -= 3;
        if (sc < bestScore) { bestScore = sc; best = o; }
      });
      return { type: 'play', cards: best.cards };
    }
    const beatsList = opts.filter(o => !checkPlay(s, pid, o.cards).err);
    if (!beatsList.length) return passOrDig();
    const goOut = beatsList.find(o => o.cards.length === p.hand.length);
    if (goOut) return { type: 'play', cards: goOut.cards };
    beatsList.sort((a, b) => a.combo.key - b.combo.key);
    const mustPlay = p.pounced || t.forced === pid;
    if (threat <= 2) return { type: 'play', cards: beatsList[beatsList.length - 1].cards };
    const choice = beatsList[0];
    if (!mustPlay) {
      const usesTop = choice.cards.some(u => effRank(s, u) === 12);
      const breaks = choice.cards.length === 1 && p.hand.filter(u => rankOf(s, u) === rankOf(s, choice.cards[0])).length >= 2;
      if (usesTop && p.hand.length > 4 && rng() < 0.65) return passOrDig();
      if (breaks && rng() < 0.5) return passOrDig();
    }
    return { type: 'play', cards: choice.cards };
  }

  return {
    SUITS, SUIT_NAMES, RANKS, rankOfF, suitOfF, faceName, faceOf, rankOf, cardName, classifyObjs, classify, beats, enumerate,
    JOKERS, JOKER_IDS, STARS, STAR_IDS, BASE_GAIN, MAX_LEVEL, FORTUNES, FORTUNE_IDS, PACKS, HOUSE, EDIT_COST,
    MAX_JOKERS, POUNCE_COST, HAIRBALL_FINE, BOX_SAVE, PLACEMENT, PLACEMENTS, DECK_MIN, DECK_MAX, BASE_CAP,
    newMatch, openShop, startHand, buy, sell, moveJoker, openPack, choosePack, skipPack, deckEdit, copiesOf,
    act, checkPlay, passBlock, canPounce, canDig, botChoose, botDiscard, effRank, STOCK_MIN, capOf, penaltyCards, legalBeats, jcount, has,
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
