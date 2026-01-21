from __future__ import annotations
import os
import requests
from datetime import datetime
import pandas as pd
import numpy as np
import tensorflow as tf
from earthpulse_ml.openmeteo_client import fetch_realtime
from earthpulse_ml.feature_engineering import add_lagged_aggregates, select_features

# Initial city → Lat/Lon mapping
CITY_COORDS = {
    "Delhi": (28.6139, 77.2090),
    "Mumbai": (19.0760, 72.8777),
    "California": (36.7783, -119.4179)
}

def geocode_city(city: str) -> tuple[float, float]:
    """Fetch coordinates dynamically using Open-Meteo Geocoding API."""
    url = "https://geocoding-api.open-meteo.com/v1/search"
    resp = requests.get(url, params={"name": city, "count": 1, "language": "en", "format": "json"})
    if resp.status_code != 200:
        raise ValueError(f"Failed to geocode city '{city}' (status {resp.status_code})")
    data = resp.json()
    if "results" not in data or not data["results"]:
        raise ValueError(f"No coordinates found for city '{city}'")
    coords = data["results"][0]
    return coords["latitude"], coords["longitude"]

def load_model(model_path: str):
    model = tf.keras.models.load_model(model_path)
    feat_file = model_path + ".features.txt"
    with open(feat_file, "r") as f:
        feat_cols = [line.strip() for line in f if line.strip()]
    return model, feat_cols

def _prepare_features(lat: float, lon: float) -> tuple[pd.DataFrame, dict]:
    wx = fetch_realtime(lat, lon, timezone_name="auto")
    wx_eng = add_lagged_aggregates(wx)
    feats = select_features(wx_eng).fillna(0.0)
    # Latest weather snapshot for output
    row = wx.iloc[-1].to_dict()
    latest_weather = {
        **row,
        "precip_mm": row.get("precipitation", 0.0),
        "rain_mm": row.get("rain", 0.0)
    }

    return feats.iloc[[-1]], latest_weather

def predict_risks(city: str | None, lat: float | None, lon: float | None,
                  flood_model_path: str, wildfire_model_path: str):
    # Resolve coordinates
    if city:
        if city in CITY_COORDS:
            lat, lon = CITY_COORDS[city]
        else:
            print(f"ℹ️ City '{city}' not in local mapping, fetching coordinates...")
            lat, lon = geocode_city(city)
            CITY_COORDS[city] = (lat, lon)  # Cache for future use
    elif lat is None or lon is None:
        raise ValueError("Either --city or both --lat and --lon must be provided")

    # Load models & features
    flood_model, flood_feats = load_model(flood_model_path)
    fire_model, fire_feats = load_model(wildfire_model_path)
    feats, weather_snapshot = _prepare_features(lat, lon)

    # Feature alignment
    X_flood = feats.reindex(columns=flood_feats, fill_value=0.0).values.astype("float32")
    X_fire = feats.reindex(columns=fire_feats, fill_value=0.0).values.astype("float32")

    flood_prob = float(flood_model.predict(X_flood, verbose=0)[0][0])
    fire_prob = float(fire_model.predict(X_fire, verbose=0)[0][0])

    flood_label = "High" if flood_prob >= 0.5 else "Low"
    wildfire_label = "High" if fire_prob >= 0.5 else "Low"

    return {
        "city": city if city else f"{lat},{lon}",
        "coordinates": {"latitude": lat, "longitude": lon},
        "weather": weather_snapshot,
        "wildfire": {"probability": fire_prob, "label": wildfire_label},
        "flood": {"probability": flood_prob, "label": flood_label}
    }

if __name__ == "__main__":
    import argparse, json
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", help="City name (preferred)")
    ap.add_argument("--lat", type=float, help="Latitude (fallback)")
    ap.add_argument("--lon", type=float, help="Longitude (fallback)")
    ap.add_argument("--flood_model", required=True)
    ap.add_argument("--wildfire_model", required=True)
    args = ap.parse_args()

    result = predict_risks(args.city, args.lat, args.lon,
                           args.flood_model, args.wildfire_model)
    print(json.dumps(result, indent=2))
