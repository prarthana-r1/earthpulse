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
          `/api/hotspots?lat=${coords[0]}&lon=${coords[1]}&radius_km=200`
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
          `/api/flood_zones?lat=${coords[0]}&lon=${coords[1]}`
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
          `/api/waterways?lat=${coords[0]}&lon=${coords[1]}`
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
      const query = `
        [out:json][timeout:25];
        (
          node["amenity"="ngo"](around:${radius},${coords[0]},${coords[1]});
          way["amenity"="ngo"](around:${radius},${coords[0]},${coords[1]});
          relation["amenity"="ngo"](around:${radius},${coords[0]},${coords[1]});
          node["office"="ngo"](around:${radius},${coords[0]},${coords[1]});
          way["office"="ngo"](around:${radius},${coords[0]},${coords[1]});
          relation["office"="ngo"](around:${radius},${coords[0]},${coords[1]});
        );
        out center geom tags;
      `;

      const servers = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://z.overpass-api.de/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter",
        "https://overpass-api.de/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      ];

      let data = null;
      for (const server of servers) {
        try {
          const res = await fetch(server, {
            method: "POST",
            body: query,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            signal: AbortSignal.timeout(10000),
          });

          const text = await res.text();

          if (text.trim().startsWith("<") || text.trim().startsWith("<?xml")) {
            console.warn("❌ Overpass returned HTML/XML:", server);
            continue;
          }

          data = JSON.parse(text);
          console.log("✔ Overpass success:", server);
          break;
        } catch (err) {
          console.warn(`❌ Overpass server failed (${server}):`, err);
        }
      }

      if (!data) {
        console.error("❌ All Overpass servers failed.");
        setNgos([]);
        return;
      }

      const parsed = (data.elements || [])
        .map((el) => {
          if (el.lat && el.lon) {
            return {
              id: el.id,
              lat: el.lat,
              lon: el.lon,
              name: el.tags?.name || el.tags?.operator || "NGO",
              contact: {
                phone: el.tags?.phone || el.tags?.contact_phone || "Not available",
                email: el.tags?.email || el.tags?.contact_email || "Not available",
                website: el.tags?.website || el.tags?.contact_website || "Not available",
              },
              tags: el.tags || {}
            };
          }

          if (el.center && el.center.lat && el.center.lon) {
            return {
              id: el.id,
              lat: el.center.lat,
              lon: el.center.lon,
              name: el.tags?.name || el.tags?.operator || "NGO",
              contact: {
                phone: el.tags?.phone || el.tags?.contact_phone || "Not available",
                email: el.tags?.email || el.tags?.contact_email || "Not available",
                website: el.tags?.website || el.tags?.contact_website || "Not available",
              },
              tags: el.tags || {}
            };
          }

          if (Array.isArray(el.geometry) && el.geometry.length > 0) {
            const N = Math.min(el.geometry.length, 5);
            let sumLat = 0, sumLon = 0;
            for (let i = 0; i < N; i++) {
              sumLat += el.geometry[i].lat;
              sumLon += el.geometry[i].lon;
            }
            const avgLat = sumLat / N;
            const avgLon = sumLon / N;

            return {
              id: el.id,
              lat: avgLat,
              lon: avgLon,
              name: el.tags?.name || el.tags?.operator || "NGO",
              contact: {
                phone: el.tags?.phone || el.tags?.contact_phone || "Not available",
                email: el.tags?.email || el.tags?.contact_email || "Not available",
                website: el.tags?.website || el.tags?.contact_website || "Not available",
              },
              tags: el.tags || {}
            };
          }

          return null;
        })
        .filter(Boolean)
        .filter((e) => e.lat && e.lon)
        .filter(
          (v, i, arr) =>
            arr.findIndex(
              (x) => x.lat === v.lat && x.lon === v.lon && x.name === v.name
            ) === i
        );

      console.log("NGOs parsed count:", parsed.length, parsed.slice(0, 3));
      setNgos(parsed);
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
        address: data?.extratags?.address || "Not available"
      };
    } catch (e) {
      return {
        phone: "Not available",
        email: "Not available",
        website: "Not available",
        address: "Not available"
      };
    }
  };

  // Open NGO Chat
  const openNgoChat = async (ngo) => {
    const details = await fetchNgoDetails(ngo);

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
          zIndex: 1000,
          top: 12,
          left: 12,
          background: "rgba(30, 41, 59, 0.95)",
          backdropFilter: "blur(8px)",
          padding: "14px 16px",
          borderRadius: "12px",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
          border: "1px solid rgba(71, 85, 105, 0.5)",
          minWidth: "180px"
        }}
      >
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

        {[
          { key: "showHotspots", label: "Wildfire Hotspots", icon: "🔥", state: showHotspots, setter: setShowHotspots },
          { key: "showFloodZones", label: "Flood Zones", icon: "🌊", state: showFloodZones, setter: setShowFloodZones },
          { key: "showWaterways", label: "Waterways", icon: "💧", state: showWaterways, setter: setShowWaterways },
          { key: "showNgos", label: "NGOs", icon: "🏥", state: showNgos, setter: setShowNgos }
        ].map((item) => (
          <label
            key={item.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px",
              marginBottom: "4px",
              cursor: "pointer",
              borderRadius: "8px",
              transition: "background 0.2s",
              color: "#e2e8f0",
              fontSize: "13px"
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(71, 85, 105, 0.3)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <input
              type="checkbox"
              checked={item.state}
              onChange={() => item.setter(!item.state)}
              style={{
                accentColor: "#3b82f6",
                cursor: "pointer",
                width: "16px",
                height: "16px"
              }}
            />
            <span style={{ fontSize: "14px" }}>{item.icon}</span>
            <span>{item.label}</span>
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
                      const d = await fetchNgoDetails(ngo);
                      alert(
                        `📞 Phone: ${d.phone}\n✉ Email: ${d.email}\n🌐 Website: ${d.website}\n📍 Address: ${d.address}`
                      );
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
            padding: "14px 16px",
            fontWeight: "600",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            fontSize: "14px"
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
    </div>
  );
}

export default MapView;