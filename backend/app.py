# server/app.py
from dotenv import load_dotenv
load_dotenv()
import sys
import os
import json
import importlib
import time
import traceback
from io import BytesIO
from datetime import datetime, timezone, timedelta
import tempfile
import uuid

from flask import Flask, request, jsonify, send_file, current_app
from flask_cors import CORS
import requests

# Lazy pywebpush import helper (to avoid editor/static import errors)
PUSH_MODULE = None
PUSH_IMPORT_ERROR = None
PUSH_AVAILABLE = False

# Add earthpulse_ml folder to sys.path (unchanged)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../ml_service/earthpulse_ml")))

# Config / env
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
FAST2SMS_API_KEY = os.getenv("FAST2SMS_API_KEY")
ALERT_PHONE = os.getenv("ALERT_PHONE")
ML_API_URL = os.getenv("ML_API_URL")        # e.g. your HF space or inference endpoint
HF_TOKEN = os.getenv("HF_TOKEN")           # Bearer token for ML_API_URL (if required)

OPENWEATHER_API_KEY = os.environ.get("WEATHER_API_KEY", "")
OPENWEATHER_ONECALL = "https://api.openweathermap.org/data/2.5/onecall"
OPENWEATHER_GEOCODE = "https://api.openweathermap.org/geo/1.0/direct"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"

DEFAULT_FLOOD_MODEL = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../ml_service/models/flood_model.keras"))
DEFAULT_WILDFIRE_MODEL = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../ml_service/models/wildfire_model.keras"))

VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY')
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY')
VAPID_CLAIMS = {"sub": os.environ.get('VAPID_SUB', 'mailto:admin@example.com')}

# --- Optional ML / TF imports ---
TF_AVAILABLE = False
FLOOD_MODEL = None
WILDFIRE_MODEL = None
FLOOD_FEATS = []
WILDFIRE_FEATS = []

try:
    import tensorflow as tf  # optional
    TF_AVAILABLE = True
except Exception as e:
    tf = None
    TF_AVAILABLE = False

# Optional local ML helpers (openmeteo_client, feature_engineering)
OPENMETEO_AVAILABLE = False
FEATURE_ENG_AVAILABLE = False
fetch_realtime = None
add_lagged_aggregates = None
select_features = None

try:
    # these modules are expected to exist in ml_service/earthpulse_ml (you uploaded them)
    from openmeteo_client import fetch_realtime
    from feature_engineering import add_lagged_aggregates, select_features
    OPENMETEO_AVAILABLE = True
    FEATURE_ENG_AVAILABLE = True
except Exception as e:
    # Keep app working even if ML helper modules are not available locally
    fetch_realtime = None
    add_lagged_aggregates = None
    select_features = None
    OPENMETEO_AVAILABLE = False
    FEATURE_ENG_AVAILABLE = False

# Helper: attempt to import pywebpush only when needed
def ensure_push():
    global PUSH_MODULE, PUSH_IMPORT_ERROR, PUSH_AVAILABLE
    if PUSH_MODULE is not None or PUSH_IMPORT_ERROR is not None:
        return
    try:
        PUSH_MODULE = importlib.import_module('pywebpush')
        PUSH_AVAILABLE = True
        PUSH_IMPORT_ERROR = None
    except Exception as e:
        PUSH_MODULE = None
        PUSH_AVAILABLE = False
        PUSH_IMPORT_ERROR = str(e)

# Helper: call external ML server (HuggingFace space / inference endpoint)
def call_ml_server(city=None, lat=None, lon=None):
    """
    POST to ML_API_URL (expected to return JSON like:
      { "flood": {"probability": 0.12}, "wildfire": {"probability": 0.05}, ... }
    """
    if not ML_API_URL:
        raise RuntimeError("ML_API_URL not configured (set ML_API_URL env var)")

    url = ML_API_URL.rstrip("/") + "/predict"
    headers = {}
    if HF_TOKEN:
        headers["Authorization"] = f"Bearer {HF_TOKEN}"

    payload = {}
    if city:
        payload["city"] = city
    if lat is not None and lon is not None:
        payload["lat"] = float(lat)
        payload["lon"] = float(lon)

    # Use requests with reasonable timeout and propagate errors
    r = requests.post(url, json=payload, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()

# Attempt to load TF models only if TF is available and files exist
def load_model_and_features_if_possible(model_path: str):
    """
    Returns (model_or_None, feature_list)
    """
    if not TF_AVAILABLE:
        return None, []
    try:
        if not os.path.exists(model_path):
            return None, []
        # Use tensorflow to load model
        model = tf.keras.models.load_model(model_path)
        feat_file = model_path + ".features.txt"
        feat_cols = []
        if os.path.exists(feat_file):
            with open(feat_file, "r") as f:
                feat_cols = [l.strip() for l in f if l.strip()]
        return model, feat_cols
    except Exception as e:
        # Don't crash app if model load fails
        print(f"Warning: failed to load model {model_path}: {e}")
        return None, []

# Load (optional) models at startup
FLOOD_MODEL, FLOOD_FEATS = load_model_and_features_if_possible(DEFAULT_FLOOD_MODEL)
WILDFIRE_MODEL, WILDFIRE_FEATS = load_model_and_features_if_possible(DEFAULT_WILDFIRE_MODEL)

# --- Feature preparation (uses local openmeteo_client + feature_engineering if available)
import pandas as pd
import numpy as np

def prepare_features_for_model(lat, lon, model_feats):
    """
    Returns a DataFrame with one row aligned to model_feats.
    If local openmeteo/feature_engineering is not available, returns zeros.
    """
    # If feature list empty, return zeros
    if not model_feats:
        return pd.DataFrame([ {c: 0.0 for c in model_feats} ])  # empty -> empty df

    if not OPENMETEO_AVAILABLE or not FEATURE_ENG_AVAILABLE:
        # can't compute features locally -> return zeros
        return pd.DataFrame([ {c: 0.0 for c in model_feats} ])

    try:
        wx = fetch_realtime(lat, lon, timezone_name="auto")
        wx_eng = add_lagged_aggregates(wx)
        feats = select_features(wx_eng).fillna(0.0)
        if feats.shape[0] == 0:
            return pd.DataFrame([ {c: 0.0 for c in model_feats} ])
        last = feats.iloc[[-1]].copy()
        aligned = last.reindex(columns=model_feats, fill_value=0.0)
        return aligned
    except Exception as e:
        print("prepare_features_for_model error:", e)
        return pd.DataFrame([ {c: 0.0 for c in model_feats} ])

# --- Flask app init ---
app = Flask("earthpulse_api")
CORS(app)

# Web push subscription store (in-memory)
SUBSCRIPTIONS = []

# --- Push endpoints (unchanged, but resilient) ---
@app.get('/vapid_public_key')
def vapid_public():
    ensure_push()
    if not PUSH_AVAILABLE:
        return jsonify({"error": "pywebpush not available", "details": PUSH_IMPORT_ERROR}), 500
    if not VAPID_PUBLIC_KEY:
        return jsonify({"error": "VAPID_PUBLIC_KEY not set"}), 500
    return jsonify({"publicKey": VAPID_PUBLIC_KEY})

@app.post('/subscribe')
def subscribe():
    ensure_push()
    if not PUSH_AVAILABLE:
        return jsonify({"error": "pywebpush not available", "details": PUSH_IMPORT_ERROR}), 500
    data = request.get_json() or {}
    sub = data.get('subscription')
    if not sub:
        return jsonify({"error": "subscription missing"}), 400

    try:
        endpoint = sub.get('endpoint') if isinstance(sub, dict) else None
    except Exception:
        endpoint = None

    if endpoint:
        SUBSCRIPTIONS[:] = [s for s in SUBSCRIPTIONS if not (isinstance(s, dict) and s.get('endpoint') == endpoint)]
        SUBSCRIPTIONS.append(sub)
    else:
        if sub not in SUBSCRIPTIONS:
            SUBSCRIPTIONS.append(sub)
    return jsonify({"status": "ok"})

@app.get('/push/subscriptions')
def push_subscriptions():
    try:
        return jsonify({"count": len(SUBSCRIPTIONS), "subscriptions": SUBSCRIPTIONS})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post('/push/test')
def push_test():
    payload = request.get_json() or {}
    title = payload.get('title', 'Test Alert')
    body = payload.get('body', 'This is a test push')
    sent = 0
    errors = []
    ensure_push()
    if not PUSH_AVAILABLE:
        return jsonify({"error": "pywebpush not available", "details": PUSH_IMPORT_ERROR}), 500
    if not VAPID_PRIVATE_KEY:
        return jsonify({"error": "VAPID_PRIVATE_KEY not set"}), 500
    for sub in list(SUBSCRIPTIONS):
        try:
            ensure_push()
            PUSH_MODULE.webpush(
                subscription_info=sub,
                data=json.dumps({"title": title, "body": body}),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
            sent += 1
        except Exception as ex:
            errors.append(str(ex))
    return jsonify({"sent": sent, "errors": errors})

# --- Health endpoint ---
@app.get("/health")
def health():
    return {
        "status": "ok",
        "tf_available": TF_AVAILABLE,
        "openmeteo_local_available": OPENMETEO_AVAILABLE and FEATURE_ENG_AVAILABLE,
        "flood_model_loaded": bool(FLOOD_FEATS and FLOOD_MODEL),
        "wildfire_model_loaded": bool(WILDFIRE_FEATS and WILDFIRE_MODEL),
        "ml_api_url": bool(ML_API_URL)
    }

# --- Geocoding helper (open-meteo geocoding) ---
def geocode_city(city: str, country: str|None = "India"):
    q = f"{city}, {country}" if country else city
    r = requests.get(GEOCODE_URL, params={"name": q, "count": 1, "language": "en", "format": "json"}, timeout=10)
    r.raise_for_status()
    data = r.json()
    if "results" not in data or not data["results"]:
        raise ValueError(f"Could not geocode '{city}'")
    res = data["results"][0]
    return float(res["latitude"]), float(res["longitude"])

# --- Core predict endpoint (uses local models if available, else HF) ---
@app.get("/predict")
def predict():
    """
    Query parameters:
      - city=Name  OR lat=..&lon=..
      - use_hf=true -> force use HuggingFace ML API
    """
    city = request.args.get("city")
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    use_hf = request.args.get("use_hf")

    # If use_hf=true -> force HF
    if use_hf == "true":
        try:
            return jsonify(call_ml_server(city=city, lat=lat, lon=lon))
        except Exception as e:
            return jsonify({"error": f"HuggingFace error: {str(e)}"}), 500

    # resolve coordinates
    if city:
        if city.strip().lower() == 'floodville':
            lat, lon = 12.9716, 77.5946
        else:
            try:
                lat, lon = geocode_city(city)
            except Exception as e:
                return jsonify({"error": str(e)}), 400
    else:
        if lat is None or lon is None:
            return jsonify({"error": "Provide --city or (lat & lon)"}), 400

    # If floodville -> canned values
    if city and city.strip().lower() == 'floodville':
        flood_prob = 0.95
        fire_prob = 0.05
    else:
        # If local models available and TF present -> use them
        if TF_AVAILABLE and FLOOD_MODEL and WILDFIRE_MODEL and FLOOD_FEATS and WILDFIRE_FEATS:
            try:
                X_flood = prepare_features_for_model(lat, lon, FLOOD_FEATS).values.astype("float32")
                X_fire = prepare_features_for_model(lat, lon, WILDFIRE_FEATS).values.astype("float32")

                flood_prob = float(FLOOD_MODEL.predict(X_flood, verbose=0)[0][0])
                fire_prob  = float(WILDFIRE_MODEL.predict(X_fire, verbose=0)[0][0])
            except Exception as e:
                # If local model prediction fails, fallback to HF
                app.logger.exception("Local TF predict failed, falling back to HF: %s", e)
                try:
                    hf_result = call_ml_server(city=city, lat=lat, lon=lon)
                    flood_prob = (hf_result.get("flood") or {}).get("probability")
                    fire_prob = (hf_result.get("wildfire") or {}).get("probability")
                except Exception as ex:
                    return jsonify({"error": f"HuggingFace fallback error: {str(ex)}"}), 500
        else:
            # Fallback to HuggingFace ML API
            try:
                hf_result = call_ml_server(city=city, lat=lat, lon=lon)
                flood_prob = (hf_result.get("flood") or {}).get("probability")
                fire_prob = (hf_result.get("wildfire") or {}).get("probability")
            except Exception as e:
                return jsonify({"error": f"HuggingFace error: {str(e)}"}), 500

    # normalize probabilities (ensure numeric or None)
    try:
        flood_prob = float(flood_prob) if flood_prob is not None else None
    except Exception:
        flood_prob = None
    try:
        fire_prob = float(fire_prob) if fire_prob is not None else None
    except Exception:
        fire_prob = None

    flood_label = "High" if (flood_prob is not None and flood_prob >= 0.5) else "Low"
    fire_label = "High" if (fire_prob is not None and fire_prob >= 0.5) else "Low"

    # latest weather snapshot - use local openmeteo if available else blank
    latest_weather = {}
    if city and city.strip().lower() == 'floodville':
        latest_weather = {
            "time": datetime.now(timezone.utc).isoformat(),
            "temp_c": 25.0,
            "humidity": 95.0,
            "precip": 20.0,
            "wind_kph": 10.0
        }
    else:
        if OPENMETEO_AVAILABLE and fetch_realtime:
            try:
                wx = fetch_realtime(lat, lon, timezone_name="auto")
                latest_weather = wx.iloc[-1].to_dict() if wx.shape[0] else {}
            except Exception as e:
                latest_weather = {}
        else:
            latest_weather = {}

    out = {
        "city": city if city else f"{lat},{lon}",
        "coordinates": {"latitude": lat, "longitude": lon},
        "weather": latest_weather,
        "wildfire": {"probability": fire_prob, "label": fire_label},
        "flood": {"probability": flood_prob, "label": flood_label},
    }
    return jsonify(out)

# ------------------------------
# Weather endpoints (unchanged)
# ------------------------------
def fetch_openweather(city: str):
    if not OPENWEATHER_API_KEY:
        raise RuntimeError("WEATHER_API_KEY is not set")

    current_url = "https://api.openweathermap.org/data/2.5/weather"
    forecast_url = "https://api.openweathermap.org/data/2.5/forecast"
    params = {"q": city, "appid": OPENWEATHER_API_KEY, "units": "metric"}

    cur = requests.get(current_url, params=params, timeout=10); cur.raise_for_status(); current = cur.json()
    fc = requests.get(forecast_url, params=params, timeout=10); fc.raise_for_status(); forecast = fc.json()
    return current, forecast

def deg_to_compass(deg: float) -> str:
    dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]
    ix = int((deg/22.5)+0.5) % 16
    return dirs[ix]

@app.route("/weather", methods=["GET"])
def weather():
    city = request.args.get("city")
    if not city:
        return jsonify({"error": "Provide ?city=Name"}), 400
    try:
        # Floodville canned dataset
        if city.strip().lower() == 'floodville':
            now = datetime.now(timezone.utc)
            hourly = []
            for h in range(24):
                t = now + timedelta(hours=h)
                hourly.append({
                    "time": t.isoformat(sep=' ', timespec='minutes'),
                    "temp_c": 24 + (h % 6),
                    "condition": {"text": "Heavy rain", "icon": ""},
                    "wind_kph": 12.0,
                    "wind_dir": deg_to_compass(180),
                    "pressure_mb": 1005,
                    "precip_mm": 8.0 + (h % 3),
                    "humidity": 90,
                    "cloud": 100,
                    "feelslike_c": 24.0
                })
            forecastdays = []
            for d in range(7):
                day = (now.date() + timedelta(days=d)).isoformat()
                forecastdays.append({
                    "date": day,
                    "day": {
                        "maxtemp_c": 28 + d,
                        "mintemp_c": 20 + d,
                        "condition": {"text": "Heavy rain", "icon": ""},
                        "maxwind_kph": 20.0,
                        "totalprecip_mm": 50.0 + d*5,
                        "avghumidity": 88,
                        "daily_chance_of_rain": 90,
                        "avgvis_km": 2.0,
                        "uv": 1
                    },
                    "hour": []
                })
            if forecastdays:
                forecastdays[0]["hour"] = hourly
            payload = {
                "location": {"name": city, "country": "TX"},
                "current": {
                    "temp_c": 25.0,
                    "temp_f": 77.0,
                    "condition": {"text": "Heavy rain", "icon": ""},
                    "wind_kph": 12.0,
                    "wind_dir": "S",
                    "pressure_mb": 1005,
                    "humidity": 95,
                    "cloud": 100,
                    "feelslike_c": 25.0,
                    "vis_km": 1.5,
                },
                "forecast": {"forecastday": forecastdays}
            }
            return jsonify(payload)

        cur, fc = fetch_openweather(city)
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
        payload = {"location": {"name": city, "country": cur["sys"]["country"]}, "current": cur_data, "forecast": {"forecastday": forecastdays}}
        return jsonify(payload)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/weather/history", methods=["GET"])
def weather_history():
    city = request.args.get("city")
    if not city:
        return jsonify({"error": "Provide ?city=Name"}), 400
    try:
        api_key = os.environ.get("WEATHER_API_KEY_HISTORY", "")
        if not api_key:
            return jsonify({"error": "WEATHER_API_KEY_HISTORY not set"}), 500
        end_date = datetime.now(timezone.utc).date() - timedelta(days=1)
        start_date = end_date - timedelta(days=1)
        history = []
        for d in [start_date, end_date]:
            url = "http://api.weatherapi.com/v1/history.json"
            params = {"key": api_key, "q": city, "dt": d.isoformat()}
            r = requests.get(url, params=params, timeout=10)
            r.raise_for_status()
            data = r.json()
            if "forecast" not in data or not data["forecast"]["forecastday"]:
                continue
            day_data = data["forecast"]["forecastday"][0]["day"]
            history.append({
                "date": d.isoformat(),
                "maxTemp": day_data.get("maxtemp_c"),
                "minTemp": day_data.get("mintemp_c"),
                "humidity": day_data.get("avghumidity"),
                "precipitation": day_data.get("totalprecip_mm"),
                "windSpeed": day_data.get("maxwind_kph"),
            })
        return jsonify({"city": city, "history": history})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ------------------------------
# Google Places endpoints (unchanged behavior)
# ------------------------------
@app.get('/google/nearby_ngos')
def google_nearby_ngos():
    lat = float(request.args.get("lat"))
    lon = float(request.args.get("lon"))
    radius = 5000
    url = "https://places.googleapis.com/v1/places:searchNearby"
    payload = {
        "includedTypes": ["non_profit", "point_of_interest", "foundation"],
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lon},
                "radius": radius
            }
        }
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask":
            "places.id,places.displayName,places.location,"
            "places.formattedAddress,places.websiteUri,"
            "places.internationalPhoneNumber"
    }
    r = requests.post(url, json=payload, headers=headers)
    data = r.json()
    results = []
    for p in data.get("places", []):
        results.append({
            "place_id": p.get("id"),
            "name": p.get("displayName", {}).get("text"),
            "geometry": {
                "location": {
                    "lat": p.get("location", {}).get("latitude"),
                    "lng": p.get("location", {}).get("longitude"),
                }
            },
            "vicinity": p.get("formattedAddress"),
            "website": p.get("websiteUri"),
            "phone": p.get("internationalPhoneNumber"),
            "international_phone": p.get("internationalPhoneNumber"),
            "international_phone_number": p.get("internationalPhoneNumber"),
        })
    return jsonify({"results": results})

@app.get("/google/nearby")
def google_nearby():
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"error": "lat & lon required"}), 400
    url = "https://places.googleapis.com/v1/places:searchNearby"
    payload = {
        "includedTypes": ["non_profit"],
        "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": 5000}}
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.formattedAddress,"
            "places.location,places.websiteUri,places.rating,"
            "places.internationalPhoneNumber"
        )
    }
    resp = requests.post(url, json=payload, headers=headers)
    data = resp.json()
    results = []
    for p in data.get("places", []):
        results.append({
            "place_id": p.get("id"),
            "name": p.get("displayName", {}).get("text"),
            "geometry": {
                "location": {
                    "lat": p.get("location", {}).get("latitude"),
                    "lng": p.get("location", {}).get("longitude")
                }
            },
            "rating": p.get("rating"),
            "website": p.get("websiteUri"),
            "international_phone": p.get("internationalPhoneNumber")
        })
    return jsonify({"results": results})

@app.get("/google/details")
def google_details():
    place_id = request.args.get("place_id")
    key = GOOGLE_API_KEY
    if not place_id:
        return jsonify({"error": "place_id required"}), 400
    url = f"https://places.googleapis.com/v1/places/{place_id}"
    headers = {"X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,displayName,formattedAddress,websiteUri,internationalPhoneNumber"}
    r = requests.get(url, headers=headers)
    p = r.json()
    return jsonify({
        "result": {
            "formatted_phone_number": p.get("internationalPhoneNumber"),
            "website": p.get("websiteUri"),
            "formatted_address": p.get("formattedAddress"),
            "name": p.get("displayName", {}).get("text")
        }
    })

@app.get("/google/search")
def google_search():
    query = request.args.get("name")
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    key = GOOGLE_API_KEY
    url = "https://places.googleapis.com/v1/places:searchText"
    payload = {"textQuery": query, "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": 5000}}}
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber,places.location"
    }
    r = requests.post(url, json=payload, headers=headers)
    return jsonify(r.json())

# ------------------------------
# Hotspots / flood zones / waterways (unchanged)
# ------------------------------
@app.get("/api/hotspots")
def api_hotspots():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
        radius_km = float(request.args.get("radius_km", 200))
        url = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/?country=india&source=viirs&timeWindow=24"
        try:
            df = pd.read_csv(url)
        except Exception as e:
            app.logger.error("Hotspot CSV load error: %s", e)
            return jsonify([])
        if df.empty: return jsonify([])
        if not {"latitude", "longitude", "confidence"}.issubset(df.columns): return jsonify([])
        def haversine(lat1, lon1, lat2, lon2):
            from math import radians, sin, cos, atan2, sqrt
            R = 6371
            dlat = radians(lat2 - lat1)
            dlon = radians(lon2 - lon1)
            a = sin(dlat/2)**2 + cos(radians(lat1))*cos(radians(lat2))*sin(dlon/2)**2
            return R * 2 * atan2(sqrt(a), sqrt(1 - a))
        hotspots = []
        for _, row in df.iterrows():
            dist = haversine(lat, lon, row["latitude"], row["longitude"])
            if dist <= radius_km:
                hotspots.append({"lat": float(row["latitude"]), "lon": float(row["longitude"]), "confidence": float(row["confidence"])})
        return jsonify(hotspots)
    except Exception as e:
        app.logger.exception("Hotspot API error: %s", e)
        return jsonify([])

@app.get("/api/flood_zones")
def api_flood_zones():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except:
        return jsonify({"error": "lat/lon required"}), 400
    size = 0.07
    polygon = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "properties": {"zone": "Flood Risk", "severity": 0.7},
        "geometry": {"type": "Polygon", "coordinates": [[
            [lon - size, lat - size],
            [lon + size, lat - size],
            [lon + size, lat + size],
            [lon - size, lat + size],
            [lon - size, lat - size],
        ]]}
    }]}
    return jsonify(polygon)

@app.get("/api/waterways")
def get_waterways():
    lat = float(request.args.get("lat"))
    lon = float(request.args.get("lon"))
    query = f"""
    [out:json][timeout:25];
    (
      way["waterway"](around:15000, {lat}, {lon});
      way["waterway"~"river|stream|canal|ditch|drain"](around:15000, {lat}, {lon});
      relation["waterway"](around:15000, {lat}, {lon});
      way["natural"="water"](around:15000, {lat}, {lon});
      relation["natural"="water"](around:15000, {lat}, {lon});
      way["landuse"="reservoir"](around:15000, {lat}, {lon});
      way["waterway"](around:15000, {lat}, {lon});
    );
    out geom;
    """
    overpass_url = "https://overpass-api.de/api/interpreter"
    try:
        r = requests.post(overpass_url, data=query, headers={"Content-Type":"application/x-www-form-urlencoded"})
        data = r.json()
        features = []
        for el in data.get("elements", []):
            if el.get("geometry"):
                coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
                features.append({"type":"Feature","geometry":{"type":"LineString","coordinates":coords},"properties":{"id":el.get("id"),"type":el.get("tags",{}).get("waterway")}})
        return jsonify({"type": "FeatureCollection", "features": features})
    except Exception as e:
        return jsonify({"error": str(e)})

# ------------------------------
# SMS and scheduler
# ------------------------------
ALERT_CITIES = [c.strip() for c in os.environ.get("ALERT_CITIES", "Floodville,Delhi,Mumbai,Bengaluru,Chennai").split(",") if c.strip()]
ALERT_INTERVAL_MINUTES = float(os.environ.get("ALERT_INTERVAL_MINUTES", "1"))
COOLDOWN_MINUTES = int(os.environ.get("ALERT_COOLDOWN_MINUTES", "1"))
ALERT_FLOOD_THRESHOLD = float(os.environ.get("ALERT_FLOOD_THRESHOLD", "0.7"))
ALERT_FIRE_THRESHOLD = float(os.environ.get("ALERT_FIRE_THRESHOLD", "0.7"))
INTERNAL_BASE_URL = os.environ.get("INTERNAL_BASE_URL", "http://localhost:5000").rstrip("/")

_last_alert_sent = {}

def _should_send_alert(key: str) -> bool:
    last = _last_alert_sent.get(key)
    if not last:
        return True
    return (time.time() - last) >= (COOLDOWN_MINUTES * 60)

def _mark_alert_sent(key: str):
    _last_alert_sent[key] = time.time()

def send_alert_sms(alert_msg: str):
    if not FAST2SMS_API_KEY or not ALERT_PHONE:
        app.logger.warning("FAST2SMS_API_KEY or ALERT_PHONE not configured; skipping SMS")
        return
    url = "https://www.fast2sms.com/dev/bulkV2"
    payload = {"message": alert_msg, "language": "english", "route": "q", "numbers": ALERT_PHONE}
    headers = {"authorization": FAST2SMS_API_KEY, "Content-Type": "application/x-www-form-urlencoded"}
    try:
        response = requests.post(url, data=payload, headers=headers)
        app.logger.info("SMS Response: %s", response.text)
    except Exception as e:
        app.logger.exception("SMS send failed: %s", e)

def periodic_risk_check():
    app.logger.info("💡 Scheduler heartbeat: checking risk at %s", datetime.now().strftime("%H:%M:%S"))
    for city in ALERT_CITIES:
        try:
            url = f"{INTERNAL_BASE_URL}/predict"
            r = requests.get(url, params={"city": city}, timeout=30)
            r.raise_for_status()
            res = r.json()
            flood_prob = (res.get("flood") or {}).get("probability") if isinstance(res.get("flood"), dict) else res.get("flood")
            fire_prob  = (res.get("wildfire") or {}).get("probability") if isinstance(res.get("wildfire"), dict) else res.get("wildfire")

            if flood_prob is not None and float(flood_prob) >= ALERT_FLOOD_THRESHOLD:
                key = f"{city}:flood"
                if _should_send_alert(key):
                    title = f"{city}: HIGH Flood Risk"
                    body = (f"[EarthPulse Alert]\nCity: {city}\nFlood Risk: {(float(flood_prob)*100):.0f}%\nStay alert and avoid low-lying areas.")
                    tag = f"earthpulse:{city}:flood:{int(time.time())}"
                    try: requests.post(f"{INTERNAL_BASE_URL}/push/test", json={"title": title, "body": body, "tag": tag}, timeout=30)
                    except: pass
                    send_alert_sms(body)
                    _mark_alert_sent(key)
                    app.logger.info(f"Auto-alert flood for {city} sent")

            if fire_prob is not None and float(fire_prob) >= ALERT_FIRE_THRESHOLD:
                key = f"{city}:fire"
                if _should_send_alert(key):
                    title = f"{city}: HIGH Fire Risk"
                    body = (f"[EarthPulse Alert]\nCity: {city}\nWildfire Risk: {(float(fire_prob)*100):.0f}%\nExercise caution and avoid dry vegetation.")
                    tag = f"earthpulse:{city}:fire:{int(time.time())}"
                    try: requests.post(f"{INTERNAL_BASE_URL}/push/test", json={"title": title, "body": body, "tag": tag}, timeout=30)
                    except: pass
                    send_alert_sms(body)
                    _mark_alert_sent(key)
                    app.logger.info(f"Auto-alert fire for {city} sent")

        except Exception as e:
            app.logger.exception(f"Auto-alert error for {city}: {e}")

# Start scheduler (only when __main__)
from apscheduler.schedulers.background import BackgroundScheduler
def start_alert_scheduler():
    try:
        scheduler = BackgroundScheduler()
        from datetime import datetime, timedelta
        scheduler.add_job(periodic_risk_check, "interval", minutes=ALERT_INTERVAL_MINUTES, next_run_time=datetime.now() + timedelta(seconds=10))
        app.logger.info("⚙️  Starting background alert scheduler ... (first run delayed 10s)")
        scheduler.start()
    except Exception as e:
        app.logger.exception("Failed to start background scheduler: %s", e)

# ------------------------------
# PDF report endpoint (kept as-is but slightly hardened)
# ------------------------------
import matplotlib.pyplot as plt
from fpdf import FPDF
from PIL import Image

@app.get("/download_report")
def download_report():
    city = request.args.get("city")
    if not city:
        return {"error": "City is required"}, 400
    try:
        pred = requests.get(f"{INTERNAL_BASE_URL}/predict", params={"city": city}, timeout=10).json()
        weather = requests.get(f"{INTERNAL_BASE_URL}/weather", params={"city": city}, timeout=10).json()
    except Exception as e:
        return {"error": str(e)}, 500

    cur = weather.get("current", {})
    forecast = weather.get("forecast", {}).get("forecastday", [])
    flood = pred.get("flood", {"probability": 0, "label": "N/A"})
    wildfire = pred.get("wildfire", {"probability": 0, "label": "N/A"})

    tmp_files = []
    def temp_file():
        fd, path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        tmp_files.append(path)
        return path

    temp_chart = None
    try:
        dates = [d.get("date", "") for d in forecast]
        tmin = [d["day"].get("mintemp_c", 0) for d in forecast]
        tmax = [d["day"].get("maxtemp_c", 0) for d in forecast]
        if dates:
            fig, ax = plt.subplots(figsize=(6, 3.2))
            ax.plot(dates, tmin, marker="o", label="Min Temp")
            ax.plot(dates, tmax, marker="o", label="Max Temp")
            ax.set_title("7-Day Temperature Trend")
            ax.set_ylabel("°C")
            ax.grid(True, linewidth=0.3)
            ax.legend()
            plt.xticks(rotation=45, fontsize=8)
            ax.tick_params(axis="y", labelsize=8)
            fig.tight_layout()
            temp_chart = temp_file()
            fig.savefig(temp_chart, dpi=150)
            plt.close(fig)
    except Exception:
        pass

    rain_chart = None
    try:
        rain = [d["day"].get("daily_chance_of_rain", 0) for d in forecast]
        if dates:
            fig, ax = plt.subplots(figsize=(6, 3.2))
            ax.bar(dates, rain)
            ax.set_title("7-Day Rain Probability")
            ax.set_ylabel("%")
            ax.set_ylim(0, 100)
            ax.grid(axis="y", linewidth=0.3)
            plt.xticks(rotation=45, fontsize=8)
            ax.tick_params(axis="y", labelsize=8)
            fig.tight_layout()
            rain_chart = temp_file()
            fig.savefig(rain_chart, dpi=150)
            plt.close(fig)
    except Exception:
        pass

    pdf = FPDF("P", "mm", "A4")
    pdf.set_auto_page_break(auto=True, margin=12)
    def draw_page_border():
        pdf.set_draw_color(180, 180, 180)
        pdf.set_line_width(0.8)
        pdf.rect(5, 5, 200, 287)
    pdf.add_page()
    draw_page_border()

    try:
        pdf.add_font("DejaVu", "", "fonts/DejaVuSans.ttf", uni=True)
        pdf.add_font("DejaVu", "B", "fonts/DejaVuSans-Bold.ttf", uni=True)
        pdf.add_font("DejaVu", "I", "fonts/DejaVuSans-Oblique.ttf", uni=True)
        pdf.set_font("DejaVu", "", 11)
    except Exception:
        pdf.set_font("Arial", "", 11)

    pdf.set_font("DejaVu", "B", 18)
    pdf.set_text_color(30, 144, 255)
    pdf.cell(0, 10, f"🌍 EarthPulse Disaster Report — {city}", ln=True)
    pdf.ln(2)
    pdf.set_font("DejaVu", "", 11)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 6, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", ln=True)
    pdf.ln(4)

    def section(title, fill=(160, 30, 30)):
        pdf.set_font("DejaVu", "B", 14)
        pdf.set_fill_color(*fill)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(0, 10, f"  {title}", ln=True, fill=True)
        pdf.set_text_color(0, 0, 0)
        pdf.ln(3)

    def draw_risk(label, prob):
        try:
            pct = int(prob * 100)
        except Exception:
            pct = 0
        bar_w = 120; bar_h = 8
        if pct < 30:
            color = (0, 200, 0)
        elif pct < 60:
            color = (255, 215, 0)
        elif pct < 80:
            color = (255, 165, 0)
        else:
            color = (255, 60, 60)
        pdf.set_font("DejaVu", "B", 11)
        pdf.cell(0, 6, f"{label}: {pct}%", ln=True)
        x = pdf.get_x(); y = pdf.get_y()
        pdf.set_fill_color(230, 230, 230)
        pdf.rect(x, y, bar_w, bar_h, "F")
        pdf.set_fill_color(*color)
        pdf.rect(x, y, bar_w * pct / 100, bar_h, "F")
        pdf.ln(bar_h + 4)

    section("Current Weather", (30, 100, 160))
    pdf.set_font("DejaVu", "", 11)
    pdf.multi_cell(0, 6,
        f"Temperature: {cur.get('temp_c')}°C (Feels like {cur.get('feelslike_c')}°C)\n"
        f"Humidity: {cur.get('humidity')}%\n"
        f"Wind: {cur.get('wind_kph')} km/h ({cur.get('wind_dir')})\n"
        f"Visibility: {cur.get('vis_km')} km\n"
        f"Pressure: {cur.get('pressure_mb')} mb"
    )
    pdf.ln(2)
    section("Disaster Risk Assessment")
    draw_risk("Flood Risk", flood.get("probability", 0))
    draw_risk("Wildfire Risk", wildfire.get("probability", 0))
    section("24-Hour Snapshot", (80, 80, 80))

    hours = forecast[0].get("hour", [])[:12] if forecast else []
    pdf.set_font("DejaVu", "B", 10)
    pdf.set_fill_color(230, 230, 230)
    pdf.cell(45, 7, "Time", 1, 0, "C", True)
    pdf.cell(40, 7, "Temp", 1, 0, "C", True)
    pdf.cell(30, 7, "Rain%", 1, 1, "C", True)
    pdf.set_font("DejaVu", "", 10)
    for h in hours:
        t = h.get("time", "").replace("T", " ").replace("+00:00", "")
        temp = f"{h.get('temp_c', 'N/A')}°C"
        rain = f"{h.get('chance_of_rain', 'N/A')}%"
        pdf.cell(45, 7, t, border=1)
        pdf.cell(40, 7, temp, border=1)
        pdf.cell(30, 7, rain, border=1)
        pdf.ln(7)
    pdf.ln(5)

    section("7-Day Forecast", (50, 50, 50))
    pdf.set_font("DejaVu", "B", 10)
    pdf.set_fill_color(235, 235, 235)
    pdf.cell(30, 8, "Date", 1, 0, "C", True)
    pdf.cell(65, 8, "Condition", 1, 0, "C", True)
    pdf.cell(25, 8, "Min°", 1, 0, "C", True)
    pdf.cell(25, 8, "Max°", 1, 0, "C", True)
    pdf.cell(25, 8, "Rain%", 1, 1, "C", True)
    pdf.set_font("DejaVu", "", 10)
    for d in forecast:
        day = d["day"]
        pdf.cell(30, 8, d["date"], 1)
        pdf.cell(65, 8, day["condition"]["text"][:30], 1)
        pdf.cell(25, 8, str(day["mintemp_c"]), 1)
        pdf.cell(25, 8, str(day["maxtemp_c"]), 1)
        pdf.cell(25, 8, str(day["daily_chance_of_rain"]), 1)
        pdf.ln()

    def insert_chart(path, title):
        if not path or not os.path.exists(path): return
        if pdf.get_y() > 180:
            pdf.add_page(); draw_page_border()
        pdf.set_font("DejaVu", "B", 14); pdf.cell(0, 8, title, ln=True)
        img_w, img_h = 170, 90
        x = (210 - img_w) / 2; y = pdf.get_y() + 3
        pdf.set_draw_color(120,120,120); pdf.rect(x-2, y-2, img_w+4, img_h+4)
        try:
            pdf.image(path, x=x, y=y, w=img_w, h=img_h)
        except Exception:
            pass
        pdf.ln(img_h + 16)
        if pdf.get_y() < 20: draw_page_border()

    insert_chart(temp_chart, "7-Day Temperature Trend")
    insert_chart(rain_chart, "7-Day Rain Probability")

    def add_footer():
        auto_break = pdf.auto_page_break
        pdf.set_auto_page_break(False)
        pdf.set_y(265)
        pdf.set_font("DejaVu", "I", 10)
        pdf.set_text_color(90,90,90)
        pdf.cell(0,6, '"Preparedness today ensures safety tomorrow."', ln=True, align="C")
        pdf.set_font("DejaVu", "B", 11)
        pdf.set_text_color(60,60,60)
        pdf.cell(0,6, "— Team EarthPulse", ln=True, align="C")
        pdf.set_auto_page_break(auto_break, margin=12)

    pdf.add_page(); draw_page_border()
    section("Preparedness & Action Plan", (30,144,255))
    pdf.set_font("DejaVu", "", 11)
    pdf.multi_cell(0,6,
        "• Prepare emergency kit: water, flashlight, medicines.\n"
        "• Avoid low-lying areas during heavy rainfall.\n"
        "• Keep communication devices charged.\n"
        "• Follow official alerts from authorities.\n"
        "• Avoid dry vegetation during wildfire warnings."
    )
    add_footer()

    out = BytesIO()
    pdf.output(out)
    out.seek(0)
    for f in tmp_files:
        try: os.remove(f)
        except: pass
    return send_file(out, download_name=f"EarthPulse_Report_{city}.pdf", as_attachment=True, mimetype="application/pdf")

# Manual trigger
@app.post("/push/run_auto_check")
def run_auto_check():
    try:
        app.logger.info("Manual trigger: running periodic risk check...")
        periodic_risk_check()
        return jsonify({"status": "ok"})
    except Exception as e:
        app.logger.exception("run_auto_check failed: %s", e)
        return jsonify({"status": "error", "error": str(e)}), 500

# Entry point
if __name__ == "__main__":
    start_alert_scheduler()
    import threading
    threading.Timer(5, periodic_risk_check).start()
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)
