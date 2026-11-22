// Focus sound: a relaxed lo-fi chiptune soundtrack with a binaural beat under
// it, synthesised in the browser (there are no audio files).
//
// The music is a four-chord loop: soft electric-piano chords, a round bass,
// swung lo-fi drums that make the chords breathe, a chiptune arpeggio with
// echo, vinyl crackle, and a short lead melody. The melody is made up fresh
// every 32 bars and repeated within them, so it sticks. Under everything, two
// quiet sine tones a few hertz apart, one per ear, give the binaural beat
// (10 Hz for Focus, 6 Hz for Calm) through headphones.
//
// It follows play. Game pages send 'pebble:sound' events (see priced.js): a
// new puzzle starts sparse, drums come in with the first moves, the arpeggio
// once the pebbles are well up the line, and the lead brightens when the flag
// is reached. Moves, erasures, mistakes and solves get their own notes, all in
// the same key as the music. Pages that send no events get the full mix.
//
// Browsers only start sound inside a tap, so a mood chosen on one page starts
// on the first tap of the next page. The choice is remembered on this device.
window.PebbleBeats = (() => {
  const KEY = 'pebble-beats';
  const PENTA = [0, 2, 4, 7, 9];                                   // C major pentatonic
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);                // MIDI note to hertz
  const deg = d => 72 + 12 * Math.floor(d / 5) + PENTA[((d % 5) + 5) % 5];  // degree 0 = C5

  // Chords are [bass, voicing...] in MIDI. keys: [step, length in steps, velocity].
  const MOODS = {
    focus: {
      label: 'Focus', beat: 10, carrier: 220, bpm: 88, swing: 0.57, drums: 1, arp: 1, space: 0.22,
      chords: [[41, 53, 57, 60, 64], [40, 52, 55, 59, 62], [38, 50, 53, 57, 60], [36, 48, 52, 55, 59]], // Fmaj7 Em7 Dm7 Cmaj7
      keys: [[0, 5, 1], [6, 3, 0.7], [10, 6, 0.85]],
    },
    calm: {
      label: 'Calm', beat: 6, carrier: 196, bpm: 70, swing: 0.6, drums: 0.6, arp: 0.7, space: 0.35,
      chords: [[45, 55, 57, 60, 64], [41, 53, 57, 60, 64], [36, 48, 52, 55, 59], [43, 55, 59, 62, 64]], // Am7 Fmaj7 Cmaj7 G6
      keys: [[0, 8, 1], [8, 8, 0.8]],
    },
  };

  // How loud each layer is at each level of play (0 sparse ... 3 flag reached).
  const LEVELS = [
    { keys: 0.9, bass: 0.9, mel: 0.85, hat: 0.5, kick: 0, snare: 0, arp: 0, crackle: 1 },
    { keys: 0.85, bass: 1, mel: 0.9, hat: 0.8, kick: 1, snare: 0.9, arp: 0, crackle: 1 },
    { keys: 0.8, bass: 1, mel: 0.95, hat: 0.9, kick: 1, snare: 1, arp: 1, crackle: 0.8 },
    { keys: 0.8, bass: 1, mel: 1, hat: 1, kick: 1, snare: 1, arp: 1, crackle: 0.7 },
  ];
  const ARP = [0, 1, 2, 3, 2, 1, 2, 3];
  const RHYTHMS = [[0, 3, 6, 8, 12], [0, 2, 4, 7, 10], [0, 6, 8, 10, 14], [2, 4, 6, 10, 12], [0, 4, 7, 10], [0, 3, 6, 10, 12, 14]];

  function seeded(seed) {
    return () => {
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function buffers(c) {
    const sr = c.sampleRate;
    const noise = c.createBuffer(1, sr, sr), nd = noise.getChannelData(0);
    for (let i = 0; i < sr; i++) nd[i] = Math.random() * 2 - 1;
    const crackle = c.createBuffer(2, sr * 4, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = crackle.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * 0.004;
        if (Math.random() < 0.00025) d[i] += (Math.random() * 2 - 1) * 0.5;
      }
    }
    const room = c.createBuffer(2, Math.floor(sr * 2.4), sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = room.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < d.length; i++) { lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = lp * Math.pow(1 - i / d.length, 3); }
    }
    return { noise, crackle, room };
  }

  // One running soundtrack on context c, playing into out.
  function createTrack(c, out, cfg, seed) {
    const rand = seeded(seed || 1), buf = buffers(c), live = new Set();
    const spb = 60 / cfg.bpm, step = spb / 4, swingOff = (cfg.swing - 0.5) * spb;
    const t0 = c.currentTime + 0.12;

    // Mix: music (ducked under the kick) and drums through a warm low-pass and a
    // gentle compressor; echo and room sends; effects and the binaural pair beside.
    const master = c.createGain();
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(0.6, t0 + 2);
    // A last-stage limiter keeps stacked effects and music from clipping.
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
    master.connect(limiter); limiter.connect(out);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.008; comp.release.value = 0.25;
    comp.connect(master);
    const warm = c.createBiquadFilter();
    warm.type = 'lowpass'; warm.frequency.value = 7000;
    warm.connect(comp);
    const duck = c.createGain(); duck.connect(warm);
    const drums = c.createGain(); drums.gain.value = cfg.drums; drums.connect(warm);
    const fx = c.createGain(); fx.gain.value = 3.6; fx.connect(master);   // effects skip the compressor so they cut through

    const echoIn = c.createGain(), echo = c.createDelay(2), fb = c.createGain(), echoTone = c.createBiquadFilter(), echoOut = c.createGain();
    echo.delayTime.value = spb * 0.75; fb.gain.value = 0.32;
    echoTone.type = 'lowpass'; echoTone.frequency.value = 2600; echoOut.gain.value = 0.35;
    echoIn.connect(echo); echo.connect(echoTone); echoTone.connect(fb); fb.connect(echo); echoTone.connect(echoOut); echoOut.connect(warm);
    const roomIn = c.createGain(), room = c.createConvolver(), roomOut = c.createGain();
    room.buffer = buf.room; roomOut.gain.value = cfg.space;
    roomIn.connect(room); room.connect(roomOut); roomOut.connect(warm);

    const layer = bus => { const g = c.createGain(); g.gain.value = 0; g.connect(bus); return g; };
    const L = { keys: layer(duck), bass: layer(duck), mel: layer(duck), arp: layer(duck),
                kick: layer(drums), snare: layer(drums), hat: layer(drums), crackle: layer(warm) };
    const send = (from, to, amount) => { const g = c.createGain(); g.gain.value = amount; from.connect(g); g.connect(to); };
    send(L.arp, echoIn, 0.5); send(L.mel, echoIn, 0.35); send(L.mel, roomIn, 0.5); send(L.keys, roomIn, 0.6); send(fx, echoIn, 0.1); send(fx, roomIn, 0.35);

    // Slow tape wobble on the keys and lead.
    const wob = c.createOscillator(), wobDepth = c.createGain();
    wob.frequency.value = 0.35; wobDepth.gain.value = 7;
    wob.connect(wobDepth); wob.start(t0); live.add(wob);

    function start(src, t, stop, offset, wobble) {
      if (wobble) wobDepth.connect(src.detune);
      src.onended = () => { live.delete(src); if (wobble) { try { wobDepth.disconnect(src.detune); } catch (e) {} } };
      src.start(t, offset || 0); src.stop(stop); live.add(src);
    }

    // The binaural pair: one quiet pure tone per ear, `beat` hertz apart.
    const bin = c.createGain(), merger = c.createChannelMerger(2);
    bin.gain.setValueAtTime(0, t0); bin.gain.linearRampToValueAtTime(0.05, t0 + 3);
    merger.connect(bin); bin.connect(master);
    [[-1, 0], [1, 1]].forEach(([sign, ch]) => {
      const o = c.createOscillator();
      o.frequency.value = cfg.carrier + sign * cfg.beat / 2;
      o.connect(merger, 0, ch); o.start(t0); live.add(o);
    });

    // Vinyl crackle, looping.
    const crackle = c.createBufferSource(), cf = c.createBiquadFilter(), cg = c.createGain();
    crackle.buffer = buf.crackle; crackle.loop = true;
    cf.type = 'lowpass'; cf.frequency.value = 3500; cg.gain.value = 0.15;
    crackle.connect(cf); cf.connect(cg); cg.connect(L.crackle); crackle.start(t0); live.add(crackle);

    // ---------- Instruments ----------
    function keys(t, midi, len, vel) {
      const f = hz(midi), g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.075 * vel, t + 0.012);
      g.gain.setTargetAtTime(0.033 * vel, t + 0.012, 0.35);
      g.gain.setTargetAtTime(0, t + len, 0.12);
      g.connect(L.keys);
      [[1, 1], [2, 0.22], [3, 0.06]].forEach(([mult, amp]) => {
        const o = c.createOscillator(), a = c.createGain();
        o.frequency.value = f * mult; a.gain.value = amp;
        o.connect(a); a.connect(g); start(o, t, t + len + 0.8, 0, true);
      });
    }

    function bassNote(t, midi, len) {
      const o = c.createOscillator(), o2 = c.createOscillator(), m = c.createGain(), lp = c.createBiquadFilter(), g = c.createGain();
      o.frequency.value = o2.frequency.value = hz(midi); o2.type = 'triangle'; m.gain.value = 0.35;
      lp.type = 'lowpass'; lp.frequency.value = 420;
      o.connect(lp); o2.connect(m); m.connect(lp); lp.connect(g); g.connect(L.bass);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.165, t + 0.02);
      g.gain.setTargetAtTime(0.11, t + 0.02, 0.2); g.gain.setTargetAtTime(0, t + len, 0.06);
      start(o, t, t + len + 0.4); start(o2, t, t + len + 0.4);
    }

    function blip(t, midi, len, gain, bus) {
      const o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
      o.type = 'square'; o.frequency.value = hz(midi);
      lp.type = 'lowpass'; lp.frequency.value = 2200;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.005); g.gain.setTargetAtTime(0, t + 0.01, len / 3);
      o.connect(lp); lp.connect(g); g.connect(bus); start(o, t, t + len + 0.3);
    }

    function lead(t, midi, len, bright) {
      const lp = c.createBiquadFilter(), g = c.createGain();
      lp.type = 'lowpass'; lp.frequency.value = bright ? 3400 : 1900; lp.Q.value = 0.8;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + 0.015);
      g.gain.setTargetAtTime(0.09, t + 0.015, 0.15); g.gain.setTargetAtTime(0, t + len, 0.07);
      lp.connect(g); g.connect(L.mel);
      const parts = [['triangle', 0, 1], ['square', 4, 0.2]];
      if (bright) parts.push(['sine', 1200, 0.35]);
      parts.forEach(([type, cents, amp]) => {
        const o = c.createOscillator(), a = c.createGain();
        o.type = type; o.frequency.value = hz(midi); o.detune.value = cents; a.gain.value = amp;
        o.connect(a); a.connect(lp); start(o, t, t + len + 0.5, 0, true);
      });
    }

    function kick(t) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.85, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      o.connect(g); g.connect(L.kick); start(o, t, t + 0.35);
      // The music dips under each kick and swells back.
      duck.gain.setTargetAtTime(0.55, t, 0.01); duck.gain.setTargetAtTime(1, t + 0.07, 0.12);
    }

    function snare(t, v) {
      const n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
      n.buffer = buf.noise; bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45 * v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      n.connect(bp); bp.connect(g); g.connect(L.snare); start(n, t, t + 0.22, rand() * 0.7);
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.value = 185;
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.22 * v, t + 0.003); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(og); og.connect(L.snare); start(o, t, t + 0.12);
    }

    function hat(t, v, open) {
      const n = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain(), len = open ? 0.22 : 0.04;
      n.buffer = buf.noise; hp.type = 'highpass'; hp.frequency.value = 7200;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1 * v, t + 0.002); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      n.connect(hp); hp.connect(g); g.connect(L.hat); start(n, t, t + len + 0.02, rand() * 0.7);
    }

    // ---------- Melody: a two-bar motif, repeated, varied and answered ----------
    let motif = null, variant = null;
    function makeMotif() {
      let d = 2 + Math.floor(rand() * 4);
      const bars = [0, 1].map(() => {
        const r = RHYTHMS[Math.floor(rand() * RHYTHMS.length)];
        return r.map((pos, k) => {
          d = Math.max(0, Math.min(9, d + [-2, -1, -1, 0, 1, 1, 2][Math.floor(rand() * 7)]));
          return { pos, d, len: Math.min(4, (k + 1 < r.length ? r[k + 1] : 16) - pos) };
        });
      });
      const last = bars[1][bars[1].length - 1];
      last.len = 16 - last.pos;
      return bars;
    }
    function vary(bar) {
      return bar.map((n, k) => k < bar.length - 2 ? n : { ...n, d: Math.max(0, Math.min(9, n.d + (rand() < 0.5 ? -1 : 1))) });
    }
    // Strong beats land on a note of the chord underneath.
    function fit(d, chord, strong) {
      if (!strong) return d;
      const pcs = chord.slice(1).map(m => m % 12);
      for (const off of [0, -1, 1, -2, 2]) if (pcs.includes(deg(d + off) % 12)) return d + off;
      return d;
    }
    // 32-bar cycle: melody, rest, melody, rest (8 bars each); a new motif each cycle.
    function phrase(bar) {
      const inCycle = bar % 32;
      if (Math.floor(inCycle / 8) % 2 === 1) return null;
      const p = inCycle % 8;
      if (p === 7) return [{ pos: 0, d: null, len: 12 }];
      const src = p % 2 === 0 ? motif[0] : p === 3 ? variant : motif[1];
      const shift = p === 4 || p === 5 ? 1 : 0;
      return src.map(n => ({ pos: n.pos, d: n.d + shift, len: n.len }));
    }

    // ---------- Sequencer ----------
    let level = 2, bright = false, s = 0, timer = null;
    const on = k => LEVELS[level][k] > 0;
    function playStep(i, time) {
      const bar = Math.floor(i / 16), pos = i % 16;
      const t = time + (pos % 4 === 2 ? swingOff : 0);
      const chord = cfg.chords[bar % cfg.chords.length];
      if (pos === 0 && (bar % 32 === 0 || !motif)) { motif = makeMotif(); variant = vary(motif[1]); }

      const hit = cfg.keys.find(h => h[0] === pos);
      if (hit) chord.slice(1).forEach((m, k) => keys(t + k * 0.008, m, hit[1] * step, hit[2]));

      if (pos === 0) bassNote(t, chord[0], 6 * step);
      if (pos === 8) bassNote(t, chord[0] + (bar % 2 ? 7 : 0), 5 * step);
      if (pos === 14 && bar % 2) bassNote(t, chord[0] + 12, 1.6 * step);

      if (on('arp') && pos % 2 === 0) blip(t, chord[1 + ARP[pos / 2]] + 12, 1.8 * step, 0.07 * cfg.arp, L.arp);

      const notes = phrase(bar);
      if (notes) for (const n of notes) if (n.pos === pos) {
        const d = n.d == null ? fit(5, chord, true) : fit(n.d, chord, pos % 4 === 0);
        lead(t, deg(d), n.len * step * 0.92, bright);
      }

      if (on('kick') && (pos === 0 || pos === 10 || (cfg.drums >= 1 && pos === 7 && bar % 4 === 3))) kick(t);
      if (on('snare') && (pos === 4 || pos === 12)) snare(t, cfg.drums >= 1 ? 1 : 0.7);
      if (on('hat') && pos % 2 === 0) hat(t, (pos % 4 === 0 ? 0.85 : 0.55) * (0.9 + rand() * 0.2), pos === 14 && bar % 2 === 1);
    }
    function scheduleUntil(limit) {
      while (t0 + s * step < limit) { playStep(s, t0 + s * step); s++; }
    }
    function nextBeat() { return t0 + Math.max(0, Math.ceil((c.currentTime - t0) / spb)) * spb; }

    function setLevel(n, when) {
      n = Math.max(0, Math.min(3, n));
      const t = when == null ? nextBeat() : when;
      level = n; bright = n >= 3;
      for (const k in L) { L[k].gain.cancelScheduledValues(t); L[k].gain.setTargetAtTime(LEVELS[n][k] || 0, t, 0.35); }
    }

    // ---------- Sound effects: one soft sound per kind of move ----------
    // Every move of the same kind sounds the same, wherever it happens. The
    // notes are G, A, D and E, which sit well over every chord in both moods.
    const FX = 0.085;                                // base level of the effects
    const soon = () => c.currentTime + 0.01;
    // A soft mallet: a sine with faint upper partials, gentle attack, warm decay.
    function bell(t, midi, len, gain) {
      const g = c.createGain(), lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2400;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008);
      g.gain.setTargetAtTime(0, t + 0.008, len / 4);
      lp.connect(g); g.connect(fx);
      [[1, 1], [2, 0.12], [4, 0.05]].forEach(([mult, amp]) => {
        const o = c.createOscillator(), a = c.createGain();
        o.frequency.value = hz(midi) * mult; a.gain.value = amp;
        o.connect(a); a.connect(lp); start(o, t, t + len + 0.1);
      });
      dip(t);
    }
    // A soft breath of low noise, for erasing.
    function breath(t, len, gain) {
      const n = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain();
      n.buffer = buf.noise; lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.5;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.06); g.gain.setTargetAtTime(0, t + 0.06, len / 4);
      n.connect(lp); lp.connect(g); g.connect(fx); start(n, t, t + len + 0.1, 0.25);
    }
    // The music steps back slightly under each effect.
    function dip(t) { duck.gain.setTargetAtTime(0.85, t, 0.02); duck.gain.setTargetAtTime(1, t + 0.12, 0.2); }
    const sfx = {
      place() { bell(soon(), 79, 0.45, FX); },                                   // G5
      remove() { bell(soon(), 76, 0.4, FX * 0.8); },                             // E5: the same, a step down
      erase() { const t = soon(); breath(t, 0.5, FX * 1.4); bell(t + 0.03, 67, 0.6, FX * 0.75); },  // G4 under a breath
      bad() { bell(soon(), 57, 0.18, FX * 0.8); },                               // A3, short and muted
      flag() { const t = soon(); bell(t, 79, 0.6, FX * 0.75); bell(t + 0.12, 86, 0.9, FX * 0.75); },             // G5 then D6
      win() {
        const t = soon();
        [76, 79, 81, 86, 88].forEach((m, k) => bell(t + k * 0.1, m, 1.2, FX * 0.7));            // E5 G5 A5 D6 E6
        [79, 86, 88].forEach(m => bell(t + 0.6, m, 2.2, FX * 0.4));
      },
      lose() { const t = soon(); [76, 74, 67].forEach((m, k) => bell(t + k * 0.22, m, k === 2 ? 1 : 0.5, FX * 0.8)); },  // E5 D5 G4
    };
    // A short filter dip when a puzzle is lost.
    function sag() {
      const t = c.currentTime;
      warm.frequency.cancelScheduledValues(t);
      warm.frequency.setTargetAtTime(700, t, 0.15);
      warm.frequency.setTargetAtTime(7000, t + 1.6, 0.5);
    }

    function run() {
      scheduleUntil(c.currentTime + 0.25);
      timer = setInterval(() => scheduleUntil(c.currentTime + 0.25), 50);
    }
    function stop() {
      clearInterval(timer);
      const t = c.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 0.8);
      setTimeout(() => { live.forEach(x => { try { x.stop(); } catch (e) {} }); master.disconnect(); }, 900);
    }

    return { run, stop, setLevel, scheduleUntil, sfx, sag, layers: L, voices: () => live.size, level: () => level };
  }

  // ---------- Player: one track at a time, following the chosen mood ----------
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  let mood = MOODS[load(KEY)] ? load(KEY) : 'off';
  let ctx = null, track = null, gameLevel = null;   // null: this page sends no game events
  const listeners = new Set();
  const notify = () => listeners.forEach(f => f());

  // 'off', 'waiting' (chosen, but needs a tap to start) or 'playing'.
  const status = () => mood === 'off' ? 'off' : track && ctx && ctx.state === 'running' ? 'playing' : 'waiting';

  function context() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    // Lets iPhones play this through the silent switch, like a music app.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    ctx = new AC();
    ctx.onstatechange = notify;
    return ctx;
  }

  // Start the chosen mood. Call only from inside a tap.
  function play() {
    if (mood === 'off') return;
    const c = context();
    if (!c) return;
    if (c.state !== 'running') c.resume();
    if (!track) {
      track = createTrack(c, c.destination, MOODS[mood], (Date.now() & 0xffffff) + 1);
      track.setLevel(gameLevel == null ? 2 : gameLevel, c.currentTime);
      track.run();
    }
    notify();
  }

  function set(m) {
    if (!MOODS[m]) m = 'off';
    mood = m;
    store(KEY, m);
    if (m !== 'off') store(KEY + '-last', m);
    if (track) { track.stop(); track = null; }
    play();
    notify();
  }

  // Game events: keep the level in step with play even while the sound is off,
  // and play the matching effect when it is on.
  document.addEventListener('pebble:sound', e => {
    const d = e.detail || {};
    if (gameLevel == null) gameLevel = 1;
    if (d.type === 'start') gameLevel = 1;
    else if (d.type === 'place' && d.progress >= 0.4) gameLevel = Math.max(gameLevel, 2);
    else if (d.type === 'flag' || d.type === 'win') gameLevel = 3;
    else if (d.type === 'lose') gameLevel = 0;
    if (!track || status() !== 'playing') return;
    if (track.sfx[d.type]) track.sfx[d.type](d.spot, d.n);
    if (d.type === 'lose') track.sag();
    track.setLevel(gameLevel);
  });

  // A mood chosen earlier starts on this page's first tap.
  function onGesture() { if (mood !== 'off' && status() !== 'playing') play(); }
  ['pointerup', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, onGesture, true));
  // Quiet in the background; back on return (or on the next tap, if the browser insists).
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (mood !== 'off') ctx.resume();
  });

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/>' +
    '<rect x="3" y="14" width="4.5" height="7" rx="1.5" fill="currentColor"/>' +
    '<rect x="16.5" y="14" width="4.5" height="7" rx="1.5" fill="currentColor"/></svg>';

  // Header button: one tap on or off, using the last mood picked (Focus at first).
  function toggleButton(btn) {
    btn.innerHTML = ICON;
    const draw = () => {
      const st = status();
      btn.classList.toggle('on', st !== 'off');
      btn.classList.toggle('waiting', st === 'waiting');
      btn.setAttribute('aria-pressed', st !== 'off');
      btn.title = st === 'off' ? 'Game music: off (lo-fi with a binaural beat; headphones help)'
        : st === 'waiting' ? 'Game music: tap anywhere to start' : 'Game music: ' + MOODS[mood].label + ', on';
    };
    btn.setAttribute('aria-label', 'Game music');
    btn.addEventListener('click', () => set(mood === 'off' ? (load(KEY + '-last') || 'focus') : 'off'));
    listeners.add(draw);
    draw();
  }

  // Off / Focus / Calm, with a status line underneath.
  function picker(box, note) {
    const options = [['off', 'Off'], ['focus', 'Focus'], ['calm', 'Calm']];
    box.innerHTML = options.map(([v, label]) => '<button type="button" data-mood="' + v + '">' + label + '</button>').join('');
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => set(b.dataset.mood)));
    const draw = () => {
      box.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.mood === mood));
      if (!note) return;
      const st = status(), m = MOODS[mood];
      note.textContent = st === 'off' ? 'Lo-fi game music that follows your moves, with a binaural beat underneath. Headphones help.'
        : st === 'waiting' ? 'Tap anywhere to start the music.'
        : m.label + ': ' + m.bpm + ' BPM, ' + m.beat + ' Hz binaural beat. Playing.';
    };
    listeners.add(draw);
    draw();
  }

  return { toggleButton, picker, set, status, _createTrack: createTrack, _moods: MOODS, _track: () => track };
})();
