import React, { useEffect } from "react";
import { MapContainer, TileLayer, Polygon, Popup } from "react-leaflet";
import { useGeolocation } from "../../hooks/useGeolocation";
import "leaflet/dist/leaflet.css";

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

  return (
    <div style={{ height: "100vh", width: "100%" }}>
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
