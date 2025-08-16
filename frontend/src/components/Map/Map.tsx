import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import L from "leaflet";
import { useGeolocation } from "../../hooks/useGeolocation";
import { healthCheck, api, getWalkingArea } from "../../services/api";
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
  const [isochrone, setIsochrone] = useState(null);
  const [loadingIsochrone, setLoadingIsochrone] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  const handleShowWalkingArea = async () => {
    if (!mapRef.current) return;
    setLoadingIsochrone(true);
    try {
      const map = mapRef.current;
      const center = map.getCenter();
      const result = await getWalkingArea(center.lat, center.lng);
      setIsochrone(result);
    } catch (error) {
      console.error("Failed to get walking area:", error);
    } finally {
      setLoadingIsochrone(false);
    }
  };

  const isochroneStyle = {
    fillColor: "#9b59b6",
    fillOpacity: 0.1,
    color: "#8e44ad",
    weight: 3,
    opacity: 1,
  };

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
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          bottom: "10px",
          right: "10px",
          zIndex: 1000,
          display: "flex",
          gap: "10px",
        }}
      >
        <button 
            onClick={handleShowWalkingArea}
            disabled={loadingIsochrone}
            style={{
                backgroundColor: "#9b59b6",
                color: "white",
                border: "none",
                padding: "10px 15px",
                borderRadius: "5px",
                cursor: loadingIsochrone ? "not-allowed" : "pointer",
                opacity: loadingIsochrone ? 0.6 : 1
            }}
               >{loadingIsochrone ? "Loading ..." : "Show 15min walk area"}
               </button>
      </div>
      <MapContainer
        center={center}
        zoom={14}
        style={{ height: "100%", width: "100%" }}
        ref={mapRef}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {isochrone && (<GeoJSON 
        data={isochrone}
        style={isochroneStyle}
        />
        )}
      </MapContainer>
    </div>
  );
};

export default Map;
