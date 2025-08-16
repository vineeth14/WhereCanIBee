import React, { useEffect } from "react";
import { MapContainer, TileLayer, Polygon, Popup } from "react-leaflet";
import { useGeolocation } from "../../hooks/useGeolocation";
import { healthCheck, api } from "../../services/api";
import "leaflet/dist/leaflet.css";

const testBackend = async () => {
  try {
    const result = await healthCheck();
    console.log("Backend response:", result);
  } catch (error) {
    console.error("Backend connection failed:", error);
  }
};

const Map: React.FC = () => {
  const { location, loading, error, getCurrentLocation } = useGeolocation();

  useEffect(() => {
    getCurrentLocation();
  }, []);

  if (loading) return <div>Getting your location...</div>;
  if (error && !location) return <div> Error: {error}</div>;

  const center: [number, number] = location
    ? [location.latitude, location.longitude]
    : [40.7831, -73.9712];

  const sendLocationToBackend = async (lat: number, lng: number) => {
    try {
      const response = await api.post("/location", {
        latitude: lat,
        longitude: lng,
      });
      console.log("Location sent:", response.data);
    } catch (error) {
      console.error("Failed to send location:", error);
    }
  };

  return (
    <div style={{ height: "100vh", width: "100%" }}>
      <button onClick={testBackend}>Test Backend</button>
      <MapContainer
        center={center}
        zoom={14}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      </MapContainer>
    </div>
  );
};

export default Map;
