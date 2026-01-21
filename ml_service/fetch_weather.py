import openmeteo_requests
import requests_cache
from retry_requests import retry
import pandas as pd
import os

# Setup client with retries & cache
session = requests_cache.CachedSession('.cache', expire_after=3600)
client = openmeteo_requests.Client(session=retry(session, retries=5, backoff_factor=0.2))

# Define locations
# Define locations (India-focused)
locations = [
    # --- Major metros ---
    {"name": "Delhi", "lat": 28.7041, "lon": 77.1025},
    {"name": "Mumbai", "lat": 19.0760, "lon": 72.8777},
    {"name": "Kolkata", "lat": 22.5726, "lon": 88.3639},
    {"name": "Chennai", "lat": 13.0827, "lon": 80.2707},
    {"name": "Bengaluru", "lat": 12.9716, "lon": 77.5946},  # urban flooding
    {"name": "Hyderabad", "lat": 17.3850, "lon": 78.4867},
    {"name": "Ahmedabad", "lat": 23.0225, "lon": 72.5714},
    {"name": "Jaipur", "lat": 26.9124, "lon": 75.7873},
    {"name": "Lucknow", "lat": 26.8467, "lon": 80.9462},
    {"name": "Pune", "lat": 18.5204, "lon": 73.8567},
    {"name": "Bhopal", "lat": 23.2599, "lon": 77.4126},
    {"name": "Indore", "lat": 22.7196, "lon": 75.8577},
    {"name": "Visakhapatnam", "lat": 17.6868, "lon": 83.2185},
    {"name": "Srinagar", "lat": 34.0837, "lon": 74.7973},
    {"name": "Ranchi", "lat": 23.3441, "lon": 85.3096},
    {"name": "Chandigarh", "lat": 30.7333, "lon": 76.7794},
    {"name": "Thiruvananthapuram", "lat": 8.5241, "lon": 76.9366},

    # --- River flood–prone (Ganga–Brahmaputra belt) ---
    {"name": "Guwahati", "lat": 26.1445, "lon": 91.7362},
    {"name": "Dibrugarh", "lat": 27.4728, "lon": 94.9120},
    {"name": "Patna", "lat": 25.5941, "lon": 85.1376},
    {"name": "Bhagalpur", "lat": 25.2425, "lon": 86.9842},
    {"name": "Varanasi", "lat": 25.3176, "lon": 82.9739},
    {"name": "Gorakhpur", "lat": 26.7606, "lon": 83.3732},

    # --- Delta & coastal flooding ---
    {"name": "Howrah", "lat": 22.5958, "lon": 88.2636},
    {"name": "Kochi", "lat": 9.9312, "lon": 76.2673},
    {"name": "Alappuzha", "lat": 9.4981, "lon": 76.3388},

    # --- Wildfire-prone (Western Ghats & forests) ---
    {"name": "Chikkamagaluru", "lat": 13.3153, "lon": 75.7754},
    {"name": "Madikeri", "lat": 12.4260, "lon": 75.7382},
    {"name": "Shivamogga", "lat": 13.9299, "lon": 75.5681},

    {"name": "Nagpur", "lat": 21.1458, "lon": 79.0882},
    {"name": "Chandrapur", "lat": 19.9615, "lon": 79.2961},
    {"name": "Gadchiroli", "lat": 20.1850, "lon": 80.0033},

    {"name": "Jagdalpur", "lat": 19.0748, "lon": 82.0080},
    {"name": "Bastar", "lat": 19.0833, "lon": 81.9500},  # district HQ approx

    {"name": "Nainital", "lat": 29.3806, "lon": 79.4636},
    {"name": "Almora", "lat": 29.5971, "lon": 79.6591},

    {"name": "Kullu", "lat": 31.9579, "lon": 77.1095},
    {"name": "Mandi", "lat": 31.7088, "lon": 76.9310}
]



# Create folders
os.makedirs("data/raw", exist_ok=True)

# ---------------- Fetch Realtime Data ---------------- #
def fetch_weather(city, lat, lon):
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": [
            "temperature_2m",
            "relative_humidity_2m",
            "dew_point_2m",
            "apparent_temperature",
            "precipitation",
            "rain",
            "snowfall",
            "surface_pressure",
            "cloud_cover",
            "wind_speed_10m",
            "wind_gusts_10m",
            "et0_fao_evapotranspiration"
        ],
        "forecast_days": 7,
        "timezone": "auto"
    }

    resp = client.weather_api(url, params=params)[0]
    hourly = resp.Hourly()

    df = pd.DataFrame({
        "time": pd.date_range(
            start=pd.to_datetime(hourly.Time(), unit="s", utc=True),
            end=pd.to_datetime(hourly.TimeEnd(), unit="s", utc=True),
            freq=pd.Timedelta(seconds=hourly.Interval()),
            inclusive="left"
        ),
        "temperature_2m": hourly.Variables(0).ValuesAsNumpy(),
        "relative_humidity_2m": hourly.Variables(1).ValuesAsNumpy(),
        "dew_point_2m": hourly.Variables(2).ValuesAsNumpy(),
        "apparent_temperature": hourly.Variables(3).ValuesAsNumpy(),
        "precipitation": hourly.Variables(4).ValuesAsNumpy(),
        "rain": hourly.Variables(5).ValuesAsNumpy(),
        "snowfall": hourly.Variables(6).ValuesAsNumpy(),
        "surface_pressure": hourly.Variables(7).ValuesAsNumpy(),
        "cloud_cover": hourly.Variables(8).ValuesAsNumpy(),
        "wind_speed_10m": hourly.Variables(9).ValuesAsNumpy(),
        "wind_gusts_10m": hourly.Variables(10).ValuesAsNumpy(),
        "et0_fao_evapotranspiration": hourly.Variables(11).ValuesAsNumpy(),
        "city": city,
        "latitude": lat,
        "longitude": lon
    })

    # 🔁 Aliases for frontend + ML consistency
    df["precip_mm"] = df["precipitation"]
    df["rain_mm"] = df["rain"]

    # 🔥 Wildfire baseline (improved)
    df["wildfire_label"] = (
        (df["temperature_2m"] > 35) &
        (df["relative_humidity_2m"] < 30) &
        (
            (df["wind_speed_10m"] > 20) |
            (df["et0_fao_evapotranspiration"] > 5)
        )
    ).astype(int)

    # 🌊 Flood baseline (India-appropriate)
    df["flood_label"] = (
        df["precipitation"]
        .rolling(24, min_periods=1)
        .sum() > 25
    ).astype(int)

    # 📁 Safe output
    os.makedirs("data/raw", exist_ok=True)
    safe_city = city.replace(" ", "_").lower()
    out_path = f"data/raw/{safe_city}_realtime.csv"
    df.to_csv(out_path, index=False)

    print(f"✅ Weather data saved for {city} → {out_path}")
    return df


# ---------------- Main Loop ---------------- #
all_data = []

for loc in locations:
    try:
        all_data.append(fetch_weather(loc["name"], loc["lat"], loc["lon"]))
    except Exception as e:
        print(f"Failed to fetch {loc['name']}: {e}")

if all_data:
    pd.concat(all_data, ignore_index=True).to_csv("data/raw/all_weather.csv", index=False)
    print("🌍 Combined weather data saved → data/raw/all_weather.csv")

print("✅ Done! Ready for training.")
