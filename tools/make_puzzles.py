"""Generate and grade puzzles for the Daily and Challenge pages.

Every puzzle uses the Prices rules: spot i costs C[i] to place or remove with a
tap (the spot before it must hold a pebble) and E[i] to erase with a hold from
anywhere. At most P pebbles are on the line. The goal is the flag pebbled and
nothing else. The budget is always exactly the optimum, so any wasted move loses.

Each candidate is solved exactly (Dijkstra over all pebble placements), then
graded by how unlikely it is to stumble onto the optimum:

    difficulty = -log10( chance that a player picking uniformly at random among
                         the legal, affordable moves at every step reaches the
                         flag at the optimal cost )

Usage:  python tools/make_puzzles.py   (writes shared/puzzles.js)
"""
import heapq
import json
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "shared" / "puzzles.js"
DAILY_START = "2026-11-22"  # Daily #1
DAILY_COUNT = 366
PER_TIER = 12


def moves(mask, n, p, C, E):
    """Yield (next_mask, cost, kind, spot) for every legal move from mask."""
    count = bin(mask).count("1")
    for i in range(1, n + 1):
        pred = i == 1 or (mask >> (i - 1)) & 1
        if (mask >> i) & 1:
            if pred:
                yield mask ^ (1 << i), C[i], "t", i
            yield mask ^ (1 << i), E[i], "e", i
        elif pred and count < p:
            yield mask | (1 << i), C[i], "t", i


def solve(n, p, C, E, allow_erase=True):
    goal = 1 << n
    dist = {0: 0}
    order = []
    heap = [(0, 0)]
    seen = set()
    while heap:
        d, m = heapq.heappop(heap)
        if m in seen:
            continue
        seen.add(m)
        order.append(m)
        if m == goal:
            continue  # the game ends here
        for t, w, kind, _ in moves(m, n, p, C, E):
            if kind == "e" and not allow_erase:
                continue
            if d + w < dist.get(t, math.inf):
                dist[t] = d + w
                heapq.heappush(heap, (d + w, t))
    return dist, order


def grade(n, p, C, E):
    dist, order = solve(n, p, C, E)
    goal = 1 << n
    if goal not in dist:
        return None
    opt = dist[goal]

    # Distance to the goal from every state (reverse search over the same moves).
    rev = {}
    for m in order:
        if m == goal:
            continue
        for t, w, _, _ in moves(m, n, p, C, E):
            rev.setdefault(t, []).append((m, w))
    togo = {goal: 0}
    heap = [(0, goal)]
    done = set()
    while heap:
        d, m = heapq.heappop(heap)
        if m in done:
            continue
        done.add(m)
        for s, w in rev.get(m, []):
            if d + w < togo.get(s, math.inf):
                togo[s] = d + w
                heapq.heappush(heap, (d + w, s))

    # Walk the optimal moves in cost order: chance of random play staying optimal,
    # number of optimal move sequences, and which spots optimal routes erase.
    chance = {0: 1.0}
    paths = {0: 1}
    plans = {0: {()}}
    length = {0: 0}
    for m in order:
        if m == goal or m not in chance:
            continue
        budget_left = opt - dist[m]
        legal = [(t, w, k, i) for t, w, k, i in moves(m, n, p, C, E) if w <= budget_left]
        for t, w, k, i in legal:
            if dist[m] + w + togo.get(t, math.inf) != opt or dist[m] + w != dist.get(t):
                continue
            chance[t] = chance.get(t, 0) + chance[m] / len(legal)
            paths[t] = paths.get(t, 0) + paths[m]
            length[t] = max(length.get(t, 0), length[m] + 1)
            add = {tuple(sorted(pl + ((i,) if k == "e" else ()))) for pl in plans[m]}
            plans.setdefault(t, set()).update(add)
            if len(plans[t]) > 60:
                plans[t] = set(list(plans[t])[:60])

    rdist, _ = solve(n, p, C, E, allow_erase=False)
    plan_list = sorted(plans[goal])
    erasures = sorted({len(pl) for pl in plan_list})
    return {
        "opt": opt,
        "difficulty": -math.log10(chance[goal]),
        "paths": paths[goal],
        "plans": len(plan_list),
        "erasures": erasures,
        "length": length[goal],
        "reversible": rdist.get(goal),
        "plan": list(plan_list[0]),
    }


def candidate(rng, n, p):
    C = [0] + [rng.choices([1, 2, 3], weights=[5, 3, 2])[0] for _ in range(n)]
    E = [0] + [rng.randint(2, 9) for _ in range(n)]
    return C, E


# Tiers: board size, pebbles, and the difficulty band a puzzle must land in.
# For scale, the Prices page's own levels grade Easy 5.1, Medium 10.1, Hard 16.3.
# Extreme also requires that every optimal route erases exactly the same spots.
TIERS = {
    "daily":    dict(n=(12, 14), p=(4, 4), band=(15.0, 19.0), min_erase=2, unique=False),
    "hard":     dict(n=(12, 14), p=(4, 4), band=(15.5, 18.0), min_erase=2, unique=False),
    "veryhard": dict(n=(15, 16), p=(4, 5), band=(19.0, 22.5), min_erase=3, unique=False),
    "extreme":  dict(n=(17, 19), p=(5, 5), band=(24.0, 99.0), min_erase=3, unique=True),
}


def make(tier, count, seed):
    cfg = TIERS[tier]
    rng = random.Random(seed)
    out, tried = [], 0
    while len(out) < count:
        tried += 1
        n = rng.randint(*cfg["n"])
        p = rng.randint(*cfg["p"])
        C, E = candidate(rng, n, p)
        g = grade(n, p, C, E)
        if not g:
            continue
        lo, hi = cfg["band"]
        if not lo <= g["difficulty"] < hi:
            continue
        if min(g["erasures"]) < cfg["min_erase"]:
            continue
        if cfg["unique"] and g["plans"] != 1:
            continue
        # Erasing must matter: without it the flag is out of reach or clearly dearer.
        if g["reversible"] is not None and g["reversible"] < g["opt"] + 4:
            continue
        out.append({"p": p, "c": C[1:], "e": E[1:], "opt": g["opt"],
                    "erase": g["erasures"], "d": round(g["difficulty"], 2),
                    "len": g["length"], "plans": g["plans"]})
    print(f"{tier}: kept {count} of {tried} candidates")
    return out


def main():
    data = {"dailyStart": DAILY_START}
    data["daily"] = make("daily", DAILY_COUNT, 2026)
    data["challenge"] = {
        "hard": sorted(make("hard", PER_TIER, 11), key=lambda q: q["d"]),
        "veryhard": sorted(make("veryhard", PER_TIER, 22), key=lambda q: q["d"]),
        "extreme": sorted(make("extreme", PER_TIER, 33), key=lambda q: q["d"]),
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(
        "// Generated by tools/make_puzzles.py: do not edit by hand.\n"
        "// Every budget is the exact optimum; d is the solver's difficulty grade.\n"
        "window.PEBBLE_PUZZLES = " + json.dumps(data, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print("wrote", OUT)


if __name__ == "__main__":
    main()
