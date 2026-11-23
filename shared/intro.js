// Rules dropdown and a short "how to play" animation for every game page.
//
// Include intro.css in the head and, at the end of the page,
//   <script src="…/shared/intro.js" data-game="spooky"></script>
// It moves the page's rules box (#info, or #rules on Daily and Challenge) into
// a small "Rules" dropdown with a "How to play" button, and plays the animation
// the first time each game is opened on this device. An animation is a list of
// steps on a small board: a caption, and optionally a finger that taps or holds
// a spot, and the change that follows.
(() => {
  const me = document.currentScript;
  const GAME = me && me.dataset.game;
  const SEEN_KEY = 'pebble-intro-v1';
  const W = 340, R = 22;

  // ---------- Boards ----------
  // A line: spots 0..n in one row; spot 0 always pebbled; the flag on spot n.
  function line(n, extra = {}) {
    const gap = Math.min(80, 280 / n), x0 = 170 - gap * n / 2;
    return {
      h: extra.h || 120, tick: !!extra.tick, line: true,
      nodes: Array.from({ length: n + 1 }, (_, i) => ({
        x: x0 + gap * i, y: 58, fixed: i === 0, goal: i === n, on: i === 0, label: i ? String(i) : '',
        ...(extra[i] || {}),
      })),
    };
  }
  // A small graph: nodes with positions, and edges [from, to].
  const graph = (nodes, edges, h) => ({ h, nodes, edges });

  // ---------- Steps ----------
  const say = (text, o = {}) => ({ text, ...o });
  const tap = (at, set, text, o = {}) => ({ at, act: 'tap', set, text, ...o });
  const hold = (at, set, text, o = {}) => ({ at, act: 'hold', set, text, ...o });
  const bad = (at, text, o = {}) => ({ at, act: 'bad', text, ...o });
  const tick = (set, text, o = {}) => ({ at: 'tick', act: 'tap', set, text, ...o });
  const on = v => ({ on: v });

  const dots = (k, n) => '●'.repeat(Math.max(0, k)) + '○'.repeat(Math.max(0, n - k));
  const placed = s => s.nodes.filter(n => n.on && !n.fixed).length;
  const hand = P => s => 'In hand ' + dots(P - placed(s), P);

  const PRICES = {
    title: 'Prices',
    board: () => line(3, { h: 140, 1: { chips: [1, 3] }, 2: { chips: [2, 2] }, 3: { chips: [1, 2] } }),
    vars: { budget: 9 },
    hud: s => hand(2)(s) + '  ·  Budget ' + s.vars.budget,
    steps: [
      say('Each spot has two prices: tap (outlined) and erase (orange).'),
      tap(1, { 1: on(true) }, 'A tap places a pebble next to one, and pays the outlined price.', { add: { budget: -1 } }),
      tap(2, { 2: on(true) }, 'Spot 2 costs 2 to tap.', { add: { budget: -2 } }),
      hold(1, { 1: on(false) }, 'A hold erases a pebble from anywhere, and pays the orange price.', { add: { budget: -3 }, flash: 'erased' }),
      tap(3, { 3: on(true) }, 'Reach the flag…', { add: { budget: -1 } }),
      hold(2, { 2: on(false) }, '…then clear the rest before the budget runs out. Solved.', { add: { budget: -2 }, flash: 'erased', win: true }),
    ],
  };

  const SCENES = {
    reversible: {
      title: 'Reversible',
      board: () => line(3),
      hud: hand(2),
      steps: [
        say('Spot 0 always has a pebble. You have 2 more to place.'),
        tap(1, { 1: on(true) }, 'Tap a spot to place a pebble…'),
        bad(3, '…but only when the spot just before it has one.'),
        tap(2, { 2: on(true) }, 'Spot 1 has a pebble, so spot 2 is allowed.'),
        tap(1, { 1: on(false) }, 'Tap a pebble to pick it up. Same rule: the spot before must have one.'),
        tap(3, { 3: on(true) }, 'Get a pebble to the flag. Fewer moves is better.', { win: true }),
      ],
    },
    clean: {
      title: 'Clean finish',
      board: () => line(2),
      hud: hand(2),
      steps: [
        say('Goal: finish with a pebble on the flag and nowhere else.'),
        tap(1, { 1: on(true) }, 'Tap to place a pebble, only when the spot before has one.'),
        tap(2, { 2: on(true) }, 'Reach the flag…'),
        tap(1, { 1: on(false) }, '…then pick up every other pebble. Only the flag is left: solved.', { win: true }),
      ],
    },
    erase: {
      title: 'Erasure',
      board: () => line(3),
      vars: { budget: 9 },
      hud: s => hand(2)(s) + '  ·  Budget ' + s.vars.budget,
      steps: [
        say('You have a budget, and every move costs something.'),
        tap(1, { 1: on(true) }, 'A tap places or picks up a pebble next to one. It costs 1.', { add: { budget: -1 } }),
        tap(2, { 2: on(true) }, 'Tap: cost 1.', { add: { budget: -1 } }),
        hold(1, { 1: on(false) }, 'Hold a pebble to erase it, from anywhere. It costs λ, here 2.', { add: { budget: -2 }, flash: 'erased' }),
        tap(3, { 3: on(true) }, 'Reach the flag…', { add: { budget: -1 } }),
        bad(2, 'Spot 1 is empty, so a tap cannot pick up spot 2…'),
        hold(2, { 2: on(false) }, '…but a hold can. Only the flag is left, within budget: solved.', { add: { budget: -2 }, flash: 'erased', win: true }),
      ],
    },
    prices: PRICES,
    daily: { ...PRICES, title: 'Bonus challenge', seenAs: 'prices' },
    challenge: { ...PRICES, title: 'Challenges', seenAs: 'prices' },
    pits: {
      title: 'Pits',
      board: () => line(2, { 1: { slots: 2 }, 2: { slots: 1 } }),
      hud: s => 'In hand ' + dots(3 - s.nodes.reduce((k, n) => k + (n.full ? n.slots : 0), 0), 3),
      steps: [
        say('Each pit has slots. You have 3 pebbles.'),
        bad(2, 'You can only tap a pit when the pit before it is full.'),
        tap(1, { 1: { full: true } }, 'A tap fills every slot of a pit at once. That is one move.'),
        tap(2, { 2: { full: true } }, 'Fill the flag pit…'),
        tap(1, { 1: { full: false } }, '…then empty every other pit. Fewest moves wins.', { win: true }),
      ],
    },
    spooky: {
      title: 'Spooky',
      board: () => line(3),
      hud: s => hand(3)(s) + '  ·  Ghosts ' + s.nodes.filter(n => n.ghost).length,
      steps: [
        tap(1, { 1: on(true) }, 'Tap to place a pebble, only when the spot before has one.'),
        tap(2, { 2: on(true) }, 'Place another.'),
        hold(1, { 1: { on: false, ghost: true } }, 'Hold a pebble to turn it into a ghost. That frees the pebble.'),
        tap(3, { 3: on(true) }, 'Reach the flag.'),
        bad(2, 'A ghost is not a pebble, so spot 2 cannot be picked up yet.'),
        tap(1, { 1: { ghost: false, on: true } }, 'Clear a ghost by tapping it to pebble it again…'),
        tap(2, { 2: on(false) }, '…then pick pebbles up as usual.'),
        tap(1, { 1: on(false) }, 'Only the flag is left: solved.', { win: true }),
      ],
    },
    dag: {
      title: 'DAGs',
      board: () => graph([
        { x: 80, y: 148, input: true }, { x: 170, y: 148, input: true }, { x: 260, y: 148, input: true },
        { x: 125, y: 94 }, { x: 215, y: 94 }, { x: 170, y: 40, goal: true },
      ], [[0, 3], [1, 3], [1, 4], [2, 4], [3, 5], [4, 5]], 180),
      hud: hand(3),
      steps: [
        say('The bottom row holds the inputs. They are always there.'),
        tap(3, { 3: on(true) }, 'Tap a node when every node feeding it has a pebble.'),
        bad(5, 'The flag needs both nodes below it.'),
        tap(4, { 4: on(true) }, 'Pebble the other one…'),
        tap(5, { 5: on(true) }, '…then the flag.'),
        tap(3, { 3: on(false) }, 'Then clear every other pebble, with the same rule.'),
        tap(4, { 4: on(false) }, 'Only the flag is left: solved.', { win: true }),
      ],
    },
    redblue: {
      title: 'Red-blue',
      board: () => graph([
        { x: 100, y: 140, blue: true }, { x: 240, y: 140, blue: true }, { x: 170, y: 50, goal: true },
      ], [[0, 2], [1, 2]], 175),
      vars: { io: 0 },
      hud: s => 'Red ' + dots(s.nodes.filter(n => n.red).length, 3) + '  ·  I/O ' + s.vars.io,
      steps: [
        say('Blue is slow memory and holds the inputs. Red is fast memory, and you only have a few.'),
        bad(2, 'A node needs red on every node feeding it.'),
        tap(0, { 0: { red: true } }, 'Tap a blue node to load it into red: 1 I/O.', { add: { io: 1 } }),
        tap(1, { 1: { red: true } }, 'Load the other one: 1 I/O.', { add: { io: 1 } }),
        tap(2, { 2: { red: true } }, 'With both feeders red, computing is free.'),
        tap(0, { 0: { red: false } }, 'Tap red to drop it. Also free.'),
        hold(2, { 2: { blue: true } }, 'Hold red to store it in blue: 1 I/O. Blue on the flag: solved.', { add: { io: 1 }, win: true }),
      ],
    },
    clocked: {
      title: 'Clocked',
      board: () => line(3, { h: 150, tick: true }),
      vars: { ticks: 0 },
      hud: s => hand(3)(s) + '  ·  Ticks ' + s.vars.ticks,
      steps: [
        tap(1, { 1: { queued: true } }, 'Tap spots to queue moves.'),
        bad(2, 'Spot 2 must wait: spot 1 only gets its pebble when the tick happens.'),
        tick({ 1: { queued: false, on: true } }, 'Press Tick: every queued move happens at once.', { add: { ticks: 1 } }),
        tap(2, { 2: { queued: true } }, 'Queue the next move…'),
        tick({ 2: { queued: false, on: true } }, '…and tick again.', { add: { ticks: 1 } }),
        tap(3, { 3: { queued: true } }, 'Moves that don’t wait on each other can share a tick.'),
        tick({ 3: { queued: false, on: true } }, 'Reach the flag, then clear the rest, in as few ticks as you can.', { add: { ticks: 1 } }),
      ],
    },
    today: {
      title: "Today's chips",
      board: () => graph([
        { x: 170, y: 168, input: true, slots: 1, blue: true }, { x: 105, y: 100, slots: 2, chips: [3, 4, 'io'] },
        { x: 235, y: 36, slots: 1, chips: [1, 2, 'io'], goal: true },
      ], [[0, 1], [1, 2], [0, 2]], 205),
      vars: { budget: 12 },
      hud: s => 'Fast memory ' + dots(4 - s.nodes.reduce((k, n) => k + (n.fast ? n.slots : 0), 0), 4) + '  ·  Budget ' + s.vars.budget,
      steps: [
        say('Red is fast memory: small. Blue is slow memory: big. The input starts in slow memory.'),
        tap(0, { 0: { fast: true, full: true } }, 'Tap the input to read it into fast memory. Moving data costs the blue price.', { add: { budget: -2 } }),
        tap(1, { 1: { fast: true, full: true } }, 'Tap a box to compute it once its inputs are in fast memory.', { add: { budget: -3 } }),
        tap(2, { 2: { fast: true, full: true } }, 'Compute the output…', { add: { budget: -1 } }),
        tap(1, { 1: { fast: false, full: false } }, 'Dropping a value is free.'),
        hold(2, { 2: { blue: true } }, '…and hold to write it to slow memory. Solved.', { add: { budget: -2 }, win: true }),
      ],
    },
    future: {
      title: 'Future chips',
      board: () => graph([
        { x: 95, y: 112, slots: 1, chips: [1, 3] }, { x: 245, y: 112, slots: 2, chips: [9, 6] },
        { x: 170, y: 40, slots: 2, chips: [1, 6], goal: true },
      ], [[0, 2], [1, 2]], 175),
      vars: { budget: 20 },
      hud: s => 'Free ' + dots(5 - s.nodes.reduce((k, n) => k + (n.full ? n.slots : 0), 0), 5) + '  ·  Budget ' + s.vars.budget,
      steps: [
        say('Each box is a value; its slots are its bits. The inputs are always there.'),
        tap(0, { 0: { full: true } }, 'Tap to compute a box. The outlined price is its circuit: gates × depth.', { add: { budget: -1 } }),
        tap(1, { 1: { full: true } }, 'A deep circuit, like a multiply, costs more.', { add: { budget: -9 } }),
        tap(2, { 2: { full: true } }, 'Compute the output…', { add: { budget: -1 } }),
        tap(0, { 0: { full: false } }, '…then clear the rest. Shallow circuit: tap again to uncompute, same price.', { add: { budget: -1 } }),
        hold(1, { 1: { full: false } }, 'Deep circuit: erasing its bits is cheaper. Hold to erase. Solved.', { add: { budget: -6 }, flash: 'erased', win: true }),
      ],
    },
  };

  // ---------- Drawing ----------
  const FLAG = (x, y) => '<g class="flag" transform="translate(' + (x - 7) + ' ' + (y - 12) + ')">' +
    '<path d="M2 1v22" stroke-width="2.6" stroke-linecap="round" fill="none"/>' +
    '<path d="M3.5 2h13l-3.5 4.5 3.5 4.5h-13z" stroke="none"/></g>';
  const GHOST = (x, y) => '<path class="spook" d="M' + (x - 8) + ' ' + (y + 8) + 'v-8a8 8 0 0 1 16 0v8' +
    'l-2.67 -2.5l-2.67 2.5l-2.67 -2.5l-2.67 2.5l-2.67 -2.5z"/>' +
    '<circle cx="' + (x - 3) + '" cy="' + (y - 1) + '" r="1.8" fill="#fff"/><circle cx="' + (x + 3) + '" cy="' + (y - 1) + '" r="1.8" fill="#fff"/>';
  const chip = (cls, cx, cy, v) => '<g class="chip ' + cls + '"><rect x="' + (cx - 11) + '" y="' + (cy - 9) + '" width="22" height="18" rx="5"/>' +
    '<text x="' + cx + '" y="' + (cy + 4.5) + '">' + v + '</text></g>';

  function drawNode(n, i, fx) {
    const cls = [];
    for (const k of ['fixed', 'input', 'goal', 'ghost', 'queued', 'blue', 'red', 'fast']) if (n[k]) cls.push(k);
    if (fx.bad === i) cls.push('bad');
    if (fx.erased === i) cls.push('erased');
    if (fx.pop && fx.pop.has(i)) cls.push('pop');
    const { x, y } = n;
    let s = '<g class="' + cls.join(' ') + '"><circle class="ring" cx="' + x + '" cy="' + y + '" r="' + R + '"/>';
    if (n.slots) {
      const gap = 11, sx = x - gap * (n.slots - 1) / 2;
      for (let j = 0; j < n.slots; j++) s += '<circle class="slot' + (n.full ? ' full' : '') + '" cx="' + (sx + gap * j) + '" cy="' + y + '" r="4.5"/>';
    } else if (n.goal && !n.on && !n.red && !n.ghost && !n.queued) s += FLAG(x, y);
    else if (n.label && !n.on && !n.ghost && !n.queued) s += '<text class="idx" x="' + x + '" y="' + (y + 5) + '">' + n.label + '</text>';
    if (n.on || n.red) s += '<circle class="dot" cx="' + x + '" cy="' + y + '" r="' + (R - 9) + '"/>';
    if (n.queued && !n.on) s += '<circle class="qdot" cx="' + x + '" cy="' + y + '" r="' + (R - 9) + '"/>';
    if (n.ghost) s += GHOST(x, y);
    if (n.chips) s += chip('', x - 13, y + R + 15, n.chips[0]) + chip(n.chips[2] || 'e', x + 13, y + R + 15, n.chips[1]);
    if (fx.hold === i) s += '<circle class="holdring" cx="' + x + '" cy="' + y + '" r="' + (R + 1) + '" pathLength="100" transform="rotate(-90 ' + x + ' ' + y + ')"/>';
    return s + '</g>';
  }

  function render(b, fx) {
    let s = '';
    if (b.line) { const a = b.nodes[0], z = b.nodes[b.nodes.length - 1]; s += '<path class="track" d="M' + a.x + ' ' + a.y + 'H' + z.x + '"/>'; }
    else b.edges.forEach(([i, j]) => { const p = b.nodes[i], q = b.nodes[j]; s += '<line class="edge" x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '"/>'; });
    b.nodes.forEach((n, i) => { s += drawNode(n, i, fx); });
    if (b.tick) s += '<g class="tickbtn"><rect x="128" y="' + (b.h - 40) + '" width="84" height="30" rx="8"/><text x="170" y="' + (b.h - 20) + '">Tick</text></g>';
    return '<svg class="pi-svg" viewBox="0 0 ' + W + ' ' + b.h + '" aria-hidden="true">' + s + '</svg>';
  }

  // ---------- Player ----------
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seenAll = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch (e) { return {}; } };
  const seen = sc => !!seenAll()[sc.seenAs || GAME];
  function markSeen(sc) { const d = seenAll(); d[sc.seenAs || GAME] = 1; try { localStorage.setItem(SEEN_KEY, JSON.stringify(d)); } catch (e) {} }

  let back = null, timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const stopTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function close() {
    stopTimers();
    if (back) { back.remove(); back = null; document.removeEventListener('keydown', onKey); }
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open() {
    const sc = SCENES[GAME];
    if (!sc) return;
    close();
    back = document.createElement('div');
    back.className = 'pi-back';
    back.innerHTML =
      '<div class="pi-card" role="dialog" aria-modal="true" aria-labelledby="piTitle">' +
      '<span class="pi-kicker">How to play</span><h2 class="pi-title" id="piTitle">' + sc.title + '</h2>' +
      '<div class="pi-stage"><div class="pi-board"></div><div class="pi-finger"></div></div>' +
      '<div class="pi-hud"></div><p class="pi-say" aria-live="polite"></p>' +
      '<div class="pi-dots">' + sc.steps.map(() => '<i></i>').join('') + '</div>' +
      '<div class="pi-actions"><button type="button" class="again">Replay</button><button type="button" class="go">Play</button></div></div>';
    document.body.appendChild(back);
    const q = sel => back.querySelector(sel);
    const stage = q('.pi-stage'), boardEl = q('.pi-board'), finger = q('.pi-finger'), hud = q('.pi-hud'), sayEl = q('.pi-say');
    const dotEls = [...back.querySelectorAll('.pi-dots i')];
    let board, vars;

    const draw = fx => { boardEl.innerHTML = render(board, fx || {}); hud.textContent = sc.hud ? sc.hud({ nodes: board.nodes, vars }) : ''; };
    const target = at => at === 'tick' ? { x: 170, y: board.h - 25 } : board.nodes[at];
    function moveFinger(at) {
      const p = target(at);
      finger.style.left = (p.x / W * 100) + '%';
      finger.style.top = (p.y / board.h * 100) + '%';
      finger.classList.add('show');
    }
    function apply(st) {
      const pop = new Set();
      for (const [i, p] of Object.entries(st.set || {})) {
        const n = board.nodes[i];
        if ((p.on && !n.on) || (p.red && !n.red) || (p.ghost && !n.ghost)) pop.add(Number(i));
        Object.assign(n, p);
      }
      for (const [k, d] of Object.entries(st.add || {})) vars[k] += d;
      draw({ pop, erased: st.flash === 'erased' ? st.at : undefined });
      if (st.flash === 'erased') later(() => draw(), 450);
      if (st.win) stage.classList.add('win');
    }
    function step(k) {
      dotEls.forEach((d, j) => d.classList.toggle('on', j <= k));
      if (k >= sc.steps.length) { finger.classList.remove('show'); return; }
      const st = sc.steps[k];
      sayEl.textContent = st.text;
      if (st.at == null) {
        finger.classList.remove('show');
        later(() => step(k + 1), st.ms || 2600);
        return;
      }
      moveFinger(st.at);
      later(() => {
        if (st.act === 'hold') {
          finger.classList.add('press');
          draw({ hold: st.at });
          later(() => { finger.classList.remove('press'); apply(st); }, 650);
        } else {
          finger.classList.add('press', 'ripple');
          later(() => finger.classList.remove('press'), 160);
          later(() => finger.classList.remove('ripple'), 520);
          if (st.act === 'bad') { draw({ bad: st.at }); later(() => draw(), 480); } else apply(st);
        }
      }, calm ? 150 : 480);
      later(() => step(k + 1), st.ms || (st.act === 'hold' ? 3000 : 2600));
    }
    function start() {
      stopTimers();
      board = sc.board();
      vars = { ...(sc.vars || {}) };
      stage.classList.remove('win');
      finger.classList.remove('show', 'press', 'ripple');
      finger.style.left = '50%'; finger.style.top = '100%';
      draw();
      later(() => step(0), 250);
    }

    back.addEventListener('click', e => { if (e.target === back) close(); });
    q('.go').addEventListener('click', close);
    q('.again').addEventListener('click', start);
    document.addEventListener('keydown', onKey);
    markSeen(sc);
    start();
    q('.go').focus({ preventScroll: true });
  }

  // ---------- Rules dropdown ----------
  function wrapRules() {
    const el = document.getElementById('info') || document.getElementById('rules');
    if (!el || el.closest('.rules-drop')) return;
    const det = document.createElement('details');
    det.className = 'rules-drop';
    det.innerHTML = '<summary><span>Rules</span>' + (SCENES[GAME] ? '<button type="button" class="how">▶ How to play</button>' : '') + '</summary>';
    el.parentNode.insertBefore(det, el);
    det.appendChild(el);
    const how = det.querySelector('.how');
    if (how) how.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); open(); });
  }

  wrapRules();
  if (SCENES[GAME] && !seen(SCENES[GAME])) setTimeout(open, 400);
  window.PebbleIntro = { open, close };
})();
