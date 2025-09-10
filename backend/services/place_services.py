import requests
import backend.config as config

def get_bus_stations(location="10.776,106.700", radius=3000):
    url = (
        f"{config.PLACES_URL}?location={location}"
        f"&radius={radius}&type=bus_station&key={config.GOOGLE_MAPS_API_KEY}"
    )
    try:
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        response = resp.json()
    except Exception:
        return []

    stations = []
    for place in response.get("results", []):
        try:
            stations.append({
                "id": place["place_id"],
                "name": place.get("name"),
                "lat": float(place["geometry"]["location"]["lat"]),
                "lng": float(place["geometry"]["location"]["lng"])
            })
        except Exception:
            pass
    return stations