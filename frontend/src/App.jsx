import MapView from "./MapView";
import { fetchWeather as fetchWeatherData, fetchPrediction as fetchPredictionApi, fetchPredictionByCoords, fetchWeatherHistory, sendPush } from "./api";

import React, { useEffect, useState, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";
import "./index.css";

// Popular Indian cities for initial suggestions
const SUGGESTED_CITIES = [
  // Assam
  "Guwahati","Dibrugarh","Silchar","Jorhat","Tezpur","Nagaon","Lakhimpur",
  "Kaziranga","Majuli","Sivasagar",

  // Bihar
  "Patna","Bhagalpur","Muzaffarpur","Darbhanga","Purnia","Katihar","Gaya",
  "Nalanda","Rajgir","Bodh Gaya",

  // Uttar Pradesh
  "Varanasi","Allahabad","Gorakhpur","Lucknow","Kanpur","Agra","Meerut","Ballia",
  "Ayodhya","Mathura","Vrindavan","Noida","Ghaziabad",

  // West Bengal
  "Kolkata","Howrah","Hooghly","Malda","Asansol","Siliguri","Cooch Behar",
  "Darjeeling","Kalimpong","Durgapur","Haldia",

  // Odisha
  "Bhubaneswar","Cuttack","Puri","Balasore","Bhadrak","Jagatsinghpur",
  "Konark","Rourkela","Sambalpur",

  // Maharashtra
  "Mumbai","Thane","Navi Mumbai","Pune","Kolhapur","Sangli","Nagpur",
  "Chandrapur","Gadchiroli",
  "Nashik","Aurangabad","Solapur","Lonavala","Mahabaleshwar",

  // Kerala
  "Kochi","Thiruvananthapuram","Kozhikode","Thrissur","Alappuzha","Kottayam",
  "Munnar","Wayanad","Idukki","Varkala",

  // Tamil Nadu
  "Chennai","Cuddalore","Nagapattinam","Coimbatore","Salem","Madurai",
  "Rameswaram","Kanyakumari","Tiruchirappalli","Thanjavur","Ooty",

  // Andhra Pradesh
  "Vijayawada","Rajahmundry","Kakinada","Visakhapatnam","Tirupati",
  "Nellore","Kurnool","Srikakulam","Araku",

  // Telangana
  "Hyderabad","Khammam","Adilabad","Mancherial","Warangal","Karimnagar",
  "Nizamabad","Mahbubnagar","Bhadrachalam",

  // Uttarakhand
  "Dehradun","Haridwar","Rishikesh","Nainital","Almora",
  "Mussoorie","Haldwani","Kedarnath","Badrinath",

  // Karnataka
  "Bengaluru","Mangaluru","Udupi","Hubballi","Belagavi",
  "Chikkamagaluru","Madikeri","Shivamogga","Hassan","Mysuru","Tumakuru",
  "Hampi","Gokarna","Coorg","Ballari","Davangere",

  // Madhya Pradesh
  "Bhopal","Indore","Jabalpur","Satna","Rewa","Ujjain",
  "Sanchi","Khajuraho","Gwalior","Pachmarhi",

  // Chhattisgarh
  "Raipur","Bilaspur","Durg","Jagdalpur","Bastar",
  "Korba","Ambikapur",

  // Rajasthan
  "Jaipur","Udaipur","Mount Abu","Kota","Ajmer","Bikaner",
  "Jodhpur","Jaisalmer","Pushkar","Chittorgarh",

  // Gujarat
  "Ahmedabad","Surat","Vadodara","Rajkot","Jamnagar","Gandhinagar",
  "Dwarka","Somnath","Bhuj","Porbandar","Statue of Unity",

  // Punjab
  "Chandigarh","Ludhiana","Jalandhar","Amritsar","Patiala",
  "Bathinda","Hoshiarpur",

  // Haryana
  "Gurgaon","Faridabad","Panipat","Sonipat","Rohtak",
  "Kurukshetra","Hisar","Karnal",

  // Himachal Pradesh
  "Shimla","Kullu","Mandi","Solan",
  "Manali","Dharamshala","Dalhousie","Una",

  // Jammu & Kashmir
  "Srinagar","Jammu","Anantnag","Baramulla",
  "Gulmarg","Pahalgam","Leh",

  // Delhi
  "Delhi","New Delhi"
];



// Replaced with real API imports
function App() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState(null);
  const [weatherData, setWeatherData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredCities, setFilteredCities] = useState([]);
  const [recentSearches, setRecentSearches] = useState([]);
  const [viewMode, setViewMode] = useState("daily"); // daily or hourly
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ep_notifications_enabled') || 'false'); } catch { return false; }
  });
  const [inAppAlerts, setInAppAlerts] = useState([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [historyData, setHistoryData] = useState(null);

  const apiKey = import.meta.env.VITE_WEATHERAPI_CURLOC;
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://earthpulse-backend-48598371636.asia-south1.run.app';
  const searchRef = useRef(null);
  const suggestionsRef = useRef(null);
  const autoSelectedRef = useRef(false);
  const hasUserSelectedRef = useRef(false);
  const [toasts, setToasts] = useState([]);

  const [isMapExpanded, setIsMapExpanded] = useState(false);


  // Register service worker and setup push subscription
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        // listen for messages from SW
        navigator.serviceWorker.addEventListener('message', (ev) => {
          if (ev.data?.type === 'PUSH_RECEIVED') {
            const { title, body } = ev.data.payload || {};
            setToasts(prev => [{ id: Date.now(), title, body }, ...prev].slice(0, 5));
          }
        });
      }).catch(err => console.warn('SW registration failed', err));
    }
  }, []);

  // Auto-select current location on first load
  useEffect(() => {
    if (!selected) {
      getCurrentLocation();
    }
  }, []);

  const showToast = (title, body) => {
    setToasts(prev => [{ id: Date.now(), title, body }, ...prev].slice(0, 5));
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };
const subscribeToPush = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const resp = await fetch(`${BACKEND_URL}/vapid_public_key`);
    if (!resp.ok) return;
    const data = await resp.json();
    const publicKey = data.publicKey;
    const reg = await navigator.serviceWorker.ready;

    // Check if already subscribed to avoid creating duplicates
    let existing = await reg.pushManager.getSubscription();
    if (!existing) {
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      await fetch(`${BACKEND_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub })
      });
      localStorage.setItem('ep_push_subscribed', 'true');
      showToast('Subscribed', 'Push notifications enabled');
    } else {
      // Ensure server knows about this subscription (in case backend restarted)
      await fetch(`${BACKEND_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: existing })
      });
      localStorage.setItem('ep_push_subscribed', 'true');
      showToast('Subscribed', 'Push subscription active');
    }
  } catch (e) {
    console.warn('Push subscribe failed', e);
  }

  // ✅ Always refresh subscription every time app loads (in case backend restarted)
  if (localStorage.getItem('ep_push_subscribed') !== 'true') {
    localStorage.setItem('ep_push_subscribed', 'true');
  }
};



  // Auto-enable notifications on first load
useEffect(() => {
  if ('Notification' in window) {
    // Ask permission if not granted or denied
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          setNotificationsEnabled(true);
          localStorage.setItem('ep_notifications_enabled', 'true');
          subscribeToPush();
        }
      });
    } else if (Notification.permission === 'granted') {
      // Already granted earlier
      setNotificationsEnabled(true);
      localStorage.setItem('ep_notifications_enabled', 'true');
      subscribeToPush();
    }
  }
}, []);


  // helper
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const getPrediction = async (city) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchPredictionApi(city);
      setResult(r);
      // result set -> alerts are handled in the result useEffect (avoid double alerts)
      
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

  // Notification helpers
  const sendBrowserNotification = (title, body) => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body }); } catch (e) { console.warn('Notification failed', e); }
    }
  };

  const addInAppAlert = (title, body) => {
    setInAppAlerts(prev => [{ id: Date.now(), title, body }, ...prev].slice(0, 5));
  };

  const processResultAlerts = (res) => {
    if (!res) return;

    const floodProb = res.flood?.probability || 0;
    const fireProb = res.wildfire?.probability || 0;

    const mediumThreshold = 0.4; // >=40% -> medium
    const highThreshold = 0.7; // >=70% -> high

    if (floodProb >= highThreshold) {
      const title = `${res.city}: HIGH Flood Risk`;
      const body = `Flood probability ${(floodProb*100).toFixed(0)}% — take precautions.`;
      addInAppAlert(title, body);
      if (notificationsEnabled) sendBrowserNotification(title, body);
    } else if (floodProb >= mediumThreshold) {
      const title = `${res.city}: Flood Watch`;
      const body = `Flood probability ${(floodProb*100).toFixed(0)}% — monitor conditions.`;
      addInAppAlert(title, body);
      if (notificationsEnabled) sendBrowserNotification(title, body);
    }

    if (fireProb >= highThreshold) {
      const title = `${res.city}: HIGH Fire Risk`;
      const body = `Fire probability ${(fireProb*100).toFixed(0)}% — exercise caution.`;
      addInAppAlert(title, body);
      if (notificationsEnabled) sendBrowserNotification(title, body);
    } else if (fireProb >= mediumThreshold) {
      const title = `${res.city}: Fire Watch`;
      const body = `Fire probability ${(fireProb*100).toFixed(0)}% — monitor conditions.`;
      addInAppAlert(title, body);
      if (notificationsEnabled) sendBrowserNotification(title, body);
    }
  };

  const enableNotifications = async () => {
    try {
      if ('Notification' in window && Notification.permission !== 'granted') {
        await Notification.requestPermission();
      }
    } catch (e) {
      console.warn('Notification permission error', e);
    }
    setNotificationsEnabled(true);
    localStorage.setItem('ep_notifications_enabled', 'true');
    // try subscribing to push as well
    subscribeToPush();
  };

  const disableNotifications = () => {
    setNotificationsEnabled(false);
    localStorage.setItem('ep_notifications_enabled', 'false');
  };

  const prepareCombinedData = () => {
  const history = historyData?.map(day => ({
    date: new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    maxTemp: day.maxTemp,
    minTemp: day.minTemp,
    humidity: day.humidity,
    precipitation: day.precipitation ?? day.precip ?? 0,
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

  const getCurrentLocation = (allowOverride = false) => {
  setLocationLoading(true);
  if (!navigator.geolocation) {
    setError("Geolocation is not supported by this browser");
    setLocationLoading(false);
    return;
  }

  // If the user has explicitly chosen a city, don't overwrite it unless
  // allowOverride is true (the button press should pass true).
  if (hasUserSelectedRef.current && !allowOverride) {
    setError('Keeping your selected city. Click the pin to override with current location.');
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
        if (!resp.ok) {
          throw new Error('Reverse geocoding failed');
        }
        let places = [];
        try { places = await resp.json(); } catch (e) { throw new Error('Invalid response from location lookup'); }

        let cityName = "Current Location";
        if (places && places.length > 0 && places[0].name) cityName = places[0].name;

        // If the user selected a city while we were resolving coords, respect it
        if (hasUserSelectedRef.current && !allowOverride) {
          setError('Keeping your selected city. Click the pin to override with current location.');
          setLocationLoading(false);
          return;
        }

        // Update state (mark as auto-selected on load)
        setSelected(cityName);
        autoSelectedRef.current = true;
        hasUserSelectedRef.current = false;

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
    if (!selected) return; // avoid calling APIs with empty city (prevents 400)

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

  // Watch for changes to result and create alerts when risks are medium/high
  useEffect(() => {
    if (!result) return;

    const floodProb = result.flood?.probability || 0;
    const fireProb = result.wildfire?.probability || 0;

    const mediumThreshold = 0.4; // >=40% -> medium
    const highThreshold = 0.7; // >=70% -> high

    if (floodProb >= highThreshold) {
      const title = `${result.city}: HIGH Flood Risk`;
      const body = `Flood probability ${(floodProb*100).toFixed(0)}% — take precautions.`;
      // Always show in-app alert
      addInAppAlert(title, body);
      // Generate a tag so native notifications from page and SW can be deduplicated/replaced
      const tag = `earthpulse:${result.city}:flood:${Math.floor(Date.now()/60000)}`;
      // Send native/browser notification from page (if enabled)
      if (notificationsEnabled) {
        try {
          new Notification(title, { body, tag });
        } catch (e) { console.warn('Notification failed', e); }
      }
      // If subscribed to push, also request the backend to send a push (include tag)
      try {
        if (notificationsEnabled && localStorage.getItem('ep_push_subscribed') === 'true') {
          sendPush({ title, body, tag }).catch(e => console.warn('push send failed', e));
        }
      } catch (e) { /* ignore */ }
    } else if (floodProb >= mediumThreshold) {
      const title = `${result.city}: Flood Watch`;
      const body = `Flood probability ${(floodProb*100).toFixed(0)}% — monitor conditions.`;
      addInAppAlert(title, body);
      const tag = `earthpulse:${result.city}:flood:${Math.floor(Date.now()/60000)}`;
      if (notificationsEnabled) {
        try {
          new Notification(title, { body, tag });
        } catch (e) { console.warn('Notification failed', e); }
      }
      try {
        if (notificationsEnabled && localStorage.getItem('ep_push_subscribed') === 'true') {
          sendPush({ title, body, tag }).catch(e => console.warn('push send failed', e));
        }
      } catch (e) { }
    }

    if (fireProb >= highThreshold) {
      const title = `${result.city}: HIGH Fire Risk`;
      const body = `Fire probability ${(fireProb*100).toFixed(0)}% — exercise caution.`;
      addInAppAlert(title, body);
      const tag = `earthpulse:${result.city}:fire:${Math.floor(Date.now()/60000)}`;
      if (notificationsEnabled) {
        try {
          new Notification(title, { body, tag });
        } catch (e) { console.warn('Notification failed', e); }
      }
      try {
        if (notificationsEnabled && localStorage.getItem('ep_push_subscribed') === 'true') {
          sendPush({ title, body, tag }).catch(e => console.warn('push send failed', e));
        }
      } catch (e) { }
    } else if (fireProb >= mediumThreshold) {
      const title = `${result.city}: Fire Watch`;
      const body = `Fire probability ${(fireProb*100).toFixed(0)}% — monitor conditions.`;
      addInAppAlert(title, body);
      const tag = `earthpulse:${result.city}:fire:${Math.floor(Date.now()/60000)}`;
      if (notificationsEnabled) {
        try {
          new Notification(title, { body, tag });
        } catch (e) { console.warn('Notification failed', e); }
      }
      try {
        if (notificationsEnabled && localStorage.getItem('ep_push_subscribed') === 'true') {
          sendPush({ title, body, tag }).catch(e => console.warn('push send failed', e));
        }
      } catch (e) { }
    }

  }, [result, notificationsEnabled]);


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
    // user explicitly selected a city -> clear auto-selected flag
    autoSelectedRef.current = false;
    hasUserSelectedRef.current = true;
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
precipitation:
  (hour.precip_mm ?? hour.precipitation ?? hour.rain ?? 0) > 0
    ? Math.max(hour.precip_mm ?? hour.precipitation ?? hour.rain, 0.2)
    : 0,
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
      precipitation: day.day.totalprecip_mm ?? day.day.precipitation ?? 0,
      rainChance: day.day.daily_chance_of_rain
    }));
  };

  const hourlyData = prepareHourlyData();
  const dailyData = prepareDailyData();

  
return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 text-white p-4 shadow-lg relative overflow-hidden border-b border-slate-700/50">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-0 left-0 w-full h-full" style={{
            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(59, 130, 246, 0.1) 10px, rgba(59, 130, 246, 0.1) 20px)'
          }}></div>
        </div>

        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🌍</div>
            <div>
              <h1 className="text-xl font-bold tracking-wide">EarthPulse</h1>
              <p className="text-blue-300 text-xs font-medium">Disaster Prediction & Monitoring System</p>
            </div>
          </div>
      
<div className="flex items-center gap-2">

  {/* DOWNLOAD BUTTON */}
  <button
    onClick={() => {
      if (!selected) return alert("Please select a city first.");
      window.open(`${BACKEND_URL}/download_report?city=${selected}`, "_blank");
    }}
    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 backdrop-blur-sm border border-indigo-500/50 rounded-lg px-3 py-2 transition-all duration-200 text-sm font-medium text-white"
  >
    ⬇ Download
  </button>

  {/* LOCATION BUTTON */}
  <button
    onClick={() => getCurrentLocation(true)}
    disabled={locationLoading}
    className="flex items-center gap-2 bg-slate-700/60 hover:bg-slate-600/60 backdrop-blur-sm border border-slate-600/50 rounded-lg px-3 py-2 transition-all duration-200 disabled:opacity-50 text-sm font-medium"
  >
    <span className={`text-base ${locationLoading ? 'animate-spin' : ''}`}>
      {locationLoading ? '🔄' : '📍'}
    </span>
  </button>

  {/* ALERT BUTTON */}
  <div className="flex items-center gap-2 bg-slate-700/40 border border-slate-600/40 rounded-lg px-2 py-1 text-xs">
    <button
      disabled
      className="px-2 py-1 rounded-md text-xs font-semibold bg-blue-600/80 text-white"
    >
      🔔
    </button>
  </div>

</div>


        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-96 bg-gradient-to-b from-slate-800 to-slate-900 border-r border-slate-700/30 p-6 overflow-y-auto shadow-xl">
          <div className="space-y-6">
            <div className="text-center border-b border-slate-700/30 pb-4">
              <h3 className="text-xl font-bold mb-2 text-blue-400 flex items-center justify-center gap-2">
                <span className="text-2xl">🎯</span>
                Location Scanner
              </h3>
              <p className="text-sm text-slate-400 font-medium">Global Threat Assessment</p>
            </div>

            {/* Search Input */}
            <div className="relative" ref={searchRef}>
              <form onSubmit={handleSearchSubmit}>
                <div className="relative group">
                  <input
                    type="text"
                    placeholder="Search location..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={handleSearchFocus}
                    className="w-full p-4 pl-12 pr-4 border border-slate-600/50 bg-slate-800/60 rounded-xl focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 outline-none transition-all duration-300 backdrop-blur-sm hover:bg-slate-700/60 text-slate-200 placeholder-slate-500"
                  />
                  <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-blue-500 group-focus-within:text-blue-400 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              </form>

              {/* Autocomplete */}
              {showSuggestions && (search.length > 0 || recentSearches.length > 0) && (
                <div
                  ref={suggestionsRef}
                  className="absolute top-full left-0 right-0 bg-slate-800/98 backdrop-blur-md border border-slate-600/50 rounded-xl shadow-2xl mt-2 max-h-72 overflow-y-auto z-20"
                >
                  {search.length > 0 && filteredCities.length > 0 && (
                    <>
                      <div className="px-4 py-3 text-xs font-semibold text-blue-400 bg-slate-900/80 border-b border-slate-700/30 flex items-center gap-2">
                        <span>🌍</span>
                        Available Locations
                      </div>
                      {filteredCities.map((city, index) => (
                        <button
                          key={`suggestion-${index}`}
                          onClick={() => handleCitySelect(city)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-700/50 focus:bg-slate-700/50 focus:outline-none transition-all duration-200 group border-b border-slate-700/20"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-blue-500 group-hover:scale-110 transition-transform">📍</span>
                            <span className="text-slate-300">{city}</span>
                          </div>
                        </button>
                      ))}
                    </>
                  )}

                  {search.length > 0 && !filteredCities.some(city => city.toLowerCase() === search.toLowerCase()) && (
                    <>
                      <div className="px-4 py-3 text-xs font-semibold text-amber-400 bg-slate-900/80 border-b border-slate-700/30 flex items-center gap-2">
                        <span>🔍</span>
                        Custom Search
                      </div>
                      <button
                        onClick={() => handleCitySelect(search)}
                        className="w-full text-left px-4 py-3 hover:bg-amber-900/30 focus:bg-amber-900/30 focus:outline-none transition-all duration-200 group"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-amber-500 group-hover:scale-110 transition-transform">🌍</span>
                          <span className="text-slate-300">Search "{search}"</span>
                        </div>
                      </button>
                    </>
                  )}

                  {search.length === 0 && recentSearches.length > 0 && (
                    <>
                      <div className="px-4 py-3 text-xs font-semibold text-emerald-400 bg-slate-900/80 border-b border-slate-700/30 flex items-center gap-2">
                        <span>⏰</span>
                        Recent Searches
                      </div>
                      {recentSearches.map((city, index) => (
                        <button
                          key={`recent-${index}`}
                          onClick={() => handleCitySelect(city)}
                          className="w-full text-left px-4 py-3 hover:bg-emerald-900/30 focus:bg-emerald-900/30 focus:outline-none transition-all duration-200 group border-b border-slate-700/20"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-emerald-500 group-hover:scale-110 transition-transform">📍</span>
                            <span className="text-slate-300">{city}</span>
                          </div>
                        </button>
                      ))}
                    </>
                  )}

                  {search.length > 0 && filteredCities.length === 0 && (
                    <div className="px-4 py-6 text-slate-500 text-center">
                      <div className="text-2xl mb-2">🌐</div>
                      <div className="text-sm">No locations found. Press Enter to search "{search}"</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Current Weather */}
            {weatherData && !weatherLoading && (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-6 text-white shadow-xl border border-slate-600/50">
                <div className="absolute inset-0 bg-blue-500/5 backdrop-blur-sm"></div>
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4 border-b border-slate-600/30 pb-3">
                    <div>
                      <h4 className="text-xl font-bold text-blue-300">{weatherData.location.name}</h4>
                      <p className="text-slate-400 text-sm">{weatherData.current.condition.text}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-blue-400">{weatherData.current.temp_c}°C</div>
                      <div className="text-sm opacity-75">Feels {weatherData.current.feelslike_c}°C</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-2 bg-slate-900/50 p-3 rounded-lg border border-slate-700/20">
                      <span>💨</span>
                      <span>{weatherData.current.wind_kph} km/h {weatherData.current.wind_dir}</span>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-900/50 p-3 rounded-lg border border-slate-700/20">
                      <span>💧</span>
                      <span>{weatherData.current.humidity}% Humidity</span>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-900/50 p-3 rounded-lg border border-slate-700/20">
                      <span>🌧️</span>
                      <span>{weatherData.current.precip_mm}mm Rain</span>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-900/50 p-3 rounded-lg border border-slate-700/20">
                      <span>📊</span>
                      <span>{weatherData.current.pressure_mb} mb</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Loading */}
            {(loading || weatherLoading) && (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-6 text-white shadow-xl border border-blue-600/50">
                <div className="absolute inset-0">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 animate-pulse"></div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-12 h-12 border-4 border-slate-700/30 border-t-blue-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg">🛰️</span>
                    </div>
                  </div>
                  <div>
                    <div className="font-bold text-lg text-blue-400">Scanning Location</div>
                    <div className="text-slate-400 text-sm">Analyzing {selected}...</div>
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-900/50 to-rose-800/50 p-5 text-white shadow-xl border border-rose-700/50">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div>
                    <div className="font-bold text-rose-300">System Alert</div>
                    <div className="text-rose-200 text-sm">{error}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Threat Cards */}
            {result && !loading && !error && (
              <div className="space-y-6">
                {/* Main Summary */}
                <div className={`relative overflow-hidden rounded-2xl p-6 shadow-xl border ${overallColors.bg} ${overallColors.border} ${overallColors.text}`}>
                  <div className="absolute inset-0 bg-black/20 backdrop-blur-sm"></div>
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">⚠️</span>
                        <div>
                          <h4 className="text-xl font-bold">{result.city}</h4>
                          <p className="text-sm opacity-80">Threat Assessment</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${overallColors.accent}`}>
                          {overallColors.level}
                        </div>
                        <div className="text-sm opacity-75">
                          {getRiskLevel(maxRisk)} Risk
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center bg-black/20 rounded-lg p-3 border border-white/10">
                        <div className="text-2xl mb-1">🌊</div>
                        <div className="font-bold text-lg">
                          {((result.flood?.probability || 0) * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs opacity-75">Flood</div>
                      </div>
                      <div className="text-center bg-black/20 rounded-lg p-3 border border-white/10">
                        <div className="text-2xl mb-1">🔥</div>
                        <div className="font-bold text-lg">
                          {((result.wildfire?.probability || 0) * 100).toFixed(0)}%
                        </div>
                        <div className="text-xs opacity-75">Fire</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detailed Cards */}
                <div className="space-y-4">
                  {/* Flood */}
                  <div className={`relative overflow-hidden rounded-xl p-5 shadow-xl border ${getFloodColors(result.flood?.probability || 0).bg} ${getFloodColors(result.flood?.probability || 0).border} ${getFloodColors(result.flood?.probability || 0).text}`}>
                    <div className="absolute inset-0 bg-black/20 backdrop-blur-sm"></div>
                    <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-3 border-b border-white/10 pb-2">
                        <span className="text-2xl">🌊</span>
                        <div>
                          <h5 className="font-bold text-lg">Flood Threat</h5>
                          <p className="text-xs opacity-80">Precipitation Analysis</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center bg-black/20 p-2 rounded text-sm">
                          <span>Risk Level:</span>
                          <span className="font-bold">{((result.flood?.probability || 0) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between items-center bg-black/20 p-2 rounded text-sm">
                          <span>Status:</span>
                          <span className="font-semibold">{result.flood?.label || "Unknown"}</span>
                        </div>
                        <div className={`w-full ${getFloodColors(result.flood?.probability || 0).bar} rounded-full h-3 overflow-hidden border border-white/20`}>
                          <div 
                            className={`${getFloodColors(result.flood?.probability || 0).barFill} h-3 rounded-full transition-all duration-1000 ease-out shadow-lg`}
                            style={{ width: `${(result.flood?.probability || 0) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Fire */}
                  <div className={`relative overflow-hidden rounded-xl p-5 shadow-xl border ${getWildfireColors(result.wildfire?.probability || 0).bg} ${getWildfireColors(result.wildfire?.probability || 0).border} ${getWildfireColors(result.wildfire?.probability || 0).text}`}>
                    <div className="absolute inset-0 bg-black/20 backdrop-blur-sm"></div>
                    <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-3 border-b border-white/10 pb-2">
                        <span className="text-2xl">🔥</span>
                        <div>
                          <h5 className="font-bold text-lg">Fire Threat</h5>
                          <p className="text-xs opacity-80">Wildfire Analysis</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center bg-black/20 p-2 rounded text-sm">
                          <span>Risk Level:</span>
                          <span className="font-bold">{((result.wildfire?.probability || 0) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between items-center bg-black/20 p-2 rounded text-sm">
                          <span>Status:</span>
                          <span className="font-semibold">{result.wildfire?.label || "Unknown"}</span>
                        </div>
                        <div className={`w-full ${getWildfireColors(result.wildfire?.probability || 0).bar} rounded-full h-3 overflow-hidden border border-white/20`}>
                          <div 
                            className={`${getWildfireColors(result.wildfire?.probability || 0).barFill} h-3 rounded-full transition-all duration-1000 ease-out shadow-lg`}
                            style={{ width: `${(result.wildfire?.probability || 0) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Scale */}
                <div className="p-5 bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-600/30 rounded-xl shadow-xl">
                  <div className="flex items-center gap-3 mb-3 border-b border-slate-600/30 pb-2">
                    <span className="text-2xl">📊</span>
                    <h5 className="font-bold text-slate-200">Threat Scale</h5>
                  </div>
                  <div className="space-y-2 text-sm text-slate-300">
                    <div className="flex items-center gap-3 bg-emerald-900/30 p-2 rounded border border-emerald-800/30">
                      <div className="w-4 h-4 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full"></div>
                      <span><span className="font-semibold text-emerald-400">Safe (0-40%)</span> - Minimal risk</span>
                    </div>
                    <div className="flex items-center gap-3 bg-amber-900/30 p-2 rounded border border-amber-800/30">
                      <div className="w-4 h-4 bg-gradient-to-r from-amber-500 to-orange-600 rounded-full"></div>
                      <span><span className="font-semibold text-amber-400">Alert (40-70%)</span> - Monitor closely</span>
                    </div>
                    <div className="flex items-center gap-3 bg-rose-900/30 p-2 rounded border border-rose-800/30">
                      <div className="w-4 h-4 bg-gradient-to-r from-rose-600 to-rose-800 rounded-full"></div>
                      <span><span className="font-semibold text-rose-400">Danger (&gt;70%)</span> - Take action</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Access */}
            {!result && !loading && (
              <div className="space-y-4">
                <div className="text-center">
                  <h4 className="text-sm font-semibold text-blue-400 mb-3 flex items-center justify-center gap-2">
                    <span>🎯</span>
                    Quick Access Stations
                  </h4>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {SUGGESTED_CITIES.slice(0, 8).map((city) => (
                    <button
                      key={city}
                      onClick={() => handleCitySelect(city)}
                      className="p-3 bg-gradient-to-r from-slate-800/90 to-slate-900/90 hover:from-slate-700/90 hover:to-slate-800/90 border border-slate-600/30 rounded-lg transition-all duration-300 text-left group shadow-lg hover:shadow-blue-900/30"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-blue-500 group-hover:scale-110 transition-transform">📍</span>
                        <span className="text-slate-300 text-sm">{city}</span>
                        <span className="ml-auto text-blue-500 group-hover:text-blue-400 transition-colors font-bold">›</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
          {weatherData ? (
            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-700/30 pb-4">
                <div>
                  <h2 className="text-2xl font-bold text-blue-400 flex items-center gap-3">
                    <span className="text-3xl">📊</span>
                    Data Analytics
                  </h2>
                  <p className="text-slate-400 text-sm">Real-time threat pattern analysis</p>
                </div>
                
                {/* View Toggle */}
                <div className="flex bg-slate-800/90 backdrop-blur-sm rounded-xl border border-slate-600/30 p-1 shadow-lg">
                  <button
                    onClick={() => setViewMode("hourly")}
                    className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-300 ${
                      viewMode === "hourly"
                        ? "bg-blue-600 text-white shadow-md"
                        : "text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                    }`}
                  >
                    24 Hours
                  </button>
                  <button
                    onClick={() => setViewMode("daily")}
                    className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-300 ${
                      viewMode === "daily"
                        ? "bg-blue-600 text-white shadow-md"
                        : "text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                    }`}
                  >
                    7 Days
                  </button>
                  <button
                    onClick={() => setViewMode("combined")}
                    className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all duration-300 ${
                      viewMode === "combined"
                        ? "bg-blue-600 text-white shadow-md"
                        : "text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                    }`}
                  >
                    2D History
                  </button>
                </div>
              </div>

              {/* Temperature Chart */}
              <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl border border-slate-600/50 p-6 shadow-xl">
                <h3 className="text-lg font-bold text-blue-400 mb-4 flex items-center gap-2">
                  <span className="text-xl">🌡️</span>
                  Temperature Analysis
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={
                      viewMode === "hourly" ? hourlyData :
                      viewMode === "daily" ? dailyData :
                      prepareCombinedData()
                    }>
                      <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                      <XAxis 
                        dataKey={viewMode === "hourly" ? "time" : "date"} 
                        stroke="#94a3b8"
                        fontSize={12}
                      />
                      <YAxis
  stroke="#94a3b8"
  fontSize={12}
  domain={[0, 'dataMax + 1']}
  allowDecimals={false}
/>

                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'rgba(15, 23, 42, 0.95)', 
                          border: '1px solid #475569', 
                          borderRadius: '12px',
                          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)'
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
                            stroke="#f97316" 
                            strokeWidth={3}
                            dot={{ fill: '#f97316', strokeWidth: 2, r: 4 }}
                            name="Max Temp (°C)"
                          />
                          <Line 
                            type="monotone" 
                            dataKey="minTemp" 
                            stroke="#06b6d4" 
                            strokeWidth={3}
                            dot={{ fill: '#06b6d4', strokeWidth: 2, r: 4 }}
                            name="Min Temp (°C)"
                          />
                        </>
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Environmental Metrics */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Humidity & Wind */}
                <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl border border-slate-600/50 p-6 shadow-xl">
                  <h3 className="text-lg font-bold text-blue-400 mb-4 flex items-center gap-2">
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
                        <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                        <XAxis 
                          dataKey={viewMode === "hourly" ? "time" : "date"} 
                          stroke="#94a3b8"
                          fontSize={12}
                        />
                        <YAxis stroke="#94a3b8" fontSize={12} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'rgba(15, 23, 42, 0.95)', 
                            border: '1px solid #475569', 
                            borderRadius: '12px',
                            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)'
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
                <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl border border-slate-600/50 p-6 shadow-xl">
                  <h3 className="text-lg font-bold text-blue-400 mb-4 flex items-center gap-2">
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
                        <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                        <XAxis 
                          dataKey={viewMode === "hourly" ? "time" : "date"} 
                          stroke="#94a3b8"
                          fontSize={12}
                        />
                        <YAxis stroke="#94a3b8" fontSize={12} />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'rgba(15, 23, 42, 0.95)', 
                            border: '1px solid #475569', 
                            borderRadius: '12px',
                            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)'
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

              {/* Additional Metrics */}
              {weatherData.current && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-cyan-600/50 rounded-xl p-4 text-center shadow-lg">
                    <div className="text-2xl mb-2">👁️</div>
                    <div className="text-sm text-cyan-400 mb-1">Visibility</div>
                    <div className="text-lg font-bold text-cyan-300">{weatherData.current.vis_km} km</div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-orange-600/50 rounded-xl p-4 text-center shadow-lg">
                    <div className="text-2xl mb-2">☀️</div>
                    <div className="text-sm text-orange-400 mb-1">UV Index</div>
                    <div className="text-lg font-bold text-orange-300">{weatherData.current.uv ?? "N/A"}</div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-500/50 rounded-xl p-4 text-center shadow-lg">
                    <div className="text-2xl mb-2">☁️</div>
                    <div className="text-sm text-slate-400 mb-1">Cloud Cover</div>
                    <div className="text-lg font-bold text-slate-300">{weatherData.current.cloud}%</div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-emerald-600/50 rounded-xl p-4 text-center shadow-lg">
                    <div className="text-2xl mb-2">💨</div>
                    <div className="text-sm text-emerald-400 mb-1">Wind Gust</div>
                    <div className="text-lg font-bold text-emerald-300">{weatherData.current.gust_kph} km/h</div>
                  </div>
                </div>
              )}

              {/* Historical Data
              {historyData && (
                <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl border border-slate-600/50 p-6 shadow-xl">
                  <h3 className="text-lg font-bold text-blue-400 mb-4 flex items-center gap-2">
                    <span className="text-xl">📜</span>
                    Historical Data (48H)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {historyData.map((day, i) => (
                      <div key={i} className="p-4 bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl shadow-lg border border-slate-700/20">
                        <div className="font-semibold text-blue-300 mb-2">
                          {new Date(day.date).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </div>
                        <div className="text-sm text-slate-400 space-y-1">
                          <div>Min: {day.minTemp != null ? `${day.minTemp}°C` : "N/A"}</div>
                          <div>Max: {day.maxTemp != null ? `${day.maxTemp}°C` : "N/A"}</div>
                          <div>Humidity: {day.humidity != null ? `${day.humidity.toFixed(1)}%` : "N/A"}</div>
                          <div>Rain: {day.precipitation ?? day.precip ?? 0} mm</div>
                          <div>Wind: {day.windSpeed != null ? `${day.windSpeed.toFixed(1)} km/h` : "N/A"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )} */}

<div
  className={`transition-all duration-300 ${
    isMapExpanded
      ? "fixed inset-0 z-50 bg-slate-900 p-4"
      : "relative p-4 bg-slate-900/50 h-[400px]"
  }`}
>

  {/* TOP RIGHT BUTTON BAR (same structure, only extended) */}
  <div className="flex justify-between items-center mb-2">

    {/* EXISTING MAP EXPAND BUTTON — UNCHANGED */}
    <button
      onClick={() => setIsMapExpanded(!isMapExpanded)}
      className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-all"
    >
      {isMapExpanded ? "🔽 Collapse Map" : "🔼 Expand Map"}
    </button>

  </div>

  {/* MAP COMPONENT */}
  <MapView result={result} isMapExpanded={isMapExpanded} />
</div>


</div>

          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-6 max-w-md">
                <div className="relative">
                  <div className="text-8xl">🌍</div>
                  <div className="absolute -top-4 -right-4 text-3xl">🔥</div>
                  <div className="absolute -bottom-2 -left-4 text-2xl">🌊</div>
                </div>
                <div className="space-y-3">
                  <h2 className="text-2xl font-bold text-blue-400">EarthPulse System</h2>
                  <p className="text-slate-400 leading-relaxed text-sm">
                    Advanced disaster prediction & monitoring system. Enter a location to initiate 
                    real-time threat assessment, risk forecasting, and environmental analysis.
                  </p>
                  <div className="flex items-center justify-center gap-4 text-sm text-slate-500 mt-4">
                    <span className="flex items-center gap-1">🌊 Flood</span>
                    <span className="flex items-center gap-1">🔥 Fire</span>
                    <span className="flex items-center gap-1">📊 Analytics</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Toasts */}
      <div className="fixed top-6 right-6 z-50 space-y-3 w-80">
        {toasts.map(t => (
          <div key={t.id} className="bg-slate-900/98 border border-blue-600/50 rounded-lg p-4 shadow-2xl relative backdrop-blur-sm">
            <button
              aria-label="Close notification"
              onClick={() => removeToast(t.id)}
              className="absolute top-2 right-2 text-blue-400 hover:text-blue-300 text-xl"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              ×
            </button>
            <div className="font-semibold text-blue-400">{t.title}</div>
            <div className="text-slate-400 text-sm">{t.body}</div>
          </div>
        ))}
      </div>

      <footer className="bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 p-3 text-center text-slate-400 text-xs border-t border-slate-700/50 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 to-cyan-600/5"></div>
        <div className="relative z-10 flex items-center justify-center gap-2">
          <span className="text-sm">🌍</span>
          <span>© 2025 EarthPulse - Disaster Monitoring System</span>
          <span className="text-sm">🌍</span>
        </div>
      </footer>
    </div>
  );




}

export default App;