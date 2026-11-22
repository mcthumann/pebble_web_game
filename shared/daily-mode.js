// The Daily level on every game page: one more level button that plays today's
// puzzle from the rotation (shared/dailies.js; Prices uses shared/puzzles.js).
// Needs shared/progress.js. A link ending in #daily opens it.
//
// In the page: <button type="button" data-daily>Daily</button> inside #levels,
// then, after the page's kit.init():
//   const daily = PebbleDaily.attach('dag', 'dag/');
//   setLevel(daily.wanted() ? daily.button : levelButtons[0]);
// and in setLevel, daily.chose(btn); at a finish,
//   kit.finish(name, score, OPT, time, daily.opts()); daily.done(score, OPT, ms);
window.PebbleDaily = (() => {
  const prog = window.PebbleProgress;
  const BASE = 'https://mcthumann.github.io/pebble_web_game/';

  function attach(game, path) {
    const btn = document.querySelector('#levels [data-daily]');
    const key = prog.todayKey(), num = prog.dailyNumber(key);
    const puzzle = prog.gameDailyPuzzle(game, num);
    Object.entries(puzzle.data || {}).forEach(([k, v]) => { btn.dataset[k] = String(v); });
    btn.dataset.name = 'Daily #' + num;
    const on = () => btn.classList.contains('sel');

    // The button shows a star once today's daily is solved at the optimum,
    // an outline star once it is solved.
    function mark() {
      const r = prog.gameDaily(game, key), opt = r && r.best <= r.opt;
      btn.innerHTML = 'Daily' + (!r ? '' : opt
        ? '<span class="mark star" aria-hidden="true">★</span>'
        : '<span class="mark done" aria-hidden="true">☆</span>');
      btn.setAttribute('aria-label', "Today's daily puzzle, #" + num + (!r ? '' : opt ? ', solved optimally' : ', solved'));
    }

    function untilTomorrow() {
      const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const mins = Math.ceil((next - now) / 60000), h = Math.floor(mins / 60);
      return h ? h + ' h' : mins + ' min';
    }

    // Another tab or page may open the daily: #daily in the address does it.
    window.addEventListener('hashchange', () => {
      if (location.hash !== '#daily') return;
      if (!on()) btn.click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    mark();

    return {
      button: btn, puzzle, num,
      active: on,
      wanted: () => location.hash === '#daily',
      // Keep #daily in the address while the daily is open, so a reload stays on it.
      chose(b) {
        const want = b === btn;
        if ((location.hash === '#daily') === want) return;
        try { history.replaceState(null, '', location.pathname + location.search + (want ? '#daily' : '')); } catch (e) {}
      },
      // The daily is saved here, not with the level stars (its optimum changes daily).
      opts: () => on() ? { record: false, url: BASE + path + '#daily' } : {},
      done(score, opt, ms) {
        if (!on()) return;
        const before = prog.gameDaily(game, key), optimal = score <= opt;
        prog.saveGameDaily(game, key, score, opt, ms);
        if (game === 'prices' && optimal) prog.saveDaily(key, ms);
        mark();
        const line = document.getElementById('best');
        if (!line) return;
        const wasOpt = before && before.best <= before.opt;
        line.textContent = optimal
          ? (wasOpt ? "Today's star is already yours" : "Today's daily star ★") + ' · next puzzle in ' + untilTomorrow()
          : before && score >= before.best ? 'Your best today: ' + before.best + ' · optimal ' + opt
          : (before ? 'New best today' : '☆ Solved today') + ' · match ' + opt + ' for the star';
      },
    };
  }

  return { attach };
})();
