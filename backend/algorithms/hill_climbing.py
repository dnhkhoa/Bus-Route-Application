# backend/algorithms/hill_climbing.py
from typing import Dict, Tuple, List, Optional
import math, time

INF = float("inf")

def _haversine(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    R = 6371000.0
    from math import radians, sin, cos, sqrt, atan2
    (lat1, lon1), (lat2, lon2) = a, b
    dlat = radians(lat2 - lat1); dlon = radians(lon2 - lon1)
    A = sin(dlat/2)**2 + cos(radians(lat1))*cos(radians(lat2))*sin(dlon/2)**2
    return 2 * R * atan2(math.sqrt(A), math.sqrt(1-A))

def _path_cost(path: List[str], graph: Dict[str, Dict[str, float]]) -> float:
    if not path or len(path) == 1: return 0.0
    total = 0.0
    for u, v in zip(path, path[1:]):
        w = graph.get(u, {}).get(v)
        if w is None: return INF
        total += w
    return total

def _greedy_walk(
    start: str, goal: str,
    graph: Dict[str, Dict[str, float]],
    positions: Dict[str, Tuple[float, float]],
    max_steps: int = 200,
    allow_sideways: int = 3,
) -> List[str]:
    cur = start; path = [cur]; visited = {cur}; sideways = 0
    for _ in range(max_steps):
        if cur == goal: break
        neighs = list(graph.get(cur, {}).items())
        if not neighs: break
        # chọn neighbor có w + heuristic nhỏ nhất
        best_v, best_f = None, float("inf")
        cur_h = _haversine(positions[cur], positions[goal])
        for v, w in neighs:
            f = float(w) + _haversine(positions[v], positions[goal])
            if f < best_f:
                best_f, best_v = f, v
        if best_v is None or best_v in visited: break
        improved = best_f < (cur_h + 1e-9)
        if not improved:
            if sideways >= allow_sideways: break
            sideways += 1
        cur = best_v; visited.add(cur); path.append(cur)
    return path

def hill_climbing(
    graph: Dict[str, Dict[str, float]],
    start: str,
    goal: str,
    positions: Dict[str, Tuple[float, float]],
    max_steps: Optional[int] = None,
    restarts: int = 5,
    allow_sideways: int = 3,
    max_iters: Optional[int] = None,  # alias
    **kwargs,
) -> Dict:
    _max_steps = max_steps if max_steps is not None else (max_iters if max_iters is not None else 200)
    t0 = time.perf_counter()
    best_path: List[str] = []; best_cost = INF; attempts = []; expanded = 0

    for r in range(restarts):
        p = _greedy_walk(start, goal, graph, positions, max_steps=_max_steps, allow_sideways=allow_sideways)
        c = _path_cost(p, graph)
        attempts.append({"restart": r, "path": p, "cost": None if c == INF else c})
        if c < best_cost:
            best_cost, best_path = c, p
        expanded += max(0, len(p)-1)

    dt = (time.perf_counter() - t0) * 1000.0
    return {
        "start": start,
        "goal": goal,
        "best_path": best_path,
        "best_cost": None if best_cost == INF else best_cost,
        "attempts": attempts,
        "expanded": expanded,             # ước lượng số bước/đỉnh đã duyệt
        "runtime_ms": round(dt, 3),
        "found": bool(best_path and best_path[-1] == goal),
    }
