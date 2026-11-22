// Progress for the Daily and Challenge pages, kept in this browser only.
// Daily solves are stored by local date; challenge results sit next to the
// other games' stars (key "challenge"), which the games list does not count.
window.PebbleProgress = (() => {
  const GAMES_KEY = 'pebble-games-v1', DAILY_KEY = 'pebble-daily-v1';
  const read = k => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const dateOf = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayKey = () => keyOf(new Date());

  function clock(ms) {
    const t = Math.round(ms / 100), m = Math.floor(t / 600), sec = ((t % 600) / 10).toFixed(1);
    return m ? m + ':' + sec.padStart(4, '0') : sec + ' s';
  }
  const prettyDate = key => dateOf(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  // Daily #1 is the puzzle list's start date (local time). After the last
  // puzzle in the list, the list starts over.
  function dailyNumber(key = todayKey()) {
    const days = Math.round((dateOf(key) - dateOf(window.PEBBLE_PUZZLES.dailyStart)) / 864e5);
    return Math.max(1, days + 1);
  }
  function dailyPuzzle(num) {
    const list = window.PEBBLE_PUZZLES.daily;
    return list[(num - 1) % list.length];
  }
  const dailyBest = (key = todayKey()) => (read(DAILY_KEY).days || {})[key];
  function saveDaily(key, ms) {
    const d = read(DAILY_KEY);
    d.days = d.days || {};
    d.days[key] = d.days[key] ? Math.min(d.days[key], ms) : ms;
    write(DAILY_KEY, d);
  }
  // Days solved in a row, ending today (or yesterday, while today is still open).
  function streak() {
    const days = read(DAILY_KEY).days || {}, d = dateOf(todayKey());
    if (!days[keyOf(d)]) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days[keyOf(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  const levelKey = (tier, i) => tier + '-' + (i + 1);
  const challengeResult = (tier, i) => (read(GAMES_KEY).challenge || {})[levelKey(tier, i)];
  function saveChallenge(tier, i, cost, opt, ms) {
    const d = read(GAMES_KEY), g = d.challenge = d.challenge || {}, k = levelKey(tier, i), old = g[k];
    g[k] = { best: old ? Math.min(old.best, cost) : cost, opt, ms: old && old.ms ? Math.min(old.ms, ms) : ms };
    write(GAMES_KEY, d);
  }
  const challengeSolved = (tier, i) => { const r = challengeResult(tier, i); return !!r && r.best <= r.opt; };
  function tierSolved(tier) {
    const n = window.PEBBLE_PUZZLES.challenge[tier].length;
    let k = 0;
    for (let i = 0; i < n; i++) if (challengeSolved(tier, i)) k++;
    return k;
  }

  return { todayKey, prettyDate, clock, dailyNumber, dailyPuzzle, dailyBest, saveDaily, streak,
           challengeResult, saveChallenge, challengeSolved, tierSolved };
})();
