from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Tuple

# Local imports (support both package and direct run)
try:
    from backend.algorithms.hill_climbing import hill_climbing
    from backend.algorithms.a_star import a_star
    from backend.services.graph_service import build_graph, build_graph_offline, positions_map
    from backend.services.place_services import get_bus_stations
    from backend.services.directions_service import directions_polyline_for_path
    import backend.config as config
except Exception:
    from algorithms.hill_climbing import hill_climbing  # type: ignore
    from algorithms.a_star import a_star  # type: ignore
    from services.graph_service import build_graph, build_graph_offline, positions_map  # type: ignore
    from services.place_services import get_bus_stations  # type: ignore
    from services.directions_service import directions_polyline_for_path  # type: ignore
    import config as config  # type: ignore

app = FastAPI(title="Bus Route HC & A* API", version="2.2.0")

# CORS (allow all for local testing)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== Schemas =====
class Station(BaseModel):
    id: str
    name: Optional[str] = None
    lat: float
    lng: float

class LiveRequest(BaseModel):
    start_lat: float
    start_lng: float
    goal_lat: float
    goal_lng: float
    radius: int = Field(3000, description="Search radius (meters) for nearby stations (both start & goal areas)")
    restarts: int = Field(5, description="Random restarts for Hill Climbing")
    max_steps: int = Field(2000, description="Max steps for Hill Climbing")
    speed_mps: float = Field(1.2, description="Walking speed in meters/second")
    weight: str = Field("distance", description="Edge weight: 'distance' | 'time'")
    algorithm: str = Field("a_star", description="'hill_climbing' | 'a_star' | 'both'")
    with_directions: bool = Field(False, description="Include Google Directions polyline if API key configured")

# ===== Helpers =====
def _ensure_algorithm(name: str) -> str:
    n = (name or "").lower()
    if n not in {"hill_climbing", "a_star", "both"}:
        raise HTTPException(status_code=400, detail="algorithm must be 'hill_climbing', 'a_star', or 'both'")
    return n

def _closest_id(pos: Dict[str, Tuple[float, float]], lat: float, lng: float) -> str:
    import math
    best_id, best_d = None, float("inf")
    for k, (la, lo) in pos.items():
        d = (la - lat) ** 2 + (lo - lng) ** 2
        if d < best_d:
            best_id, best_d = k, d
    if best_id is None:
        raise HTTPException(status_code=404, detail="No station found to anchor start/goal")
    return best_id

def _with_geojson(result: Dict, stations: List[Dict]) -> Dict:
    id2node = {s["id"]: {"id": s["id"], "lat": float(s["lat"]), "lng": float(s["lng"]), "name": s.get("name")} for s in stations}
    path_ids: List[str] = result.get("best_path") or result.get("path") or []
    coords = [[id2node[i]["lng"], id2node[i]["lat"]] for i in path_ids if i in id2node]
    return {
        "nodes": id2node,
        "path_ids": path_ids,
        "path_geojson": {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"algorithm": result.get("algorithm"), "cost": result.get("best_cost") or result.get("cost")},
        },
        "cost": result.get("best_cost") or result.get("cost"),
        "expanded": result.get("expanded", 0),
        "runtime_ms": result.get("runtime_ms") or result.get("time_ms"),
        "found": result.get("found", True),
    }

def _bench_report(results: Dict[str, Dict]) -> Dict[str, Dict]:
    return {
        k: {
            "cost": v.get("best_cost") or v.get("cost"),
            "expanded": v.get("expanded", 0),
            "runtime_ms": v.get("runtime_ms") or v.get("time_ms"),
        }
        for k, v in results.items()
    }

def _run_hc(graph, pos, start_id, goal_id, restarts, max_steps, weight, speed_mps) -> Dict:
    out = hill_climbing(graph, pos, start_id, goal_id, restarts=restarts, max_steps=max_steps, weight=weight, speed_mps=speed_mps)
    out["algorithm"] = "hill_climbing"
    return out

def _run_astar(graph, pos, start_id, goal_id, weight, speed_mps) -> Dict:
    out = a_star(graph, pos, start_id, goal_id, weight=weight, speed_mps=speed_mps)
    out["algorithm"] = "a_star"
    return out

# ===== Routes =====

@app.get("/health")
def health():
    return {"ok": True, "version": app.version, "has_key": bool(getattr(config, "GOOGLE_MAPS_API_KEY", ""))}

@app.get("/stations", response_model=List[Station])
def stations(lat: float, lng: float, radius: int = 3000):
    try:
        items = get_bus_stations(lat, lng, radius)
        return [Station(id=i["id"], name=i.get("name"), lat=i["lat"], lng=i["lng"]) for i in items]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"stations error: {e}")

@app.post("/live")
def live(req: LiveRequest):
    algo = _ensure_algorithm(req.algorithm)

    # Collect stations around start and goal; merge & de-duplicate by id
    s_start = get_bus_stations(req.start_lat, req.start_lng, req.radius)
    s_goal  = get_bus_stations(req.goal_lat,  req.goal_lng,  req.radius)
    all_map: Dict[str, Dict] = {s["id"]: s for s in (s_start + s_goal)}
    stations: List[Dict] = list(all_map.values())

    if len(stations) < 2:
        raise HTTPException(status_code=404, detail="Not enough stations found")

    # Build graph & positions
    try:
        graph = build_graph(stations)
    except Exception:
        graph = build_graph_offline(stations)
    pos = positions_map(stations)

    # Pick closest nodes to start/goal
    start_id = _closest_id(pos, req.start_lat, req.start_lng)
    goal_id  = _closest_id(pos, req.goal_lat,  req.goal_lng)

    results: Dict[str, Dict] = {}
    if algo in {"hill_climbing", "both"}:
        results["hill_climbing"] = _run_hc(graph, pos, start_id, goal_id, req.restarts, req.max_steps, req.weight, req.speed_mps)
    if algo in {"a_star", "both"}:
        results["a_star"] = _run_astar(graph, pos, start_id, goal_id, req.weight, req.speed_mps)

    bench = _bench_report(results)
    primary_name = algo if algo != "both" else "a_star"
    primary = results.get(primary_name) or next(iter(results.values()))
    payload = _with_geojson(primary, stations)

    # Optional driving directions polyline
    if req.with_directions and getattr(config, "has_api_key", lambda: False)():
        try:
            direc = directions_polyline_for_path(primary.get("best_path", []), payload["nodes"])
            if direc:
                payload["directions"] = direc
        except Exception:
            pass

    payload["bench"] = bench
    payload["algorithm"] = primary_name
    payload["weight"] = req.weight
    payload["start_node"] = start_id
    payload["goal_node"]  = goal_id
    return payload

# Run: uvicorn backend.app:app --reload --port 8000
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app:app", host="0.0.0.0", port=8000, reload=True)
