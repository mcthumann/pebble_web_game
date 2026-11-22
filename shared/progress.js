// Progress for the daily puzzles and the Challenge page, kept in this browser
// only. Daily solves are stored by local date: the Prices daily page keeps a
// time per day (days), every other game's daily a best score (games); challenge
// results sit next to the other games' stars (key "challenge"), which the games
// list does not count.
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
  // Every game's daily uses the same numbering (shared/dailies.js has the date
  // too, so pages without the Prices list can count days).
  function dailyNumber(key = todayKey()) {
    const start = (window.PEBBLE_PUZZLES || window.PEBBLE_DAILIES).dailyStart;
    const days = Math.round((dateOf(key) - dateOf(start)) / 864e5);
    return Math.max(1, days + 1);
  }
  function dailyPuzzle(num) {
    const list = window.PEBBLE_PUZZLES.daily;
    return list[(num - 1) % list.length];
  }
  // Today's puzzle for one game, as level settings for its page (data) plus
  // the solver's grade (d). Prices reads the Prices daily list, so its page and
  // the Daily page play the same puzzle.
  function gameDailyPuzzle(game, num) {
    if (game !== 'prices') {
      const list = window.PEBBLE_DAILIES.games[game];
      return list[(num - 1) % list.length];
    }
    const q = dailyPuzzle(num);
    return { d: q.d, data: { p: q.p, c: q.c.join(','), e: q.e.join(','), budget: q.opt, opt: q.opt, row: q.c.length + 1 <= 12 ? 4 : 5 } };
  }
  // A game's daily result for a date: { best, opt, ms }, or undefined.
  function gameDaily(game, key = todayKey()) {
    const d = read(DAILY_KEY), r = ((d.games || {})[game] || {})[key];
    if (r || game !== 'prices') return r;
    // The Prices daily page keeps only a time: every solve there is optimal.
    const ms = (d.days || {})[key];
    return ms ? { best: 0, opt: 0, ms } : undefined;
  }
  function saveGameDaily(game, key, score, opt, ms) {
    const d = read(DAILY_KEY);
    d.games = d.games || {};
    const g = d.games[game] = d.games[game] || {}, old = g[key];
    g[key] = { best: old ? Math.min(old.best, score) : score, opt, ms: old && old.ms ? Math.min(old.ms, ms) : ms };
    write(DAILY_KEY, d);
  }

  const dailyBest = (key = todayKey()) => (read(DAILY_KEY).days || {})[key];
  function saveDaily(key, ms) {
    const d = read(DAILY_KEY);
    d.days = d.days || {};
    d.days[key] = d.days[key] ? Math.min(d.days[key], ms) : ms;
    write(DAILY_KEY, d);
  }
  // Days in a row with at least one daily solved (in any game), ending today
  // (or yesterday, while today is still open).
  function streak() {
    const s = read(DAILY_KEY), days = s.days || {}, games = Object.values(s.games || {}), d = dateOf(todayKey());
    const solved = k => !!days[k] || games.some(g => g[k]);
    if (!solved(keyOf(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (solved(keyOf(d))) { n++; d.setDate(d.getDate() - 1); }
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
           gameDailyPuzzle, gameDaily, saveGameDaily,
           challengeResult, saveChallenge, challengeSolved, tierSolved };
})();
