import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix default marker icon issue in Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

function MapView({ result }) {
  const [coords, setCoords] = useState([20.5937, 78.9629]); // Default India center
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!result?.city) return;   // ✅ Safe check

    const fetchCoords = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            result.city
          )}`
        );
        const data = await response.json();
        if (data.length > 0) {
          setCoords([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
        }
      } catch (error) {
        console.error("Geocoding error:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchCoords();
  }, [result]);

  // ✅ If no result yet, show loading or nothing
  if (!result) {
    return (
      <div style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p>Loading map...</p>
      </div>
    );
  }

  return (
    <MapContainer
      center={coords}
      zoom={6}
      style={{ height: "100%", width: "100%" }}
      key={coords.join(",")}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
      />
      {!loading && (
        <Marker position={coords}>
          <Popup>
            <b>{result.city}</b>
            <br />
            Flood:{" "}
            {result.flood?.probability != null
              ? (result.flood.probability * 100).toFixed(1) + "%"
              : "N/A"}
            <br />
            Wildfire:{" "}
            {result.wildfire?.probability != null
              ? (result.wildfire.probability * 100).toFixed(1) + "%"
              : "N/A"}
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}


export default MapView;
