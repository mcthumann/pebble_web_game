// Focus sound: slow ambient chords over a quiet noise bed, with a binaural beat
// underneath. Two sine tones a few hertz apart, one in each ear, are heard
// through headphones as a slow pulse at the difference (10 Hz for Focus, 6 Hz
// for Calm). Everything is synthesised in the browser; there are no audio files.
//
// Browsers only start sound inside a tap, so a mood chosen on one page starts
// on the first tap of the next page. The choice is remembered on this device.
window.PebbleBeats = (() => {
  const KEY = 'pebble-beats';
  const MOODS = {
    focus: { label: 'Focus', beat: 10, carrier: 220, step: 12, chords: [
      [110, 164.81, 220, 261.63], [87.31, 130.81, 220, 261.63],
      [98, 146.83, 196, 246.94], [110, 164.81, 220, 329.63]] },
    calm: { label: 'Calm', beat: 6, carrier: 196, step: 16, chords: [
      [98, 146.83, 196, 233.08], [87.31, 130.81, 174.61, 220],
      [77.78, 116.54, 155.56, 196], [87.31, 130.81, 174.61, 261.63]] },
  };
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/>' +
    '<rect x="3" y="14" width="4.5" height="7" rx="1.5" fill="currentColor"/>' +
    '<rect x="16.5" y="14" width="4.5" height="7" rx="1.5" fill="currentColor"/></svg>';

  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  let mood = MOODS[load(KEY)] ? load(KEY) : 'off';
  let ctx = null, voice = null, chordTimer = null;
  const listeners = new Set();
  const notify = () => listeners.forEach(f => f());

  // 'off', 'waiting' (chosen, but needs a tap to start) or 'playing'.
  const status = () => mood === 'off' ? 'off' : voice && ctx && ctx.state === 'running' ? 'playing' : 'waiting';

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

  function noise(c) {
    const len = c.sampleRate * 4, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    return src;
  }

  function startVoice(c, cfg) {
    const t = c.currentTime, nodes = [];
    const master = c.createGain();
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(0.9, t + 2.5);
    master.connect(c.destination);

    // The binaural pair: one pure tone per ear, `beat` hertz apart.
    const merger = c.createChannelMerger(2);
    merger.connect(master);
    [[-1, 0], [1, 1]].forEach(([sign, channel]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.value = cfg.carrier + sign * cfg.beat / 2;
      g.gain.value = 0.09;
      o.connect(g); g.connect(merger, 0, channel); o.start();
      nodes.push(o);
    });

    // The pad: each chord note as two slightly detuned triangles, spread across
    // the stereo field, through a low-pass filter that slowly opens and closes.
    const filter = c.createBiquadFilter(), padGain = c.createGain();
    filter.type = 'lowpass'; filter.frequency.value = 700; filter.Q.value = 0.4;
    padGain.gain.value = 0.035;
    filter.connect(padGain); padGain.connect(master);
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = 0.05; depth.gain.value = 250;
    lfo.connect(depth); depth.connect(filter.frequency); lfo.start();
    nodes.push(lfo);
    const pad = [];
    cfg.chords[0].forEach((f, k) => [-1, 1].forEach(det => {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * (1 + det * 0.003);
      if (c.createStereoPanner) {
        const p = c.createStereoPanner();
        p.pan.value = det * (0.2 + 0.15 * k);
        o.connect(p); p.connect(filter);
      } else o.connect(filter);
      o.start();
      nodes.push(o); pad.push({ o, k, det });
    }));

    // A quiet brown-noise bed, like distant rain.
    const n = noise(c), nf = c.createBiquadFilter(), ng = c.createGain();
    nf.type = 'lowpass'; nf.frequency.value = 500; ng.gain.value = 0.05;
    n.connect(nf); nf.connect(ng); ng.connect(master); n.start();
    nodes.push(n);

    // Glide to the next chord every few seconds.
    let idx = 0;
    chordTimer = setInterval(() => {
      idx = (idx + 1) % cfg.chords.length;
      const now = c.currentTime;
      pad.forEach(({ o, k, det }) => o.frequency.setTargetAtTime(cfg.chords[idx][k] * (1 + det * 0.003), now, 1.2));
    }, cfg.step * 1000);
    return { nodes, master };
  }

  function stopVoice() {
    clearInterval(chordTimer);
    chordTimer = null;
    if (!voice) return;
    const { nodes, master } = voice, t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0, t + 0.8);
    setTimeout(() => { nodes.forEach(x => { try { x.stop(); } catch (e) {} }); master.disconnect(); }, 900);
    voice = null;
  }

  // Start the chosen mood. Call only from inside a tap.
  function play() {
    if (mood === 'off') return;
    const c = context();
    if (!c) return;
    if (c.state !== 'running') c.resume();
    if (!voice) voice = startVoice(c, MOODS[mood]);
    notify();
  }

  function set(m) {
    if (!MOODS[m]) m = 'off';
    mood = m;
    store(KEY, m);
    if (m !== 'off') store(KEY + '-last', m);
    stopVoice();
    play();
    notify();
  }

  // A mood chosen earlier starts on this page's first tap.
  function onGesture() { if (mood !== 'off' && status() !== 'playing') play(); }
  ['pointerup', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, onGesture, true));
  // Quiet in the background; back on return (or on the next tap, if the browser insists).
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (mood !== 'off') ctx.resume();
  });

  // Header button: one tap on or off, using the last mood picked (Focus at first).
  function toggleButton(btn) {
    btn.innerHTML = ICON;
    const draw = () => {
      const s = status();
      btn.classList.toggle('on', s !== 'off');
      btn.classList.toggle('waiting', s === 'waiting');
      btn.setAttribute('aria-pressed', s !== 'off');
      btn.title = s === 'off' ? 'Focus sound: off (binaural beats, use headphones)'
        : s === 'waiting' ? 'Focus sound: tap anywhere to start' : 'Focus sound: ' + MOODS[mood].label + ', on';
    };
    btn.setAttribute('aria-label', 'Focus sound');
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
      const s = status();
      note.textContent = s === 'off' ? 'Binaural beats under soft chords. Use headphones.'
        : s === 'waiting' ? 'Tap anywhere to start the sound.'
        : MOODS[mood].label + ': ' + MOODS[mood].beat + ' Hz beat, playing. Use headphones.';
    };
    listeners.add(draw);
    draw();
  }

  return { toggleButton, picker, set, status };
})();
