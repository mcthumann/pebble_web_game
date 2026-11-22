"""Generate the daily puzzles for every game but Prices (writes shared/dailies.js).

Prices already has its own daily list (tools/make_puzzles.py, shared/puzzles.js).
Every other game gets PER_GAME puzzles that rotate: Daily #k plays puzzle
(k - 1) mod PER_GAME, counted from the same start date as the Prices daily.

Each candidate is solved exactly with the rules of its game page, then graded
the same way as the Prices puzzles:

    difficulty = -log10( chance that a player picking uniformly at random among
                         the legal moves at every step finishes at the optimum )

Red-blue and Clocked use a different grade (see their sections), because free
moves (Red-blue) and whole sets of moves per tick (Clocked) make the random
player meaningless there.

Usage:  python tools/make_dailies.py
"""
import heapq
import json
import math
import random
from collections import deque
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "shared" / "dailies.js"
DAILY_START = "2026-11-22"  # Daily #1, the same day as the Prices daily
PER_GAME = 12


# ---------------------------------------------------------------- engine ----

def explore(start, moves, is_goal):
    """Exact optimum and difficulty grade for a game with positive move costs.

    moves(s) yields (t, cost); is_goal(s) ends the game. Returns (opt, grade)
    or (None, None) when the goal cannot be reached.
    """
    dist = {start: 0}
    heap = [(0, start)]
    done = set()
    opt = None
    order = []
    succ = {}
    while heap:
        d, s = heapq.heappop(heap)
        if s in done:
            continue
        if opt is not None and d > opt:
            break
        done.add(s)
        order.append(s)
        if is_goal(s):
            if opt is None:
                opt = d
            continue
        out = list(moves(s))
        succ[s] = out
        for t, w in out:
            nd = d + w
            if nd < dist.get(t, math.inf):
                dist[t] = nd
                heapq.heappush(heap, (nd, t))
    if opt is None:
        return None, None
    # Chance that uniform random play stays on an optimal route. Moves that
    # would overspend the budget (the optimum) are not offered.
    prob = {}
    for s in reversed(order):
        if is_goal(s):
            prob[s] = 1.0 if dist[s] == opt else 0.0
            continue
        left = opt - dist[s]
        legal = [(t, w) for t, w in succ.get(s, []) if w <= left]
        if not legal:
            prob[s] = 0.0
            continue
        total = 0.0
        for t, w in legal:
            if dist[s] + w == dist.get(t) and t in prob:
                total += prob[t]
        prob[s] = total / len(legal)
    p = prob.get(start, 0.0)
    return opt, (round(-math.log10(p), 2) if p > 0 else 99.0)


def bfs_opt(start, moves, is_goal):
    """Fewest moves (or 0-1 costs) to a goal state, by 0-1 breadth-first search."""
    dist = {start: 0}
    dq = deque([start])
    while dq:
        s = dq.popleft()
        d = dist[s]
        if is_goal(s):
            return d
        for t, w in moves(s):
            nd = d + w
            if nd < dist.get(t, math.inf):
                dist[t] = nd
                (dq.appendleft if w == 0 else dq.append)(t)
    return None


# ------------------------------------------------------------ line games ----
# A state is a bitmask: bit i set means spot i (1..N) holds a pebble. Spot 0 is
# the permanent source and is not stored.

def line_moves(N, P):
    def moves(s):
        count = bin(s).count("1")
        for i in range(1, N + 1):
            if i > 1 and not (s >> i - 1) & 1:
                continue
            bit = 1 << i
            if s & bit:
                yield s ^ bit, 1
            elif count < P:
                yield s | bit, 1
    return moves


def reversible(N, P):
    """Home page: the game ends once a pebble lands on the flag."""
    return explore(0, line_moves(N, P), lambda s: (s >> N) & 1)


def clean(N, P):
    """Clean finish: the flag holds the only pebble."""
    return explore(0, line_moves(N, P), lambda s: s == 1 << N)


def erasure(N, P, lam):
    """Erasure: taps cost 1, a hold erases any pebble for lam; finish clean."""
    tap = line_moves(N, P)

    def moves(s):
        yield from tap(s)
        for i in range(1, N + 1):
            if (s >> i) & 1:
                yield s ^ (1 << i), lam
    return explore(0, moves, lambda s: s == 1 << N)


def erasure_count(N, P, lam, opt):
    """Fewest erasures among the optimal routes (for the hint line)."""
    tap = line_moves(N, P)
    best = {0: (0, 0)}
    heap = [(0, 0, 0)]
    while heap:
        c, e, s = heapq.heappop(heap)
        if best.get(s) != (c, e):
            continue
        if s == 1 << N:
            return e
        nxt = [(t, 1, 0) for t, _ in tap(s)] + [(s ^ (1 << i), lam, 1) for i in range(1, N + 1) if (s >> i) & 1]
        for t, w, de in nxt:
            k = (c + w, e + de)
            if c + w <= opt and k < best.get(t, (math.inf, math.inf)):
                best[t] = k
                heapq.heappush(heap, (c + w, e + de, t))
    return None


# ------------------------------------------------------------------ Pits ----

def pits_min_memory(p):
    n = len(p) - 1
    V = [[0] * (n + 2) for _ in range(n + 2)]
    for length in range(1, n):
        for a in range(1, n - length + 1):
            b = a + length - 1
            V[a][b] = min(p[m] + max(V[a][m - 1] if m > a else 0, V[m + 1][b] if m < b else 0)
                          for m in range(a, b + 1))
    return p[n] + (V[1][n - 1] if n > 1 else 0)


def pits(sizes):
    p = [0] + sizes
    n = len(sizes)
    M = pits_min_memory(p)

    def moves(s):
        w = sum(p[k] for k in range(1, n + 1) if (s >> k) & 1)
        for k in range(1, n + 1):
            if k > 1 and not (s >> k - 1) & 1:
                continue
            bit = 1 << k
            if s & bit:
                yield s ^ bit, 1
            elif w + p[k] <= M:
                yield s | bit, 1
    opt, grade = explore(0, moves, lambda s: s == 1 << n)
    return M, opt, grade


# ---------------------------------------------------------------- Spooky ----
# State: (pebbles, ghosts) as one integer, pebbles in the low N+1 bits.

def spooky(N, P):
    SH = N + 1
    LOW = (1 << SH) - 1

    def moves(s):
        pm, gm = s & LOW, s >> SH
        count = bin(pm).count("1")
        for i in range(1, N + 1):
            bit = 1 << i
            pred = i == 1 or (pm >> i - 1) & 1
            if pm & bit:
                if pred:
                    yield (pm ^ bit) | (gm << SH), 1           # tap: remove
                yield (pm ^ bit) | ((gm | bit) << SH), 1       # hold: ghost, from anywhere
                continue
            if not pred:
                continue
            if count < P:
                yield (pm | bit) | ((gm & ~bit) << SH), 1      # tap: place (or re-pebble a ghost)
    goal = 1 << N
    return explore(0, moves, lambda s: s == goal)


# ------------------------------------------------------------------- DAG ----

def dag_solve(preds, outputs):
    """Fewest pebbles that can finish, then the optimum and grade at that many."""
    n = len(preds)
    need = [sum(1 << q for q in ps) for ps in preds]
    goal = sum(1 << v for v in outputs)
    for P in range(len(outputs), n + 1):
        def moves(s, P=P):
            c = bin(s).count("1")
            for v in range(n):
                if s & need[v] != need[v]:
                    continue
                bit = 1 << v
                if s & bit:
                    yield s ^ bit, 1
                elif c < P:
                    yield s | bit, 1
        if bfs_opt(0, moves, lambda s: s == goal) is None:
            continue
        opt, grade = explore(0, moves, lambda s: s == goal)
        return P, opt, grade
    return None, None, None


def random_dag(rng, widths):
    """Layered graph, bottom row first. Every node above the bottom reads one or
    two nodes of the row just below it, near its own position, and every node
    feeds something above it."""
    rows, preds = [], []
    nid = 0
    for r, w in enumerate(widths):
        row = []
        for k in range(w):
            if r == 0:
                ps = []
            else:
                below = rows[-1]
                wb = len(below)
                centre = k * (wb - 1) / (w - 1) if w > 1 else (wb - 1) / 2
                near = [j for j in range(wb) if abs(j - centre) <= 1.01]
                two = len(near) >= 2 and rng.random() < 0.8
                pick = sorted(rng.sample(near, 2 if two else 1))
                ps = [below[j] for j in pick]
            preds.append(ps)
            row.append(nid)
            nid += 1
        rows.append(row)
    # Every node below the top must feed some node above it.
    used = {q for ps in preds for q in ps}
    for row in rows[:-1]:
        for v in row:
            if v not in used:
                return None
    if len({tuple(ps) for ps in preds if ps}) < sum(1 for ps in preds if ps):
        return None  # two nodes with the same feeders look like a drawing error
    return rows, preds


# -------------------------------------------------------------- Red-blue ----

def redblue(preds, outputs, S):
    """Fewest I/Os: loading a red pebble from blue or storing red to blue costs 1;
    computing (all feeders red) and dropping red are free. Inputs start blue."""
    n = len(preds)
    need = [sum(1 << q for q in ps) for ps in preds]
    inputs = sum(1 << v for v in range(n) if not preds[v])
    goal = sum(1 << v for v in outputs)

    def moves(s):
        red, blue = s & ((1 << n) - 1), s >> n
        c = bin(red).count("1")
        for v in range(n):
            bit = 1 << v
            if red & bit:
                yield (red ^ bit) | (blue << n), 0             # drop
                if not blue & bit:
                    yield red | ((blue | bit) << n), 1         # store
                continue
            if c >= S:
                continue
            if need[v] and red & need[v] == need[v]:
                yield (red | bit) | (blue << n), 0             # compute
            elif blue & bit:
                yield (red | bit) | (blue << n), 1             # load
    return bfs_opt(inputs << n, moves, lambda s: (s >> n) & goal == goal)


# --------------------------------------------------------------- Clocked ----

def clocked(N, P):
    """Fewest ticks. A tick toggles a set of spots, no two neighbours, each with
    a pebble on the spot before it. Pebbles down before the tick plus those
    being placed must be at most P. Finish with only the flag."""
    def moves(s):
        count = bin(s).count("1")
        ok = [i for i in range(1, N + 1) if i == 1 or (s >> i - 1) & 1]

        def rec(k, chosen, last, adds):
            if k == len(ok):
                if chosen:
                    yield chosen
                return
            yield from rec(k + 1, chosen, last, adds)
            i = ok[k]
            if last is not None and i == last + 1:
                return
            add = 0 if (s >> i) & 1 else 1
            if count + adds + add > P:
                return
            yield from rec(k + 1, chosen | (1 << i), i, adds + add)
        for t in rec(0, 0, None, 0):
            yield s ^ t, 1
    return bfs_opt(0, moves, lambda s: s == 1 << N)


# ----------------------------------------------------------------- check ----

def check_existing():
    """The solvers must agree with the optimum each game page already shows."""
    assert reversible(3, 2)[0] == 4 and reversible(7, 3)[0] == 13 and reversible(15, 4)[0] == 38
    assert clean(4, 3)[0] == 9 and clean(8, 4)[0] == 25 and clean(16, 5)[0] == 71
    assert erasure(6, 3, 4)[0] == 16 and erasure(8, 4, 5)[0] == 21 and erasure(16, 4, 5)[0] == 47
    assert pits([1, 1, 2, 3, 2, 4, 1])[1] == 23 and pits([1, 1, 1, 2, 2, 1, 3, 1])[1] == 31
    assert spooky(5, 3)[0] == 17 and spooky(7, 3)[0] == 39
    assert clocked(4, 3) == 8 and clocked(8, 4) == 20
    pyr = [[], [], [], [], [0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [7, 8]]
    assert redblue(pyr, [9], 4) == 7
    print("solvers agree with the current levels")


# ---------------------------------------------------------------- choose ----
# Daily #1 gets a middling puzzle; after that the difficulty wanders up and
# down. RANK_ORDER[k] is the difficulty rank (0 easiest) played on day k + 1.
RANK_ORDER = [5, 2, 8, 0, 10, 4, 7, 1, 11, 3, 9, 6]


def rotate(picks):
    """picks: 12 entries with a 'd' grade. Returns them in play order."""
    assert len(picks) == PER_GAME, len(picks)
    ranked = sorted(picks, key=lambda e: e["d"])
    return [ranked[r] for r in RANK_ORDER]


def row_for(spots):
    return 4 if spots <= 12 else 5


def make_reversible():
    sizes = [(9, 4), (10, 4), (11, 4), (12, 4), (13, 4), (14, 4),
             (10, 5), (11, 5), (12, 5), (13, 5), (14, 5), (15, 5)]
    out = []
    for n, p in sizes:
        opt, d = reversible(n, p)
        out.append({"data": {"p": p, "n": n, "opt": opt}, "d": d})
    return rotate(out)


def make_clean():
    sizes = [(9, 5), (10, 5), (11, 5), (12, 5), (13, 5), (14, 5), (15, 5),
             (11, 6), (12, 6), (13, 6), (14, 6), (15, 6)]
    out = []
    for n, p in sizes:
        opt, d = clean(n, p)
        out.append({"data": {"p": p, "n": n, "opt": opt}, "d": d})
    return rotate(out)


def make_erase():
    # (N, P, lambda): lambda sits near a break-even point, so how many pebbles
    # to erase is a real choice. The budget is the optimum.
    picks = [(9, 4, 5), (10, 3, 4), (11, 4, 3), (10, 4, 6), (12, 3, 3), (12, 4, 5),
             (11, 3, 5), (13, 3, 4), (14, 4, 3), (13, 4, 7), (15, 4, 5), (14, 3, 6)]
    out = []
    for n, p, lam in picks:
        opt, d = erasure(n, p, lam)
        e = erasure_count(n, p, lam, opt)
        out.append({"data": {"p": p, "n": n, "lam": lam, "budget": opt, "opt": opt, "row": row_for(n + 1)},
                    "d": d, "erase": e})
    return rotate(out)


def make_spooky():
    # Seven need ghosts (P pebbles reach only 2^(P-1) cleanly without them);
    # five could be done without, and the ghosts are a temptation.
    sizes = [(6, 3), (8, 3), (9, 3), (9, 4), (10, 4), (11, 4), (12, 4),
             (7, 4), (8, 4), (10, 5), (11, 5), (12, 5)]
    out = []
    for n, p in sizes:
        opt, d = spooky(n, p)
        out.append({"data": {"p": p, "n": n, "opt": opt, "row": row_for(n + 1)}, "d": d,
                    "ghosts": n > 2 ** (p - 1)})
    order = rotate(out)
    # Start the rotation on one that needs ghosts, of about the same difficulty.
    if not order[0]["ghosts"]:
        j = min((k for k, e in enumerate(order) if e["ghosts"]), key=lambda k: abs(order[k]["d"] - order[0]["d"]))
        order[0], order[j] = order[j], order[0]
    return order


def make_clocked():
    # Nine need more ticks than the 2N - 1 that unlimited memory would allow;
    # in the other three the memory is just enough for the fastest schedule.
    # At most 14 spots, so the board and the Tick button fit on a phone.
    sizes = [(6, 4), (7, 4), (9, 5), (10, 5), (11, 5), (12, 5), (14, 5),
             (13, 6), (14, 6), (8, 5), (11, 6), (12, 6)]
    out = []
    for n, p in sizes:
        opt = clocked(n, p)
        out.append({"data": {"p": p, "n": n, "opt": opt, "row": 5}, "d": opt - (2 * n - 1)})
    return rotate(out)


def make_pits(rng):
    existing = {(1, 1, 2, 3, 2, 4, 1), (1, 1, 1, 2, 2, 1, 3, 1), (1, 1, 1, 2, 2, 3, 2, 4, 1, 4, 2, 2)}
    found = {}
    tries = 0
    while tries < 4000:
        tries += 1
        n = rng.randint(7, 12)
        sizes = [rng.choice([1, 1, 1, 2, 2, 3, 4]) for _ in range(n - 1)] + [rng.choice([1, 1, 2])]
        key = tuple(sizes)
        if key in existing or key in found:
            continue
        M, opt, d = pits(sizes)
        if opt is None or M > 12 or opt > 60 or not (12 <= d <= 25):
            continue
        found[key] = {"data": {"p": ",".join(map(str, sizes))}, "d": d, "opt": opt, "m": M}
    # Spread the picks across the grade range, one per band.
    return rotate(spread(list(found.values()), 12, 25))


def spread(cands, lo, hi):
    cands.sort(key=lambda e: e["d"])
    picks = []
    for k in range(PER_GAME):
        target = lo + (hi - lo) * (k + 0.5) / PER_GAME
        best = min((c for c in cands if c not in picks), key=lambda c: abs(c["d"] - target))
        picks.append(best)
    return picks


DAG_SHAPES = [[4, 3, 2, 1], [4, 4, 3, 2, 1], [3, 3, 3, 2, 1], [4, 3, 3, 2, 1], [5, 4, 3, 2, 1],
              [3, 4, 3, 2, 1], [4, 3, 2, 2, 1], [3, 3, 2, 2, 1], [4, 4, 2, 2, 1], [5, 3, 3, 2, 1],
              [3, 3, 3, 3, 1], [4, 3, 3, 3, 1], [3, 4, 4, 2, 1], [4, 4, 3, 3, 1]]


def make_dag(rng):
    found = []
    seen = set()
    tries = 0
    while tries < 3000 and len(found) < 400:
        tries += 1
        widths = rng.choice(DAG_SHAPES)
        g = random_dag(rng, widths)
        if not g:
            continue
        rows, preds = g
        key = json.dumps(preds)
        if key in seen:
            continue
        seen.add(key)
        P, opt, d = dag_solve(preds, rows[-1])
        if opt is None or not (28 <= opt <= 65) or not (18 <= d <= 33) or P > 7:
            continue
        found.append({"graph": {"rows": rows, "preds": preds, "layout": "even"}, "d": d, "opt": opt, "p": P})
    return rotate(spread(found, 18, 33))


def random_rb(rng):
    """A small computation graph for Red-blue: 3 or 4 inputs at the bottom,
    each node above reads two nodes of the row below, the top row is output."""
    shapes = [[3, 3, 2], [4, 3, 2], [4, 3, 2, 1], [3, 3, 3], [4, 4, 2], [3, 3, 2, 1], [4, 3, 3], [4, 2, 2]]
    widths = rng.choice(shapes)
    rows, preds = [], []
    nid = 0
    for r, w in enumerate(widths):
        row = []
        for k in range(w):
            if r == 0:
                ps = []
            else:
                below = rows[-1]
                wb = len(below)
                centre = k * (wb - 1) / (w - 1) if w > 1 else (wb - 1) / 2
                near = [j for j in range(wb) if abs(j - centre) <= 1.51]
                if len(near) < 2:
                    near = list(range(wb))
                ps = sorted(below[j] for j in rng.sample(near, 2))
            preds.append(ps)
            row.append(nid)
            nid += 1
        rows.append(row)
    used = {q for ps in preds for q in ps}
    if any(v not in used for row in rows[:-1] for v in row):
        return None
    if len({tuple(ps) for ps in preds if ps}) < sum(1 for ps in preds if ps):
        return None
    return rows, preds


def make_redblue(rng):
    # Grade: I/Os beyond the unavoidable ones (load every input once, store
    # every output once). Each pick needs extra I/O that one more red pebble
    # would save, so the red limit is what makes it a puzzle.
    found = []
    seen = set()
    tries = 0
    while tries < 1500 and len(found) < 120:
        tries += 1
        g = random_rb(rng)
        if not g:
            continue
        rows, preds = g
        outputs = rows[-1]
        key = json.dumps(preds)
        if key in seen:
            continue
        seen.add(key)
        for S in (3, 4):
            opt = redblue(preds, outputs, S)
            if opt is None:
                continue
            base = len(rows[0]) + len(outputs)
            extra = opt - base
            if extra < 2 or extra > 7:
                continue
            roomier = redblue(preds, outputs, S + 1)
            if roomier is None or roomier >= opt:
                continue
            found.append({"graph": {"rows": rows, "preds": preds, "outputs": outputs, "layout": "even"},
                          "data": {"s": S, "opt": opt}, "d": extra + (0.5 if S == 3 else 0)})
            break
    # A spread of extra I/O, two to seven.
    return rotate(spread(found, 2, 7.5))


def main():
    check_existing()
    rng = random.Random(20261122)
    games = {}
    for name, fn in (("reversible", make_reversible), ("clean", make_clean), ("erase", make_erase),
                     ("spooky", make_spooky), ("clocked", make_clocked)):
        games[name] = fn()
        print(name, [e["d"] for e in games[name]], flush=True)
    for name, fn in (("pits", make_pits), ("dag", make_dag), ("redblue", make_redblue)):
        games[name] = fn(rng)
        print(name, [e["d"] for e in games[name]], flush=True)
    data = {"dailyStart": DAILY_START, "games": games}
    OUT.write_text(
        "// Generated by tools/make_dailies.py: do not edit by hand.\n"
        "// Twelve daily puzzles per game, on rotation from dailyStart (Daily #1).\n"
        "// data: the level settings the game page reads; d: the difficulty grade.\n"
        "window.PEBBLE_DAILIES = " + json.dumps(data, separators=(",", ":")) + ";\n",
        encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
