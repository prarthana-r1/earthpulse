// src/api.js
import axios from "axios";

const BACKEND = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

export async function fetchPrediction(city) {
  const r = await axios.get(`${BACKEND}/predict`, { params: { city } });
  return r.data;
}


export async function fetchWeather({ city, lat, lon }) {
  const params = {};
  if (city) params.city = city;
  if (typeof lat === "number" && typeof lon === "number") { params.lat = lat; params.lon = lon; }
  const r = await axios.get(`${BACKEND}/weather`, { params });
  return r.data;
}

export async function fetchPredictionByCoords({ lat, lon }) {
  const r = await axios.get(`${BACKEND}/predict`, { params: { lat, lon } });
  return r.data;
}


export async function fetchWeatherHistory(city) {
  const res = await fetch(`${BACKEND}/weather/history?city=${encodeURIComponent(city)}`);
  if (!res.ok) throw new Error("History API failed");
  return await res.json();
}
