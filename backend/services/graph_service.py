# backend/services/graph_service.py
import requests, math
import backend.config as config

def build_graph(stations):
    if len(stations) < 2:
        return {}

    origins = "|".join([f"{s['lat']},{s['lng']}" for s in stations])
    url = (
        f"{config.DIST_MATRIX_URL}?origins={origins}&destinations={origins}"
        f"&mode=driving&key={config.GOOGLE_MAPS_API_KEY}"
    )
    try:
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        response = resp.json()
    except Exception:
        return {}

    rows = response.get("rows", [])
    if len(rows) != len(stations):
        return {}

    graph = {}
    for i, s in enumerate(stations):
        graph[s["id"]] = {}
        elements = rows[i].get("elements", [])
        for j, t in enumerate(stations):
            if i == j: 
                continue
            try:
                distance = elements[j]["distance"]["value"]
                graph[s["id"]][t["id"]] = float(distance)
            except Exception:
                # thiếu ô hoặc API trả status khác => bỏ qua
                pass
    return graph

# ---- OFFLINE fallback ----
def _haversine(lat1, lon1, lat2, lon2):
    R = 6371000.0
    from math import radians, sin, cos, sqrt, atan2
    dlat = radians(lat2 - lat1); dlon = radians(lon2 - lon1)
    A = sin(dlat/2)**2 + cos(radians(lat1))*cos(radians(lat2))*sin(dlon/2)**2
    return 2 * R * atan2(math.sqrt(A), math.sqrt(1-A))

def build_graph_offline(stations):
    graph = {}
    for i, s in enumerate(stations):
        u = s["id"]; graph[u] = {}
        for j, t in enumerate(stations):
            if i == j: continue
            graph[u][t["id"]] = float(_haversine(s["lat"], s["lng"], t["lat"], t["lng"]))
    return graph

def positions_map(stations):
    return {s["id"]: (float(s["lat"]), float(s["lng"])) for s in stations}
