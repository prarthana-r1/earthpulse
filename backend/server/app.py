# server/app.py
from dotenv import load_dotenv
load_dotenv()
import sys
import os

# Add earthpulse_ml folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../ml_service/earthpulse_ml")))

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import tensorflow as tf
import pandas as pd
import numpy as np
import os
from openmeteo_client import fetch_realtime
from feature_engineering import add_lagged_aggregates, select_features
from datetime import datetime, timezone

# --- Config ---
OPENWEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")
OPENWEATHER_ONECALL = "https://api.openweathermap.org/data/2.5/onecall"
OPENWEATHER_GEOCODE = "https://api.openweathermap.org/geo/1.0/direct"

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
DEFAULT_FLOOD_MODEL = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../ml_service/models/flood_model.keras"))
DEFAULT_WILDFIRE_MODEL = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../ml_service/models/wildfire_model.keras"))


# --- Helpers ---
def deg_to_compass(deg: float) -> str:
    dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
            "S","SSW","SW","WSW","W","WNW","NW","NNW"]
    ix = int((deg/22.5)+0.5) % 16
    return dirs[ix]

def geocode_city(city: str, country: str|None = "India"):
    q = f"{city}, {country}" if country else city
    r = requests.get(GEOCODE_URL, params={"name": q, "count": 1, "language": "en", "format": "json"}, timeout=10)
    r.raise_for_status()
    data = r.json()
    if "results" not in data or not data["results"]:
        raise ValueError(f"Could not geocode '{city}'")
    res = data["results"][0]
    return float(res["latitude"]), float(res["longitude"])

def load_model_and_features(model_path: str):
    model = tf.keras.models.load_model(model_path)
    feat_file = model_path + ".features.txt"
    if os.path.exists(feat_file):
        with open(feat_file, "r") as f:
            feat_cols = [l.strip() for l in f if l.strip()]
    else:
        feat_cols = []
    return model, feat_cols

def prepare_features_for_model(lat, lon, model_feats):
    # fetch realtime hourly data (pandas.DataFrame indexed by time)
    wx = fetch_realtime(lat, lon, timezone_name="auto")
    wx_eng = add_lagged_aggregates(wx)
    feats = select_features(wx_eng).fillna(0.0)
    # final row only (latest)
    if feats.shape[0] == 0:
        # no features available -> return zeros for model_feats
        return pd.DataFrame([ {c: 0.0 for c in model_feats} ])
    last = feats.iloc[[-1]].copy()
    # ensure all required features exist
    aligned = last.reindex(columns=model_feats, fill_value=0.0)
    return aligned

# --- App ---
app = Flask("earthpulse_api")
CORS(app)

# Load models once
FLOOD_MODEL, FLOOD_FEATS = load_model_and_features(DEFAULT_FLOOD_MODEL)
WILDFIRE_MODEL, WILDFIRE_FEATS = load_model_and_features(DEFAULT_WILDFIRE_MODEL)

@app.get("/health")
def health():
    return {"status": "ok", "flood_model_loaded": bool(FLOOD_FEATS), "wildfire_model_loaded": bool(WILDFIRE_FEATS)}

@app.get("/predict")
def predict():
    """
    Query parameters:
      - city=Name  OR lat=..&lon=..
      - optional: flood_model, wildfire_model (paths)
    """
    city = request.args.get("city")
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)

    # resolve coords
    if city:
        try:
            lat, lon = geocode_city(city)
        except Exception as e:
            return jsonify({"error": str(e)}), 400
    else:
        if lat is None or lon is None:
            return jsonify({"error": "Provide --city or (lat & lon)"}), 400

    # prepare features and predict
    X_flood = prepare_features_for_model(lat, lon, FLOOD_FEATS).values.astype("float32")
    X_fire = prepare_features_for_model(lat, lon, WILDFIRE_FEATS).values.astype("float32")

    flood_prob = float(FLOOD_MODEL.predict(X_flood, verbose=0)[0][0]) if FLOOD_FEATS else None
    fire_prob = float(WILDFIRE_MODEL.predict(X_fire, verbose=0)[0][0]) if WILDFIRE_FEATS else None

    flood_label = "High" if (flood_prob is not None and flood_prob >= 0.5) else "Low"
    fire_label = "High" if (fire_prob is not None and fire_prob >= 0.5) else "Low"

    # Also return latest raw weather snapshot for convenience
    wx = fetch_realtime(lat, lon, timezone_name="auto")
    latest_weather = wx.iloc[-1].to_dict() if wx.shape[0] else {}

    out = {
        "city": city if city else f"{lat},{lon}",
        "coordinates": {"latitude": lat, "longitude": lon},
        "weather": latest_weather,
        "wildfire": {"probability": fire_prob, "label": fire_label},
        "flood": {"probability": flood_prob, "label": flood_label}
    }
    return jsonify(out)


def fetch_openweather(city: str):
    if not OPENWEATHER_API_KEY:
        raise RuntimeError("WEATHER_API_KEY is not set")

    # Current weather
    current_url = "https://api.openweathermap.org/data/2.5/weather"
    forecast_url = "https://api.openweathermap.org/data/2.5/forecast"

    params = {"q": city, "appid": OPENWEATHER_API_KEY, "units": "metric"}

    cur = requests.get(current_url, params=params, timeout=10)
    cur.raise_for_status()
    current = cur.json()

    fc = requests.get(forecast_url, params=params, timeout=10)
    fc.raise_for_status()
    forecast = fc.json()

    return current, forecast


def geocode_openweather_city(city: str, country: str|None="India"):
    lat, lon = geocode_city(city, country)
    return lat, lon

def map_openweather_to_frontend(city: str, lat: float, lon: float, ow: dict):
    # helpers
    def safe(d, k, default=None):
        if isinstance(d, dict):
            return d.get(k, default)
        return default

    cur = ow.get("current", {})
    weather_desc = safe((cur.get("weather") or [{}])[0], "description", "N/A")
    if isinstance(weather_desc, str):
        weather_desc = weather_desc.title()

    wind_kph = float(cur.get("wind_speed", 0.0)) * 3.6
    vis_km = float(cur.get("visibility", 10000))/1000.0 if cur.get("visibility") is not None else None

    # Hourly 24h
    hourly = []
    for h in (ow.get("hourly") or [])[:24]:
        dt = datetime.fromtimestamp(h.get("dt", 0), tz=timezone.utc).isoformat(sep=" ", timespec="minutes")
        precip = 0.0
        if isinstance(h.get("rain"), dict):
            precip += float(h["rain"].get("1h", 0.0))
        if isinstance(h.get("snow"), dict):
            precip += float(h["snow"].get("1h", 0.0))
        hourly.append({
            "time": dt,
            "temp_c": h.get("temp"),
            "condition": {
                "text": safe((h.get("weather") or [{}])[0], "description", "").title() if (h.get("weather") or [{}])[0] else "",
                "icon": ""
            },
            "wind_kph": float(h.get("wind_speed", 0.0))*3.6,
            "wind_dir": deg_to_compass(float(h.get("wind_deg", 0.0))),
            "pressure_mb": h.get("pressure"),
            "precip_mm": precip,
            "humidity": h.get("humidity"),
            "cloud": h.get("clouds"),
            "feelslike_c": h.get("feels_like"),
            "will_it_rain": 1 if float(h.get("pop", 0.0)) >= 0.5 else 0,
            "chance_of_rain": int(round(float(h.get("pop", 0.0))*100))
        })

    # Daily 7d
    daily = []
    for d in (ow.get("daily") or [])[:7]:
        precip = 0.0
        if isinstance(d.get("rain"), (int, float)):
            precip += float(d.get("rain"))
        if isinstance(d.get("snow"), (int, float)):
            precip += float(d.get("snow"))
        daily.append({
            "date": datetime.fromtimestamp(d.get("dt", 0), tz=timezone.utc).date().isoformat(),
            "day": {
                "maxtemp_c": safe(d.get("temp", {}), "max"),
                "mintemp_c": safe(d.get("temp", {}), "min"),
                "condition": {
                    "text": safe((d.get("weather") or [{}])[0], "main", "").title() if (d.get("weather") or [{}])[0] else "",
                    "icon": ""
                },
                "maxwind_kph": float(d.get("wind_speed", 0.0))*3.6,
                "totalprecip_mm": precip,
                "avghumidity": d.get("humidity"),
                "daily_chance_of_rain": int(round(float(d.get("pop", 0.0))*100)),
                "avgvis_km": None,
                "uv": d.get("uvi")
            },
            "hour": []
        })

    payload = {
        "location": {
            "name": city,
            "country": "",
            "lat": lat,
            "lon": lon
        },
        "current": {
            "temp_c": cur.get("temp"),
            "temp_f": (cur.get("temp")*9/5 + 32) if cur.get("temp") is not None else None,
            "condition": { "text": weather_desc, "icon": "" },
            "wind_kph": wind_kph,
            "wind_dir": deg_to_compass(float(cur.get("wind_deg", 0.0))),
            "pressure_mb": cur.get("pressure"),
            "precip_mm": (cur.get("rain", {}).get("1h", 0.0) if isinstance(cur.get("rain"), dict) else 0.0) +                              (cur.get("snow", {}).get("1h", 0.0) if isinstance(cur.get("snow"), dict) else 0.0),
            "humidity": cur.get("humidity"),
            "cloud": cur.get("clouds"),
            "feelslike_c": cur.get("feels_like"),
            "vis_km": vis_km,
            "uv": cur.get("uvi"),
            "gust_kph": float(cur.get("wind_gust", 0.0))*3.6 if cur.get("wind_gust") is not None else None
        },
        "forecast": {
            "forecastday": daily
        }
    }
    if payload["forecast"]["forecastday"]:
        payload["forecast"]["forecastday"][0]["hour"] = hourly
    return payload


@app.route("/weather", methods=["GET"])
def weather():
    city = request.args.get("city")
    if not city:
        return jsonify({"error": "Provide ?city=Name"}), 400

    try:
        cur, fc = fetch_openweather(city)

        # Current
        cur_data = {
            "temp_c": cur["main"]["temp"],
            "temp_f": cur["main"]["temp"] * 9/5 + 32,
            "condition": {
                "text": cur["weather"][0]["description"].title(),
                "icon": f"http://openweathermap.org/img/wn/{cur['weather'][0]['icon']}@2x.png"
            },
            "wind_kph": cur["wind"]["speed"] * 3.6,
            "wind_dir": deg_to_compass(cur["wind"]["deg"]),
            "pressure_mb": cur["main"]["pressure"],
            "humidity": cur["main"]["humidity"],
            "cloud": cur["clouds"]["all"],
            "feelslike_c": cur["main"]["feels_like"],
            "vis_km": cur.get("visibility", 10000) / 1000.0,
        }

        # Forecast → group by day
        daily = {}
        for entry in fc["list"]:
            dt = datetime.fromtimestamp(entry["dt"], tz=timezone.utc)
            day = dt.date().isoformat()
            if day not in daily:
                daily[day] = {
                    "date": day,
                    "day": {
                        "maxtemp_c": entry["main"]["temp_max"],
                        "mintemp_c": entry["main"]["temp_min"],
                        "condition": {
                            "text": entry["weather"][0]["description"].title(),
                            "icon": f"http://openweathermap.org/img/wn/{entry['weather'][0]['icon']}@2x.png"
                        },
                        "maxwind_kph": entry["wind"]["speed"] * 3.6,
                        "totalprecip_mm": entry.get("rain", {}).get("3h", 0.0),
                        "avghumidity": entry["main"]["humidity"],
                        "daily_chance_of_rain": int(entry.get("pop", 0.0) * 100),
                        "avgvis_km": entry.get("visibility", 10000) / 1000.0,
                        "uv": None,
                    },
                    "hour": []
                }

            daily[day]["hour"].append({
                "time": dt.isoformat(sep=" ", timespec="minutes"),
                "temp_c": entry["main"]["temp"],
                "condition": {
                    "text": entry["weather"][0]["description"].title(),
                    "icon": f"http://openweathermap.org/img/wn/{entry['weather'][0]['icon']}@2x.png"
                },
                "wind_kph": entry["wind"]["speed"] * 3.6,
                "wind_dir": deg_to_compass(entry["wind"]["deg"]),
                "pressure_mb": entry["main"]["pressure"],
                "precip_mm": entry.get("rain", {}).get("3h", 0.0),
                "humidity": entry["main"]["humidity"],
                "cloud": entry["clouds"]["all"],
                "feelslike_c": entry["main"]["feels_like"],
                "will_it_rain": 1 if entry.get("pop", 0.0) >= 0.5 else 0,
                "chance_of_rain": int(entry.get("pop", 0.0) * 100)
            })

        forecastdays = list(daily.values())[:7]

        payload = {
            "location": {"name": city, "country": cur["sys"]["country"]},
            "current": cur_data,
            "forecast": {"forecastday": forecastdays}
        }

        return jsonify(payload)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)



