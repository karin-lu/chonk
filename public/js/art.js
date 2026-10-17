// Procedural first-pass art for Chonk: ink-outlined cats, card faces, icons. Swap for drawn art later.
const Art = (() => {
  const INK = '#2a1d17';
  let uid = 0;
  const COATS = {
    black: { base: '#34302d', ear: '#e4a1a1', eye: '#e9c54b', stripe: null },
    calico: { base: '#f7f0e3', ear: '#f0b3ad', eye: '#7cbf68', patchA: '#e8964a', patchB: '#3b3330' },
    tabby: { base: '#eba24c', ear: '#f3c09a', eye: '#6fae58', stripe: '#b8652a' },
    white: { base: '#f8f5ef', ear: '#f2b7b7', eye: '#69a6d8' },
  };
  const SUIT_PIP = {
    fish: '<path d="M2.5 12c2.6-4.2 7.8-5.6 12-2.7L20.5 6v12l-6-3.3C10.3 17.6 5.1 16.2 2.5 12z"/><circle cx="7.4" cy="11.2" r="1.2" fill="#fbf6ea"/>',
    yarn: '<circle cx="11.5" cy="11.5" r="8.5"/><path d="M4.6 8.6c4 1 8.4 4.6 10.6 10.4M8 3.8c3.3 3 5.7 8 6.4 15.2M3.3 13.6c4.2-1 8.8 0 13.2 3.3" fill="none" stroke="#fbf6ea" stroke-width="1.3"/><path d="M17.6 17.8c2 1 3.2 2.6 3.6 4.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    mice: '<path d="M3 16.5c0-5 4-8.6 9-8.6s8 3 9.2 6.5c-3 .6-4.6 2.1-8.2 2.1H3z"/><circle cx="10.8" cy="7.4" r="3.1"/><path d="M3 16.5c-1.2 2 0 4.2 2.6 4.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="17.2" cy="12" r="1" fill="#fbf6ea"/>',
    paws: '<path d="M12 12.4c-3 0-5.6 2.6-5.6 4.9 0 1.8 1.6 2.8 3.3 2.3 1-.3 1.6-.6 2.3-.6s1.3.3 2.3.6c1.7.5 3.3-.5 3.3-2.3 0-2.3-2.6-4.9-5.6-4.9z"/><ellipse cx="5.8" cy="10" rx="1.9" ry="2.4"/><ellipse cx="9.4" cy="6.3" rx="1.9" ry="2.6"/><ellipse cx="14.6" cy="6.3" rx="1.9" ry="2.6"/><ellipse cx="18.2" cy="10" rx="1.9" ry="2.4"/>',
  };
  const pip = suit => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SUIT_PIP[suit]}</svg>`;

  // a cat head in a 100x100 box. expr: idle | think | smug | hiss
  function catHead(coatName, expr = 'idle', o = {}) {
    const c = typeof coatName === 'string' ? COATS[coatName] : coatName;
    const id = 'c' + (++uid);
    const flat = expr === 'hiss';
    const earL = flat ? 'M9 52 L13 22 L40 34 Z' : 'M15 47 L23 7 L46 30 Z';
    const earR = flat ? 'M91 52 L87 22 L60 34 Z' : 'M85 47 L77 7 L54 30 Z';
    const inL = flat ? 'M16 46 L18 30 L33 36 Z' : 'M22 39 L26 18 L38 31 Z';
    const inR = flat ? 'M84 46 L82 30 L67 36 Z' : 'M78 39 L74 18 L62 31 Z';
    const earFillL = c.patchA || c.base, earFillR = c.patchB || c.base;
    let eyes = '';
    const eye = (x, dx = 0, dy = 0) => `<ellipse cx="${x}" cy="57" rx="6" ry="7.5" fill="${c.eye}" stroke="${INK}" stroke-width="2.4"/><ellipse cx="${x + dx}" cy="${57 + dy}" rx="2.2" ry="5.2" fill="${INK}"/><circle cx="${x + dx - 1.5}" cy="${54 + dy}" r="1.3" fill="#fff"/>`;
    if (expr === 'idle') eyes = eye(36) + eye(64);
    if (expr === 'think') eyes = eye(36, 2.2, -2) + eye(64, 2.2, -2) + `<path d="M56 45 Q64 41 72 45" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
    if (expr === 'smug') eyes = `<path d="M28 58 Q36 51 44 58" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/><path d="M56 58 Q64 51 72 58" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`;
    if (expr === 'hiss') eyes = `<path d="M28 52 L44 57 L41 61 Q33 62 29 57 Z" fill="${c.eye}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="M72 52 L56 57 L59 61 Q67 62 71 57 Z" fill="${c.eye}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><circle cx="38" cy="58" r="1.8" fill="${INK}"/><circle cx="62" cy="58" r="1.8" fill="${INK}"/>`;
    let mouth = `<path d="M43 71 Q46.5 75 50 71 Q53.5 75 57 71" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
    if (expr === 'smug') mouth = `<path d="M40 70 Q50 80 60 70" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
    if (expr === 'hiss') mouth = `<path d="M40 71 Q50 66 60 71 Q58 84 50 84 Q42 84 40 71 Z" fill="#5a1c22" stroke="${INK}" stroke-width="2.4"/><path d="M43 71.5 L45.5 77 L47.5 70 Z M57 71.5 L54.5 77 L52.5 70 Z" fill="#fff"/>`;
    const stripes = c.stripe ? `<g stroke="${c.stripe}" stroke-width="3.2" stroke-linecap="round" fill="none"><path d="M43 32 L45 42"/><path d="M50 30 L50 42"/><path d="M57 32 L55 42"/><path d="M16 58 L26 60"/><path d="M17 66 L26 66"/><path d="M84 58 L74 60"/><path d="M83 66 L74 66"/></g>` : '';
    const patches = c.patchA ? `<g clip-path="url(#${id})"><ellipse cx="28" cy="40" rx="20" ry="16" fill="${c.patchA}"/><ellipse cx="74" cy="34" rx="18" ry="13" fill="${c.patchB}"/><ellipse cx="72" cy="82" rx="10" ry="7" fill="${c.patchA}"/></g>` : '';
    const acc = o.acc ? accessory(o.acc) : '';
    const whisk = `<g stroke="${INK}" stroke-width="1.6" stroke-linecap="round" opacity=".75"><path d="M28 68 L8 64"/><path d="M28 72 L9 74"/><path d="M72 68 L92 64"/><path d="M72 72 L91 74"/></g>`;
    return `<defs><clipPath id="${id}"><ellipse cx="50" cy="60" rx="36" ry="30"/></clipPath></defs>
      <path d="${earL}" fill="${earFillL}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="${earR}" fill="${earFillR}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="${inL}" fill="${c.ear}"/><path d="${inR}" fill="${c.ear}"/>
      <ellipse cx="50" cy="60" rx="36" ry="30" fill="${c.base}"/>${patches}${stripes}
      <ellipse cx="50" cy="60" rx="36" ry="30" fill="none" stroke="${INK}" stroke-width="3"/>
      ${eyes}<path d="M46 64.5 L54 64.5 L50 68.5 Z" fill="#e58a8a" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>${mouth}${whisk}${acc}`;
  }
  function accessory(a) {
    if (a === 'crown') return `<path d="M30 24 L36 6 L44 18 L50 2 L56 18 L64 6 L70 24 Z" fill="#f2c14e" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><circle cx="50" cy="15" r="3" fill="#c2304f"/>`;
    if (a === 'bow') return `<path d="M64 20 L54 12 L54 28 Z M64 20 L74 12 L74 28 Z" fill="#e05a8a" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><circle cx="64" cy="20" r="3.4" fill="#e05a8a" stroke="${INK}" stroke-width="2"/>`;
    if (a === 'cap') return `<path d="M26 30 Q50 6 74 30 Z" fill="#3e7fc4" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><path d="M60 28 L86 32" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
    return '';
  }
  const portrait = (coat, expr) => `<svg viewBox="0 0 100 100" aria-hidden="true">${catHead(coat, expr)}</svg>`;

  // face-card art, drawn in the suit colour
  function faceArt(rank, suit, color) {
    const coat = { base: color, ear: '#fbf6ea', eye: '#fbf6ea' };
    if (rank === 'K') return `<svg viewBox="0 0 100 100">${catHead(coat, 'smug', { acc: 'crown' })}</svg>`;
    if (rank === 'Q') return `<svg viewBox="0 0 100 100">${catHead(coat, 'idle', { acc: 'bow' })}</svg>`;
    if (rank === 'J') return `<svg viewBox="0 0 100 100">${catHead(coat, 'think', { acc: 'cap' })}</svg>`;
    if (rank === '2') return `<svg viewBox="0 0 100 100"><ellipse cx="50" cy="70" rx="44" ry="26" fill="${color}" stroke="${INK}" stroke-width="3"/><path d="M28 36 L32 18 L44 30 Z M72 36 L68 18 L56 30 Z" fill="${color}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><ellipse cx="50" cy="46" rx="24" ry="19" fill="${color}" stroke="${INK}" stroke-width="3"/><path d="M38 46 Q42 42 46 46 M54 46 Q58 42 62 46" fill="none" stroke="#fbf6ea" stroke-width="3" stroke-linecap="round"/><path d="M46 53 Q50 57 54 53" fill="none" stroke="#fbf6ea" stroke-width="2.4" stroke-linecap="round"/><path d="M90 72 Q100 60 92 50" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M90 72 Q100 60 92 50" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/></svg>`;
    return null;
  }
  // big centre pip for number cards and aces
  function centerPip(rank, suit) {
    const big = rank === 'A';
    return `<svg viewBox="0 0 24 24" fill="currentColor" style="width:${big ? 92 : 70}%;height:${big ? 92 : 70}%">${big ? '<circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".5"/>' : ''}${SUIT_PIP[suit]}</svg>`;
  }
  const PAW = `<svg viewBox="0 0 24 24" fill="#f6b949">${SUIT_PIP.paws}</svg>`;
  const ICONS = {
    Mult: '<path d="M12 2 L14.8 9 L22 9.5 L16.4 14 L18.3 21 L12 17 L5.7 21 L7.6 14 L2 9.5 L9.2 9 Z" fill="#ffd38a" stroke="#2a1d17" stroke-width="1.4" stroke-linejoin="round"/>',
    Rule: '<path d="M4 4 H20 V20 H4 Z" fill="#cfe0ff" stroke="#2a1d17" stroke-width="1.4"/><path d="M8 9 H16 M8 13 H16 M8 17 H13" stroke="#2a1d17" stroke-width="1.6" stroke-linecap="round"/>',
    Economy: '<circle cx="12" cy="12" r="9" fill="#f6c95a" stroke="#2a1d17" stroke-width="1.4"/><circle cx="12" cy="12" r="5" fill="none" stroke="#2a1d17" stroke-width="1.4"/>',
    Interaction: '<path d="M3 12 Q12 3 21 12 Q12 21 3 12 Z" fill="#ffc0dc" stroke="#2a1d17" stroke-width="1.4"/><circle cx="12" cy="12" r="3" fill="#2a1d17"/>',
    Defence: '<path d="M12 2 L20 6 V12 Q20 18 12 22 Q4 18 4 12 V6 Z" fill="#a8e6e2" stroke="#2a1d17" stroke-width="1.4" stroke-linejoin="round"/>',
  };
  const icon = kind => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind] || ICONS.Rule}</svg>`;
  const FISH = '<svg viewBox="0 0 24 24"><path d="M2 12c3-5 9-6 13-3l6-4v14l-6-4c-4 3-10 2-13-3z" fill="#9fd0e6" stroke="#1d3a46" stroke-width="1.4" stroke-linejoin="round"/><circle cx="7" cy="11" r="1.3" fill="#1d3a46"/></svg>';
  const COIN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f6c95a" stroke="#6b4a10" stroke-width="1.6"/><path d="M12 6v12M8.5 9.5h7M8.5 14.5h7" stroke="#6b4a10" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const SPARK = '<svg viewBox="0 0 24 24"><path d="M12 1 L14 10 L23 12 L14 14 L12 23 L10 14 L1 12 L10 10 Z" fill="#ffe08a"/></svg>';
  const LITTER = '<svg viewBox="0 0 76 50"><path d="M4 14 H72 L66 46 H10 Z" fill="#c9a26b" stroke="#2a1d17" stroke-width="2.4" stroke-linejoin="round"/><path d="M4 14 H72" stroke="#2a1d17" stroke-width="2.4"/><path d="M10 14 Q22 4 34 12 Q46 3 58 11 Q66 6 70 14" fill="#e6d3ad" stroke="#2a1d17" stroke-width="2"/><circle cx="24" cy="10" r="2" fill="#bfa77b"/><circle cx="48" cy="9" r="2" fill="#bfa77b"/></svg>';
  return { catHead, portrait, faceArt, centerPip, pip, PAW, icon, FISH, COIN, SPARK, LITTER, SUIT_PIP };
})();
