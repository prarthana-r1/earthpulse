from flask import Flask, request, jsonify
from earthpulse_ml.predict import predict_risks
import os

app = Flask(__name__)

# --- Model paths ---
FLOOD_MODEL = "models/flood_model.keras"
WILDFIRE_MODEL = "models/wildfire_model.keras"

# Warm load test
print("🚀 ML Server starting...")
print(f"Using flood model: {FLOOD_MODEL}")
print(f"Using wildfire model: {WILDFIRE_MODEL}")

@app.route("/", methods=["GET"])
def home():
    return {"message": "EarthPulse ML inference server is running"}

@app.route("/predict", methods=["POST"])
def predict():
    data = request.json

    city = data.get("city")
    lat = data.get("lat")
    lon = data.get("lon")

    if not city and (lat is None or lon is None):
        return {"error": "Provide either 'city' or both 'lat' and 'lon'."}, 400

    result = predict_risks(
        city=city,
        lat=lat,
        lon=lon,
        flood_model_path=FLOOD_MODEL,
        wildfire_model_path=WILDFIRE_MODEL
    )

    return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7860)
