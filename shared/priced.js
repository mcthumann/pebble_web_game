// The Prices game, shared by the Daily and Challenge pages.
// Spot i costs C[i] to place or remove with a tap (the spot before it must hold
// a pebble) and E[i] to erase with a hold from anywhere. At most P pebbles are
// on the line. Won when the flag is the only pebble left on the line; lost when
// no move fits in what is left of the budget. Puzzles come from puzzles.js,
// where every budget is the exact optimum.
window.PricedGame = (() => {
  const HOLD_MS = 450, PER_ROW = 5;
  const X0 = 40, SPAN = 225, Y0 = 40, DY = 84;
  const SVG = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clock(ms) {
    const t = Math.round(ms / 100), m = Math.floor(t / 600), sec = ((t % 600) / 10).toFixed(1);
    return m ? m + ':' + sec.padStart(4, '0') : sec + ' s';
  }

  let lastBuzz = 0;
  function buzz(pattern) {
    const now = performance.now();
    if (now - lastBuzz < 120) return;
    lastBuzz = now;
    try { if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate(pattern || 30); } catch (e) {}
  }

  // A short, light confetti burst for a solve.
  function confetti() {
    if (calm) return;
    const c = document.createElement('canvas'), ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const W = innerWidth, H = innerHeight;
    c.className = 'confetti'; c.width = W * dpr; c.height = H * dpr;
    document.body.appendChild(c); ctx.scale(dpr, dpr);
    const colors = ['#FFFFFF', '#F5C542', '#FFE8A3', '#BFF0DD'];
    const bits = Array.from({ length: 70 }, () => ({
      x: W / 2 + (Math.random() - .5) * 140, y: H * .26,
      vx: (Math.random() - .5) * 9, vy: -3 - Math.random() * 8,
      a: Math.random() * 6.3, va: (Math.random() - .5) * .3,
      w: 5 + Math.random() * 4, h: 8 + Math.random() * 6,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    (function frame(t) {
      const age = (t - t0) / 1600;
      ctx.clearRect(0, 0, W, H);
      if (age >= 1) { c.remove(); return; }
      ctx.globalAlpha = Math.min(1, (1 - age) * 2.5);
      for (const b of bits) {
        b.vy += .28; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.a += b.va;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
        ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      }
      requestAnimationFrame(frame);
    })(t0);
  }

  // Phones get the share sheet; elsewhere the line is copied.
  async function share(text, btn) {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {}
      t.remove();
      btn.textContent = ok ? 'Copied' : 'Copy failed';
    }
    setTimeout(() => { btn.textContent = 'Share'; }, 1600);
  }

  // onEnd({ won, cost, opt, tapCost, eraseCost, ms, time, flagged, stray }) runs
  // once per game, just before the finish screen is drawn.
  function create(onEnd) {
    const board = $('board'), hand = $('hand');
    let P, N, C, E, BUDGET, DX, R, nodes = [];
    let pebbled, moves, erasures, tapCost, eraseCost, done, lost, startedAt, solveMs, reach = 0;
    let holdTimer = null, holdNode = null, suppressClick = false;

    // Spots 0..N snake along one line, five to a row. Spot 0 is always pebbled.
    function build() {
      const rows = Math.ceil((N + 1) / PER_ROW);
      const xOf = i => { const r = Math.floor(i / PER_ROW), k = i % PER_ROW; return X0 + DX * (r % 2 ? PER_ROW - 1 - k : k); };
      let d = 'M' + X0 + ' ' + Y0;
      for (let r = 0; r < rows; r++) {
        d += 'H' + xOf(Math.min(N, PER_ROW * r + PER_ROW - 1));
        if (r < rows - 1) d += 'A' + DY / 2 + ' ' + DY / 2 + ' 0 0 ' + (r % 2 ? 0 : 1) + ' ' +
                               xOf(PER_ROW * (r + 1)) + ' ' + (Y0 + DY * (r + 1));
      }
      board.setAttribute('viewBox', '-18 6 340 ' + rows * DY);
      board.innerHTML = '<path id="track" d="' + d + '"/>';
      nodes = [];
      for (let i = 0; i <= N; i++) {
        const x = xOf(i), y = Y0 + DY * Math.floor(i / PER_ROW);
        const g = document.createElementNS(SVG, 'g');
        g.setAttribute('class', i === 0 ? 'node fixed' : i === N ? 'node goal' : 'node');
        g.setAttribute('role', 'button');
        g.setAttribute('aria-label', 'Spot ' + i + (i ? ', tap ' + C[i] + ', erase ' + E[i] : ''));
        g.innerHTML =
          '<rect class="hit" x="' + (x - DX / 2) + '" y="' + (y - 30) + '" width="' + DX + '" height="76"/>' +
          '<circle class="ring" cx="' + x + '" cy="' + y + '" r="' + R + '"/>' +
          (i === N
            ? '<g class="flag" transform="translate(' + (x - 7) + ' ' + (y - 12) + ')">' +
              '<path d="M2 1v22" stroke="#1F2329" stroke-width="2.6" stroke-linecap="round" fill="none"/>' +
              '<path d="M3.5 2h13l-3.5 4.5 3.5 4.5h-13z" fill="#1F2329"/></g>'
            : '<text class="idx" x="' + x + '" y="' + (y + 5) + '">' + i + '</text>') +
          '<circle class="dot" cx="' + x + '" cy="' + y + '" r="' + (R - 9) + '"/>' +
          '<circle class="hold" cx="' + x + '" cy="' + y + '" r="' + R + '" pathLength="100" transform="rotate(-90 ' + x + ' ' + y + ')"/>' +
          (i === 0 ? '' : chip('pc', x - 13, y + R + 14, C[i]) + chip('pe', x + 13, y + R + 14, E[i]));
        g.addEventListener('pointerdown', () => press(i));
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) g.addEventListener(ev, release);
        g.addEventListener('click', () => { if (suppressClick) { suppressClick = false; return; } tap(i); });
        board.appendChild(g);
        nodes.push(g);
      }
    }

    function chip(cls, cx, cy, v) {
      return '<g class="' + cls + '"><rect x="' + (cx - 11) + '" y="' + (cy - 9) + '" width="22" height="18" rx="5"/>' +
        '<text x="' + cx + '" y="' + (cy + 4.5) + '">' + v + '</text></g>';
    }

    // Tell the music what just happened (shared/beats.js listens; nothing else needs it).
    function emit(type, spot) {
      document.dispatchEvent(new CustomEvent('pebble:sound', { detail: { type, spot, n: N, progress: reach / N } }));
    }

    const inHand = () => P - pebbled.slice(1).filter(Boolean).length;
    const cost = () => tapCost + eraseCost;
    const left = () => BUDGET - cost();
    const stray = () => pebbled.slice(1, N).filter(Boolean).length;
    // True when no legal move fits in what is left of the budget.
    function stuck() {
      const rest = left();
      for (let i = 1; i <= N; i++) {
        if (pebbled[i - 1] && (pebbled[i] || inHand() > 0) && C[i] <= rest) return false;
        if (pebbled[i] && E[i] <= rest) return false;
      }
      return true;
    }

    function flash(el, cls) {
      if (cls === 'bad') buzz();
      el.classList.add(cls);
      clearTimeout(el[cls + 'Timer']);
      el[cls + 'Timer'] = setTimeout(() => el.classList.remove(cls), 450);
    }
    function tooDear(i) { emit('bad', i); flash(nodes[i], 'bad'); flash($('budget'), 'bad'); }
    function act() { if (moves + erasures === 0) startedAt = performance.now(); }

    function settle(spent) {
      const d = $('delta');
      d.textContent = '−' + spent;
      d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
      if (pebbled[N] && stray() === 0) done = true;
      else if (stuck()) done = lost = true;
      if (!done) return;
      solveMs = performance.now() - startedAt;
      emit(lost ? 'lose' : 'win', N);
      onEnd({ won: !lost, cost: cost(), opt: BUDGET, tapCost, eraseCost, ms: solveMs,
              time: clock(solveMs), flagged: pebbled[N], stray: stray() });
    }

    // Tap: the reversible move.
    function tap(i) {
      if (done) return;
      const placing = !pebbled[i];
      if (i === 0 || !pebbled[i - 1]) { emit('bad', i); flash(nodes[i], 'bad'); return; }
      if (placing && inHand() === 0) { emit('bad', i); flash(nodes[i], 'bad'); flash(hand, 'bad'); return; }
      if (C[i] > left()) { tooDear(i); return; }
      act();
      pebbled[i] = placing;
      moves++;
      tapCost += C[i];
      if (placing) reach = Math.max(reach, i);
      emit(placing ? 'place' : 'remove', i);
      if (placing && i === N && stray() > 0) emit('flag', i);
      settle(C[i]);
      render();
    }

    // Hold: erase a pebble from anywhere, at the spot's erase price.
    function press(i) {
      suppressClick = false;
      release();
      if (done || i === 0 || !pebbled[i]) return;
      holdNode = nodes[i];
      holdNode.classList.add('holding');
      holdTimer = setTimeout(() => {
        endHold();
        suppressClick = true;
        if (E[i] > left()) { tooDear(i); return; }
        act();
        pebbled[i] = false;
        erasures++;
        eraseCost += E[i];
        flash(nodes[i], 'erased');
        emit('erase', i);
        settle(E[i]);
        render();
      }, HOLD_MS);
    }
    function release() { clearTimeout(holdTimer); endHold(); }
    function endHold() { if (holdNode) holdNode.classList.remove('holding'); holdNode = null; }

    function render() {
      const flagged = pebbled[N], extra = stray();
      for (let i = 0; i <= N; i++) {
        nodes[i].classList.toggle('on', pebbled[i]);
        nodes[i].classList.toggle('tidy', flagged && i > 0 && i < N && pebbled[i]);
      }
      const held = inHand(), rest = left();
      let dots = '';
      for (let k = 0; k < P; k++) dots += '<i class="' + (k < held ? '' : 'used') + '"></i>';
      hand.innerHTML = dots + '<span>' + held + ' in hand</span>';

      $('left').textContent = rest;
      $('of').textContent = 'of ' + BUDGET;
      $('budget').classList.toggle('low', rest <= Math.max(3, Math.round(BUDGET / 5)));
      $('fill').style.width = (100 * rest / BUDGET) + '%';

      $('g1').className = flagged ? 'ok' : 'now';
      $('g2').className = flagged ? 'urgent' : '';
      $('g2').textContent = flagged ? 'Now clear ' + extra + ' more' : 'Then clear the rest';

      document.body.classList.toggle('done', done);
      document.body.classList.toggle('won', done && !lost);
      document.body.classList.toggle('lost', lost);
    }

    function reset() {
      release();
      pebbled = new Array(N + 1).fill(false);
      pebbled[0] = true;
      moves = erasures = tapCost = eraseCost = 0;
      done = lost = false;
      reach = 0;
      $('delta').classList.remove('show');
      render();
      emit('start', 0);
    }

    function load(q) {
      P = q.p;
      C = [0, ...q.c];
      E = [0, ...q.e];
      N = q.c.length;
      BUDGET = q.opt;
      DX = SPAN / (PER_ROW - 1);
      R = Math.min(23, DX / 2 - 6);
      build();
      reset();
    }

    // A press that starts on the board never counts as a tap on anything else.
    // Finishing with a hold redraws the page while the finger is still down, and
    // phones then deliver the release to whatever button moved under it.
    let pressOnBoard = false;
    document.addEventListener('pointerdown', e => { pressOnBoard = board.contains(e.target); }, true);
    document.addEventListener('click', e => {
      if (pressOnBoard && e.detail !== 0 && !board.contains(e.target)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    $('reset').addEventListener('click', reset);
    board.addEventListener('contextmenu', e => e.preventDefault());

    return { load, reset };
  }

  return { create, clock, buzz, confetti, share };
})();
