// Enhanced MapView.jsx with Eye-Friendly Theme
import React, { useEffect, useState, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Tooltip,
  GeoJSON,
  useMap,
  ZoomControl,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import axios from "axios";
import "leaflet.heat";


const BACKEND = import.meta.env.VITE_BACKEND_URL || "https://earthpulse-backend.onrender.com";

// Fix default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Custom Icons
const CityIcon = L.icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const NgoIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  iconSize: [30, 48],
  iconAnchor: [15, 48],
});

const PoliceIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/2983/2983781.png",
  iconSize: [30, 30],
  iconAnchor: [15, 30]
});

const FireIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/482/482058.png",
  iconSize: [30, 30],
  iconAnchor: [15, 30]
});

const HospitalIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/2967/2967350.png",
  iconSize: [30, 30],
  iconAnchor: [15, 30]
});


const ShelterIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/1483/1483336.png",
  iconSize: [30, 30],
  iconAnchor: [15, 30]
});

const EocIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/484/484167.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32]
});

const WarehouseIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/1046/1046857.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32]
});

const AmbulanceIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/2967/2967353.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32]
});



// Map Component
function MapView({ result, isMapExpanded }) {

  const [coords, setCoords] = useState([20.59, 78.96]);
  const [ngos, setNgos] = useState([]);
  const [showNgos, setShowNgos] = useState(true);
  const [hotspots, setHotspots] = useState([]);
  const [showHotspots, setShowHotspots] = useState(true);
  const [floodZones, setFloodZones] = useState(null);
  const [showFloodZones, setShowFloodZones] = useState(true);
  const [waterways, setWaterways] = useState(null);
  const [showWaterways, setShowWaterways] = useState(true);
  const heatLayerRef = useRef(null);
  
  const [chatOpen, setChatOpen] = useState(false);
  const [chatNgo, setChatNgo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const mapRef = useRef(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
const [selectedNgo, setSelectedNgo] = useState(null);
// Emergency services
const [policeStations, setPoliceStations] = useState([]);
const [fireStations, setFireStations] = useState([]);
const [hospitals, setHospitals] = useState([]);

const [showPolice, setShowPolice] = useState(true);
const [showFire, setShowFire] = useState(true);
const [showHospitals, setShowHospitals] = useState(true);


// Emergency service locations
const [shelters, setShelters] = useState([]);
const [eocs, setEocs] = useState([]); // Emergency Operation Centers
const [warehouses, setWarehouses] = useState([]); // Disaster Relief Warehouses
const [ambulances, setAmbulances] = useState([]);

// Toggle visibility
const [showShelters, setShowShelters] = useState(true);
const [showEocs, setShowEocs] = useState(true);
const [showWarehouses, setShowWarehouses] = useState(true);
const [showAmbulances, setShowAmbulances] = useState(true);
const [selectAll, setSelectAll] = useState(true);

const toggleAllLayers = () => {
  const newValue = !selectAll;
  setSelectAll(newValue);

  setShowHotspots(newValue);
  setShowFloodZones(newValue);
  setShowWaterways(newValue);
  setShowNgos(newValue);
  setShowPolice(newValue);
  setShowFire(newValue);
  setShowHospitals(newValue);
  setShowShelters(newValue);
  setShowEocs(newValue);
  setShowWarehouses(newValue);
  setShowAmbulances(newValue);
};


//cache for google place ids
const placeIdCache = useRef(new Map());

async function getGooglePlaceId(ngo) {
  const key = `${ngo.name}__${ngo.lat}__${ngo.lon}`;
  if (placeIdCache.current.has(key)) return placeIdCache.current.get(key);

  const BACKEND = import.meta.env.VITE_BACKEND_URL;
  try {
    const res = await fetch(`${BACKEND}/google/search?name=${encodeURIComponent(ngo.name)}&lat=${ngo.lat}&lon=${ngo.lon}`);
    const data = await res.json();
    console.log("SEARCH RESULTS:", sj);

    const pid = data.results?.[0]?.place_id || null;
    placeIdCache.current.set(key, pid);
    return pid;
  } catch (e) {
    console.warn("getGooglePlaceId error", e);
    placeIdCache.current.set(key, null);
    return null;
  }
}


  //google maps fetch ngos
  const fetchGoogleNgos = async (lat, lon) => {
  try {
    const radius = 5000; // 5 km

    const BACKEND = import.meta.env.VITE_BACKEND_URL;

const res = await fetch(
  `${BACKEND}/google/nearby_ngos?lat=${lat}&lon=${lon}`
);


    const data = await res.json();

    if (!data.results) return [];

    const results = data.results.map(place => ({
      id: place.place_id,
      lat: place.geometry.location.lat,
      lon: place.geometry.location.lng,
      name: place.name,
      googlePlaceId: place.place_id,
      types: place.types,
      rating: place.rating,
      icon: place.icon
    }));

    return results;
  } catch (e) {
    console.error("Google NGO fetch error:", e);
    return [];
  }

  console.log("Google Details:", data);

};



// FETCH GOOGLE DETAILS — call your backend proxy (no CORS)
const fetchGoogleNgoDetails = async (placeId) => {
  try {
    const BACKEND = import.meta.env.VITE_BACKEND_URL;

    const res = await fetch(`${BACKEND}/google/details?place_id=${placeId}`);
    const data = await res.json();
    const r = data.result || data;
console.log("DETAILS RAW:", data);
console.log("DETAILS R:", r);


    return {
  phone: r?.formatted_phone_number 
      || r?.phone
      || r?.international_phone 
      || r?.international_phone_number
      || null,

  website: r?.website || r?.websiteUri || null,
  address: r?.formatted_address || r?.formattedAddress || null,
  name: r?.name || r?.displayName?.text || null,
};


  } catch (e) {
    console.error("Google details fetch error:", e);
    return {
      phone: null,
      website: null,
      address: null
    };
  }
};






  // Fit Bounds Component
  const FitBounds = ({ coords, ngos }) => {
    const map = useMap();
    useEffect(() => {
      try {
        const points = [];
        if (coords) points.push(coords);
        ngos.forEach((n) => points.push([n.lat, n.lon]));

        if (points.length === 0) return;
        if (points.length === 1) {
          map.setView(points[0], 10);
        } else {
          map.fitBounds(points, { padding: [40, 40] });
        }
      } catch (e) {
        console.warn("FitBounds error:", e);
      }
    }, [coords, ngos]);
    return null;
  };

  // Fetch City Coordinates
  useEffect(() => {
    if (!result?.city) return;

    const fetchCoords = async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            result.city
          )}`
        );
        const data = await res.json();
        if (data.length > 0) {
          setCoords([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
        }
      } catch (err) {
        console.error("Geocoding error:", err);
      }
    };

    fetchCoords();
  }, [result]);

  // Fetch Hotspots
  useEffect(() => {
    if (!coords) return;

    const fetchHotspots = async () => {
      try {
        const resp = await axios.get(
  `${BACKEND}/api/hotspots?lat=${coords[0]}&lon=${coords[1]}&radius_km=200`
);


        const data = resp.data;

        if (!Array.isArray(data)) {
          console.warn("Hotspot API returned non-array:", data);
          setHotspots([]);
          return;
        }

        const points = data.map((h) => [
          h.lat,
          h.lon,
          (h.confidence ?? 50) / 100,
        ]);

        setHotspots(points);
      } catch (e) {
        console.error("Hotspot fetch failed:", e);
        setHotspots([]);
      }
    };

    fetchHotspots();
  }, [coords]);

  // Render Heatmap
  const HeatLayer = ({ points }) => {
    const map = useMap();

    useEffect(() => {
      if (heatLayerRef.current) {
        try {
          map.removeLayer(heatLayerRef.current);
        } catch {}
        heatLayerRef.current = null;
      }

      if (showHotspots && points.length > 0) {
        const layer = L.heatLayer(points, {
          radius: 25,
          blur: 40,
          maxZoom: 10,
          max: 1.0,
        }).addTo(map);

        heatLayerRef.current = layer;
      }

      return () => {
        if (heatLayerRef.current) {
          try {
            map.removeLayer(heatLayerRef.current);
          } catch {}
          heatLayerRef.current = null;
        }
      };
    }, [points, showHotspots]);

    return null;
  };

  // Fetch Flood Zones
  useEffect(() => {
    if (!coords) return;

    const fetchFlood = async () => {
      try {
        const res = await axios.get(
  `${BACKEND}/api/flood_zones?lat=${coords[0]}&lon=${coords[1]}`
);

        if (res.data?.type === "FeatureCollection") {
          setFloodZones(res.data);
        } else {
          console.warn("Invalid flood zone GeoJSON:", res.data);
          setFloodZones(null);
        }
      } catch (e) {
        console.error("Flood zone fetch error:", e);
        setFloodZones(null);
      }
    };

    fetchFlood();
  }, [coords]);

  // Fetch Waterways
  useEffect(() => {
    if (!coords) return;
    const fetchWaterways = async () => {
      try {
        const res = await axios.get(
  `${BACKEND}/api/waterways?lat=${coords[0]}&lon=${coords[1]}`
);


        const data = res.data;
        if (!data || data.type !== "FeatureCollection") {
          console.log("Waterways sample:", data.features?.slice(0,3));
          setWaterways(null);
          return;
        }

        const count = (data.features || []).length;
        console.log("Waterways fetched, feature count:", count);
        if (count === 0) {
          setWaterways(null);
          return;
        }

        setWaterways(data);
      } catch (e) {
        console.error("Waterways fetch error:", e);
        setWaterways(null);
      }
    };

    fetchWaterways();
  }, [coords]);

 // Fetch NGOs
useEffect(() => {
  if (!coords) return;

  const fetchNgos = async () => {
    const radius = 10000;

    // ----------------------------
    // 1. Fetch OSM Disaster NGOs
    // ----------------------------
 const query = `
[out:json][timeout:25];
(
node["amenity"="shelter"](around:${radius},${coords[0]},${coords[1]});
node["amenity"="social_facility"](around:${radius},${coords[0]},${coords[1]});
node["social_facility:for"="disaster"](around:${radius},${coords[0]},${coords[1]});
node["office"="ngo"](around:${radius},${coords[0]},${coords[1]});
node["office"="charity"](around:${radius},${coords[0]},${coords[1]});
node["emergency"="operations_centre"](around:${radius},${coords[0]},${coords[1]});
node["emergency"="fire_station"](around:${radius},${coords[0]},${coords[1]});
node["emergency"="ambulance_station"](around:${radius},${coords[0]},${coords[1]});
node["building"="warehouse"](around:${radius},${coords[0]},${coords[1]});
node["amenity"="police"](around:${radius},${coords[0]},${coords[1]});
node["amenity"="hospital"](around:${radius},${coords[0]},${coords[1]});



);
out center tags;

`;

    const overpass = await fetch("https://overpass.kumi.systems/api/interpreter", {
      method: "POST",
      body: query,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    const osmData = await overpass.json();

    // -----------------------------
// Classify ALL OSM elements
// -----------------------------
const facilities = {
  ngos: [],
  police: [],
  fire: [],
  hospitals: [],
  shelters: [],
  warehouses: [],
  ambulances: [],
  eocs: []
};

for (const el of osmData.elements || []) {
  const t = el.tags || {};
  const base = {
    id: el.id,
    name: t.name || "Unknown",
    lat: el.lat || el.center?.lat,
    lon: el.lon || el.center?.lon
  };

  if (t["office"] === "ngo" || t["amenity"] === "ngo")
    facilities.ngos.push(base);

  else if (t["amenity"] === "police")
    facilities.police.push(base);

  else if (t["emergency"] === "fire_station")
    facilities.fire.push(base);

  else if (t["amenity"] === "hospital")
    facilities.hospitals.push(base);

  else if (t["amenity"] === "shelter")
    facilities.shelters.push(base);

  else if (t["building"] === "warehouse")
    facilities.warehouses.push(base);

  else if (t["emergency"] === "ambulance_station")
    facilities.ambulances.push(base);

  else if (t["emergency"] === "operations_centre")
    facilities.eocs.push(base);
}

// UPDATE UI STATES
setPoliceStations(facilities.police);
setFireStations(facilities.fire);
setHospitals(facilities.hospitals);
setShelters(facilities.shelters);
setWarehouses(facilities.warehouses);
setAmbulances(facilities.ambulances);
setEocs(facilities.eocs);


    // ----------------------------
    // 2. Fetch Google Nearby NGOs
    // ----------------------------
    const BACKEND = import.meta.env.VITE_BACKEND_URL;
    const googleResp = await fetch(
      `${BACKEND}/google/nearby_ngos?lat=${coords[0]}&lon=${coords[1]}`
    );

    const googleData = await googleResp.json();
    const googleResults = googleData.results || [];

    // 1. Classify all elements → facilities.ngos contains ONLY NGOs
// (already added earlier)

// 2. Use only filtered NGOs
const osmNgos = facilities.ngos;

// 3. Google NGOs
const googleNgos = googleResults.map(g => ({
  id: g.place_id,
  name: g.name,
  lat: g.geometry.location.lat,
  lon: g.geometry.location.lng,
  googlePlaceId: g.place_id,
}));

// 4. Merge
// Google first ALWAYS
let master = [...googleNgos];

// Add OSM only when no similar Google NGO exists
for (const osm of osmNgos) {
  const exists = master.some(
    (g) =>
      g.name?.toLowerCase() === osm.name?.toLowerCase() ||
      (Math.abs(g.lat - osm.lat) < 0.0005 &&
       Math.abs(g.lon - osm.lon) < 0.0005)
  );

  if (!exists) {
    master.push(osm);
  }
}





    // ----------------------------
    // 4. Enrich EACH NGO with Google Place Details
    // ----------------------------
    const finalNgos = [];

    for (const ngo of master) {
      let placeId = ngo.googlePlaceId;

      // Find Google place_id if missing
      if (!placeId) {
        const search = await fetch(
          `${BACKEND}/google/search?name=${encodeURIComponent(
            ngo.name
          )}&lat=${ngo.lat}&lon=${ngo.lon}`
        );
        const sdata = await search.json();
        placeId = sdata.results?.[0]?.place_id || null;
      }

      // Get Google Details
      let details = null;
      if (placeId) details = await fetchGoogleNgoDetails(placeId);

      // Fallback → send empty structure
      if (!details) {
        details = {
          phone: "Not available",
          website: "Not available",
          rating: null
        };
      }

      finalNgos.push({
        ...ngo,
        googlePlaceId: placeId,
        details,
      });
    }

    setNgos(finalNgos);
  };

  fetchNgos();
}, [coords]);



  //map expansion handling
 useEffect(() => {
  if (mapRef.current) {
    setTimeout(() => {
      mapRef.current.invalidateSize();
    }, 300);
  }
}, [isMapExpanded]);

  // Fetch NGO Details
  const fetchNgoDetails = async (ngo) => {
    try {
      const url = `https://nominatim.openstreetmap.org/details?osmtype=N&osmid=${ngo.id}&format=json`;
      const res = await fetch(url);
      const data = await res.json();

      return {
        phone: data?.extratags?.contact_phone || data?.extratags?.phone || "Not available",
        email: data?.extratags?.contact_email || data?.extratags?.email || "Not available",
        website: data?.extratags?.contact_website || data?.extratags?.website || "Not available",
      };
    } catch (e) {
      return {
        phone: "Not available",
        email: "Not available",
        website: "Not available",
      };
    }
  };

  // Open NGO Chat
  const openNgoChat = async (ngo) => {

  let details = ngo.contact;

  if (ngo.googlePlaceId) {
    const googleInfo = await fetchGoogleNgoDetails(ngo.googlePlaceId);
    if (googleInfo) {
      details = {
        phone: googleInfo.phone,
        email: "Not available",
        website: googleInfo.website,
      };
    }
  } else {
    const osmDetails = await fetchNgoDetails(ngo);
    details = osmDetails;
  }

  const fullNgo = {
    ...ngo,
    contact: details
  };

  setChatNgo(fullNgo);
  setChatOpen(true);

  setMessages([
    { sender: "ngo", text: `Hello! This is ${fullNgo.name}. How can we assist you today?` }
  ]);
};


  if (!result) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-900/50 rounded-lg">
        <div className="text-center">
          <div className="text-4xl mb-3">🗺️</div>
          <div className="text-slate-400">Loading map...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>
      {/* Layer Toggles - Eye-Friendly Design */}
      <div
      
  style={{
  position: "absolute",
  zIndex: 5000,
  top: 12,
  left: 12,

  background: "rgba(30, 41, 59, 0.92)",
  backdropFilter: "blur(8px)",
  padding: "12px",
  borderRadius: "14px",
  boxShadow: "0 3px 12px rgba(0, 0, 0, 0.3)",
  border: "1px solid rgba(71, 85, 105, 0.45)",

  /* 🔥 Smaller box */
  width: "240px",
  maxHeight: "32vh",

  /* 🔥 Scrollable but invisible scrollbar */
  overflowY: "scroll",
  msOverflowStyle: "none", 
  scrollbarWidth: "none",
}}


  
>

  <style>
  {`::-webkit-scrollbar { display: none; }`}
</style>





        <div style={{
          fontSize: "13px",
          fontWeight: "600",
          color: "#60a5fa",
          marginBottom: "10px",
          display: "flex",
          alignItems: "center",
          gap: "6px"
        }}>
          <span>🗺️</span>
          <span>Map Layers</span>
        </div>

        <label
  style={{
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 4px",
    marginBottom: "8px",
    cursor: "pointer",
    fontSize: "15px",
    color: "#e2e8f0",
    fontWeight: "600"
  }}
>
  <input
    type="checkbox"
    checked={selectAll}
    onChange={toggleAllLayers}
    style={{
      width: "18px",
      height: "18px",
      accentColor: "#3b82f6",
      cursor: "pointer"
    }}
  />
  <span>Select All</span>
</label>


        {[
          { key: "showHotspots", label: "Wildfire Hotspots", icon: "🔥", state: showHotspots, setter: setShowHotspots },
          { key: "showFloodZones", label: "Flood Zones", icon: "🌊", state: showFloodZones, setter: setShowFloodZones },
          { key: "showWaterways", label: "Waterways", icon: "💧", state: showWaterways, setter: setShowWaterways },
          { key: "showNgos", label: "NGOs", icon: "🏥", state: showNgos, setter: setShowNgos },
          { key: "showPolice", label: "Police Stations", icon: "👮‍♂️", state: showPolice, setter: setShowPolice },
{ key: "showFire", label: "Fire Stations", icon: "🚒", state: showFire, setter: setShowFire },
{ key: "showHospitals", label: "Hospitals", icon: "🏥", state: showHospitals, setter: setShowHospitals },
{ key: "showShelters", label: "Shelters", icon: "⛺", state: showShelters, setter: setShowShelters },
{ key: "showEocs", label: "Emergency Operation Centers", icon: "🏢", state: showEocs, setter: setShowEocs },
{ key: "showWarehouses", label: "Relief Warehouses", icon: "📦", state: showWarehouses, setter: setShowWarehouses },
{ key: "showAmbulances", label: "Ambulance Stations", icon: "🚑", state: showAmbulances, setter: setShowAmbulances },


        ].map((item) => (
          <label
  key={item.key}
  style={{
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "3px 4px",
    marginBottom: "1px",
    cursor: "pointer",
    borderRadius: "5px",
    transition: "background 0.15s",
    color: "#e2e8f0",
    fontSize: "14px"
  }}
  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(71, 85, 105, 0.35)")}
  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
>
  <input
    type="checkbox"
    checked={item.state}
    onChange={() => item.setter(!item.state)}
    style={{
      accentColor: "#3b82f6",
      cursor: "pointer",
      width: "14px",
      height: "14px"
    }}
  />
  
  <span style={{ fontSize: "14px" }}>{item.icon}</span>
<span style={{ fontSize: "14px" }}>{item.label}</span>
</label>

        ))}
      </div>

      <MapContainer
  center={coords}
  zoom={10}
    zoomControl={false} 
  whenCreated={(map) => { mapRef.current = map; }}
  style={{ height: "100%", width: "100%" }}
>

        <ZoomControl position="bottomleft" />
        <FitBounds coords={coords} ngos={ngos} />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        
        {/* Hotspot Heatmap */}
        <HeatLayer points={hotspots} />

        {/* City Marker */}
        <Marker position={coords} icon={CityIcon}>
          <Popup>
            <div style={{ fontFamily: "system-ui", fontSize: "13px" }}>
              <strong style={{ fontSize: "14px", color: "#1e293b" }}>{result.city}</strong>
              <div style={{ marginTop: "8px", color: "#475569" }}>
                <div style={{ marginBottom: "4px" }}>
                  🌊 Flood: {result.flood ? (result.flood.probability * 100).toFixed(1) : "N/A"}%
                </div>
                <div>
                  🔥 Wildfire: {result.wildfire ? (result.wildfire.probability * 100).toFixed(1) : "N/A"}%
                </div>
              </div>
            </div>
          </Popup>
        </Marker>

        {/* Flood Zones */}
        {showFloodZones && floodZones && floodZones.type === "FeatureCollection" && (
          <GeoJSON
            data={floodZones}
            style={{
              color: "#3b82f6",
              weight: 3,
              opacity: 0.7,
              fillOpacity: 0.2
            }}
          />
        )}

        {/* Waterways */}
        {showWaterways && waterways && (
          <GeoJSON
            data={waterways}
            style={{
              color: "#0ea5e9",
              weight: 2,
              opacity: 0.8,
            }}
          />
        )}

        {/* NGOs */}
        {showNgos && ngos.map((ngo) => (
          <Marker
            key={ngo.id}
            position={[ngo.lat, ngo.lon]}
            icon={NgoIcon}
          >
            <Popup>
              <div style={{ minWidth: "220px", fontFamily: "system-ui" }}>
                <strong style={{ fontSize: "14px", color: "#1e293b" }}>{ngo.name}</strong>
                <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button
                    onClick={async () => {
  let d = null;
  let placeId = ngo.googlePlaceId;

  // If no Place ID found → try searching Google by name
  if (!placeId) {
    const BACKEND = import.meta.env.VITE_BACKEND_URL;
    const s = await fetch(`${BACKEND}/google/search?name=${encodeURIComponent(ngo.name)}&lat=${ngo.lat}&lon=${ngo.lon}`);
    const sj = await s.json();
    console.log("SEARCH RESULTS:", sj);

    placeId = sj?.places?.[0]?.id || null;

  }

  // Try Google Details again with the REAL placeId
  if (placeId) {
    d = await fetchGoogleNgoDetails(placeId);
  }

  // Build safe fallback
  const mapLink = placeId
    ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ngo.name)}`;

  const finalWebsite = d?.website || mapLink;


  d = {
    phone: d?.phone || null,
    website: finalWebsite,
    mapLink
  };
 console.log("PLACE SELECTED:", { ...ngo, details: d });
  console.log("NGO DETAILS:", d);

  setSelectedNgo({ ...ngo, details: d });
  setDetailsOpen(true);
}}



                    style={{
                      padding: "8px 12px",
                      background: "#10b981",
                      color: "white",
                      borderRadius: "8px",
                      cursor: "pointer",
                      border: "none",
                      fontSize: "13px",
                      fontWeight: "500",
                      transition: "background 0.2s"
                    }}
                    onMouseEnter={(e) => e.target.style.background = "#059669"}
                    onMouseLeave={(e) => e.target.style.background = "#10b981"}
                  >
                    Show Details
                  </button>

                  <button
                    onClick={() => openNgoChat(ngo)}
                    style={{
                      padding: "8px 12px",
                      background: "#3b82f6",
                      color: "white",
                      borderRadius: "8px",
                      cursor: "pointer",
                      border: "none",
                      fontSize: "13px",
                      fontWeight: "500",
                      transition: "background 0.2s"
                    }}
                    onMouseEnter={(e) => e.target.style.background = "#2563eb"}
                    onMouseLeave={(e) => e.target.style.background = "#3b82f6"}
                  >
                    💬 Chat with NGO
                  </button>
                </div>
              </div>
            </Popup>
            <Tooltip>{ngo.name}</Tooltip>
          </Marker>
        ))}



        {showPolice && policeStations.map(p => (
  <Marker key={p.id} icon={PoliceIcon} position={[p.lat, p.lon]}>
    <Popup>
      <strong>{p.name}</strong><br/>
      🚔 Police Station
    </Popup>
  </Marker>
))}



{showFire && fireStations.map(f => (
  <Marker key={f.id} icon={FireIcon} position={[f.lat, f.lon]}>
    <Popup>
      <strong>{f.name}</strong><br/>
      🚒 Fire Station
    </Popup>
  </Marker>
))}


{showHospitals && hospitals.map(h => (
  <Marker key={h.id} icon={HospitalIcon} position={[h.lat, h.lon]}>
    <Popup>
      <strong>{h.name}</strong><br/>
      🏥 Hospital
    </Popup>
  </Marker>
))}


{showShelters && shelters.map(s => (
  <Marker key={s.id} icon={ShelterIcon} position={[s.lat, s.lon]}>
    <Popup>
      <strong>{s.name}</strong><br/>
      ⛺ Temporary Shelter
    </Popup>
  </Marker>
))}


{showEocs && eocs.map(e => (
  <Marker key={e.id} icon={EocIcon} position={[e.lat, e.lon]}>
    <Popup>
      <strong>{e.name}</strong><br/>
      🏢 Emergency Operations Center
    </Popup>
  </Marker>
))}


{showWarehouses && warehouses.map(w => (
  <Marker key={w.id} icon={WarehouseIcon} position={[w.lat, w.lon]}>
    <Popup>
      <strong>{w.name}</strong><br/>
      📦 Disaster Relief Warehouse
    </Popup>
  </Marker>
))}


{showAmbulances && ambulances.map(a => (
  <Marker key={a.id} icon={AmbulanceIcon} position={[a.lat, a.lon]}>
    <Popup>
      <strong>{a.name}</strong><br/>
      🚑 Ambulance Station
    </Popup>
  </Marker>
))}


      </MapContainer>

      {/* Chat Widget - Eye-Friendly Design */}
      {chatOpen && (
        <div style={{
          position: "absolute",
          bottom: "20px",
          right: "20px",
          width: "340px",
          height: "420px",
          background: "rgba(30, 41, 59, 0.98)",
          backdropFilter: "blur(12px)",
          borderRadius: "16px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
          display: "flex",
          flexDirection: "column",
          zIndex: 9999,
          border: "1px solid rgba(71, 85, 105, 0.5)",
          overflow: "hidden"
        }}>
          {/* Header */}
          <div style={{
            background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
            color: "white",
            padding: "10px 12px",
minWidth: "170px",
maxWidth: "200px",
zIndex: 2000,
            fontWeight: "600",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            fontSize: "14px",
            maxHeight: "75vh",
overflowY: "auto"

          }}>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: "6px" }}>{chatNgo?.name}</div>
              <div style={{
                fontSize: "11px",
                opacity: 0.9,
                lineHeight: "1.4",
                fontWeight: "400"
              }}>
                {chatNgo?.contact?.phone !== "Not available" && (
                  <div>📞 {chatNgo?.contact?.phone}</div>
                )}
                {chatNgo?.contact?.email !== "Not available" && (
                  <div>✉ {chatNgo?.contact?.email}</div>
                )}
              </div>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              style={{
                background: "rgba(255, 255, 255, 0.2)",
                border: "none",
                color: "white",
                fontSize: "18px",
                cursor: "pointer",
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.2s"
              }}
              onMouseEnter={(e) => e.target.style.background = "rgba(255, 255, 255, 0.3)"}
              onMouseLeave={(e) => e.target.style.background = "rgba(255, 255, 255, 0.2)"}
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            padding: "14px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            background: "rgba(15, 23, 42, 0.5)"
          }}>
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  alignSelf: msg.sender === "user" ? "flex-end" : "flex-start",
                  background: msg.sender === "user" 
                    ? "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)" 
                    : "rgba(71, 85, 105, 0.8)",
                  color: "white",
                  padding: "10px 14px",
                  borderRadius: "12px",
                  maxWidth: "75%",
                  fontSize: "13px",
                  lineHeight: "1.5",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)"
                }}
              >
                {msg.text}
              </div>
            ))}
          </div>

          {/* Input */}
          <div style={{
            padding: "12px",
            display: "flex",
            gap: "8px",
            background: "rgba(15, 23, 42, 0.8)",
            borderTop: "1px solid rgba(71, 85, 105, 0.3)"
          }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && input.trim()) {
                  setMessages((prev) => [...prev, { sender: "user", text: input }]);
                  setInput("");
                  setTimeout(() => {
                    setMessages(prev => [...prev, { sender: "ngo", text: "Thank you! We will respond shortly." }]);
                  }, 600);
                }
              }}
              placeholder="Type a message..."
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid rgba(71, 85, 105, 0.5)",
                background: "rgba(30, 41, 59, 0.8)",
                color: "#e2e8f0",
                fontSize: "13px",
                outline: "none",
                transition: "border 0.2s"
              }}
              onFocus={(e) => e.target.style.borderColor = "#3b82f6"}
              onBlur={(e) => e.target.style.borderColor = "rgba(71, 85, 105, 0.5)"}
            />
            <button
              onClick={() => {
                if (!input.trim()) return;
                setMessages((prev) => [...prev, { sender: "user", text: input }]);
                setInput("");
                setTimeout(() => {
                  setMessages(prev => [...prev, { sender: "ngo", text: "Thank you! We will respond shortly." }]);
                }, 600);
              }}
              style={{
                background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                color: "white",
                border: "none",
                padding: "10px 16px",
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "500",
                transition: "transform 0.2s, box-shadow 0.2s",
                boxShadow: "0 2px 8px rgba(59, 130, 246, 0.3)"
              }}
              onMouseEnter={(e) => {
                e.target.style.transform = "translateY(-1px)";
                e.target.style.boxShadow = "0 4px 12px rgba(59, 130, 246, 0.4)";
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = "translateY(0)";
                e.target.style.boxShadow = "0 2px 8px rgba(59, 130, 246, 0.3)";
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}


{detailsOpen && selectedNgo && (
  <div style={{
    position: "absolute",
    right: 0,
    top: 0,
    height: "100%",
    width: "320px",
    background: "rgba(30, 41, 59, 0.98)",
    color: "white",
    padding: "20px",
    zIndex: 5000,
    overflowY: "auto",
    boxShadow: "-4px 0 12px rgba(0,0,0,0.4)"
  }}>
    
    <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "10px" }}>
      {selectedNgo.name}
    </h2>

    <div style={{ fontSize: "14px", lineHeight: "1.6" }}>
      
      <p><strong>📞 Phone:</strong><br />
        {selectedNgo.details.phone 
          ? selectedNgo.details.phone
          : <span style={{ opacity: 0.7 }}>Phone number not listed</span>}
      </p>

      <p><strong>🌐 Website:</strong><br />
        <a 
          href={selectedNgo.details.website}
          target="_blank"
          style={{ color: "#3b82f6" }}
        >
          {selectedNgo.details.website}
        </a>
      </p>

      <p><strong>🗺 Google Maps:</strong><br />
        <a 
          href={selectedNgo.details.mapLink}
          target="_blank"
          style={{ color: "#3b82f6" }}
        >
          Open in Maps
        </a>
      </p>

    </div>

    <button
      onClick={() => setDetailsOpen(false)}
      style={{
        marginTop: "20px",
        background: "#ef4444",
        padding: "10px 14px",
        borderRadius: "8px",
        color: "white",
        cursor: "pointer",
        width: "100%",
        border: "none"
      }}
    >
      Close
    </button>
  </div>
)}


    </div>
  );
}

export default MapView;