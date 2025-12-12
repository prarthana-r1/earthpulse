// src/api.js
import axios from "axios";

const BACKEND = import.meta.env.VITE_BACKEND_URL || "https://earthpulse-backend-48598371636.asia-south1.run.app";

// ---------------------------
// PREDICTION
// ---------------------------
export async function fetchPrediction(city) {
  const r = await axios.get(`${BACKEND}/predict`, { params: { city } });
  return r.data;
}

export async function fetchPredictionByCoords({ lat, lon }) {
  const r = await axios.get(`${BACKEND}/predict`, { params: { lat, lon } });
  return r.data;
}

// ---------------------------
// WEATHER
// ---------------------------
export async function fetchWeather({ city, lat, lon }) {
  const params = {};
  if (city) params.city = city;
  if (typeof lat === "number" && typeof lon === "number") {
    params.lat = lat;
    params.lon = lon;
  }
  const r = await axios.get(`${BACKEND}/weather`, { params });
  return r.data;
}

export async function fetchWeatherHistory(city) {
  const res = await fetch(`${BACKEND}/weather/history?city=${encodeURIComponent(city)}`);
  if (!res.ok) throw new Error("History API failed");
  return await res.json();
}

// ---------------------------
// MAP LAYERS (🔥 Your missing routes)
// ---------------------------
export async function fetchHotspots(lat, lon, radius_km = 200) {
  const r = await axios.get(`${BACKEND}/api/hotspots`, {
    params: { lat, lon, radius_km }
  });
  return r.data;
}

export async function fetchWaterways(lat, lon) {
  const r = await axios.get(`${BACKEND}/api/waterways`, {
    params: { lat, lon }
  });
  return r.data;
}

export async function fetchFloodZones(lat, lon) {
  const r = await axios.get(`${BACKEND}/api/flood_zones`, {
    params: { lat, lon }
  });
  return r.data;
}

// ---------------------------
// PUSH NOTIFICATIONS
// ---------------------------
export async function sendPush(payload) {
  const r = await axios.post(`${BACKEND}/push/test`, payload);
  return r.data;
}
