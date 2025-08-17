import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { useGeolocation } from "../../hooks/useGeolocation";
import { healthCheck, api, getWalkingArea, getPOIs } from "../../services/api";
import "leaflet/dist/leaflet.css";

const Map: React.FC = () => {
  const { location, loading, error, getCurrentLocation } = useGeolocation();
  const [isochrone, setIsochrone] = useState(null);
  const [loadingIsochrone, setLoadingIsochrone] = useState(false);
  const [pois, setPois] = useState<{ restaurants: any[]; recreation: any[] }>({
    restaurants: [],
    recreation: [],
  });
  const [loadingPOIs, setLoadingPOIs] = useState<{
    restaurants: boolean;
    recreation: boolean;
  }>({ restaurants: false, recreation: false });
  const [showCategories, setShowCategories] = useState<{
    restaurants: boolean;
    recreation: boolean;
  }>({
    restaurants: false,
    recreation: false,
  });
  const mapRef = useRef<L.Map | null>(null);

  const handleShowWalkingArea = async () => {
    if (!mapRef.current) return;
    setLoadingIsochrone(true);
    try {
      const map = mapRef.current;
      const center = map.getCenter();
      const result = await getWalkingArea(center.lat, center.lng);
      console.log("Isochrone data:", result);
      console.log(
        "First feature geometry type:",
        result.features?.[0]?.geometry?.type,
      );
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

  // Custom SVG markers for different categories
  const restaurantIcon = new L.DivIcon({
    html: `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#e74c3c" stroke="white" stroke-width="2"/>
        <path d="M7 9l5-5 5 5M12 4v16" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="12" cy="14" r="1" fill="white"/>
      </svg>
    `,
    className: 'custom-marker-restaurant',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  const recreationIcon = new L.DivIcon({
    html: `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#27ae60" stroke="white" stroke-width="2"/>
        <path d="M8 12l2 2 4-4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    className: 'custom-marker-recreation',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

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

  const handleCategoryToggle = async (
    category: "restaurants" | "recreation",
  ) => {
    if (!isochrone) return;
    const newState = !showCategories[category];
    setShowCategories((prev) => ({ ...prev, [category]: newState }));

    if (newState && pois[category].length === 0) {
      setLoadingPOIs((prev) => ({ ...prev, [category]: true }));
      try {
        const result = await getPOIs(isochrone, category);
        console.log(`${category} POIs received:`, result.pois);
        console.log(`${category} POI count:`, result.pois.length);
        setPois((prev) => ({ ...prev, [category]: result.pois }));
      } catch (error) {
        console.error(`Failed to get ${category} POIs:`, error);
      } finally {
        setLoadingPOIs((prev) => ({ ...prev, [category]: false }));
      }
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
          backgroundColor: "white",
          padding: "10px",
          borderRadius: "5px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
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
            opacity: loadingIsochrone ? 0.6 : 1,
          }}
        >
          {loadingIsochrone ? "Loading ..." : "Show 15min walk area"}
        </button>

        {isochrone && (
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label style={{ fontSize: "12px", fontWeight: "bold" }}>Show POIs:</label>
            
            <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px" }}>
              <input
                type="checkbox"
                checked={showCategories.restaurants}
                onChange={() => handleCategoryToggle('restaurants')}
                disabled={loadingPOIs.restaurants}
              />
              Restaurants {loadingPOIs.restaurants && "(loading...)"}
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px" }}>
              <input
                type="checkbox"
                checked={showCategories.recreation}
                onChange={() => handleCategoryToggle('recreation')}
                disabled={loadingPOIs.recreation}
              />
              Recreation {loadingPOIs.recreation && "(loading...)"}
            </label>
          </div>
        )}
      </div>
      <MapContainer
        center={center}
        zoom={14}
        style={{ height: "100%", width: "100%" }}
        ref={mapRef}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {isochrone && <GeoJSON data={isochrone} style={isochroneStyle} />}
        
        {/* POI Markers */}
        {showCategories.restaurants && pois.restaurants.slice(0, 10).map(poi => (
          <Marker key={poi.id} position={[poi.lat, poi.lng]} icon={restaurantIcon}>
            <Popup>
              <div>
                <strong>{poi.name}</strong><br/>
                <em>{poi.category}</em>
              </div>
            </Popup>
          </Marker>
        ))}

        {showCategories.recreation && pois.recreation.slice(0, 10).map(poi => {
          console.log('Rendering recreation marker for:', poi);
          return (
          <Marker key={poi.id} position={[poi.lat, poi.lng]} icon={recreationIcon}>
            <Popup>
              <div>
                <strong>{poi.name}</strong><br/>
                <em>{poi.category}</em>
              </div>
            </Popup>
          </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};

export default Map;
