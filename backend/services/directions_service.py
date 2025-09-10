# backend/services/directions_service.py
import requests
import backend.config as config

def _decode_polyline(encoded: str):
    points, index, lat, lng = [], 0, 0, 0
    while index < len(encoded):
        result, shift = 0, 0
        while True:
            b = ord(encoded[index]) - 63; index += 1
            result |= (b & 0x1f) << shift; shift += 5
            if b < 0x20: break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1); lat += dlat
        result, shift = 0, 0
        while True:
            b = ord(encoded[index]) - 63; index += 1
            result |= (b & 0x1f) << shift; shift += 5
            if b < 0x20: break
        dlng = ~(result >> 1) if (result & 1) else (result >> 1); lng += dlng
        points.append({"lat": lat/1e5, "lng": lng/1e5})
    return points

def directions_polyline_for_path(best_path_ids, id2node):
    if not config.has_api_key() or len(best_path_ids) < 2:
        return None
    origin = id2node[best_path_ids[0]]
    dest   = id2node[best_path_ids[-1]]
    w_ids = best_path_ids[1:-1]
    params = {
        "origin": f"{origin['lat']},{origin['lng']}",
        "destination": f"{dest['lat']},{dest['lng']}",
        "mode": "driving",
        "key": config.GOOGLE_MAPS_API_KEY,
    }
    if w_ids:
        params["waypoints"] = "|".join([f"{id2node[i]['lat']},{id2node[i]['lng']}" for i in w_ids])
    try:
        r = requests.get(config.DIRECTIONS_URL, params=params, timeout=5)
        r.raise_for_status()
        routes = r.json().get("routes", [])
        if not routes: return None
        enc = routes[0]["overview_polyline"]["points"]
        return {"encoded": enc, "coords": _decode_polyline(enc)}
    except Exception:
        return None
