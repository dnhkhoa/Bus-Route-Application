from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))


GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
print("API Key:", GOOGLE_MAPS_API_KEY)
print("Current working dir:", os.getcwd())


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


PLACES_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"
DIST_MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json"


HCM_BBOX = {
    "lat_min": 10.376,
    "lat_max": 11.160,
    "lon_min": 106.361,
    "lon_max": 107.020
}


def has_api_key():
    return bool(GOOGLE_MAPS_API_KEY)
print(has_api_key())  