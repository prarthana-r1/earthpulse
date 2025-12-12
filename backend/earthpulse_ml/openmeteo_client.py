
"""
Open-Meteo data client utilities.
No API key required.
Docs: https://open-meteo.com/en/docs
Note: Run this script in an environment with internet access.
"""
from __future__ import annotations
import requests
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, List
import pandas as pd

OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_FWI = "https://fwi-api.open-meteo.com/v1/fwi"

DEFAULT_HOURLY = [
    "temperature_2m",
    "relative_humidity_2m",
    "dew_point_2m",
    "apparent_temperature",
    "precipitation",
    "rain",
    "snowfall",
    "weather_code",
    "surface_pressure",
    "cloud_cover",
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
    "et0_fao_evapotranspiration"
]

# Variables for FWI endpoint (Canadian Fire Weather Index components)
DEFAULT_FWI_HOURLY = [
    "fwi", "ffmc", "dmc", "dc", "isi", "bui",
    "wind_speed_10m", "temperature_2m", "relative_humidity_2m", "rain"
]

def _to_iso_date(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")

def fetch_archive_timeseries(lat: float, lon: float, start: datetime, end: datetime,
                             hourly: Optional[List[str]] = None, timezone_name: str = "UTC") -> pd.DataFrame:
    """
    Fetch historical (reanalysis) hourly data from Open-Meteo archive API.
    """
    hourly = hourly or DEFAULT_HOURLY
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": _to_iso_date(start),
        "end_date": _to_iso_date(end),
        "hourly": ",".join(hourly),
        "timezone": timezone_name
    }
    r = requests.get(OPEN_METEO_ARCHIVE, params=params, timeout=60)
    r.raise_for_status()
    data = r.json()
    if "hourly" not in data:
        raise RuntimeError(f"Unexpected response: {data}")
    df = pd.DataFrame(data["hourly"])
    df["time"] = pd.to_datetime(df["time"])
    return df.set_index("time")

def fetch_realtime(lat: float, lon: float, hourly=None, timezone_name="UTC") -> pd.DataFrame:
    hourly = hourly or DEFAULT_HOURLY

    # ensure timezone compatibility
    if timezone_name == "auto":
        timezone_name = "UTC"

    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(hourly),
        "past_days": 1,
        "forecast_days": 1,
        "timezone": timezone_name
    }

    try:
        # safe for Render/Vercel
        r = requests.get(OPEN_METEO_BASE, params=params, timeout=7)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print("⚠ Real-time weather fetch failed:", e)
        raise RuntimeError("weather_service_unavailable")

    if "hourly" not in data:
        raise RuntimeError("weather_data_missing")

    df = pd.DataFrame(data["hourly"])
    df["time"] = pd.to_datetime(df["time"])
    return df.set_index("time")



def fetch_fwi(lat: float, lon: float, start: datetime, end: datetime, timezone_name: str = "UTC") -> pd.DataFrame:
    """
    Fetch Fire Weather Index timeseries.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": _to_iso_date(start),
        "end_date": _to_iso_date(end),
        "hourly": ",".join(DEFAULT_FWI_HOURLY),
        "timezone": timezone_name
    }
    r = requests.get(OPEN_METEO_FWI, params=params, timeout=60)
    r.raise_for_status()
    data = r.json()
    if "hourly" not in data:
        raise RuntimeError(f"Unexpected FWI response: {data}")
    df = pd.DataFrame(data["hourly"])
    df["time"] = pd.to_datetime(df["time"])
    return df.set_index("time")
