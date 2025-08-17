import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useGeolocation } from "../../hooks/useGeolocation";
import { healthCheck, api, getWalkingArea, getPOIs } from "../../services/api";
import "leaflet/dist/leaflet.css";

// Component to handle map events
const MapEventHandler = ({ onZoomEnd }: { onZoomEnd: (zoom: number) => void }) => {
  useMapEvents({
    zoomend: (e) => {
      onZoomEnd(e.target.getZoom());
    },
  });
  return null;
};

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
  const [currentZoom, setCurrentZoom] = useState(14);
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

  // Material Design Icons for clean markers
  const createRestaurantIcon = (size = 24) => new L.DivIcon({
    html: `
      <div class="material-marker restaurant-marker" style="
        width: ${size + 8}px;
        height: ${size + 8}px;
        background: #ffffff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        border: 2px solid #e74c3c;
      ">
        <span class="material-icons" style="
          font-size: ${size}px;
          color: #e74c3c;
        ">restaurant</span>
      </div>
    `,
    className: 'material-marker-container',
    iconSize: [size + 8, size + 8],
    iconAnchor: [(size + 8)/2, (size + 8)/2]
  });

  const createRecreationIcon = (size = 24) => new L.DivIcon({
    html: `
      <div class="material-marker recreation-marker" style="
        width: ${size + 8}px;
        height: ${size + 8}px;
        background: #ffffff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        border: 2px solid #27ae60;
      ">
        <span class="material-icons" style="
          font-size: ${size}px;
          color: #27ae60;
        ">park</span>
      </div>
    `,
    className: 'material-marker-container',
    iconSize: [size + 8, size + 8],
    iconAnchor: [(size + 8)/2, (size + 8)/2]
  });

  const createGenericIcon = (size = 16) => new L.DivIcon({
    html: `
      <div class="material-marker generic-marker" style="
        width: ${size + 4}px;
        height: ${size + 4}px;
        background: #ffffff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        border: 2px solid #95a5a6;
      ">
        <span class="material-icons" style="
          font-size: ${size}px;
          color: #95a5a6;
        ">place</span>
      </div>
    `,
    className: 'material-marker-container',
    iconSize: [size + 4, size + 4],
    iconAnchor: [(size + 4)/2, (size + 4)/2]
  });

  // Distance-based clustering to prevent overcrowding
  const clusterNearbyPOIs = (poisArray: any[], maxDistance: number) => {
    const clustered = [];
    const used = new Set();
    
    for (let i = 0; i < poisArray.length; i++) {
      if (used.has(i)) continue;
      
      const poi = poisArray[i];
      const cluster = [poi];
      used.add(i);
      
      // Find nearby POIs within maxDistance
      for (let j = i + 1; j < poisArray.length; j++) {
        if (used.has(j)) continue;
        
        const otherPoi = poisArray[j];
        const distance = Math.sqrt(
          Math.pow(poi.lat - otherPoi.lat, 2) + 
          Math.pow(poi.lng - otherPoi.lng, 2)
        );
        
        if (distance < maxDistance) {
          cluster.push(otherPoi);
          used.add(j);
        }
      }
      
      // Use the best POI from the cluster (first one after sorting)
      clustered.push(cluster[0]);
    }
    
    return clustered;
  };

  // Aggressive filtering and ranking based on zoom level
  const getFilteredAndRankedPOIs = (poisArray: any[], category: 'restaurants' | 'recreation') => {
    // First, rank POIs by quality/importance
    const rankedPOIs = poisArray.sort((a, b) => {
      // Priority ranking system
      let scoreA = 0, scoreB = 0;
      
      // 1. Name quality (named places are better than "Unnamed")
      if (a.name && a.name !== 'Unnamed') scoreA += 10;
      if (b.name && b.name !== 'Unnamed') scoreB += 10;
      
      // 2. Category importance
      const importantTypes = category === 'restaurants' 
        ? ['restaurant', 'cafe'] 
        : ['park'];
      if (importantTypes.includes(a.category)) scoreA += 5;
      if (importantTypes.includes(b.category)) scoreB += 5;
      
      // 3. Additional data richness (opening hours, phone, etc.)
      if (a.tags?.opening_hours) scoreA += 3;
      if (b.tags?.opening_hours) scoreB += 3;
      if (a.tags?.phone) scoreA += 2;
      if (b.tags?.phone) scoreB += 2;
      
      return scoreB - scoreA; // Descending order
    });
    
    // Apply distance-based clustering based on zoom
    let clusteredPOIs;
    if (currentZoom < 14) {
      clusteredPOIs = clusterNearbyPOIs(rankedPOIs, 0.01); // Large clustering distance
    } else if (currentZoom < 16) {
      clusteredPOIs = clusterNearbyPOIs(rankedPOIs, 0.005); // Medium clustering
    } else {
      clusteredPOIs = clusterNearbyPOIs(rankedPOIs, 0.002); // Fine clustering
    }
    
    // Progressive zoom-based limits - more POIs as you zoom in
    if (currentZoom < 12) {
      return clusteredPOIs.slice(0, 5); // Show top 5 at very low zoom
    } else if (currentZoom < 14) {
      return clusteredPOIs.slice(0, 10); // Top 10 at low-medium zoom
    } else if (currentZoom < 16) {
      return clusteredPOIs.slice(0, 20); // Top 20 at medium zoom
    } else if (currentZoom < 18) {
      return clusteredPOIs.slice(0, 35); // More detail at high zoom
    } else {
      return clusteredPOIs; // Show all at very high zoom
    }
  };

  // Smart icon selection based on zoom level
  const getMarkerIcon = (category: 'restaurants' | 'recreation') => {
    if (currentZoom < 14) {
      // Very small for low zoom
      return createGenericIcon(10);
    } else if (currentZoom < 16) {
      // Medium zoom, use category-specific but smaller
      return category === 'restaurants' ? createRestaurantIcon(16) : createRecreationIcon(16);
    } else {
      // High zoom, use full-size distinctive markers
      return category === 'restaurants' ? createRestaurantIcon(24) : createRecreationIcon(24);
    }
  };

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
        <MapEventHandler onZoomEnd={setCurrentZoom} />
        <TileLayer 
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>"
        />
        {isochrone && <GeoJSON data={isochrone} style={isochroneStyle} />}
        
        {/* POI Markers with Aggressive Filtering & Ranking */}
        {showCategories.restaurants && getFilteredAndRankedPOIs(pois.restaurants, 'restaurants').map(poi => (
          <Marker key={poi.id} position={[poi.lat, poi.lng]} icon={getMarkerIcon('restaurants')}>
            <Popup>
              <div>
                <strong>{poi.name}</strong><br/>
                <em>{poi.category}</em>
                {poi.tags?.opening_hours && <><br/><small>Hours: {poi.tags.opening_hours}</small></>}
                {poi.tags?.phone && <><br/><small>Phone: {poi.tags.phone}</small></>}
              </div>
            </Popup>
          </Marker>
        ))}

        {showCategories.recreation && getFilteredAndRankedPOIs(pois.recreation, 'recreation').map(poi => (
          <Marker key={poi.id} position={[poi.lat, poi.lng]} icon={getMarkerIcon('recreation')}>
            <Popup>
              <div>
                <strong>{poi.name}</strong><br/>
                <em>{poi.category}</em>
                {poi.tags?.opening_hours && <><br/><small>Hours: {poi.tags.opening_hours}</small></>}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default Map;
