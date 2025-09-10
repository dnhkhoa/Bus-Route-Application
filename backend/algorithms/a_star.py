# backend/algorithms/a_star.py
from typing import Dict, Tuple, List, Optional
import heapq, math, time

INF = float("inf")

def _haversine(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    R = 6371000.0
    from math import radians, sin, cos, sqrt, atan2
    (lat1, lon1), (lat2, lon2) = a, b
    dlat = radians(lat2 - lat1); dlon = radians(lon2 - lon1)
    A = sin(dlat/2)**2 + cos(radians(lat1))*cos(radians(lat2))*sin(dlon/2)**2
    return 2 * R * atan2(math.sqrt(A), math.sqrt(1-A))

def a_star(
    graph: Dict[str, Dict[str, float]],
    positions: Dict[str, Tuple[float, float]],
    start: str,
    goal: str,
    weight: str = "distance",   # 'distance'(m) | 'duration'(s)
    speed_mps: float = 10.0,    # dùng cho heuristic khi weight='duration'
) -> Dict:
    """
    A* trên đồ thị có trọng số.
    - Nếu weight='distance': h(n) = haversine(n, goal) (m)
    - Nếu weight='duration': h(n) = haversine(n, goal)/speed_mps (s)
    Trả: {best_path, best_cost, expanded, runtime_ms, found}
    """
    t0 = time.perf_counter()

    def h(n: str) -> float:
        d = _haversine(positions[n], positions[goal])
        return d if weight == "distance" else d / max(1e-6, speed_mps)

    openpq: List[Tuple[float, str]] = []
    heapq.heappush(openpq, (h(start), start))

    g = {start: 0.0}
    came = {}
    expanded = 0
    closed = set()

    while openpq:
        _, u = heapq.heappop(openpq)
        if u in closed: 
            continue
        closed.add(u)
        expanded += 1
        if u == goal:
            break

        for v, w in graph.get(u, {}).items():
            alt = g[u] + float(w)
            if alt < g.get(v, INF):
                g[v] = alt
                came[v] = u
                f = alt + h(v)
                heapq.heappush(openpq, (f, v))

    # reconstruct
    path: List[str] = []
    if goal in g:
        cur = goal
        while cur != start:
            path.append(cur)
            cur = came[cur]
        path.append(start)
        path.reverse()

    dt = (time.perf_counter() - t0) * 1000.0
    return {
        "start": start,
        "goal": goal,
        "best_path": path,
        "best_cost": g.get(goal, None),
        "expanded": expanded,
        "runtime_ms": round(dt, 3),
        "found": bool(path and path[-1] == goal),
    }
