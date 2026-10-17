(() => {
  const E = Engine, A = Art;
  const COATS = ['black', 'calico', 'tabby', 'white'];
  const COLORS = ['var(--p0)', 'var(--p1)', 'var(--p2)', 'var(--p3)'];
  const CW = 58, CH = 81.2;
  const $ = id => document.getElementById(id);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const youify = t => t.replace(/^You plays/, 'You play').replace(/^You passes/, 'You pass').replace(/^You pounces/, 'You pounce').replace(/^You wins/, 'You win')
    .replace(/^You sheds every card and collects/, 'You shed every card and collect').replace(/^You digs/, 'You dig').replace(/^You buries/, 'You bury').replace(/You's/g, 'your');
  const reducedOS = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- prefs ----------
  const prefs = { speed: 1, sound: true, reduced: reducedOS, name: '', opps: 3 };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('shed-v2-prefs') || '{}')); } catch (e) {}
  const savePrefs = () => { try { localStorage.setItem('shed-v2-prefs', JSON.stringify(prefs)); } catch (e) {} };
  const fast = !!window.__fast;
  const D = ms => (fast || ui.skip ? 0 : ms / prefs.speed * (prefs.reduced ? 0.6 : 1));
  const wait = ms => new Promise(r => setTimeout(r, D(ms)));

  // ---------- sound (synthesised stubs) ----------
  const SND = (() => {
    let ctx = null, master = null, nb = null;
    function ensure() {
      if (!prefs.sound || fast) return null;
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination); } catch (e) { return null; }
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(f, d, type = 'sine', g = 0.12, slide = 0, delay = 0) {
      const c = ensure(); if (!c) return;
      const t = c.currentTime + delay, o = c.createOscillator(), a = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
      a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + 0.01); a.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(a); a.connect(master); o.start(t); o.stop(t + d + 0.03);
    }
    function noise(d, g = 0.2, freq = 2000, q = 1, type = 'bandpass') {
      const c = ensure(); if (!c) return;
      if (!nb) { nb = c.createBuffer(1, c.sampleRate, c.sampleRate); const ch = nb.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
      const src = c.createBufferSource(), f = c.createBiquadFilter(), a = c.createGain(), t = c.currentTime;
      src.buffer = nb; f.type = type; f.frequency.value = freq; f.Q.value = q;
      a.gain.setValueAtTime(g, t); a.gain.exponentialRampToValueAtTime(0.0001, t + d);
      src.connect(f); f.connect(a); a.connect(master); src.start(t); src.stop(t + d + 0.03);
    }
    return {
      unlock: ensure,
      slap() { noise(0.09, 0.5, 1300, 0.8); }, card() { noise(0.05, 0.22, 3600, 1); }, pass() { tone(250, 0.12, 'triangle', 0.06, -60); },
      purr(lv) { for (let i = 0; i < 5; i++) tone(46 + lv * 7, 0.07, 'sawtooth', 0.045, 0, i * 0.07); tone(380 + lv * 70, 0.12, 'sine', 0.05, 120, 0.05); },
      coin(i = 0) { tone(1100 + i * 90, 0.09, 'square', 0.03); }, tick(i = 0) { tone(560 + i * 22, 0.05, 'triangle', 0.05); },
      whoosh() { noise(0.35, 0.25, 700, 0.5, 'lowpass'); }, scratch() { tone(520, 0.35, 'sawtooth', 0.05, -430); noise(0.3, 0.14, 1200, 2); },
      chirp() { tone(880, 0.09, 'sine', 0.08, 500); tone(1250, 0.1, 'sine', 0.06, 300, 0.1); }, hiss() { noise(0.45, 0.16, 6000, 0.7, 'highpass'); }, sweep() { noise(0.22, 0.18, 2600, 0.6); },
    };
  })();
  window.addEventListener('pointerdown', () => SND.unlock(), { once: true });

  // ---------- state ----------
  let s, scale = 1, busy = false, timer = null;
  let ME = 0;                     // the seat this page plays; 0 in solo, assigned by the host in a room
  const BOT_NAMES = ['Kit', 'Mochi', 'Biscuit', 'Tofu'];
  const isOnline = () => net.mode !== 'solo';
  const oppIds = () => s.players.map((_, k) => (ME + 1 + k) % s.players.length).slice(0, s.players.length - 1);
  const ui = { ov: null, sel: new Set(), msg: { text: '', cls: '' }, sortBySuit: false, pile: [], thinking: null, dealing: false, bump: null, skip: false,
    editMode: 'scent', fortunePick: null, shopMsg: '', shopOk: false, shopAnim: false, anyway: false, hissFlash: new Set(),
    opps: 3, inGame: false, back: null, code: '', roomMsg: '' };
  let firstVisit = true;
  try { firstVisit = !localStorage.getItem('shed-v2-rules-seen'); } catch (e) {}

  // ---------- stage ----------
  const stage = $('stage'), fx = $('fx'), ov = $('ov');
  // ---------- tooltips: hover with a mouse, press and hold on touch ----------
  let tipFor = null, tipTimer = null, pressTimer = null, longPress = false, pressXY = null, msgTimer = null;
  const tipEl = document.createElement('div');
  tipEl.className = 'tip'; tipEl.hidden = true; tipEl.setAttribute('role', 'tooltip');
  stage.appendChild(tipEl);
  function showTip(t) {
    if (!t || !t.isConnected || !t.dataset.tt) return;
    tipFor = t;
    tipEl.innerHTML = `<b>${esc(t.dataset.tt)}</b>${t.dataset.tb ? `<span>${esc(t.dataset.tb.charAt(0).toUpperCase() + t.dataset.tb.slice(1))}</span>` : ''}`;
    tipEl.hidden = false;
    const r = rectOf(t), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    const x = Math.max(6, Math.min(1024 - w - 6, r.x + r.w / 2 - w / 2));
    let y = r.y - h - 8;
    if (y < 6) y = r.y + r.h + 8;
    if (y + h > 570) y = Math.max(6, 570 - h);
    tipEl.style.left = `${x}px`; tipEl.style.top = `${y}px`;
    tipEl.classList.remove('in'); void tipEl.offsetWidth; tipEl.classList.add('in');
  }
  function hideTip() { clearTimeout(tipTimer); tipFor = null; tipEl.hidden = true; }
  stage.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const t = e.target.closest('[data-tt]');
    if (t === tipFor) return;
    clearTimeout(tipTimer);
    if (!t) { hideTip(); return; }
    if (tipFor) showTip(t); else tipTimer = setTimeout(() => showTip(t), 320);
  });
  stage.addEventListener('pointerleave', hideTip);
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') { hideTip(); return; }
    longPress = false; clearTimeout(pressTimer); hideTip();
    const t = e.target.closest('[data-tt]');
    if (!t) return;
    pressXY = [e.clientX, e.clientY];
    pressTimer = setTimeout(() => { longPress = true; showTip(t); if (navigator.vibrate) try { navigator.vibrate(8); } catch (err) {} }, 380);
  });
  stage.addEventListener('pointerup', e => { if (e.pointerType === 'mouse') return; clearTimeout(pressTimer); if (longPress) setTimeout(hideTip, 900); });
  stage.addEventListener('pointercancel', () => { clearTimeout(pressTimer); hideTip(); });
  stage.addEventListener('pointermove', e => { if (pressXY && e.pointerType !== 'mouse' && Math.hypot(e.clientX - pressXY[0], e.clientY - pressXY[1]) > 10) clearTimeout(pressTimer); });
  stage.addEventListener('contextmenu', e => { if (e.target.closest('[data-tt]')) e.preventDefault(); });
  stage.addEventListener('click', e => { if (longPress) { longPress = false; e.preventDefault(); e.stopPropagation(); } }, true);
  stage.addEventListener('focusin', e => { const t = e.target.closest('[data-tt]'); if (t && e.target.matches(':focus-visible')) showTip(t); });
  stage.addEventListener('focusout', hideTip);
  function flash(text, cls = 'err') {
    ui.msg = { text, cls }; renderHand();
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { if (ui.msg.text === text) { ui.msg = { text: '', cls: '' }; renderHand(); } }, 2600);
  }
  function fit() {
    const vp = $('viewport'), cs = getComputedStyle(vp);
    const w = vp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = vp.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    scale = Math.max(0.2, Math.min(w / 1024, h / 576));
    stage.style.setProperty('--k', scale); stage.style.setProperty('--tz', Math.max(1, Math.min(1.5, 0.9 / scale)).toFixed(3));
    const portraitPhone = window.innerHeight > window.innerWidth && window.innerWidth < 760;
    const rot = $('rotate');
    if (rot) rot.hidden = !(portraitPhone && !ui.anyway);
  }
  window.addEventListener('resize', fit);
  function rectOf(el) {
    const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    return { x: (r.left - sr.left) / scale, y: (r.top - sr.top) / scale, w: r.width / scale, h: r.height / scale };
  }
  const center = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  // ---------- cards ----------
  const MOD_SVG = {
    hairball: c => `<path d="M2 6c1-3 4-4 6-2s-1 5-3 4-1-4 2-4 3 3 1 5" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
    gold: c => `<circle cx="6" cy="6" r="4" fill="none" stroke="${c}" stroke-width="1.8"/><circle cx="6" cy="10" r="1.6" fill="${c}"/>`,
    box: c => `<path d="M2 4.5h8v6H2zM2 4.5l2-2.5h4l2 2.5" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/>`,
    tabby: c => `<path d="M2 3l3 6M5 2l3 7M8 2l2 4" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
    vase: c => `<path d="M4.5 1.5h3M5 2v2C3 5 2.5 7 3 9s2 2.5 3 2.5S8.5 11 9 9s-1-4-2-5V2" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"/>`,
  };
  const pname = id => s.players[id].name;
  function badge(m) {
    if (!m) return '';
    const who = esc(pname(m.owner));
    const tt = ` data-tt="${esc(E.FORTUNES[m.kind].name)} · ${who}" data-tb="${esc(E.FORTUNES[m.kind].text)}"`;
    if (m.kind === 'scent') return `<span class="mk" style="background:${COLORS[m.owner]}"${tt}></span>`;
    return `<span class="mk ic"${tt}><svg viewBox="0 0 12 12">${MOD_SVG[m.kind](COLORS[m.owner])}</svg></span>`;
  }
  const SUIT_COLOR = { fish: '#2464b0', yarn: '#c2304f', mice: '#5f528a', paws: '#b06512' };
  function faceHTML(f, { mod = null, cls = '', tag = 'div', attrs = '', style = '' } = {}) {
    const suit = E.SUITS[E.suitOfF(f)], rank = E.RANKS[E.rankOfF(f)];
    const art = A.faceArt(rank, suit, SUIT_COLOR[suit]) || A.centerPip(rank, suit);
    const wild = mod && mod.kind === 'tabby' ? '<span class="wild">any suit</span>' : '';
    const label = `${E.faceName(f)}${mod ? `, ${E.FORTUNES[mod.kind].name} by ${pname(mod.owner)}` : ''}`;
    return `<${tag} class="cd ${cls}" data-suit="${suit}" aria-label="${esc(label)}" ${attrs} style="${style}"><div class="cd-i"><span class="cd-r">${rank}</span><span class="cd-p">${A.pip(suit)}</span><div class="cd-art">${art}</div><span class="cd-r b">${rank}</span>${wild}</div>${badge(mod)}</${tag}>`;
  }
  const cardHTML = (uid, o = {}) => faceHTML(s.cards[uid].f, { ...o, mod: s.cards[uid].mod });
  const backHTML = (style = '', cls = '') => `<div class="cd back ${cls}" style="${style}"><div class="cd-i"><div class="seal">${A.PAW}</div></div></div>`;
  const rotOf = uid => (((uid * 37) % 9) - 4) * 1.3;

  // layouts (in container coordinates)
  function handPos(n, i) {
    const W = 648, sp = n > 1 ? Math.min(64, (W - CW - 24) / (n - 1)) : 0, total = sp * (n - 1) + CW, x0 = (W - total) / 2, mid = (n - 1) / 2, d = i - mid;
    return { x: x0 + i * sp, y: 42 + d * d * 0.5, rot: Math.max(-12, Math.min(12, d * 1.8)) };
  }
  function trickPos(n, i, uid) {
    const W = 508, gap = 8, total = n * CW + (n - 1) * gap, x0 = (W - total) / 2;
    return { x: x0 + i * (CW + gap), y: 18, rot: rotOf(uid) };
  }

  // portraits
  function exprOf(id) {
    if (ui.hissFlash.has(id)) return 'hiss';
    if (ui.thinking === id) return 'think';
    const p = s.players[id];
    if (s.phase === 'play' && (p.mult >= 3 || p.hand.length <= 3)) return 'smug';
    return 'idle';
  }
  const portrait = (id, expr) => A.portrait(COATS[id], expr || exprOf(id));

  // ---------- render ----------
  // tooltip attributes: everything explanatory lives here, shown on hover or press-and-hold
  const tip = (t, b = '') => ` data-tt="${esc(t)}" data-tb="${esc(b)}"`;
  const off = (cond, why) => (cond ? '' : ` aria-disabled="true" data-why="${esc(why || '')}"`);

  function render() {
    renderSide(); renderOpps(); renderTable(); renderMine(); renderHand(); renderActions(); renderShop(); renderOverlay();
    if (tipFor && !tipFor.isConnected) hideTip();
  }

  function renderSide() {
    const me = s.players[ME], playing = s.phase === 'play';
    const house = playing ? s.houseRule : s.nextHouse;
    const cap = E.capOf(s, me), m = playing ? me.mult : 1;
    const pips = Array.from({ length: cap }, (_, i) => `<i class="${i < m ? 'on' : ''}"></i>`).join('');
    const hot = m >= 4 ? 'hot' : '', blaze = m >= 5 ? 'blaze' : '';
    const handNo = playing ? s.handNo : Math.min(s.handNo + 1, s.maxHands);
    $('side').innerHTML = `
      <div class="logo"${tip('Shed! 锄大猫', 'Big Two with cats. Shed every card first and the other cats pay you fish.')}><b>Shed!</b><span>锄大猫</span></div>
      <div class="panel me-card"><div class="por" id="por-${ME}"${tip(isOnline() ? `${me.name} (you)` : 'You', 'Your fish, coins and Mult are on this side of the table.')}>${portrait(ME)}</div><div class="money">
        <div${tip(`${me.fish} fish`, 'Your score. The cat with the most fish after six hands wins.')}>${A.FISH}<span class="num">${me.fish}</span></div>
        <div${tip(`${me.coins} coins`, 'Spend them in the shop between hands. Every 5 you save earns 1 interest, up to 3.')}>${A.COIN}<span class="num">${me.coins}</span></div></div></div>
      <div class="panel meter ${hot} ${blaze}" id="meter"${tip(`Mult ×${m}`, `When you shed your last card, every other cat pays you cards left × Mult. Win tricks with triples or five-card hands to raise it. Cap ×${cap}${me.pounced ? ', raised by your Pounce' : ''}.`)}>
        <div class="lbl">Mult</div><div class="x num ${ui.bump === ME ? 'bump' : ''}">×${m}</div><div class="pips">${pips}</div></div>
      <div class="sign ${house !== 'none' ? 'lit' : ''}"${tip(`${playing ? 'House rule' : 'Next hand'}: ${E.HOUSE[house].name}`, E.HOUSE[house].text)}><div class="nm">${E.HOUSE[house].name}</div></div>
      <div class="panel info">
        <span${tip('Hand', `Hand ${handNo} of ${s.maxHands}.`)}>Hand<br><b class="num">${handNo}/${s.maxHands}</b></span>
        <span${tip('Pot', 'Fish paid for Pounces and by the Vacuum. The cat who goes out takes the pot.')}>Pot<br><b class="num">${s.pot}</b></span>
        <span${tip('Shared deck', `${s.deck.length} cards. Everyone is dealt from it; marks and copies change it.`)}>Deck<br><b class="num">${s.deck.length}</b></span>
        <span${tip('Litter box', 'Face-down cards. Instead of passing you can dig one up and bury a card.')}>Litter<br><b class="num">${playing ? s.stock.length : '–'}</b></span>
      </div>
      <div class="sbtns">
        <button class="sbtn" data-act="rules">Rules</button><button class="sbtn" data-act="log">Log</button>
        <button class="sbtn" data-act="options">Options</button><button class="sbtn" data-act="menu">Menu</button>
      </div>`;
  }

  const jokerBadge = (j, extra = '') => `<span class="ji" data-kind="${E.JOKERS[j].kind}"${tip(E.JOKERS[j].name, `${E.JOKERS[j].rarity} ${E.JOKERS[j].kind.toLowerCase()} joker. ${E.JOKERS[j].text}`)}>${A.icon(E.JOKERS[j].kind)}${extra}</span>`;
  const starBadge = (p, k) => `<span class="sb"${tip(`${E.STARS[k].label} · level ${p.levels[k]}`, `${E.STARS[k].name}: winning a trick with ${E.STARS[k].label.toLowerCase()} gives +${E.BASE_GAIN[k] + p.levels[k] - 1} Mult.`)}>★${p.levels[k]}</span>`;

  function seatHTML(p) {
    const t = s.trick, playing = s.phase === 'play', isTurn = playing && s.turn === p.id;
    const state = [];
    if (playing && p.pounced) state.push(`<span class="chip pounce"${tip('Pounced', `${p.name} paid 5 fish for +1 Mult and can't pass while able to beat the table.`)}>Pounced</span>`);
    if (playing && t && t.out.has(p.id)) state.push(`<span class="chip muted"${tip('Sitting out', 'Bath Time: after passing, this cat sits out until the trick ends.')}>Out</span>`);
    else if (playing && t && t.passedEver.has(p.id) && t.lastBy !== p.id) state.push('<span class="chip muted">Passed</span>');
    if (playing && t && t.forced === p.id) state.push(`<span class="chip"${tip("Can't pass", 'Off the Table: this cat must beat the lead if they can.')}>Forced</span>`);
    const icons = p.jokers.map(j => jokerBadge(j)).join('') + E.STAR_IDS.filter(k => p.levels[k] > 1).map(k => starBadge(p, k)).join('');
    const n = playing && !ui.dealing ? p.hand.length : 0;
    const backs = Array.from({ length: Math.min(n, 13) }, () => '<i></i>').join('');
    const coat = ['a black cat', 'a calico', 'an orange tabby', 'a white cat'][p.id];
    const who = isOnline() ? (p.human ? ' Played by a friend.' : ' A bot.') : '';
    if (s.phase === 'shop' && isOnline() && p.human) state.push(s.ready && s.ready[p.id] ? `<span class="chip ready"${tip('Ready', `${p.name} has finished shopping.`)}>Ready</span>` : `<span class="chip muted"${tip('Shopping', `${p.name} is still in the shop.`)}>Shopping</span>`);
    return `<section class="panel seat ${isTurn ? 'turn' : ''}" aria-label="${esc(p.name)}">
      <div class="por" id="por-${p.id}"${tip(p.name, `${p.name} is ${coat}.${who} ${playing ? `${n} cards in hand, ` : ''}${p.fish} fish, ${p.coins} coins.`)}>${portrait(p.id)}<span class="ring" style="--c:${COLORS[p.id]}"></span></div>
      <div class="body"><div class="top"><span class="nm">${esc(p.name)}</span>${playing ? `<span class="cnt num"${tip(`${n} cards`, n <= 2 ? `${p.name} is close to going out.` : 'Cards left in hand.')}>${n}</span>` : ''}</div>
        <div class="minibacks" aria-hidden="true">${backs}</div>
        <div class="row"><span${tip(`${p.fish} fish`, `${p.name}'s score.`)}>${A.FISH}<b class="num">${p.fish}</b></span><span class="${ui.bump === p.id ? 'bump' : ''}" style="display:inline-block"${tip(`Mult ×${playing ? p.mult : 1}`, `If ${p.name} goes out, everyone pays cards left × this.`)}>×<b class="num">${playing ? p.mult : 1}</b></span>${state.join('')}</div>
        <div class="chips">${icons}</div></div>
      ${ui.thinking === p.id ? '<span class="bubble think">…</span>' : ''}
    </section>`;
  }
  function renderOpps() { const ids = oppIds(), el = $('opps'); el.className = `region n${ids.length}`; el.innerHTML = ids.map(i => seatHTML(s.players[i])).join(''); }

  function statusText() {
    const t = s.trick, me = s.players[ME], cur = s.players[s.turn];
    if (s.phase !== 'play') return { m: '', sb: '' };
    if (ui.dealing) return { m: 'Dealing…', sb: '' };
    if (cur.id === ME && me.mustDiscard) return { m: '<em>Bury a card</em>', sb: `You dug up the ${esc(E.cardName(s, me.drawn))}` };
    if (cur.id !== ME) return { m: `${esc(cur.name)}…`, sb: '' };
    if (!t.play) return { m: '<em>Your lead</em>', sb: s.mustLead !== null ? `Include the ${esc(E.cardName(s, s.mustLead))}` : '' };
    return { m: `<em>Your turn</em> · beat it or pass`, sb: me.pounced ? 'Pounced: you must beat it if you can' : t.forced === ME ? "Off the Table: you can't pass" : '' };
  }

  function renderTable() {
    const playing = s.phase === 'play', t = s.trick;
    const st = statusText();
    let trick = '';
    if (playing) {
      const prev = ui.pile.slice(0, -1).slice(-2);
      prev.forEach((pl, k) => {
        const depth = prev.length - k;
        pl.cards.forEach((u, i) => { const p = trickPos(pl.cards.length, i, u); trick += cardHTML(u, { cls: 'old', style: `left:${p.x - depth * 18}px;top:${p.y - depth * 9}px;--rot:${p.rot - 4}deg;opacity:${0.5 - depth * 0.12};z-index:${k}` }); });
      });
      if (t.play) t.play.cards.forEach((u, i) => { const p = trickPos(t.play.cards.length, i, u); trick += cardHTML(u, { cls: 'cur', attrs: `data-uid="${u}"`, style: `left:${p.x}px;top:${p.y}px;--rot:${p.rot}deg;z-index:${10 + i}` }); });
      trick += t.play ? `<div class="lbl"><b>${esc(pname(t.play.by))}</b> · ${t.play.combo.label}</div>` : '<div class="empty"></div>';
    }
    const deckN = Math.min(5, Math.ceil(s.deck.length / 12));
    const stack = Array.from({ length: deckN }, (_, i) => backHTML(`left:${i * 1.5}px;top:${-i * 1.5}px`)).join('');
    const tray = playing ? s.discards.map(u => cardHTML(u, { style: 'position:relative' })).join('') : '';
    $('table').innerHTML = `<div class="felt ${playing && s.rev ? 'rev' : ''}" id="felt">
      <div id="status" aria-live="polite"><div class="m">${st.m}</div>${st.sb ? `<div class="sb">${st.sb}</div>` : ''}</div>
      <div id="deck"${tip('Shared deck', `${s.deck.length} cards. Everyone is dealt from the same deck.`)}><div class="stack" id="deckstack">${stack}</div><span class="count">${s.deck.length}</span></div>
      <div id="trick">${trick}</div>
      <div id="litter"${tip('Litter box', `${playing ? s.stock.length : 0} face-down cards. Press Dig instead of passing to draw one, then bury a card in the tray.`)}><div class="box" id="litterbox">${A.LITTER}</div><span class="count">${playing ? s.stock.length : 0}</span></div>
      <div id="tray" aria-label="Litter tray"${tray ? tip('Litter tray', 'Cards buried by digging. Everyone can see them.') : ''}>${tray}</div>
      ${playing && s.rev ? `<div class="revbar"${tip('Upside-down', 'Rank order is reversed: 3 is the highest rank and 2 the lowest. Suits still rank Fish > Yarn > Mice > Paws.')}>Upside-down · 3 high</div>` : ''}
    </div>`;
  }

  function renderMine() {
    const me = s.players[ME];
    const used = j => (j === 'copycat' && me.usedCopycat) || (j === 'offtable' && me.usedOff) || (j === 'zoomies' && me.zoomDone) || (j === 'ninelives' && me.nineUsed) || (j === 'hiss' && me.hissUsed);
    const jk = me.jokers.map(j => `<div class="jk ${used(j) ? 'used' : ''}" data-kind="${E.JOKERS[j].kind}"${tip(E.JOKERS[j].name, `${E.JOKERS[j].text}${used(j) ? ' Already used.' : ''}`)}>${A.icon(E.JOKERS[j].kind)}${esc(E.JOKERS[j].name)}</div>`);
    while (jk.length < E.MAX_JOKERS) jk.push(`<div class="jk empty"${tip('Empty joker slot', 'Buy jokers or open Kitten packs in the shop. You can hold 4.')}></div>`);
    const lv = E.STAR_IDS.filter(k => me.levels[k] > 1).map(k => `<span class="chip lvl"${tip(`${E.STARS[k].label} · level ${me.levels[k]}`, `${E.STARS[k].name}: winning a trick with ${E.STARS[k].label.toLowerCase()} gives +${E.BASE_GAIN[k] + me.levels[k] - 1} Mult.`)}>★ ${E.STARS[k].label} ${me.levels[k]}</span>`);
    $('mine').innerHTML = `<div class="panel jrow" id="jrow">${jk.join('')}</div>
      <div class="panel srow"${lv.length ? '' : tip('Star charts', 'All your plays are level 1. Star packs in the shop level them up.')}>${lv.length ? lv.join('') : '<span class="faint">★</span>'}</div>`;
  }

  function sortedHand() {
    const me = s.players[ME];
    const ek = u => E.effRank(s, u) * 4 + E.suitOfF(s.cards[u].f);
    return [...me.hand].sort((a, b) => ui.sortBySuit ? (E.suitOfF(s.cards[a].f) - E.suitOfF(s.cards[b].f) || ek(a) - ek(b) || a - b) : (ek(a) - ek(b) || a - b));
  }

  function renderHand() {
    const me = s.players[ME], playing = s.phase === 'play', myTurn = playing && s.turn === ME;
    const line = ui.msg;
    const cards = playing ? sortedHand() : [];
    const n = cards.length;
    const html = cards.map((u, i) => {
      const p = handPos(n, i);
      const cls = `${ui.sel.has(u) ? 'sel' : ''} ${me.drawn === u ? 'drawn' : ''}`;
      return cardHTML(u, { tag: 'button', cls, attrs: `data-act="card" data-uid="${u}" aria-pressed="${ui.sel.has(u)}"`, style: `left:${p.x}px;top:${p.y}px;--rot:${p.rot}deg;z-index:${i + 1};${ui.dealing ? 'visibility:hidden' : ''}` });
    }).join('');
    $('handzone').innerHTML = `<div id="hint" class="${line.cls}" role="status">${esc(line.text)}</div><div id="hand" class="${myTurn ? '' : 'wait'}">${html}</div>`;
  }

  function renderActions() {
    const me = s.players[ME], playing = s.phase === 'play', myTurn = playing && s.turn === ME && !busy && !net.waiting;
    if (!playing) { $('actions').innerHTML = ''; return; }
    const discarding = myTurn && me.mustDiscard;
    const wait = 'Wait for your turn.';
    let playWhy = wait;
    if (myTurn && !discarding) playWhy = ui.sel.size ? E.checkPlay(s, ME, [...ui.sel]).err || null : 'Tap cards in your hand to select them first.';
    const playCombo = myTurn && !discarding && !playWhy ? E.checkPlay(s, ME, [...ui.sel]).combo : null;
    const passErr = myTurn ? (discarding ? 'Bury a card first.' : E.passBlock(s, ME)) : wait;
    const digWhy = !myTurn ? wait : discarding ? 'Bury a card first.' : !s.stock.length ? 'The litter box is empty.' : E.passBlock(s, ME);
    const pounceWhy = !myTurn ? wait : me.pounced ? 'You already pounced this hand.' : me.hand.length > 5 ? 'You can pounce with 5 or fewer cards.' : me.fish < E.POUNCE_COST ? 'You need 5 fish.' : me.mustDiscard ? 'Bury a card first.' : null;
    $('actions').innerHTML = `
      ${discarding
        ? `<button class="act big" data-act="discard"${off(ui.sel.size === 1, 'Tap the one card you want to bury.')}${tip('Discard', 'Bury the selected card face up in the litter tray. This counts as your pass.')}>Bury</button>`
        : `<button class="act big ${playCombo ? 'ready' : ''}" data-act="play"${off(!playWhy, playWhy)}${tip(playCombo ? `Play ${playCombo.label.toLowerCase()}` : 'Play', 'Beat the table with the same number of cards, or lead anything when the table is clear.')}>${playCombo ? `Play ${playCombo.label}` : 'Play'}</button>`}
      <button class="act" data-act="pass"${off(!passErr, passErr)}${tip('Pass', 'Skip this trick. You can still play when your turn comes round again.')}>Pass</button>
      <button class="act dig" data-act="dig"${off(!digWhy, digWhy)}${tip('Dig', 'Instead of passing: draw the top card of the litter box, then bury one card face up.')}>Dig</button>
      <button class="act pounce" data-act="pounce"${off(!pounceWhy, pounceWhy)}${tip('Pounce', 'With 5 or fewer cards: pay 5 fish for +1 Mult and a higher cap. Afterwards you must beat the table whenever you can.')}>Pounce</button>
      <button class="act small" data-act="hint"${off(myTurn, wait)}${tip('Hint', 'Selects a sensible play for you.')}>Hint</button>
      <button class="act small" data-act="sort" style="grid-column:span 2"${tip('Sort', 'Group your hand by rank or by suit.')}>${ui.sortBySuit ? 'By rank' : 'By suit'}</button>`;
  }

  // ---------- shop ----------
  function miniHTML(f, mods, count, disabled) {
    const suit = E.SUITS[E.suitOfF(f)], rank = E.RANKS[E.rankOfF(f)];
    const body = `${count === 0 ? 'Eaten: no copies left in the deck.' : count > 1 ? `${count} copies in the deck.` : '1 copy in the deck.'}${mods.length ? ' ' + mods.map(m => `${E.FORTUNES[m.kind].name} (${pname(m.owner)}): ${E.FORTUNES[m.kind].text}`).join(' ') : ''}`;
    return `<button class="cell ${count ? '' : 'gone'}" data-act="face" data-f="${f}" data-suit="${suit}" aria-label="${esc(E.faceName(f) + '. ' + body)}"${tip(E.faceName(f), body)} ${disabled ? 'aria-disabled="true"' : ''}><span class="mini"><b>${rank}</b>${A.pip(suit)}</span>${mods.slice(0, 2).map(m => badge(m, true)).join('')}${count > 1 ? `<span class="x2">×${count}</span>` : ''}</button>`;
  }
  function chooserHTML(me) {
    const pd = me.pending; if (!pd) return '';
    const pk = E.PACKS[pd.type];
    if (pd.type === 'fortune' && ui.fortunePick) {
      return `<div class="chooser banner"><div class="ch-box" data-pack="fortune"><div class="ch-note">Tap a card in the deck · ${E.FORTUNES[ui.fortunePick].name}</div><div style="display:flex;gap:6px"><button class="btn" data-act="unpick">Back</button><button class="btn" data-act="skip">Skip pack</button></div></div></div>`;
    }
    let opts = '';
    const FICON = k => (MOD_SVG[k] ? `<svg viewBox="0 0 12 12" class="opt-ic">${MOD_SVG[k]('#f6b949')}</svg>` : k === 'scent' ? '<span class="opt-dot"></span>' : `<span class="opt-glyph">${k === 'twin' ? '×2' : '−1'}</span>`);
    if (pd.type === 'kitten') opts = pd.options.map(j => { const J = E.JOKERS[j], own = me.jokers.includes(j); return `<button class="opt" data-act="pick" data-v="${j}" data-kind="${J.kind}"${own ? ' aria-disabled="true" data-why="You already have this joker."' : ''}${tip(J.name, `${J.rarity} ${J.kind.toLowerCase()} joker. ${J.text}${own ? ' You already have it.' : ''}`)}>${A.icon(J.kind)}<strong>${esc(J.name)}</strong><small>${J.rarity}</small></button>`; }).join('');
    if (pd.type === 'star') opts = pd.options.map(k => { const lv = me.levels[k], max = lv >= E.MAX_LEVEL; return `<button class="opt" data-act="pick" data-v="${k}"${max ? ` aria-disabled="true" data-why="Already at level ${E.MAX_LEVEL}."` : ''}${tip(E.STARS[k].name, max ? `${E.STARS[k].label} are already at level ${E.MAX_LEVEL}.` : `Winning a trick with ${E.STARS[k].label.toLowerCase()} will give +${E.BASE_GAIN[k] + lv} Mult instead of +${E.BASE_GAIN[k] + lv - 1}.`)}><span class="opt-glyph">★</span><strong>${E.STARS[k].label}</strong><small>Lv ${lv} → ${Math.min(lv + 1, E.MAX_LEVEL)}</small></button>`; }).join('');
    if (pd.type === 'fortune') opts = pd.options.map(k => `<button class="opt" data-act="pick" data-v="${k}"${tip(E.FORTUNES[k].name, E.FORTUNES[k].text)}>${FICON(k)}<strong>${E.FORTUNES[k].name}</strong><small>fortune</small></button>`).join('');
    return `<div class="chooser"><div class="ch-box" data-pack="${pd.type}"><h3>${pk.name} · pick one</h3><div class="opts">${opts}</div><div><button class="btn" data-act="skip">Skip</button></div></div></div>`;
  }
  function dealButton(me) {
    const label = s.handNo === 0 ? 'Deal' : `Deal hand ${s.handNo + 1}`;
    if (s.ready && s.ready[ME]) {
      const humans = s.players.filter(p => p.human), done = humans.filter(p => s.ready[p.id]).length;
      return `<button class="btn deal" aria-disabled="true" data-why="Waiting for the others to finish shopping."${tip('Ready', 'The hand is dealt once everyone at the table is ready.')}>Ready ${done}/${humans.length}</button>`;
    }
    return `<button class="btn gold deal" data-act="deal"${off(!me.pending && !net.waiting, me.pending ? 'Finish or skip the open pack first.' : 'Sending…')}${isOnline() ? tip(label, 'The hand is dealt once everyone at the table is ready.') : ''}>${isOnline() ? 'Ready' : label}</button>`;
  }
  function renderShop() {
    const el = $('shop');
    const show = s.phase === 'shop' && ui.ov !== 'payout';
    el.hidden = !show;
    if (!show) { el.classList.remove('in'); return; }
    if (ui.shopAnim) { el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); ui.shopAnim = false; }
    const me = s.players[ME];
    const wares = s.shop.jokers.map(j => {
      const J = E.JOKERS[j], owned = me.jokers.includes(j), full = me.jokers.length >= E.MAX_JOKERS, poor = me.coins < J.cost;
      const why = owned ? 'You already have this joker.' : full ? 'All 4 joker slots are full. Sell one first.' : poor ? `You need ${J.cost} coins.` : null;
      return `<article class="ware" data-kind="${J.kind}"${tip(J.name, `${J.rarity} ${J.kind.toLowerCase()} joker. ${J.text}`)}>${A.icon(J.kind)}<span class="n">${esc(J.name)}</span><span class="k">${J.rarity}</span><button class="btn ${why ? '' : 'gold'}" data-act="buy" data-v="${j}"${off(!why, why)}>${owned ? 'Owned' : `${A.COIN}${J.cost}`}</button></article>`;
    }).join('');
    const packs = Object.keys(E.PACKS).map(k => {
      const pk = E.PACKS[k];
      const why = me.opened[k] ? 'Already opened this shop.' : me.pending ? 'Finish choosing from the open pack first.' : (k === 'fortune' && me.edited) ? 'You already changed the deck this shop.' : (k === 'kitten' && me.jokers.length >= E.MAX_JOKERS) ? 'All joker slots are full.' : me.coins < pk.cost ? `You need ${pk.cost} coins.` : null;
      return `<article class="pack ${me.opened[k] ? 'opened' : ''}" data-pack="${k}"${tip(pk.name, pk.text)}><span class="n">${pk.name.replace(' pack', '')}</span><button class="btn" data-act="open" data-v="${k}"${off(!why, why)}>${me.opened[k] ? 'Opened' : `${A.COIN}${pk.cost}`}</button></article>`;
    }).join('');
    const owned = me.jokers.map((j, i) => `<div class="jk" data-kind="${E.JOKERS[j].kind}"${tip(E.JOKERS[j].name, `${E.JOKERS[j].text} Mimic copies the joker to its right, so order matters.`)}>${A.icon(E.JOKERS[j].kind)}<span>${esc(E.JOKERS[j].name)}</span><span class="ctl"><button data-act="move" data-v="${j}" data-dir="-1" aria-label="Move left" ${i === 0 ? 'disabled' : ''}>←</button><button data-act="move" data-v="${j}" data-dir="1" aria-label="Move right" ${i === me.jokers.length - 1 ? 'disabled' : ''}>→</button><button data-act="sell" data-v="${j}" aria-label="Sell for 2 coins"${tip('Sell', 'Sell this joker for 2 coins.')}>+2</button></span></div>`);
    while (owned.length < E.MAX_JOKERS) owned.push(`<div class="jk empty"${tip('Empty joker slot', 'You can hold 4 jokers.')}></div>`);
    const stars = E.STAR_IDS.map(k => `<span class="${me.levels[k] > 1 ? 'up' : ''}"${tip(`${E.STARS[k].label} · level ${me.levels[k]}`, `${E.STARS[k].name}: winning a trick with ${E.STARS[k].label.toLowerCase()} gives +${E.BASE_GAIN[k] + me.levels[k] - 1} Mult. Star packs level it up to ${E.MAX_LEVEL}.`)}>${E.STARS[k].label}<b>${me.levels[k]}</b></span>`).join('');
    const targeting = !!ui.fortunePick, fortuneOpen = me.pending && me.pending.type === 'fortune';
    const cells = [];
    for (let su = 3; su >= 0; su--) for (let r = 0; r < 13; r++) {
      const f = r * 4 + su, copies = E.copiesOf(s, f), mods = copies.map(u => s.cards[u].mod).filter(Boolean), free = copies.some(u => !s.cards[u].mod);
      let dis;
      if (targeting) dis = ui.fortunePick === 'twin' || ui.fortunePick === 'eat' ? !copies.length : !free;
      else dis = me.edited || fortuneOpen || !free;
      cells.push(miniHTML(f, mods, copies.length, dis));
    }
    const mode = (k, name, body) => `<button class="mode" data-act="mode" data-v="${k}" aria-pressed="${ui.editMode === k}"${me.edited ? ' aria-disabled="true" data-why="You already changed the deck this shop."' : ''}${tip(`${name} · 3 coins`, body)}>${name}<span>${A.COIN}3</span></button>`;
    el.innerHTML = `
      <div class="sh-head"><h2>Shop</h2>
        <span class="chip"${tip(`Next hand: ${E.HOUSE[s.nextHouse].name}`, E.HOUSE[s.nextHouse].text)}>Next · ${E.HOUSE[s.nextHouse].name}</span>
        <span class="coins"${tip(`${me.coins} coins`, 'Every player sees the same shop and shops at the same time.')}>${A.COIN}${me.coins}</span>
        ${dealButton(me)}</div>
      <div class="sh-col">
        <div class="wares">${wares}</div>
        <div class="packs">${packs}</div>
        <div class="owned">${owned.join('')}</div>
      </div>
      <div class="sh-col">
        <div class="stars panel">${stars}</div>
        <section class="panel deckp"${targeting ? '' : tip('The shared deck', 'Everyone is dealt from these cards. Once per shop, mark a card here or use a Fortune card. Changes are permanent and public.')}>
          ${targeting ? `<div class="ch-note">${E.FORTUNES[ui.fortunePick].name}: tap a card</div>` : `<div class="modes">${mode('scent', 'Scent', '+1 Mult for you whenever this card is in a trick you win.')}${mode('hairball', 'Hairball', 'Whoever else holds this card when a hand ends pays you 3 fish.')}</div>`}
          <div class="deckgrid ${targeting ? 'target' : ''}">${cells.join('')}</div>
          ${ui.shopMsg ? `<div class="toast ${ui.shopOk ? 'ok' : 'err'}" role="status">${esc(ui.shopMsg)}</div>` : ''}</section>
      </div>
      ${chooserHTML(me)}`;
  }

  // ---------- overlays ----------
  function renderOverlay() {
    if (ui.ov === 'payout') return; // built and animated by the director
    if (!ui.ov) { ov.innerHTML = rotateHTML(); fit(); return; }
    if (ui.ov === 'title') {
      const keepFocus = document.activeElement && ['pname', 'joincode'].includes(document.activeElement.id) ? document.activeElement.id : null;
      ov.innerHTML = titleHTML() + rotateHTML(); fit();
      if (keepFocus) { const el = $(keepFocus); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      return;
    }
    const body = { rules: rulesHTML, log: logHTML, options: optionsHTML, end: endHTML, room: roomHTML, leave: leaveHTML, gone: goneHTML }[ui.ov]();
    const modal = ['end', 'room', 'leave', 'gone'].includes(ui.ov);
    ov.innerHTML = `<div class="sheet" data-act="${modal ? '' : 'bg'}"><div class="sheet-box ${ui.ov}-box" id="sheetbox">${body}</div></div>` + rotateHTML();
    fit();
  }

  // ---------- title screen & rooms ----------
  const roomsOff = () => (net.api ? null : 'Online rooms need the game server. Open the game from its website.');
  function roomListHTML() {
    const open = net.hosts.filter(h => h.open > 0).slice(0, 4);
    if (!net.api || !open.length) return '';
    return open.map(h => { const code = esc(String(h.code).slice(0, 4)), nm = cleanName(h.name) || 'Cat'; return `<button class="ts-room" data-act="join" data-v="${code}"${tip(`${nm}’s room`, `${h.n - h.open} of ${h.n} seats taken. Seats nobody takes are played by bots.`)}><b>${code}</b><span>${esc(nm)}</span><i>${h.n - h.open}/${h.n}</i></button>`; }).join('');
  }
  // patch the list in place, so a room's button is never swapped out from under a click
  function renderRooms() {
    const el = $('tsrooms');
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = roomListHTML();
    const want = [...tmp.children], have = new Map([...el.children].map(b => [b.dataset.v, b]));
    want.forEach(n => {
      const old = have.get(n.dataset.v);
      if (!old) { el.appendChild(n); return; }
      have.delete(n.dataset.v);
      if (old.innerHTML !== n.innerHTML) old.innerHTML = n.innerHTML;
      old.dataset.tt = n.dataset.tt; old.dataset.tb = n.dataset.tb;
    });
    have.forEach(b => b.remove());
  }
  function titleHTML() {
    const n = ui.opps, why = roomsOff();
    const cats = [0, 1, 2, 3].map(i => `<div class="ts-cat ${i <= n ? 'on' : ''}" style="--c:${COLORS[i]}">${A.portrait(COATS[i], i === 0 ? 'smug' : 'idle')}</div>`).join('');
    const seg = [1, 2, 3].map(k => `<button data-act="opps" data-v="${k}" aria-pressed="${n === k}"${tip(`${k} opponent${k > 1 ? 's' : ''}`, `${k + 1} cats at the table. In a room, friends take these seats and bots fill the rest.`)}>${k}</button>`).join('');
    const resume = ui.inGame && net.mode === 'solo' && s.phase !== 'matchEnd' ? `<button class="sbtn" data-act="resume"${tip('Resume', 'Back to the match you were playing.')}>Resume</button>` : '';
    return `<div class="title-screen">
      <div class="ts-art">
        <div class="ts-logo"><b>Shed!</b><span>锄大猫</span></div>
        <div class="ts-felt"><div class="ts-cats">${cats}</div></div>
      </div>
      <div class="ts-panel panel">
        <label class="ts-field"${tip('Your name', 'Shown to friends in a room.')}><span>Name</span><input id="pname" maxlength="14" autocomplete="off" spellcheck="false" placeholder="Cat" value="${esc(prefs.name)}"></label>
        <div class="ts-field"><span>Opponents</span><span class="seg ts-seg">${seg}</span></div>
        <button class="btn gold ts-play" data-act="solo"${tip('Play', `A match against ${n} bot cat${n > 1 ? 's' : ''}.`)}>Play</button>
        <div class="ts-or"><i></i><span>with friends</span><i></i></div>
        <button class="btn ts-create" data-act="create"${off(!why, why)}${tip('Create room', 'Get a four-letter code to share. Friends open this page and join with it.')}>Create room</button>
        <div class="ts-join"><input id="joincode" maxlength="4" autocomplete="off" spellcheck="false" placeholder="CODE" value="${esc(ui.code)}" aria-label="Room code"${why ? ' disabled' : ''}><button class="btn" data-act="join"${off(!why, why)}${tip('Join', 'Enter a friend’s room code.')}>Join</button></div>
        <div class="ts-rooms" id="tsrooms">${roomListHTML()}</div>
        ${ui.roomMsg ? `<div class="ts-msg" role="status">${esc(ui.roomMsg)}</div>` : ''}
        <div class="ts-foot">${resume}<button class="sbtn" data-act="rules">Rules</button><button class="sbtn" data-act="options">Options</button></div>
      </div>
    </div>`;
  }
  function roomHTML() {
    const host = net.mode === 'host';
    const seats = host ? net.seats : net.hostInfo ? net.hostInfo.seats : [];
    const me = host ? 'host' : net.me;
    const cards = seats.map((x, i) => {
      const you = !!x && x.peer === me;
      const t = x ? tip(you ? `${x.name} (you)` : x.name, i === 0 ? 'Hosts the room and starts the match.' : you ? 'Your seat.' : 'In the room.') : tip('Open seat', 'Waiting for a friend. A bot plays it if nobody joins before the start.');
      return `<div class="rm-seat ${x ? 'on' : ''} ${you ? 'you' : ''}" style="--c:${COLORS[i]}"${t}><div class="por">${A.portrait(COATS[i], x ? 'idle' : 'think')}</div><b>${x ? esc(x.name) : esc(BOT_NAMES[i])}</b><small>${you ? 'You' : i === 0 ? 'Host' : x ? '' : 'Bot'}</small></div>`;
    }).join('');
    const ctl = host ? `<span class="seg rm-n"><button data-act="seats" data-v="-1"${off(seats.length > 2 && seats.lastIndexOf(null) > 0, seats.length <= 2 ? 'Two cats at least.' : 'Seats with people in them stay.')} aria-label="One seat fewer"${tip('Fewer seats', '2 to 4 cats at the table.')}>−</button><button data-act="seats" data-v="1"${off(seats.length < 4, 'Four cats at most.')} aria-label="One seat more"${tip('More seats', '2 to 4 cats at the table.')}>+</button></span>
        <button class="btn gold rm-start" data-act="start"${tip('Start', 'Deal everyone in. Open seats become bots.')}>Start</button>`
      : `<span class="rm-wait">${net.hostInfo ? `Waiting for ${esc(net.hostInfo.name || 'the host')}…` : 'Looking for the room…'}</span>`;
    return `<div class="rm-head"><h2>Room</h2><span class="rm-code"${tip('Room code', 'Friends open this page, type the code under Join, and take a seat.')}>${esc(net.code || '····')}</span></div>
      <div class="rm-seats">${cards}</div>
      ${ui.roomMsg ? `<div class="ts-msg" role="status">${esc(ui.roomMsg)}</div>` : ''}
      <div class="rm-foot">${net.room ? ctl : ''}<button class="btn" data-act="leave">Leave</button></div>`;
  }
  const leaveHTML = () => `<h2>Leave the room?</h2><p>${net.mode === 'host' ? 'You are hosting. Leaving ends the match for everyone.' : 'A bot takes your seat.'}</p>
    <div class="rm-foot"><button class="btn" data-act="stay">Stay</button><button class="btn gold" data-act="leave">Leave</button></div>`;
  const goneHTML = () => `<h2>The host left</h2><p>Keep this match going here, with bots in the other seats?</p>
    <div class="rm-foot"><button class="btn gold" data-act="gone-bots">Keep playing</button><button class="btn" data-act="leave">Menu</button></div>`;
  const rotateHTML = () => `<div class="rotate" id="rotate" hidden><div><div class="ph"></div><h2 style="font-family:var(--font-display);font-weight:400;color:var(--lamp);margin:0 0 6px">Turn your phone sideways</h2><p style="color:var(--muted);margin:0 0 12px">Shed! is played in landscape, like a real card table.</p><button class="btn" data-act="anyway">Play anyway</button></div></div>`;
  function logHTML() {
    const lines = s.log.slice(-160).map(l => `<div class="${l.cls}">${esc(youify(l.text))}</div>`).join('');
    return `<button class="btn close" data-act="close">Close</button><h2>Table talk</h2><div class="logbox">${lines || 'Nothing has happened yet.'}</div>`;
  }
  function optionsHTML() {
    const seg = (key, vals, labels) => `<span class="seg">${vals.map((v, i) => `<button data-act="pref" data-k="${key}" data-v="${v}" aria-pressed="${prefs[key] === v}">${labels[i]}</button>`).join('')}</span>`;
    return `<button class="btn close" data-act="close">Close</button><h2>Options</h2>
      <div class="optrow"><span>Game speed</span>${seg('speed', [1, 2, 4], ['1×', '2×', '4×'])}</div>
      <div class="optrow"><span>Sound effects</span>${seg('sound', [true, false], ['On', 'Off'])}</div>
      <div class="optrow"><span>Reduce motion</span>${seg('reduced', [false, true], ['Off', 'On'])}</div>
      <div class="optrow"><span>Fullscreen</span><button class="btn" data-act="fullscreen">Go fullscreen</button></div>
`;
  }
  function endHTML() {
    const me = s.standings.find(x => x.id === ME);
    const N = s.players.length;
    const word = ['', 'First place!', 'Second place.', 'Third place.', 'Fourth place.'][me.place];
    const pts = E.PLACEMENTS[N].map(v => (v > 0 ? `+${v}` : v === 0 ? '0' : `−${-v}`)).join(', ');
    const rows = s.standings.map(x => `<div class="end-row ${x.place === 1 ? 'first' : ''}"><span class="pl">${x.place}</span><div class="por">${portrait(x.id, x.place === 1 ? 'smug' : x.place === N ? 'hiss' : 'idle')}</div><b>${esc(x.name)}${x.id === ME && isOnline() ? ' (you)' : ''}</b><span class="n">${x.fish} fish</span><span class="n" data-tt="Ranked points" data-tb="Placement bonus: ${pts}.">${x.points > 0 ? '+' : ''}${x.points}</span></div>`).join('');
    const again = net.mode === 'guest'
      ? `<button class="btn" aria-disabled="true" data-why="The host starts the next match.">Waiting for ${esc(s.players[0].name)}</button>`
      : `<button class="btn gold" data-act="again" style="font-size:16px;padding:9px 20px">Play again</button>`;
    return `<h2>${word}</h2><div class="end-rows">${rows}</div><div style="display:flex;gap:8px">${again}<button class="btn" data-act="menu" style="font-size:16px;padding:9px 20px">Menu</button></div>`;
  }
  function rulesHTML() {
    const F = (r, su, mod) => faceHTML(E.RANKS.indexOf(r) * 4 + E.SUITS.indexOf(su), { mod: mod || null, style: 'position:relative' });
    const ex = list => `<div class="ex">${list.map(a => F(...a)).join('')}</div>`;
    const combo = (n, d, l) => `<div><span>${n}</span><small style="color:var(--muted)">${d}</small>${ex(l)}</div>`;
    const jokers = E.JOKER_IDS.map(j => `<li><b>${esc(E.JOKERS[j].name)}</b> (${E.JOKERS[j].cost} coins): ${esc(E.JOKERS[j].text)}</li>`).join('');
    const fortunes = E.FORTUNE_IDS.map(k => `<li><b>${E.FORTUNES[k].name}:</b> ${esc(E.FORTUNES[k].text)}</li>`).join('');
    const houses = ['bath', 'vacuum', 'laser', 'flip'].map(h => `<li><b>${E.HOUSE[h].name}:</b> ${esc(E.HOUSE[h].text)}</li>`).join('');
    const stars = E.STAR_IDS.map(k => `<tr><td>${E.STARS[k].label}</td><td>${E.STARS[k].name}</td><td>+${E.BASE_GAIN[k]}</td><td>+${E.BASE_GAIN[k] + E.MAX_LEVEL - 1}</td></tr>`).join('');
    const secs = [['goal', 'Goal'], ['cards', 'Cards'], ['plays', 'Plays'], ['trick', 'Tricks'], ['dig', 'Digging'], ['mult', 'Mult'], ['pay', 'Payout'], ['pounce', 'Pounce'], ['shop', 'Shop'], ['deck', 'Shared deck'], ['house', 'House rules'], ['end', 'Winning']];
    return `<button class="btn close gold" data-act="close">${firstVisit ? 'Start playing' : 'Back to the game'}</button><h2>How to play Shed!</h2>
      <p>Big Two with cats and Balatro-style shopping. Each hand, race to shed your cards. When someone plays their last card, everyone else pays them fish. After six hands, the cat with the most fish wins.</p>
      <nav class="toc">${secs.map(([id, t]) => `<a href="#r-${id}" data-act="toc">${t}</a>`).join('')}</nav>
      <h3 id="r-goal">The goal</h3><p>You play against one to three other cats: bots, or friends in a room. Everyone starts with <b>100 fish</b>. Each hand, everyone gets up to 13 cards from the shared deck; the rest go face down in the <b>litter box</b>. Be the first to play every card.</p>
      <h3 id="r-cards">The cards</h3><p>Ranks run from 3 (low) to 2 (high, the <b>Chonk</b>). On a tie in rank, suits decide: <b>Fish</b> beats <b>Yarn</b> beats <b>Mice</b> beats <b>Paws</b>.</p>${ex([['3', 'mice'], ['9', 'mice'], ['J', 'mice'], ['Q', 'mice'], ['K', 'mice'], ['A', 'mice'], ['2', 'mice']])}${ex([['7', 'paws'], ['7', 'mice'], ['7', 'yarn'], ['7', 'fish']])}
      <h3 id="r-plays">What you can play</h3><p>A single, a pair, a triple or a five-card hand. Five-card hands from weakest to strongest:</p>
      <div class="combos">${combo('Straight', 'five in a row', [['6', 'paws'], ['7', 'yarn'], ['8', 'mice'], ['9', 'fish'], ['10', 'paws']])}${combo('Flush', 'five of one suit', [['3', 'yarn'], ['7', 'yarn'], ['9', 'yarn'], ['J', 'yarn'], ['K', 'yarn']])}${combo('Full house', 'triple + pair', [['Q', 'paws'], ['Q', 'mice'], ['Q', 'fish'], ['4', 'yarn'], ['4', 'mice']])}${combo('Four of a kind', '+ any card', [['8', 'paws'], ['8', 'mice'], ['8', 'yarn'], ['8', 'fish'], ['3', 'mice']])}${combo('Straight flush', 'in a row, one suit', [['9', 'fish'], ['10', 'fish'], ['J', 'fish'], ['Q', 'fish'], ['K', 'fish']])}${combo('Five of a kind, flush house, flush five', 'only with copied cards', [['7', 'paws'], ['7', 'mice'], ['7', 'yarn'], ['7', 'fish'], ['7', 'fish', { owner: 0, kind: 'scent' }]])}</div>
      <p>Identical cards tie, and a tie doesn't beat. In straights the ace can be low or high and 2-3-4-5-6 counts, but straights can't wrap around.</p>
      <h3 id="r-trick">How a trick works</h3><ol><li>The leader plays any combo. In the first hand, the holder of the lowest card leads with it.</li><li>Each cat in turn beats it with the <b>same number of cards</b>, or passes. Passing is free.</li><li>When everyone else passes, the last cat to play wins the trick and leads the next one.</li><li>The hand ends the moment someone plays their last card.</li></ol>
      <h3 id="r-dig">Digging</h3><p>Whenever you could pass, you can <b>dig</b> instead: draw the top card of the litter box, then bury one card from your hand face up in the litter tray. It counts as your pass, and buried cards are public.</p>
      <h3 id="r-mult">Mult</h3><p>Mult starts at <b>×1</b> each hand. Winning a trick adds Mult based on the winning play, your star charts, jokers and scent marks. The cap is <b>×${E.BASE_CAP}</b>, one higher after a Pounce.</p><table><tr><th>Winning play</th><th>Star chart</th><th>Lv 1</th><th>Lv ${E.MAX_LEVEL}</th></tr>${stars}</table>
      <h3 id="r-pay">Getting paid</h3><p>When a cat plays their last card, every other cat pays <b>cards left × the winner's Mult</b>. 10 or more cards left count double, a whole untouched hand counts triple. The winner also takes the pot; whoever paid most leads next hand.</p>
      <h3 id="r-pounce">Pounce</h3><p>With <b>5 or fewer cards</b>, pay 5 fish into the pot for +1 Mult and a higher cap. After that you can't pass while you can beat the table.</p>
      <h3 id="r-shop">The shop</h3><p>Between hands, spend <b>coins</b>: 4 per hand, +1 per trick won, +1 per 5 saved (up to 3), +2 for whoever paid most. Everyone sees the same shop: two jokers and three packs (Kitten: a joker; Star: level up a play; Fortune: change the deck). Hold up to 4 jokers.</p><ul>${jokers}</ul>
      <h3 id="r-deck">The shared deck</h3><p>Once per shop you can change the shared deck, with a direct mark or a Fortune card. Changes are permanent and public; effects you own work only for you, except the Tabby. The deck stays between ${E.DECK_MIN} and ${E.DECK_MAX} cards.</p><ul>${fortunes}</ul>
      <h3 id="r-house">House rules</h3><p>From the second hand, a hand may have a house rule, shown on the red sign. Upside-Down comes from the Japanese game Daifugō.</p><ul>${houses}</ul>
      <h3 id="r-end">Winning</h3><p>Six hands, or until a cat runs out of fish. Most fish wins; placement adds ranked points, from +30 for first to −30 for last.</p>
      <h3>Playing with friends</h3><p>On the title screen, <b>Create room</b> and share the four-letter code. Friends open this page and enter it under <b>Join</b>. Seats nobody takes are played by bots.</p>`;
  }

  // ---------- fx helpers ----------
  function ghost(html, x, y) {
    const g = document.createElement('div');
    g.className = 'ghost'; g.innerHTML = html;
    const c = g.firstElementChild; if (c) { c.style.left = '0'; c.style.top = '0'; c.style.transition = 'none'; }
    g.style.transform = `translate(${x}px, ${y}px)`;
    fx.appendChild(g);
    return g;
  }
  function fly(el, a, b, { dur = 320, arc = 40, ease = 'cubic-bezier(.3,.9,.4,1.15)', fill = 'forwards', delay = 0 } = {}) {
    const d = D(dur);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - arc;
    const kf = [
      { transform: `translate(${a.x}px, ${a.y}px) rotate(${a.rot || 0}deg) scale(${a.s ?? 1})`, opacity: a.o ?? 1 },
      { transform: `translate(${mx}px, ${my}px) rotate(${((a.rot || 0) + (b.rot || 0)) / 2}deg) scale(${((a.s ?? 1) + (b.s ?? 1)) / 2})`, opacity: 1, offset: 0.5 },
      { transform: `translate(${b.x}px, ${b.y}px) rotate(${b.rot || 0}deg) scale(${b.s ?? 1})`, opacity: b.o ?? 1 },
    ];
    if (!d) { el.style.transform = kf[2].transform; el.style.opacity = kf[2].opacity; return Promise.resolve(); }
    el.style.transform = kf[0].transform; el.style.opacity = kf[0].opacity;
    return el.animate(kf, { duration: d, easing: ease, fill: fill === 'forwards' ? 'both' : 'backwards', delay: D(delay) }).finished.catch(() => {});
  }
  function pop(text, x, y, cls = '', dur = 900) {
    const p = document.createElement('div');
    p.className = `pop ${cls}`; p.textContent = text; p.style.left = `${x}px`; p.style.top = `${y}px`;
    fx.appendChild(p);
    const d = D(dur);
    if (!d) { p.remove(); return Promise.resolve(); }
    return p.animate([{ transform: 'translate(-50%,-30%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,-70%) scale(1.08)', opacity: 1, offset: 0.25 }, { transform: 'translate(-50%,-110%) scale(1)', opacity: 0 }], { duration: d, easing: 'ease-out' }).finished.then(() => p.remove(), () => p.remove());
  }
  function particles(svg, from, to, n, { dur = 600, spread = 30, stagger = 40 } = {}) {
    const all = [];
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div'); el.className = 'ptc'; el.innerHTML = svg; fx.appendChild(el);
      const a = { x: from.x - 9 + (Math.random() - 0.5) * spread, y: from.y - 9 + (Math.random() - 0.5) * spread, rot: Math.random() * 90, s: 0.6 };
      const b = { x: to.x - 9 + (Math.random() - 0.5) * 10, y: to.y - 9 + (Math.random() - 0.5) * 10, rot: 200 + Math.random() * 160, s: 1, o: 0.2 };
      all.push(fly(el, a, b, { dur, arc: 60 + Math.random() * 40, ease: 'cubic-bezier(.5,0,.6,1)', delay: i * stagger, fill: 'none' }).then(() => el.remove()));
    }
    return Promise.all(all);
  }
  function burst(at, n = 12) {
    const all = [];
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div'); el.className = 'ptc'; el.innerHTML = A.SPARK; fx.appendChild(el);
      const ang = (i / n) * Math.PI * 2, r = 50 + Math.random() * 30;
      all.push(fly(el, { x: at.x - 9, y: at.y - 9, s: 0.4 }, { x: at.x - 9 + Math.cos(ang) * r, y: at.y - 9 + Math.sin(ang) * r, s: 0.9, o: 0, rot: 120 }, { dur: 550, arc: 0, ease: 'cubic-bezier(.1,.8,.3,1)', fill: 'none' }).then(() => el.remove()));
    }
    return Promise.all(all);
  }
  function shake() { if (prefs.reduced || fast) return; stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake'); }
  const seatPoint = pid => { const el = $(`por-${pid}`); return el ? center(rectOf(el)) : { x: 512, y: 300 }; };
  const handPoint = () => center(rectOf($('handzone')));
  const playerPoint = pid => (pid === ME ? handPoint() : seatPoint(pid));
  const multPoint = pid => (pid === ME ? center(rectOf($('meter'))) : seatPoint(pid));
  const clearGhosts = () => { fx.querySelectorAll('.ghost').forEach(g => g.remove()); };

  // ---------- director ----------
  function snapshot() {
    const hand = {};
    document.querySelectorAll('#hand .cd').forEach(el => { hand[el.dataset.uid] = { el, r: rectOf(el), rot: parseFloat(el.style.getPropertyValue('--rot')) || 0 }; });
    return { hand, trick: rectOf($('trick')), litter: rectOf($('litterbox')), tray: rectOf($('tray')), deck: rectOf($('deckstack')) };
  }

  // ---------- moves ----------
  // Every change to the shared game is a move: {op, pid, ...}. Solo and host pages apply moves as they are made;
  // in a room the host numbers them and every guest replays the same list, so all pages run the same engine
  // on the same moves from the same seed and stay identical.
  const allReady = () => s.players.every(q => !q.human || (s.ready && s.ready[q.id]));
  function applyEngine(c) {
    const p = s.players[c.pid];
    if (!p) return { err: 'No such seat.' };
    let err = null, dealt = false;
    switch (c.op) {
      case 'act': err = E.act(s, c.pid, c.a); if (!err && s.phase === 'handEnd') E.openShop(s); break;
      case 'buy': err = E.buy(s, c.pid, c.v); break;
      case 'sell': err = E.sell(s, c.pid, c.v); break;
      case 'move': err = E.moveJoker(s, c.pid, c.v, c.dir); break;
      case 'open': err = E.openPack(s, c.pid, c.v); break;
      case 'skip': err = E.skipPack(s, c.pid); break;
      case 'choose': err = c.f === undefined ? E.choosePack(s, c.pid, c.v) : E.choosePack(s, c.pid, c.v, c.f); break;
      case 'edit': err = E.deckEdit(s, c.pid, c.f, c.mode); break;
      case 'ready':
        if (s.phase !== 'shop') return { err: 'The shop is closed.' };
        if (p.pending) return { err: 'Finish or skip the open pack first.' };
        s.ready[c.pid] = true;
        break;
      case 'bot': p.human = false; break;
      case 'human': p.human = true; break;
      default: return { err: 'Unknown move.' };
    }
    if (err) return { err };
    if ((c.op === 'ready' || c.op === 'bot') && s.phase === 'shop' && allReady() && Object.keys(s.ready).length) {
      s.players.forEach(q => { if (!q.human && q.bought.length) s.log.push({ text: `${q.name} shopped: ${q.bought.join(', ')}.`, cls: 'joker', hand: s.handNo + 1 }); });
      E.startHand(s); s.ready = {}; dealt = true;
    }
    return { err: null, dealt };
  }

  const queue = [];
  let draining = false;
  // c: the move; fromLog: it came from the host's numbered log (already validated); silent: catch up without animating
  function enqueue(c, fromLog = false, silent = false) { return new Promise(res => { queue.push({ c, fromLog, silent, res }); drain(); }); }
  async function drain() {
    if (draining) return;
    draining = true;
    let silentRun = false;
    while (queue.length) {
      const { c, fromLog, silent, res } = queue.shift();
      let err = null;
      try {
        if (silent) { err = applyEngine(c).err; s.events.splice(0); silentRun = true; }
        else {
          if (silentRun) { silentRun = false; ui.pile = []; render(); }
          err = await applyCmd(c, !fromLog && net.mode === 'host' ? () => net.commit(c) : null);
        }
      } catch (e) { console.warn(e); err = 'Something went wrong.'; }
      if (fromLog && c.pid === ME) { net.waiting = false; }
      if (err && fromLog) console.warn('Room move did not apply here:', err, c);
      res(err);
    }
    if (silentRun) { ui.pile = []; ui.dealing = false; render(); }
    draining = false;
    renderActions();
    schedule();
  }
  // the local player's move
  function submit(c) {
    c.pid = ME;
    if (net.mode === 'guest') return net.send(c);
    return enqueue(c);
  }

  async function applyCmd(c, onOk) {
    const before = c.op === 'act' ? snapshot() : null;
    const r = applyEngine(c);
    if (r.err) return r.err;
    if (onOk) onOk();
    if (c.op === 'act') await animateMove(c.pid, before);
    else { s.events.splice(0); if (!r.dealt) { renderShop(); renderSide(); renderMine(); renderOpps(); } }
    if (r.dealt) await dealAnim();
    return null;
  }

  async function animateMove(pid, before) {
    busy = true;
    if (ui.thinking !== null) { ui.thinking = null; renderOpps(); }
    if (pid === ME) { ui.sel.clear(); ui.msg = { text: '', cls: '' }; }
    renderActions();
    const evs = s.events.splice(0);
    try { for (const e of evs) await animate(e, before); } catch (e) { console.warn(e); }
    busy = false; ui.skip = false;
    render(); clearGhosts();
    setTimeout(() => { ui.bump = null; ui.hissFlash.clear(); }, 0);
  }

  async function animate(e, before) {
    if (e.type === 'play') return animPlay(e, before);
    if (e.type === 'pass') {
      if (e.kind === 'bury') return;
      const at = playerPoint(e.pid);
      SND.pass();
      pop('Pass', at.x, at.y - (e.pid === ME ? 40 : 30), 'small', 700);
      if (e.vacuum) pop('−1 fish', at.x, at.y + 10, 'small red', 800);
      return wait(260);
    }
    if (e.type === 'dig') {
      const from = before.litter, to = e.pid === ME ? handPoint() : seatPoint(e.pid);
      const g = ghost(backHTML(), 0, 0);
      SND.card();
      await fly(g, { x: from.x + 8, y: from.y - 10, s: 0.6 }, { x: to.x - CW / 2, y: to.y - CH / 2, s: e.pid === ME ? 1 : 0.4, o: e.pid === ME ? 1 : 0.1 }, { dur: 380, arc: 50 });
      g.remove();
      return;
    }
    if (e.type === 'discard') {
      const src = e.pid === ME && before.hand[e.uid] ? before.hand[e.uid].r : null;
      const from = src ? { x: src.x, y: src.y } : (p => ({ x: p.x - CW / 2, y: p.y - CH / 2 }))(seatPoint(e.pid));
      if (src) before.hand[e.uid].el.style.visibility = 'hidden';
      const g = ghost(cardHTML(e.uid), 0, 0);
      const tr = before.tray, n = s.discards.length;
      SND.card();
      await fly(g, { x: from.x, y: from.y, s: src ? 1 : 0.4 }, { x: tr.x + tr.w / 2 - 11 - CW * 0.31 + ((n - 1) % 4 - 1.5) * 24, y: tr.y - CH * 0.31 + Math.floor((n - 1) / 4) * 33, s: 0.38, rot: 8 }, { dur: 380, arc: 40 });
      g.remove();
      return;
    }
    if (e.type === 'pounce') {
      const at = multPoint(e.pid), por = $(`por-${e.pid}`);
      SND.whoosh(); shake();
      if (por && !fast) por.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-16px) scale(1.12)' }, { transform: 'translateY(0) scale(1)' }], { duration: D(450), easing: 'cubic-bezier(.3,1.6,.5,1)' });
      burst(at, 14);
      ui.bump = e.pid;
      await pop(`Pounce! ×${e.mult}`, at.x, at.y - 20, '', 1000);
      return;
    }
    if (e.type === 'flip') {
      const felt = $('felt');
      SND.scratch(); shake();
      if (felt && D(900)) {
        const a = felt.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(180deg) scale(.86)', offset: 0.5 }, { transform: 'rotate(360deg)' }], { duration: D(900), easing: 'cubic-bezier(.6,0,.3,1)' });
        setTimeout(() => felt.classList.toggle('rev', e.rev), D(450));
        await a.finished.catch(() => {});
      }
      const c = center(before.trick);
      await pop(e.rev ? 'Upside-down!' : 'Flipped back!', c.x, c.y, 'huge', 1100);
      return;
    }
    if (e.type === 'coin') {
      const at = multPoint(e.pid);
      SND.coin(1);
      particles(A.COIN, { x: at.x, y: at.y - 30 }, at, Math.min(3, e.n), { dur: 400, spread: 20 });
      return pop(`+${e.n} coin${e.n > 1 ? 's' : ''} · ${e.why}`, at.x, at.y - 34, 'small', 900);
    }
    if (e.type === 'forced') {
      const at = playerPoint(e.pid);
      return pop("Can't pass!", at.x, at.y - 30, 'small red', 900);
    }
    if (e.type === 'trick') return animTrick(e);
    if (e.type === 'handEnd') return payoutSeq(e);
  }

  async function animPlay(e, before) {
    const n = e.cards.length, tr = before.trick;
    // current table play slides back into the pile
    document.querySelectorAll('#trick .cd.cur').forEach(el => {
      if (D(200)) el.animate([{ opacity: 1 }, { opacity: 0.4, transform: `translate(-18px,-9px) rotate(${parseFloat(el.style.getPropertyValue('--rot')) - 4}deg)` }], { duration: D(220), fill: 'forwards' });
    });
    document.querySelectorAll('#trick .empty').forEach(el => el.remove());
    const seat = e.pid === ME ? null : seatPoint(e.pid);
    const proms = e.cards.map((u, i) => {
      const src = e.pid === ME && before.hand[u] ? before.hand[u] : null;
      if (src) src.el.style.visibility = 'hidden';
      const p = trickPos(n, i, u);
      const g = ghost(cardHTML(u), 0, 0);
      g.dataset.table = '1';
      const a = src ? { x: src.r.x + (src.r.w - CW) / 2, y: src.r.y + (src.r.h - CH) / 2, rot: src.rot } : { x: seat.x - CW / 2, y: seat.y - CH / 2, s: 0.45, rot: -20 };
      return fly(g, a, { x: tr.x + p.x, y: tr.y + p.y, rot: p.rot }, { dur: 340, arc: src ? 70 : 30, delay: i * 45 });
    });
    await Promise.all(proms);
    SND.slap();
    ui.pile.push({ cards: [...e.cards], by: e.pid });
    if (ui.pile.length > 3) ui.pile.shift();
    if (e.copycat) { const c = center(tr); pop('Copycat!', c.x, c.y - 30, 'small', 800); }
    await wait(120);
  }

  async function animTrick(e) {
    const to = playerPoint(e.pid);
    const els = [...document.querySelectorAll('#trick .cd'), ...fx.querySelectorAll('.ghost[data-table]')];
    document.querySelectorAll('#trick .lbl').forEach(el => el.remove());
    await wait(e.final ? 150 : 260);
    SND.sweep();
    const proms = els.map((el, i) => {
      const r = rectOf(el);
      const g = el.classList.contains('ghost') ? el : (() => { const gg = ghost(el.outerHTML, 0, 0); el.style.visibility = 'hidden'; return gg; })();
      g.removeAttribute('data-table');
      return fly(g, { x: r.x, y: r.y }, { x: to.x - CW / 2, y: to.y - CH / 2, s: 0.25, o: 0, rot: 30 }, { dur: 380, arc: 20, ease: 'cubic-bezier(.5,0,.7,1)', delay: i * 15, fill: 'forwards' }).then(() => g.remove());
    });
    await Promise.all(proms);
    ui.pile = [];
    const at = multPoint(e.pid);
    if (e.pid === ME || e.parts.length) {
      let lv = s.players[e.pid].mult - e.total;
      for (const [label, v] of e.parts) {
        lv += v; SND.purr(Math.min(lv, 6));
        pop(`+${v} Mult · ${label}`, at.x, at.y - 20, 'small', 900);
        await wait(300);
      }
    }
    if (e.hissBy !== null) {
      const hp = seatPoint(e.hissBy);
      ui.hissFlash.add(e.hissBy);
      const por = $(`por-${e.hissBy}`); if (por) por.innerHTML = portrait(e.hissBy, 'hiss') + `<span class="ring" style="--c:${COLORS[e.hissBy]}"></span>`;
      SND.hiss();
      pop('Hiss! Mult cancelled', hp.x, hp.y - 30, 'small red', 1100);
      await wait(500);
    } else if (e.total) {
      ui.bump = e.pid;
      pop(`×${e.mult}${e.capped ? ' (cap)' : ''}`, at.x, at.y - 46, '', 900);
    }
    if (!e.final) await wait(160);
  }

  async function payoutSeq(r) {
    ui.ov = 'payout';
    renderShop();
    const W = s.players[r.winner];
    SND.chirp();
    const rows = r.rows.map(row => {
      const p = s.players[row.id];
      return `<div class="prow" id="prow-${row.id}"><div class="por">${portrait(row.id, row.pay + row.fines >= 20 ? 'hiss' : 'idle')}</div>
        <div class="who">${esc(p.name)}<small>${row.cards} card${row.cards === 1 ? '' : 's'} left</small></div>
        <div class="lo" id="lo-${row.id}"></div>
        <div class="calc"><small class="f">&nbsp;</small><b class="amt num">0</b><small class="nt">&nbsp;</small></div></div>`;
    }).join('');
    ov.innerHTML = `<div class="sheet" data-act="skipanim"><div class="sheet-box pay-box">
      <div class="pay-head"><div class="por">${portrait(r.winner, 'smug')}</div><div><h2>${W.id === ME ? 'You shed' : `${esc(W.name)} sheds`} every card!</h2><p><b${` data-tt="Mult ×${r.mult}" data-tb="Each loser pays cards left × ${r.mult}. 10 or more cards count double, an untouched hand triple."`}>Mult ×${r.mult}</b></p></div>
        <div class="tot"><small>collected</small><b class="num" id="ptot">0</b><small>fish</small></div></div>
      ${rows}
      <div class="pay-foot"><span id="pinc" data-tt="Coins earned" data-tb="4 per hand, +1 per trick won, and 1 interest per 5 coins saved (up to 3). Some jokers add more.">&nbsp;</span><button class="btn gold" data-act="continue" id="pcont" hidden>${s.phase === 'matchEnd' ? 'See final standings' : 'Go to the shop'}</button></div>
    </div></div>` + rotateHTML();
    fit();
    let total = 0;
    const totEl = $('ptot');
    await wait(350);
    for (const row of r.rows) {
      const lo = $(`lo-${row.id}`), rowEl = $(`prow-${row.id}`);
      const n = row.leftover.length, sp = n > 1 ? Math.min(16, (lo.clientWidth - 30) / (n - 1)) : 0;
      lo.innerHTML = row.leftover.map((u, i) => backHTML(`left:${i * sp}px;top:8px;--cw:30px;z-index:${i}`)).join('');
      const backs = [...lo.querySelectorAll('.cd')];
      for (let i = 0; i < backs.length; i++) {
        const el = backs[i];
        if (D(50)) await el.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: D(55) }).finished.catch(() => {});
        el.outerHTML = cardHTML(row.leftover[i], { style: `left:${i * sp}px;top:8px;--cw:30px;z-index:${i}` });
        if (i % 3 === 0) SND.card();
      }
      const calc = rowEl.querySelector('.calc'), amt = calc.querySelector('.amt');
      const counted = row.base !== row.cards ? ` (count ${row.base})` : '';
      calc.querySelector('.f').textContent = `${row.cards}${counted} × ${r.mult}`;
      const steps = Math.min(12, Math.max(1, row.pay));
      for (let k = 1; k <= steps; k++) { amt.textContent = `−${Math.round(row.pay * k / steps)}`; if (k % 2) SND.tick(k); await wait(28); }
      const notes = [];
      if (row.note) notes.push(row.note);
      if (row.fines) notes.push(`hairballs −${row.fines}`);
      calc.querySelector('.nt').textContent = notes.join(' · ') || ' ';
      if (row.pay) {
        const a = center(rectOf(amt)), b = center(rectOf(totEl));
        await particles(A.FISH, a, b, Math.min(10, Math.ceil(row.pay / 3)), { dur: 520, stagger: 35 });
        SND.coin(2);
      }
      total += row.pay;
      totEl.textContent = total;
      if (!fast) totEl.animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: D(250) });
      await wait(180);
    }
    if (r.pot) { total += r.pot; totEl.textContent = total; pop(`+${r.pot} pot`, center(rectOf(totEl)).x, center(rectOf(totEl)).y - 20, 'small', 900); await wait(300); }
    const inc = s.players.map(p => `${p.id === ME ? 'You' : p.name} +${r.income[p.id]}`).join(' · ');
    $('pinc').innerHTML = `${A.COIN} ${esc(inc)}`;
    $('pcont').hidden = false;
    $('pcont').focus();
  }

  function schedule() {
    clearTimeout(timer);
    if (!s || busy || draining || s.phase !== 'play') return;
    // solo pauses while you read; in a room the table keeps going for everyone else
    if (!isOnline() && ['rules', 'log', 'options', 'payout', 'end', 'title', 'room'].includes(ui.ov)) return;
    const pid = s.turn, p = s.players[pid];
    if (pid === ME) { if (ui.thinking !== null) { ui.thinking = null; renderOpps(); } return; }
    if (ui.thinking !== pid) { ui.thinking = pid; renderOpps(); renderTable(); }
    if (p.human || net.mode === 'guest') return; // someone else's move arrives over the room
    timer = setTimeout(() => {
      if (busy || draining || s.turn !== pid || s.phase !== 'play') return;
      enqueue({ op: 'act', pid, a: E.botChoose(s, pid) }).then(err => { if (err) console.warn(err); });
    }, D(650));
  }

  async function dealAnim() {
    s.events.splice(0);
    ui.pile = []; ui.sel.clear(); ui.msg = { text: '', cls: '' }; ui.fortunePick = null; ui.shopMsg = '';
    busy = true; ui.dealing = true;
    render();
    const deck = rectOf($('deckstack'));
    const per = s.players[ME].hand.length;
    const targets = s.players.map(p => (p.id === ME ? handPoint() : seatPoint(p.id)));
    const proms = [];
    let k = 0;
    for (let r = 0; r < per; r++) for (let p = 0; p < s.players.length; p++) {
      const g = ghost(backHTML(), 0, 0), t = targets[p], idx = k++;
      proms.push(fly(g, { x: deck.x, y: deck.y, s: 1 }, { x: t.x - CW / 2 + (p === ME ? (r - per / 2) * 30 : 0), y: t.y - CH / 2, s: p === ME ? 1 : 0.35, o: p === ME ? 1 : 0, rot: (r - per / 2) * 2 }, { dur: 260, arc: 30, delay: idx * 18, fill: 'forwards' }).then(() => { if (idx % 4 === 0) SND.card(); g.remove(); }));
    }
    await Promise.all(proms);
    ui.dealing = false;
    render();
    if (D(300)) document.querySelectorAll('#hand .cd .cd-i').forEach((el, i) => el.animate([{ transform: 'rotateY(90deg)', filter: 'brightness(.6)' }, { transform: 'rotateY(0)' }], { duration: D(240), delay: D(i * 30), easing: 'ease-out', fill: 'backwards' }));
    await wait(300 + per * 30);
    busy = false;
    if (s.houseRule === 'flip') { const c = center(rectOf($('trick'))); SND.scratch(); await pop('Upside-down hand!', c.x, c.y, 'huge', 1200); }
  }

  const newSeed = () => (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  // cfg: {seed, names, humans} — identical on every page of a room
  function startMatch(cfg, seat = 0) {
    clearTimeout(timer); busy = false; clearGhosts();
    queue.length = 0;
    ME = seat;
    s = E.newMatch(cfg.seed, cfg.names, cfg.humans);
    s.ready = {};
    s.events.splice(0);
    Object.assign(ui, { sel: new Set(), msg: { text: '', cls: '' }, pile: [], thinking: null, dealing: false, bump: null, fortunePick: null, shopMsg: '', shopOk: false, shopAnim: true, inGame: true });
    ui.ov = null;
    render();
  }
  function soloMatch(nOpp) {
    net.leave();
    const names = ['You', 'Mochi', 'Biscuit', 'Tofu'].slice(0, nOpp + 1);
    startMatch({ seed: newSeed(), names, humans: names.map((_, i) => i === 0) }, 0);
    if (firstVisit) { ui.ov = 'rules'; render(); }
  }

  // ---------- online rooms ----------
  // The host's page referees: it applies each move, numbers it and broadcasts it on the "log" topic.
  // Guests send their moves through their room presence (any signed-in viewer may set presence) and replay
  // the host's numbered log. A guest that misses a message says which number it needs next ("want") in its
  // presence and the host re-sends from there, so dropped messages and late joiners both catch up.
  // the room this tab is in, so a reload rejoins it; forgotten when the player leaves on purpose
  const forgetRoom = () => { try { sessionStorage.removeItem('shed-room'); } catch (e) {} };
  const cleanName = v => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 14);
  const myName = () => prefs.name || 'Cat';
  const CODE_CH = 'BCDFGHJKLMNPQRSTVWXZ';
  const OPS = ['act', 'buy', 'sell', 'move', 'open', 'skip', 'choose', 'edit', 'ready'];
  const bytes = o => JSON.stringify(o).length;
  // keep only the fields a move may carry, with the right types
  function cleanMove(c) {
    if (!c || !OPS.includes(c.op)) return null;
    const m = { op: c.op };
    if (c.op === 'act') {
      const a = c.a || {};
      if (!['play', 'pass', 'dig', 'discard', 'pounce'].includes(a.type)) return null;
      m.a = { type: a.type };
      if (a.type === 'play') { if (!Array.isArray(a.cards) || a.cards.length > 5 || !a.cards.every(Number.isInteger)) return null; m.a.cards = a.cards.slice(); }
      if (a.type === 'discard') { if (!Number.isInteger(a.card)) return null; m.a.card = a.card; }
    }
    if (typeof c.v === 'string' && c.v.length < 24) m.v = c.v;
    if (c.dir === 1 || c.dir === -1) m.dir = c.dir;
    if (Number.isInteger(c.f) && c.f >= 0 && c.f < 52) m.f = c.f;
    if (c.mode === 'scent' || c.mode === 'hairball') m.mode = c.mode;
    return m;
  }

  const net = {
    mode: 'solo', api: null, room: null, code: '', cfg: null, log: [], next: 0, me: null, seats: [], hostInfo: null,
    cmdN: 0, outbox: [], seen: {}, acks: {}, rej: {}, sent: {}, lastRej: 0, waiting: false, waitT: null, offs: [], tick: null,
    hosts: [], goneAt: 0, leftAt: {}, joinT: null,

    init() {
      // On claude.ai the page gets rooms from the platform; self-hosted, from our own WebSocket server (rooms.js).
      const c = window.claude && typeof window.claude.use === 'function' ? window.claude : window.ShedRooms;
      if (!c || typeof c.use !== 'function') return;
      c.use('room').then(api => {
        if (!api) return;
        net.api = api;
        // the lobby: everyone with the page open; hosts advertise their open rooms here
        api.onPeers(ch => {
          net.hosts = ch.peers.filter(p => !p.sameTab && p.presence && p.presence.host && typeof p.presence.host.code === 'string').map(p => p.presence.host);
          if (ui.ov === 'title') renderRooms();
        }, () => {});
        if (ui.ov === 'title') renderOverlay();
        let again = null;
        try { again = sessionStorage.getItem('shed-room'); } catch (e) {}
        if (again && ui.ov === 'title') net.join(again);
      }).catch(() => {});
    },
    peerId() { const r = net.room; const p = r && r.peers().find(x => x.sameTab); return p ? p.peer : null; },
    seatOf(peer) { return net.seats.findIndex(x => x && x.peer === peer); },
    pushHost() {
      if (net.mode !== 'host' || !net.room) return;
      net.room.presence({ role: 'host', v: 1, code: net.code, name: myName(), seats: net.seats.map(x => x && { peer: x.peer, name: x.name, bot: !!x.bot }), started: net.cfg ? net.cfg.id : null, acks: net.acks, rej: net.rej }).catch(() => {});
      const open = net.seats.filter(x => !x).length;
      net.api.presence({ host: net.cfg ? null : { code: net.code, name: myName(), n: net.seats.length, open } }).catch(() => {});
    },
    listen(room) {
      net.offs.push(room.onPeers(ch => (net.mode === 'host' ? net.hostPeers(ch) : net.guestPeers(ch)), e => net.lost(e)));
      net.offs.push(room.on('log', msg => net.onLog(msg && msg.data), () => {}));
    },

    async create(n) {
      if (!net.api) return;
      forgetRoom(); net.leave();
      const code = Array.from({ length: 4 }, () => CODE_CH[Math.floor(Math.random() * CODE_CH.length)]).join('');
      ui.roomMsg = 'Opening a room…'; ui.ov = 'room'; render();
      try {
        const room = await net.api.join(`shed-${code.toLowerCase()}`);
        // only people allowed to send on the log topic can host
        await room.emit('log', { ping: 1 });
        Object.assign(net, { mode: 'host', room, code, cfg: null, log: [], seats: Array.from({ length: n }, (_, i) => (i === 0 ? { peer: 'host', name: myName() } : null)), seen: {}, acks: {}, rej: {}, sent: {}, leftAt: {} });
        net.listen(room);
        net.tick = setInterval(() => net.hostTick(), 1000);
        ui.roomMsg = '';
        net.pushHost();
      } catch (e) {
        net.leave();
        ui.roomMsg = e && e.code === 'not_permitted' ? 'Hosting needs Contributor or Editor access to this page. You can still join a friend’s room.' : 'Couldn’t open a room. Try again in a moment.';
      }
      ui.ov = 'room'; render();
    },
    setSeats(n) {
      if (net.mode !== 'host' || net.cfg || n < 2 || n > 4) return;
      while (net.seats.length > n) {
        const i = net.seats.lastIndexOf(null);
        if (i > 0) net.seats.splice(i, 1); else break;
      }
      while (net.seats.length < n) net.seats.push(null);
      ui.opps = prefs.opps = net.seats.length - 1; savePrefs();
      net.pushHost(); renderOverlay();
    },
    hostPeers(ch) {
      const guests = ch.peers.filter(p => !p.sameTab && p.kind === 'viewer' && p.presence && p.presence.role === 'guest');
      const here = new Set(guests.map(g => g.peer));
      let changed = false;
      if (!net.cfg) {
        // lobby: seat new guests, free the seats of guests who left
        net.seats.forEach((x, i) => { if (i > 0 && x && !here.has(x.peer)) { net.seats[i] = null; changed = true; } });
        guests.forEach(g => {
          if (net.seatOf(g.peer) >= 0) { const x = net.seats[net.seatOf(g.peer)], nm = cleanName(g.presence.name) || 'Cat'; if (x.name !== nm) { x.name = nm; changed = true; } return; }
          const free = net.seats.indexOf(null);
          if (free > 0) { net.seats[free] = { peer: g.peer, name: cleanName(g.presence.name) || 'Cat' }; changed = true; }
        });
      } else {
        net.seats.forEach((x, i) => {
          if (i === 0 || !x) return;
          if (x.bot && here.has(x.peer) && s.players[i]) { x.bot = false; changed = true; const nm = s.players[i].name; enqueue({ op: 'human', pid: i }).then(() => flash(`${nm} is back.`, 'ok')); return; }
          if (!x.bot) { if (here.has(x.peer)) delete net.leftAt[i]; else if (!net.leftAt[i]) net.leftAt[i] = Date.now(); }
        });
        // guests' moves: take each new one once, in order, as that guest's seat
        guests.forEach(g => {
          const seat = net.seatOf(g.peer);
          if (seat < 0 || net.seats[seat].bot) return;
          const cmds = Array.isArray(g.presence.cmds) ? g.presence.cmds.slice(-8) : [];
          cmds.filter(x => x && Number.isInteger(x.n)).sort((a, b) => a.n - b.n).forEach(x => {
            if (x.n <= (net.seen[g.peer] || 0)) return;
            net.seen[g.peer] = x.n;
            const m = cleanMove(x.c);
            if (!m) { net.acks[g.peer] = x.n; net.rej[g.peer] = { n: x.n, err: 'That move was not understood.' }; changed = true; return; }
            m.pid = seat;
            enqueue(m).then(err => { net.acks[g.peer] = Math.max(net.acks[g.peer] || 0, x.n); if (err) net.rej[g.peer] = { n: x.n, err }; net.pushHost(); });
          });
          net.resend(g);
        });
      }
      if (changed) { net.pushHost(); if (ui.ov === 'room') renderOverlay(); }
      else if (ui.ov === 'room') renderOverlay();
    },
    hostTick() {
      if (net.mode !== 'host' || !net.room) return;
      if (!net.cfg) return;
      net.room.peers().forEach(g => { if (!g.sameTab && g.presence && g.presence.role === 'guest' && net.seatOf(g.peer) >= 0) net.resend(g); });
      // a guest gone for 8 seconds hands their seat to a bot
      Object.keys(net.leftAt).forEach(k => {
        const i = +k;
        if (Date.now() - net.leftAt[i] < 8000 || !net.seats[i] || net.seats[i].bot) return;
        net.seats[i].bot = true; delete net.leftAt[i];
        const nm = s.players[i].name;
        enqueue({ op: 'bot', pid: i }).then(() => flash(`${nm} left. A bot plays their seat.`, 'ok'));
        net.pushHost();
      });
    },
    // send a guest the log from where it says it is, one chunk under the 4 KiB message limit
    resend(g) {
      const pr = g.presence || {};
      const has = pr.cfg === net.cfg.id;
      const want = has && Number.isInteger(pr.want) ? Math.max(0, pr.want) : 0;
      if (has && want >= net.log.length) return;
      const last = net.sent[g.peer], now = Date.now();
      if (last && last.want === want && last.has === has && now - last.t < 1200) return;
      net.sent[g.peer] = { want, has, t: now };
      const msg = { to: g.peer, id: net.cfg.id, from: want, len: net.log.length, entries: [] };
      if (!has) msg.cfg = net.cfg;
      for (let i = want; i < net.log.length; i++) { msg.entries.push(net.log[i]); if (bytes(msg) > 3400) { msg.entries.pop(); break; } }
      net.room.emit('log', msg).catch(() => {});
    },
    commit(c) {
      const m = cleanMove(c) || { op: c.op };
      m.pid = c.pid;
      if (c.op === 'bot' || c.op === 'human') m.op = c.op;
      net.log.push(m);
      net.room.emit('log', { id: net.cfg.id, from: net.log.length - 1, len: net.log.length, entries: [m] }).catch(() => {});
    },
    start() {
      if (net.mode !== 'host') return;
      // a rematch keeps whoever is still here; empty or abandoned seats become bots
      if (net.cfg) net.seats = net.seats.map((x, i) => (i === 0 || (x && !x.bot && net.room.peers().some(p => p.peer === x.peer)) ? x : null));
      const seats = net.seats;
      const cfg = { id: Math.random().toString(36).slice(2, 10), seed: newSeed(), names: seats.map((x, i) => (x ? x.name : BOT_NAMES[i])), humans: seats.map(x => !!x), peers: seats.map(x => (x ? x.peer : null)) };
      // two people with the same name get told apart
      cfg.names = cfg.names.map((nm, i) => (cfg.names.indexOf(nm) !== i ? `${nm} ${i + 1}` : nm));
      Object.assign(net, { cfg, log: [], sent: {}, leftAt: {} });
      startMatch(cfg, 0);
      ui.inGame = true;
      net.room.emit('log', { id: cfg.id, cfg, from: 0, len: 0, entries: [] }).catch(() => {});
      net.pushHost();
    },

    async join(code) {
      code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (!net.api) return;
      if (code.length !== 4) { ui.roomMsg = 'Room codes have four letters.'; renderOverlay(); return; }
      net.leave();
      ui.roomMsg = 'Joining…'; ui.ov = 'room'; render();
      try {
        const room = await net.api.join(`shed-${code.toLowerCase()}`);
        Object.assign(net, { mode: 'guest', room, code, cfg: null, log: [], next: 0, cmdN: Date.now(), outbox: [], lastRej: 0, hostInfo: null, goneAt: 0 });
        net.listen(room);
        room.presence({ role: 'guest', name: myName(), want: 0, cfg: null, cmds: [] }).catch(() => {});
        try { sessionStorage.setItem('shed-room', code); } catch (e) {}
        net.joinT = setTimeout(() => { if (net.mode === 'guest' && !net.hostInfo) { forgetRoom(); net.leave(); ui.roomMsg = `No room called ${code} is open right now.`; ui.ov = 'title'; render(); } }, 6000);
        ui.roomMsg = '';
      } catch (e) { net.leave(); ui.roomMsg = 'Couldn’t join. Try again in a moment.'; ui.ov = 'title'; }
      render();
    },
    guestPeers(ch) {
      net.me = net.peerId() || net.me;
      const host = ch.peers.find(p => !p.sameTab && p.presence && p.presence.role === 'host');
      if (!host) {
        if (net.hostInfo && !net.goneAt) {
          net.goneAt = Date.now();
          setTimeout(() => { if (net.mode === 'guest' && net.goneAt && !net.room.peers().some(p => p.presence && p.presence.role === 'host')) { ui.ov = net.cfg ? 'gone' : 'title'; if (!net.cfg) { ui.roomMsg = 'The host closed the room.'; net.leave(); } render(); } }, 5000);
        }
        return;
      }
      net.goneAt = 0;
      const h = host.presence;
      net.hostInfo = { name: cleanName(h.name), seats: Array.isArray(h.seats) ? h.seats.slice(0, 4) : [], started: h.started };
      clearTimeout(net.joinT);
      // the host has applied (or refused) our moves up to acks[me]
      const ack = h.acks && Number.isInteger(h.acks[net.me]) ? h.acks[net.me] : 0;
      const before = net.outbox.length;
      net.outbox = net.outbox.filter(x => x.n > ack);
      if (net.outbox.length !== before) net.room.presence({ cmds: net.outbox }).catch(() => {});
      const rj = h.rej && h.rej[net.me];
      if (rj && Number.isInteger(rj.n) && rj.n > net.lastRej) {
        net.lastRej = rj.n; net.waiting = false;
        const msg = typeof rj.err === 'string' ? rj.err.slice(0, 120) : 'That move didn’t go through.';
        if (s.phase === 'shop') { ui.shopMsg = msg; ui.shopOk = false; renderShop(); } else flash(msg);
        renderActions();
      }
      if (!net.cfg && ui.ov === 'room') renderOverlay();
      const mine = net.hostInfo.seats.some(x => x && x.peer === net.me);
      ui.roomMsg = !net.cfg && !mine && !h.started && !net.hostInfo.seats.includes(null) ? 'That room is full.' : ui.roomMsg === 'That room is full.' ? '' : ui.roomMsg;
    },
    onLog(m) {
      if (net.mode !== 'guest' || !m || typeof m !== 'object' || m.ping) return;
      net.me = net.peerId() || net.me;
      if (m.to && m.to !== net.me) return;
      const c = m.cfg;
      if (c && (!net.cfg || c.id !== net.cfg.id)) {
        if (!Array.isArray(c.names) || !Array.isArray(c.humans) || !Array.isArray(c.peers) || c.names.length < 2 || c.names.length > 4) return;
        const seat = c.peers.indexOf(net.me);
        if (seat < 0) { ui.roomMsg = 'This room started without you.'; if (ui.ov === 'room') renderOverlay(); return; }
        net.cfg = { id: String(c.id), seed: c.seed >>> 0, names: c.names.map(x => cleanName(x) || 'Cat'), humans: c.humans.map(Boolean), peers: c.peers };
        net.log = []; net.next = 0; net.outbox = []; net.waiting = false;
        startMatch(net.cfg, seat);
        ui.inGame = true;
      }
      if (!net.cfg || m.id !== net.cfg.id || !Array.isArray(m.entries) || !Number.isInteger(m.from)) { net.say(); return; }
      const len = Number.isInteger(m.len) ? m.len : m.from + m.entries.length;
      for (let k = 0; k < m.entries.length; k++) {
        const i = m.from + k;
        if (i < net.next) continue;
        if (i > net.next) break; // a gap: our "want" asks the host to fill it
        const e = m.entries[k], mv = cleanMove(e) || (e && (e.op === 'bot' || e.op === 'human') ? { op: e.op } : null);
        if (!mv || !Number.isInteger(e.pid)) break;
        mv.pid = e.pid;
        net.log.push(mv); net.next++;
        // far behind (joined late, or came back): catch up without replaying every animation
        enqueue(mv, true, len - i > 4);
      }
      net.say();
    },
    say() { if (net.room) net.room.presence({ want: net.next, cfg: net.cfg ? net.cfg.id : null }).catch(() => {}); },
    send(c) {
      const m = cleanMove(c);
      if (!m || !net.room) return Promise.resolve('That move was not understood.');
      net.outbox.push({ n: ++net.cmdN, c: m });
      net.outbox = net.outbox.slice(-8);
      net.room.presence({ cmds: net.outbox }).catch(() => {});
      net.waiting = true; clearTimeout(net.waitT);
      net.waitT = setTimeout(() => { net.waiting = false; renderActions(); if (s.phase === 'shop') renderShop(); }, 4000);
      renderActions();
      return Promise.resolve(null);
    },
    lost() { if (net.mode === 'guest' && net.cfg) { ui.ov = 'gone'; render(); } },
    // the host left mid-match: keep going here, with bots in every other seat
    goSolo() {
      const keep = s;
      net.leave(true);
      s = keep;
      s.players.forEach(p => { if (p.id !== ME) p.human = false; });
      ui.ov = null; render(); schedule();
    },
    leave(keepState) {
      net.offs.forEach(f => { try { f(); } catch (e) {} });
      net.offs = [];
      clearInterval(net.tick); clearTimeout(net.joinT); clearTimeout(net.waitT);
      if (net.room) net.room.leave().catch(() => {});
      if (net.mode === 'host' && net.api) net.api.presence({ host: null }).catch(() => {});
      Object.assign(net, { mode: 'solo', room: null, code: '', cfg: null, log: [], next: 0, seats: [], hostInfo: null, outbox: [], waiting: false, goneAt: 0 });
      if (!keepState && ui.inGame && s) { /* the table stays laid; the menu offers a fresh match */ }
    },
  };

  // ---------- input ----------
  async function human(action) {
    const err = await submit({ op: 'act', a: action });
    if (err) flash(err);
  }
  const shopDone = (err, okMsg) => { ui.shopMsg = err || okMsg || ''; ui.shopOk = !err; renderShop(); renderSide(); renderMine(); };
  const shopCmd = (c, okMsg) => submit(c).then(err => shopDone(err, net.mode === 'guest' ? '' : okMsg));

  stage.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act, v = t.dataset.v, me = s.players[ME];
    if (t.getAttribute('aria-disabled') === 'true') {
      const why = t.dataset.why;
      if (why) { if (s.phase === 'shop') { ui.shopMsg = why; ui.shopOk = false; renderShop(); } else flash(why); }
      return;
    }
    switch (act) {
      case 'card': {
        if (busy || s.phase !== 'play' || s.turn !== ME) return;
        const u = +t.dataset.uid;
        if (me.mustDiscard) { ui.sel.has(u) ? ui.sel.delete(u) : (ui.sel.clear(), ui.sel.add(u)); }
        else ui.sel.has(u) ? ui.sel.delete(u) : ui.sel.add(u);
        ui.msg = { text: '', cls: '' }; SND.card(); renderHand(); renderActions(); return;
      }
      case 'play': return human({ type: 'play', cards: [...ui.sel] });
      case 'pass': return human({ type: 'pass' });
      case 'dig': return human({ type: 'dig' });
      case 'discard': return human({ type: 'discard', card: [...ui.sel][0] });
      case 'pounce': return human({ type: 'pounce' });
      case 'hint': {
        ui.sel.clear();
        if (me.mustDiscard) ui.sel.add(E.botDiscard(s, ME));
        else { const a = E.botChoose(Object.assign({}, s, { botRng: () => 0.99 }), ME); if (a.type === 'play') a.cards.forEach(u => ui.sel.add(u)); else { flash(a.type === 'dig' ? 'Nothing beats it. Dig or pass.' : 'Nothing beats it. Pass.', 'ok'); } }
        renderHand(); renderActions(); return;
      }
      case 'sort': ui.sortBySuit = !ui.sortBySuit; renderHand(); renderActions(); return;
      case 'rules': case 'log': case 'options':
        if (!isOnline()) { clearTimeout(timer); ui.thinking = null; }
        ui.back = ['title', 'room'].includes(ui.ov) ? ui.ov : null; ui.ov = act; render(); return;
      case 'close': case 'bg':
        if (act === 'bg' && e.target !== t) return;
        if (ui.ov === 'rules') { firstVisit = false; try { localStorage.setItem('shed-v2-rules-seen', '1'); } catch (err) {} }
        ui.ov = ui.back; ui.back = null; render(); schedule(); return;
      case 'toc': { e.preventDefault(); const el = document.querySelector(t.getAttribute('href')); if (el) el.scrollIntoView({ behavior: prefs.reduced ? 'auto' : 'smooth' }); return; }
      case 'pref': { const k = t.dataset.k; prefs[k] = k === 'speed' ? +v : v === 'true'; savePrefs(); renderOverlay(); return; }
      case 'fullscreen': { const d = document.documentElement; if (d.requestFullscreen) d.requestFullscreen().catch(() => {}); return; }
      case 'menu': ui.ov = net.mode !== 'solo' && ui.inGame ? 'leave' : 'title'; render(); return;
      case 'again': if (net.mode === 'host') net.start(); else soloMatch(s.players.length - 1); return;
      case 'opps': ui.opps = prefs.opps = +v; savePrefs(); renderOverlay(); return;
      case 'solo': forgetRoom(); SND.chirp(); soloMatch(ui.opps); return;
      case 'resume': ui.ov = null; render(); schedule(); return;
      case 'create': net.create(ui.opps + 1); return;
      case 'join': net.join(v || ui.code); return;
      case 'seats': net.setSeats(net.seats.length + +v); return;
      case 'start': net.start(); return;
      case 'leave': forgetRoom(); net.leave(); ui.inGame = false; ui.ov = 'title'; ui.roomMsg = ''; render(); return;
      case 'stay': ui.ov = null; render(); return;
      case 'gone-bots': net.goSolo(); return;
      case 'anyway': ui.anyway = true; fit(); return;
      case 'skipanim': if (!e.target.closest('button')) ui.skip = true; return;
      case 'continue': {
        ui.skip = false;
        if (s.phase === 'matchEnd') { ui.ov = 'end'; render(); }
        else { ui.ov = null; ui.shopAnim = true; ui.shopMsg = ''; render(); }
        return;
      }
      // shop
      case 'buy': return shopCmd({ op: 'buy', v });
      case 'sell': return shopCmd({ op: 'sell', v });
      case 'move': return shopCmd({ op: 'move', v, dir: +t.dataset.dir });
      case 'open': ui.fortunePick = null; return shopCmd({ op: 'open', v });
      case 'skip': ui.fortunePick = null; return shopCmd({ op: 'skip' });
      case 'unpick': ui.fortunePick = null; return shopDone(null);
      case 'pick': {
        if (me.pending && me.pending.type === 'fortune') { ui.fortunePick = v; return shopDone(null); }
        return shopCmd({ op: 'choose', v }, 'Added.');
      }
      case 'mode': ui.editMode = v; renderShop(); return;
      case 'face': {
        const f = +t.dataset.f;
        if (ui.fortunePick) { const kind = ui.fortunePick; ui.fortunePick = null; return shopCmd({ op: 'choose', v: kind, f }, `${E.FORTUNES[kind].name} used on ${E.faceName(f)}.`); }
        return shopCmd({ op: 'edit', f, mode: ui.editMode }, `${ui.editMode === 'scent' ? 'Scent mark' : 'Hairball'} placed on ${E.faceName(f)}.`);
      }
      case 'deal': ui.shopMsg = ''; submit({ op: 'ready' }).then(err => { if (err) shopDone(err); else renderShop(); }); return;
    }
  });
  // pointer tilt on hand cards
  stage.addEventListener('pointermove', e => {
    const c = e.target.closest && e.target.closest('#hand .cd');
    document.querySelectorAll('#hand .cd[style*="--rx"]').forEach(el => { if (el !== c) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); } });
    if (!c || prefs.reduced) return;
    const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    c.style.setProperty('--ry', `${(px * 18).toFixed(1)}deg`); c.style.setProperty('--rx', `${(-py * 18).toFixed(1)}deg`);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ['rules', 'log', 'options'].includes(ui.ov)) { ui.ov = ui.back; ui.back = null; render(); schedule(); }
    if (e.key === 'Enter' && e.target && e.target.id === 'joincode') net.join(ui.code);
  });
  stage.addEventListener('input', e => {
    if (e.target.id === 'pname') { prefs.name = cleanName(e.target.value); savePrefs(); }
    if (e.target.id === 'joincode') { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); if (v !== e.target.value) e.target.value = v; ui.code = v; }
  });

  fit();
  ui.opps = [1, 2, 3].includes(+prefs.opps) ? +prefs.opps : 3;
  soloMatch(ui.opps);           // a table is always laid behind the title screen
  ui.inGame = false; ui.ov = 'title'; render();
  net.init();
  window.__shed = { get s() { return s; }, ui, net, get busy() { return busy; }, get ME() { return ME; }, get queue() { return queue.length + (draining ? 1 : 0); } };
})();
