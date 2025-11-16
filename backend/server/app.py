# server/app.py
from dotenv import load_dotenv
load_dotenv()
import sys
import os
from pywebpush import webpush, WebPushException


# Add earthpulse_ml folder to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../ml_service/earthpulse_ml")))

from flask import Flask, request, jsonify
import json
from flask_cors import CORS
import requests
import importlib

# Lazy import helper for pywebpush (avoids static import errors in editors)
PUSH_MODULE = None
PUSH_IMPORT_ERROR = None
PUSH_AVAILABLE = False



def ensure_push():
    """Attempt to import pywebpush and populate PUSH_MODULE/PUSH_AVAILABLE.
    Safe to call multiple times."""
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
import tensorflow as tf
import pandas as pd
import numpy as np
import os
from openmeteo_client import fetch_realtime
from feature_engineering import add_lagged_aggregates, select_features
from datetime import datetime, timezone, timedelta


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

# --- Web Push setup ---
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY')
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY')
VAPID_CLAIMS = {"sub": os.environ.get('VAPID_SUB', 'mailto:admin@example.com')}

# Simple in-memory subscription store for dev/testing
SUBSCRIPTIONS = []

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
    # Add to in-memory list if not already present. Dedupe by endpoint.
    try:
        endpoint = sub.get('endpoint') if isinstance(sub, dict) else None
    except Exception:
        endpoint = None

    if endpoint:
        # remove existing subscription with same endpoint
        SUBSCRIPTIONS[:] = [s for s in SUBSCRIPTIONS if not (isinstance(s, dict) and s.get('endpoint') == endpoint)]
        SUBSCRIPTIONS.append(sub)
    else:
        # best-effort: append if not equal to any existing
        if sub not in SUBSCRIPTIONS:
            SUBSCRIPTIONS.append(sub)
    return jsonify({"status": "ok"})


@app.get('/push/subscriptions')
def push_subscriptions():
    """Development helper: return the current in-memory subscriptions and count.
    Only intended for local debugging; do not enable in production.
    """
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
            # Use a generic exception because WebPushException may not be available until import
            errors.append(str(ex))
    return jsonify({"sent": sent, "errors": errors})

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
        # Special test city: Floodville -> return canned high-flood coordinates/result
        if city.strip().lower() == 'floodville':
            lat, lon = 12.9716, 77.5946
            # return a quick canned response (we still construct full output below after model/pred)
        else:
            try:
                lat, lon = geocode_city(city)
            except Exception as e:
                return jsonify({"error": str(e)}), 400
    else:
        if lat is None or lon is None:
            return jsonify({"error": "Provide --city or (lat & lon)"}), 400

    # prepare features and predict
    # If Floodville, bypass model and return a high flood probability for testing
    if city and city.strip().lower() == 'floodville':
        flood_prob = 0.95
        fire_prob = 0.05
    else:
        X_flood = prepare_features_for_model(lat, lon, FLOOD_FEATS).values.astype("float32")
        X_fire = prepare_features_for_model(lat, lon, WILDFIRE_FEATS).values.astype("float32")

        flood_prob = float(FLOOD_MODEL.predict(X_flood, verbose=0)[0][0]) if FLOOD_FEATS else None
        fire_prob = float(WILDFIRE_MODEL.predict(X_fire, verbose=0)[0][0]) if WILDFIRE_FEATS else None

    flood_label = "High" if (flood_prob is not None and flood_prob >= 0.5) else "Low"
    fire_label = "High" if (fire_prob is not None and fire_prob >= 0.5) else "Low"

    # Also return latest raw weather snapshot for convenience
    if city and city.strip().lower() == 'floodville':
        # Create a simple synthetic weather dataframe-like dict for latest snapshot
        latest_weather = {
            "time": datetime.now(timezone.utc).isoformat(),
            "temp_c": 25.0,
            "humidity": 95.0,
            "precip": 20.0,
            "wind_kph": 10.0
        }
    else:
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
        # Test city bypass: Floodville -> return canned high-flood weather payload
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

            # attach hourly to first day
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
    

@app.route("/weather/history", methods=["GET"])
def weather_history():
    city = request.args.get("city")
    if not city:
        return jsonify({"error": "Provide ?city=Name"}), 400

    try:
        api_key = os.environ.get("WEATHER_API_KEY_HISTORY", "")
        if not api_key:
            return jsonify({"error": "WEATHER_API_KEY_HISTORY not set"}), 500

        # yesterday and day before yesterday
        end_date = datetime.now(timezone.utc).date() - timedelta(days=1)
        start_date = end_date - timedelta(days=1)

        history = []

        for d in [start_date, end_date]:
            url = "http://api.weatherapi.com/v1/history.json"
            params = {
                "key": api_key,
                "q": city,
                "dt": d.isoformat()
            }
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


# Temporary route to manually trigger the background alert job
@app.post("/push/run_auto_check")
def run_auto_check():
    try:
        app.logger.info("Manual trigger: running periodic risk check...")
        periodic_risk_check()
        return jsonify({"status": "ok"})
    except Exception as e:
        app.logger.exception("run_auto_check failed: %s", e)
        return jsonify({"status": "error", "error": str(e)}), 500



# --- automatic alert scheduler (add near bottom of app.py) ---
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
import time
import os

# configuration (fallbacks)
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

def periodic_risk_check():
    app.logger.info("💡 Scheduler heartbeat: checking risk at %s", datetime.now().strftime("%H:%M:%S"))
    app.logger.info("Periodic risk check started")
    for city in ALERT_CITIES:
        try:
            url = f"{INTERNAL_BASE_URL}/predict"
            r = requests.get(url, params={"city": city}, timeout=30)
            r.raise_for_status()
            res = r.json()
            # extract flood/fire probability resiliently
            flood_prob = (res.get("flood") or {}).get("probability") if isinstance(res.get("flood"), dict) else res.get("flood")
            fire_prob  = (res.get("wildfire") or {}).get("probability") if isinstance(res.get("wildfire"), dict) else res.get("wildfire")

            # flood alert
            if flood_prob is not None and float(flood_prob) >= ALERT_FLOOD_THRESHOLD:
                key = f"{city}:flood"
                if _should_send_alert(key):
                    title = f"{city}: HIGH Flood Risk"
                    body  = f"Flood probability {(float(flood_prob)*100):.0f}% — take precautions."
                    tag = f"earthpulse:{city}:flood:{int(time.time())}"
                    requests.post(f"{INTERNAL_BASE_URL}/push/test", json={"title": title, "body": body, "tag": tag}, timeout=30)
                    _mark_alert_sent(key)
                    app.logger.info(f"Auto-alert flood for {city} sent")

            # fire alert
            if fire_prob is not None and float(fire_prob) >= ALERT_FIRE_THRESHOLD:
                key = f"{city}:fire"
                if _should_send_alert(key):
                    title = f"{city}: HIGH Fire Risk"
                    body  = f"Fire probability {(float(fire_prob)*100):.0f}% — exercise caution."
                    tag = f"earthpulse:{city}:fire:{int(time.time())}"
                    requests.post(f"{INTERNAL_BASE_URL}/push/test", json={"title": title, "body": body, "tag": tag}, timeout=30)
                    _mark_alert_sent(key)
                    app.logger.info(f"Auto-alert fire for {city} sent")

        except Exception as e:
            app.logger.exception(f"Auto-alert error for {city}: {e}")

# Start scheduler only when running main (prevents double-start with debug reloader)
def start_alert_scheduler():
    try:
        scheduler = BackgroundScheduler()
        # Delay first check by 10 seconds to ensure Flask server is ready
        from datetime import datetime, timedelta
        scheduler.add_job(
            periodic_risk_check,
            "interval",
            minutes=ALERT_INTERVAL_MINUTES,
            next_run_time=datetime.now() + timedelta(seconds=10)
        )
        app.logger.info("⚙️  Starting background alert scheduler ... (first run delayed 10s)")
        scheduler.start()
        app.logger.info(f"Background alert scheduler started (every {ALERT_INTERVAL_MINUTES} minutes) for cities: {ALERT_CITIES}")
    except Exception as e:
        app.logger.exception("Failed to start background scheduler: %s", e)


# Call start_alert_scheduler() in the __main__ guard below (see next step)

@app.get("/api/hotspots")
def api_hotspots():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
        radius_km = float(request.args.get("radius_km", 200))

        # NASA FIRMS VIIRS Active Fire Data (last 24h)
        url = (
            "https://firms.modaps.eosdis.nasa.gov/"
            "api/area/csv/?country=india&source=viirs&timeWindow=24"
        )

        try:
            df = pd.read_csv(url)
        except Exception as e:
            app.logger.error("Hotspot CSV load error: %s", e)
            return jsonify([])

        if df.empty:
            return jsonify([])

        # Required columns check
        if not {"latitude", "longitude", "confidence"}.issubset(df.columns):
            return jsonify([])

        # Haversine filter
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
                hotspots.append({
                    "lat": float(row["latitude"]),
                    "lon": float(row["longitude"]),
                    "confidence": float(row["confidence"]),
                })

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

    size = 0.07  # degrees ~7km

    polygon = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"zone": "Flood Risk", "severity": 0.7},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [lon - size, lat - size],
                        [lon + size, lat - size],
                        [lon + size, lat + size],
                        [lon - size, lat + size],
                        [lon - size, lat - size],
                    ]]
                }
            }
        ]
    }

    return jsonify(polygon)










import requests
@app.get("/api/waterways")
def get_waterways():
    lat = float(request.args.get("lat"))
    lon = float(request.args.get("lon"))
    radius = 25000  # 25 km

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
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coords
                    },
                    "properties": {
                        "id": el.get("id"),
                        "type": el.get("tags", {}).get("waterway")
                    }
                })

        return jsonify({
            "type": "FeatureCollection",
            "features": features
        })
        
    except Exception as e:
        return jsonify({"error": str(e)})






if __name__ == "__main__":
    start_alert_scheduler()

    # optional: delayed test run (5 seconds after server start)
    import threading
    threading.Timer(5, periodic_risk_check).start()

    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)





