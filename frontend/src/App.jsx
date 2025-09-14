import MapView from "./MapView";
import { fetchWeather as fetchWeatherData, fetchPrediction as fetchPredictionApi, fetchPredictionByCoords, fetchWeatherHistory } from "./api";

import React, { useEffect, useState, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";
import "./index.css";

// Popular Indian cities for initial suggestions
const SUGGESTED_CITIES = [
  "Delhi", "Mumbai", "Bengaluru", "Chennai", "Kolkata", "Hyderabad",
  "Pune", "Ahmedabad", "Jaipur", "Surat", "Lucknow", "Kanpur",
  "Nagpur", "Indore", "Thane", "Bhopal", "Visakhapatnam", "Pimpri-Chinchwad",
  "Patna", "Vadodara", "Ghaziabad", "Ludhiana", "Agra", "Nashik",
  "Faridabad", "Meerut", "Rajkot", "Kalyan-Dombivali", "Vasai-Virar",
  "Varanasi", "Srinagar", "Aurangabad", "Dhanbad", "Amritsar",
  "Navi Mumbai", "Allahabad", "Ranchi", "Howrah", "Coimbatore",
  "Jabalpur", "Gwalior", "Vijayawada", "Jodhpur", "Madurai",
  "Raipur", "Kota", "Guwahati", "Chandigarh", "Solapur","Punjab"
];

// Replaced with real API imports
function App() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("Delhi");
  const [result, setResult] = useState(null);
  const [weatherData, setWeatherData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredCities, setFilteredCities] = useState([]);
  const [recentSearches, setRecentSearches] = useState([]);
  const [viewMode, setViewMode] = useState("daily"); // daily or hourly
  const [locationLoading, setLocationLoading] = useState(false);
  const [historyData, setHistoryData] = useState(null);

  const apiKey = import.meta.env.VITE_WEATHERAPI_CURLOC;
  const searchRef = useRef(null);
  const suggestionsRef = useRef(null);

  const getPrediction = async (city) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchPredictionApi(city);
      setResult(r);
      
      // Add to recent searches (avoid duplicates)
      setRecentSearches(prev => {
        const filtered = prev.filter(item => item.toLowerCase() !== city.toLowerCase());
        return [city, ...filtered].slice(0, 5);
      });
    } catch (e) {
      setError("Prediction failed: " + e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const prepareCombinedData = () => {
  const history = historyData?.map(day => ({
    date: new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    maxTemp: day.maxTemp,
    minTemp: day.minTemp,
    humidity: day.humidity,
    precipitation: day.precipitation,
    windSpeed: day.windSpeed,   // ✅ added
    type: "history"
  })) || [];

  const forecast = dailyData?.map(day => ({
    ...day,
    type: "forecast"
  })) || [];

  return [...history, ...forecast];
};



  const getWeatherData = async (city) => {
    setWeatherLoading(true);
    try {
      const data = await fetchWeatherData({ city });
      setWeatherData(data);
    } catch (e) {
      console.error("Weather data failed:", e.message);
    } finally {
      setWeatherLoading(false);
    }
  };

  const getCurrentLocation = () => {
  setLocationLoading(true);
  if (!navigator.geolocation) {
    setError("Geolocation is not supported by this browser");
    setLocationLoading(false);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const { latitude, longitude } = position.coords;

        const resp = await fetch(
          `https://api.weatherapi.com/v1/search.json?key=${apiKey}&q=${latitude},${longitude}`
        );
        const places = await resp.json();
        let cityName = "Current Location";
        if (places && places.length > 0) cityName = places[0].name;

        // Update state
        setSelected(cityName);

        // Immediately fetch data for current location
        await Promise.all([
          getPrediction(cityName),
          getWeatherData(cityName),
          (async () => {
            try {
              const history = await fetchWeatherHistory(cityName);
              setHistoryData(history.history);
            } catch (e) {
              console.error("History fetch failed:", e.message);
            }
          })()
        ]);

        setLocationLoading(false);

      } catch (e) {
        setError("Failed to get location data: " + e.message);
        setLocationLoading(false);
      }
    },
    (error) => {
      setError("Location access denied: " + error.message);
      setLocationLoading(false);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 600000 }
  );
};



  useEffect(() => {
  getPrediction(selected);
  getWeatherData(selected);

  // Fetch past 3 days
  (async () => {
    try {
      const history = await fetchWeatherHistory(selected);
      setHistoryData(history.history);
    } catch (e) {
      console.error("History fetch failed:", e.message);
    }
  })();
}, [selected]);


  // Filter cities based on search input
  useEffect(() => {
    if (search.trim() === "") {
      setFilteredCities([]);
      return;
    }

    const searchLower = search.toLowerCase();
    const matches = SUGGESTED_CITIES.filter(city =>
      city.toLowerCase().includes(searchLower)
    ).slice(0, 10);
    
    setFilteredCities(matches);
  }, [search]);

  // Handle clicking outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target) &&
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCitySelect = (city) => {
    setSelected(city);
    setSearch("");
    setShowSuggestions(false);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (search.trim() !== "") {
      handleCitySelect(search.trim());
    }
  };

  const handleSearchFocus = () => {
    setShowSuggestions(true);
  };

  // Weather-themed color schemes based on risk
  const getFloodColors = (prob) => {
    if (prob > 0.7) return {
      bg: "bg-gradient-to-br from-blue-900 to-blue-800",
      border: "border-blue-700",
      text: "text-blue-100",
      accent: "text-blue-200",
      bar: "bg-blue-300",
      barFill: "bg-blue-100"
    };
    if (prob > 0.4) return {
      bg: "bg-gradient-to-br from-blue-600 to-blue-500",
      border: "border-blue-400",
      text: "text-blue-50",
      accent: "text-blue-100",
      bar: "bg-blue-200",
      barFill: "bg-blue-50"
    };
    return {
      bg: "bg-gradient-to-br from-blue-100 to-blue-50",
      border: "border-blue-200",
      text: "text-blue-800",
      accent: "text-blue-600",
      bar: "bg-blue-200",
      barFill: "bg-blue-500"
    };
  };

  const getWildfireColors = (prob) => {
    if (prob > 0.7) return {
      bg: "bg-gradient-to-br from-red-900 to-orange-900",
      border: "border-red-700",
      text: "text-red-100",
      accent: "text-red-200",
      bar: "bg-red-300",
      barFill: "bg-red-100"
    };
    if (prob > 0.4) return {
      bg: "bg-gradient-to-br from-orange-600 to-red-500",
      border: "border-orange-400",
      text: "text-orange-50",
      accent: "text-orange-100",
      bar: "bg-orange-200",
      barFill: "bg-orange-50"
    };
    return {
      bg: "bg-gradient-to-br from-orange-100 to-red-50",
      border: "border-orange-200",
      text: "text-orange-800",
      accent: "text-orange-600",
      bar: "bg-orange-200",
      barFill: "bg-orange-500"
    };
  };

  const getOverallRiskColors = (prob) => {
    if (prob > 0.7) return {
      bg: "bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900",
      border: "border-gray-600",
      text: "text-gray-100",
      accent: "text-red-300",
      level: "STORM WARNING"
    };
    if (prob > 0.4) return {
      bg: "bg-gradient-to-br from-slate-600 to-gray-600",
      border: "border-slate-400",
      text: "text-slate-100",
      accent: "text-yellow-300",
      level: "WATCH"
    };
    return {
      bg: "bg-gradient-to-br from-emerald-100 to-teal-100",
      border: "border-emerald-300",
      text: "text-emerald-800",
      accent: "text-emerald-600",
      level: "CLEAR SKIES"
    };
  };

  const getRiskLevel = (prob) => {
    if (prob > 0.7) return "HIGH";
    if (prob > 0.4) return "MEDIUM";
    return "LOW";
  };

  const maxRisk = Math.max(result?.flood?.probability || 0, result?.wildfire?.probability || 0);
  const overallColors = getOverallRiskColors(maxRisk);

  // Prepare chart data
  const prepareHourlyData = () => {
    if (!weatherData?.forecast?.forecastday?.[0]?.hour) return [];
    
    return weatherData.forecast.forecastday[0].hour.map(hour => ({
      time: new Date(hour.time).getHours() + ":00",
      temperature: hour.temp_c,
      humidity: hour.humidity,
      windSpeed: hour.wind_kph,
      precipitation: hour.precip_mm,
      pressure: hour.pressure_mb
    }));
  };

  const prepareDailyData = () => {
    if (!weatherData?.forecast?.forecastday) return [];
    
    return weatherData.forecast.forecastday.map(day => ({
      date: new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      maxTemp: day.day.maxtemp_c,
      minTemp: day.day.mintemp_c,
      humidity: day.day.avghumidity,
      windSpeed: day.day.maxwind_kph,
      precipitation: day.day.totalprecip_mm,
      rainChance: day.day.daily_chance_of_rain
    }));
  };

  const hourlyData = prepareHourlyData();
  const dailyData = prepareDailyData();

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Weather-themed Header */}
      <header className="bg-gradient-to-r from-slate-800 via-blue-800 to-indigo-900 text-white p-6 shadow-xl relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-4 left-1/4 w-16 h-16 bg-white rounded-full animate-pulse"></div>
          <div className="absolute top-8 right-1/3 w-12 h-12 bg-white rounded-full animate-pulse delay-700"></div>
          <div className="absolute bottom-4 left-1/2 w-8 h-8 bg-white rounded-full animate-pulse delay-1000"></div>
        </div>
        
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-4xl animate-bounce">⛈️</div>
            <div>
              <h1 className="text-2xl font-bold tracking-wide">EarthPulse</h1>
              <p className="text-blue-200 text-sm">Advanced Weather & Disaster Risk Monitoring</p>
            </div>
          </div>
          
          {/* Current Location Button */}
          <button
            onClick={getCurrentLocation}
            disabled={locationLoading}
            className="flex items-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 rounded-xl px-4 py-2 transition-all duration-300 hover:scale-105 disabled:opacity-50"
          >
            <span className={`text-lg ${locationLoading ? 'animate-spin' : ''}`}>
              {locationLoading ? '🔄' : '📍'}
            </span>
            <span className="text-sm font-medium">Current Location</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Weather Station Sidebar */}
        <aside className="w-96 bg-white/80 backdrop-blur-sm border-r border-gray-200/50 p-6 overflow-y-auto shadow-lg">
          <div className="space-y-6">
            <div className="text-center">
              <h3 className="text-xl font-bold mb-2 text-gray-800 flex items-center justify-center gap-2">
                <span className="text-2xl">🌐</span>
                Location Search
              </h3>
              <p className="text-sm text-gray-600">Monitor weather risks worldwide</p>
            </div>

            {/* Enhanced Search Input */}
            <div className="relative" ref={searchRef}>
              <form onSubmit={handleSearchSubmit}>
                <div className="relative group">
                  <input
                    type="text"
                    placeholder="Search any city on Earth..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={handleSearchFocus}
                    className="w-full p-4 pl-12 pr-4 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all duration-300 bg-white/70 backdrop-blur-sm hover:bg-white/90 text-gray-800 placeholder-gray-500"
                  />
                  <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              </form>

              {/* Weather-styled Autocomplete */}
              {showSuggestions && (search.length > 0 || recentSearches.length > 0) && (
                <div
                  ref={suggestionsRef}
                  className="absolute top-full left-0 right-0 bg-white/95 backdrop-blur-md border border-gray-200 rounded-xl shadow-2xl mt-2 max-h-72 overflow-y-auto z-20"
                >
                  {search.length > 0 && filteredCities.length > 0 && (
                    <>
                      <div className="px-4 py-3 text-xs font-bold text-gray-500 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2">
                        <span>🌍</span>
                        WEATHER STATIONS
                      </div>
                      {filteredCities.map((city, index) => (
                        <button
                          key={`suggestion-${index}`}
                          onClick={() => handleCitySelect(city)}
                          className="w-full text-left px-4 py-3 hover:bg-blue-50/80 focus:bg-blue-50/80 focus:outline-none transition-all duration-200 group"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-blue-500 group-hover:scale-110 transition-transform">🏙️</span>
                            <span className="text-gray-800 font-medium">{city}</span>
                          </div>
                        </button>
                      ))}
                    </>
                  )}

                  {search.length > 0 && !filteredCities.some(city => city.toLowerCase() === search.toLowerCase()) && (
                    <>
                      <div className="px-4 py-3 text-xs font-bold text-gray-500 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2">
                        <span>🔍</span>
                        CUSTOM SEARCH
                      </div>
                      <button
                        onClick={() => handleCitySelect(search)}
                        className="w-full text-left px-4 py-3 hover:bg-green-50/80 focus:bg-green-50/80 focus:outline-none transition-all duration-200 group"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-green-500 group-hover:scale-110 transition-transform">🌍</span>
                          <span className="text-gray-800 font-medium">Search "{search}"</span>
                        </div>
                      </button>
                    </>
                  )}

                  {search.length === 0 && recentSearches.length > 0 && (
                    <>
                      <div className="px-4 py-3 text-xs font-bold text-gray-500 bg-gray-50/80 border-b border-gray-100 flex items-center gap-2">
                        <span>⏰</span>
                        RECENT FORECASTS
                      </div>
                      {recentSearches.map((city, index) => (
                        <button
                          key={`recent-${index}`}
                          onClick={() => handleCitySelect(city)}
                          className="w-full text-left px-4 py-3 hover:bg-purple-50/80 focus:bg-purple-50/80 focus:outline-none transition-all duration-200 group"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-purple-500 group-hover:scale-110 transition-transform">📍</span>
                            <span className="text-gray-800 font-medium">{city}</span>
                          </div>
                        </button>
                      ))}
                    </>
                  )}

                  {search.length > 0 && filteredCities.length === 0 && (
                    <div className="px-4 py-6 text-gray-500 text-center">
                      <div className="text-2xl mb-2">🌐</div>
                      <div>No stations found. Press Enter to search "{search}"</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Current Weather Data */}
            {weatherData && !weatherLoading && (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-blue-700 p-6 text-white shadow-lg">
                <div className="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-xl font-bold">{weatherData.location.name}</h4>
                      <p className="text-blue-200 text-sm">{weatherData.current.condition.text}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold">{weatherData.current.temp_c}°C</div>
                      <div className="text-sm opacity-75">Feels like {weatherData.current.feelslike_c}°C</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <span>💨</span>
                      <span>{weatherData.current.wind_kph} km/h {weatherData.current.wind_dir}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>💧</span>
                      <span>{weatherData.current.humidity}% humidity</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>🌧️</span>
                      <span>{weatherData.current.precip_mm}mm rainfall</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>📊</span>
                      <span>{weatherData.current.pressure_mb} mb</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Weather Loading Animation */}
            {(loading || weatherLoading) && (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-600 to-slate-700 p-6 text-white shadow-lg">
                <div className="absolute inset-0">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 animate-pulse"></div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg">🛰️</span>
                    </div>
                  </div>
                  <div>
                    <div className="font-bold text-lg">Analyzing Weather Patterns</div>
                    <div className="text-slate-300 text-sm">Scanning {selected} for risk indicators...</div>
                  </div>
                </div>
              </div>
            )}

            {/* Weather Alert Error */}
            {error && (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-600 to-red-700 p-5 text-white shadow-lg">
                <div className="flex items-center gap-3">
                  <span className="text-2xl animate-bounce">⚠️</span>
                  <div>
                    <div className="font-bold">Weather Alert</div>
                    <div className="text-red-200 text-sm">{error}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Weather Forecast Cards */}
            {result && !loading && !error && (
              <div className="space-y-6">
                {/* Main Weather Summary */}
                <div className={`relative overflow-hidden rounded-2xl p-6 shadow-xl border-2 ${overallColors.bg} ${overallColors.border} ${overallColors.text}`}>
                  <div className="absolute inset-0 bg-white/5 backdrop-blur-sm"></div>
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">🌪️</span>
                        <div>
                          <h4 className="text-xl font-bold">{result.city}</h4>
                          <p className="text-sm opacity-80">Current Risk Assessment</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${overallColors.accent}`}>
                          {overallColors.level}
                        </div>
                        <div className="text-sm opacity-75">
                          {getRiskLevel(maxRisk)} Risk Zone
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center">
                        <div className="text-2xl mb-1">🌊</div>
                        <div className="font-bold text-lg">
                          {((result.flood?.probability || 0) * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs opacity-75">Flood Risk</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl mb-1">🔥</div>
                        <div className="font-bold text-lg">
                          {((result.wildfire?.probability || 0) * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs opacity-75">Fire Risk</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detailed Weather Risk Cards */}
                <div className="space-y-4">
                  {/* Flood Forecast */}
                  <div className={`relative overflow-hidden rounded-xl p-5 shadow-lg border ${getFloodColors(result.flood?.probability || 0).bg} ${getFloodColors(result.flood?.probability || 0).border} ${getFloodColors(result.flood?.probability || 0).text}`}>
                    <div className="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>
                    <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-2xl animate-pulse">🌊</span>
                        <div>
                          <h5 className="font-bold text-lg">Flood Forecast</h5>
                          <p className="text-xs opacity-80">Precipitation Risk Analysis</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm">Risk Level:</span>
                          <span className="font-bold">{((result.flood?.probability || 0) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm">Classification:</span>
                          <span className="font-semibold">{result.flood?.label || "Unknown"}</span>
                        </div>
                        <div className={`w-full ${getFloodColors(result.flood?.probability || 0).bar} rounded-full h-3 overflow-hidden`}>
                          <div 
                            className={`${getFloodColors(result.flood?.probability || 0).barFill} h-3 rounded-full transition-all duration-1000 ease-out shadow-lg`}
                            style={{ width: `${(result.flood?.probability || 0) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Wildfire Forecast */}
                  <div className={`relative overflow-hidden rounded-xl p-5 shadow-lg border ${getWildfireColors(result.wildfire?.probability || 0).bg} ${getWildfireColors(result.wildfire?.probability || 0).border} ${getWildfireColors(result.wildfire?.probability || 0).text}`}>
                    <div className="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>
                    <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-2xl animate-pulse">🔥</span>
                        <div>
                          <h5 className="font-bold text-lg">Fire Weather</h5>
                          <p className="text-xs opacity-80">Wildfire Risk Analysis</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm">Risk Level:</span>
                          <span className="font-bold">{((result.wildfire?.probability || 0) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm">Classification:</span>
                          <span className="font-semibold">{result.wildfire?.label || "Unknown"}</span>
                        </div>
                        <div className={`w-full ${getWildfireColors(result.wildfire?.probability || 0).bar} rounded-full h-3 overflow-hidden`}>
                          <div 
                            className={`${getWildfireColors(result.wildfire?.probability || 0).barFill} h-3 rounded-full transition-all duration-1000 ease-out shadow-lg`}
                            style={{ width: `${(result.wildfire?.probability || 0) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Weather Advisory */}
                <div className="p-5 bg-gradient-to-br from-slate-100 to-gray-100 border border-gray-200 rounded-xl shadow-md">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-2xl">📊</span>
                    <h5 className="font-bold text-gray-800">Risk Scale</h5>
                  </div>
                  <div className="space-y-2 text-sm text-gray-700">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full"></div>
                      <span><span className="font-semibold text-green-700">Clear (0-40%)</span> - Favorable conditions</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full"></div>
                      <span><span className="font-semibold text-yellow-700">Watch (40-70%)</span> - Monitor conditions</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 bg-gradient-to-r from-red-500 to-red-700 rounded-full"></div>
                      <span><span className="font-semibold text-red-700">Warning (&gt;70%)</span> - High risk zone</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Weather Station Quick Access */}
            {!result && !loading && (
              <div className="space-y-4">
                <div className="text-center">
                  <h4 className="text-sm font-bold text-gray-600 mb-3 flex items-center justify-center gap-2">
                    <span>🌟</span>
                    MAJOR WEATHER STATIONS
                  </h4>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {SUGGESTED_CITIES.slice(0, 8).map((city) => (
                    <button
                      key={city}
                      onClick={() => handleCitySelect(city)}
                      className="p-3 bg-gradient-to-r from-white/80 to-gray-50/80 hover:from-blue-50/90 hover:to-blue-100/90 border border-gray-200 rounded-lg transition-all duration-300 text-left group shadow-sm hover:shadow-md"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-blue-500 group-hover:scale-110 transition-transform">🏙️</span>
                        <span className="text-gray-800 font-medium">{city}</span>
                        <span className="ml-auto text-gray-400 group-hover:text-blue-500 transition-colors">→</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main Weather Display */}
        <main className="flex-1 flex flex-col bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
          {weatherData ? (
            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              {/* Weather Charts Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
                    <span className="text-3xl">📈</span>
                    Weather Analytics
                  </h2>
                  <p className="text-gray-600">Detailed weather patterns and forecasts</p>
                </div>
                
                {/* View Mode Toggle */}
                <div className="flex bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200 p-1 shadow-sm">
  <button
    onClick={() => setViewMode("hourly")}
    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
      viewMode === "hourly"
        ? "bg-blue-500 text-white shadow-md"
        : "text-gray-600 hover:bg-gray-100"
    }`}
  >
    24 Hours
  </button>
  <button
    onClick={() => setViewMode("daily")}
    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
      viewMode === "daily"
        ? "bg-blue-500 text-white shadow-md"
        : "text-gray-600 hover:bg-gray-100"
    }`}
  >
    7 Days
  </button>
  <button
    onClick={() => setViewMode("combined")}
    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
      viewMode === "combined"
        ? "bg-blue-500 text-white shadow-md"
        : "text-gray-600 hover:bg-gray-100"
    }`}
  >
    Past 2 Days
  </button>
</div>

              </div>

              {/* Temperature Chart */}
              <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-white/50 p-6 shadow-lg">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <span className="text-xl">🌡️</span>
                  Temperature Trends
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={
  viewMode === "hourly" ? hourlyData :
  viewMode === "daily" ? dailyData :
  prepareCombinedData()
}>

                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis 
                        dataKey={viewMode === "hourly" ? "time" : "date"} 
                        stroke="#64748b"
                        fontSize={12}
                      />
                      <YAxis stroke="#64748b" fontSize={12} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                          border: 'none', 
                          borderRadius: '12px',
                          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
                        }} 
                      />
                      <Legend />
                      {viewMode === "hourly" ? (
                        <Line 
                          type="monotone" 
                          dataKey="temperature" 
                          stroke="#3b82f6" 
                          strokeWidth={3}
                          dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                          activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2 }}
                          name="Temperature (°C)"
                        />
                      ) : (
                        <>
                          <Line 
                            type="monotone" 
                            dataKey="maxTemp" 
                            stroke="#ef4444" 
                            strokeWidth={3}
                            dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }}
                            name="Max Temp (°C)"
                          />
                          <Line 
                            type="monotone" 
                            dataKey="minTemp" 
                            stroke="#3b82f6" 
                            strokeWidth={3}
                            dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                            name="Min Temp (°C)"
                          />
                        </>
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Weather Details Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Humidity & Wind */}
                <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-white/50 p-6 shadow-lg">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span className="text-xl">💨</span>
                    Humidity & Wind
                  </h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={
  viewMode === "hourly" ? hourlyData :
  viewMode === "daily" ? dailyData :
  prepareCombinedData()
}>

                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis 
                          dataKey={viewMode === "hourly" ? "time" : "date"} 
                          stroke="#64748b"
                          fontSize={12}
                        />
                        <YAxis stroke="#64748b" fontSize={12} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                            border: 'none', 
                            borderRadius: '12px',
                            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
                          }} 
                        />
                        <Legend />
                        <Line 
                          type="monotone" 
                          dataKey="humidity" 
                          stroke="#06b6d4" 
                          strokeWidth={2}
                          dot={{ fill: '#06b6d4', strokeWidth: 2, r: 3 }}
                          name="Humidity (%)"
                        />
                        <Line 
                          type="monotone" 
                          dataKey="windSpeed" 
                          stroke="#10b981" 
                          strokeWidth={2}
                          dot={{ fill: '#10b981', strokeWidth: 2, r: 3 }}
                          name="Wind Speed (km/h)"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Precipitation */}
                <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-white/50 p-6 shadow-lg">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span className="text-xl">🌧️</span>
                    Precipitation
                  </h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={
  viewMode === "hourly" ? hourlyData :
  viewMode === "daily" ? dailyData :
  prepareCombinedData()
}>

                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis 
                          dataKey={viewMode === "hourly" ? "time" : "date"} 
                          stroke="#64748b"
                          fontSize={12}
                        />
                        <YAxis stroke="#64748b" fontSize={12} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                            border: 'none', 
                            borderRadius: '12px',
                            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)'
                          }} 
                        />
                        <Legend />
                        <Bar 
                          dataKey="precipitation" 
                          fill="#3b82f6" 
                          radius={[4, 4, 0, 0]}
                          name="Rainfall (mm)"
                        />
                        {viewMode === "daily" && (
                          <Bar 
                            dataKey="rainChance" 
                            fill="#06b6d4" 
                            radius={[4, 4, 0, 0]}
                            name="Rain Chance (%)"
                          />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Additional Weather Metrics */}
              {weatherData.current && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-gradient-to-br from-blue-100 to-blue-200 rounded-xl p-4 text-center shadow-sm">
                    <div className="text-2xl mb-2">👁️</div>
                    <div className="text-sm text-blue-700 mb-1">Visibility</div>
                    <div className="text-lg font-bold text-blue-900">{weatherData.current.vis_km} km</div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-yellow-100 to-orange-200 rounded-xl p-4 text-center shadow-sm">
                    <div className="text-2xl mb-2">☀️</div>
                    <div className="text-sm text-orange-700 mb-1">UV Index</div>
                    <div className="text-lg font-bold text-orange-900">{weatherData.current.uv}</div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl p-4 text-center shadow-sm">
                    <div className="text-2xl mb-2">☁️</div>
                    <div className="text-sm text-gray-700 mb-1">Cloud Cover</div>
                    <div className="text-lg font-bold text-gray-900">{weatherData.current.cloud}%</div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-green-100 to-teal-200 rounded-xl p-4 text-center shadow-sm">
                    <div className="text-2xl mb-2">💨</div>
                    <div className="text-sm text-teal-700 mb-1">Wind Gust</div>
                    <div className="text-lg font-bold text-teal-900">{weatherData.current.gust_kph} km/h</div>
                  </div>
                </div>
              )}

{historyData && (
  <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-white/50 p-6 shadow-lg">
    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
      <span className="text-xl">📜</span>
      Past 2 Days Weather
    </h3>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {historyData.map((day, i) => (
        <div key={i} className="p-4 bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl shadow">
          <div className="font-semibold text-gray-700">
            {new Date(day.date).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </div>
          <div className="text-sm text-gray-600">
            Min: {day.minTemp != null ? `${day.minTemp}°C` : "N/A"}
          </div>
          <div className="text-sm text-gray-600">
            Max: {day.maxTemp != null ? `${day.maxTemp}°C` : "N/A"}
          </div>
          <div className="text-sm text-gray-600">
            Humidity: {day.humidity != null ? `${day.humidity.toFixed(1)}%` : "N/A"}
          </div>
          <div className="text-sm text-gray-600">
            Rain: {day.precipitation != null ? `${day.precipitation} mm` : "0 mm"}
          </div>
          <div className="text-sm text-gray-600">
            Wind: {day.windSpeed != null ? `${day.windSpeed.toFixed(1)} km/h` : "N/A"}
          </div>
        </div>
      ))}
    </div>
  </div>
)}



              {/* Map View */}
<div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-white/50 p-6 shadow-lg h-96">
  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
    <span className="text-xl">🗺️</span>
    City Map
  </h3>
  <MapView result={result} />
</div>

            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-6 max-w-md">
                <div className="relative">
                  <div className="text-8xl animate-bounce">🗺️</div>
                  <div className="absolute -top-4 -right-4 text-3xl animate-pulse">☁️</div>
                  <div className="absolute -bottom-2 -left-4 text-2xl animate-pulse delay-700">🌤️</div>
                </div>
                <div className="space-y-3">
                  <h2 className="text-2xl font-bold text-gray-800">Welcome to EarthPulse</h2>
                  <p className="text-gray-600 leading-relaxed">
                    Your advanced weather monitoring system. Search for any city to view 
                    real-time weather data, disaster risk forecasts, and detailed analytics.
                  </p>
                  <div className="flex items-center justify-center gap-4 text-sm text-gray-500 mt-4">
                    <span className="flex items-center gap-1">🌊 Flood Tracking</span>
                    <span className="flex items-center gap-1">🔥 Fire Monitoring</span>
                    <span className="flex items-center gap-1">📈 Weather Analytics</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Weather Station Footer */}
      <footer className="bg-gradient-to-r from-slate-800 to-gray-900 p-4 text-center text-white/80 text-sm border-t border-gray-700 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20"></div>
        <div className="relative z-10 flex items-center justify-center gap-2">
          <span className="animate-pulse">⛈️</span>
          <span>© 2025 EarthPulse — Advanced Meteorological Risk Assessment Platform</span>
          <span className="animate-pulse">⛈️</span>
        </div>
      </footer>
    </div>
  );
}

export default App;