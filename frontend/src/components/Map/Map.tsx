import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useGeolocation } from "../../hooks/useGeolocation";
import { healthCheck, api, getWalkingArea, getPOIs } from "../../services/api";
import "leaflet/dist/leaflet.css";
import { useSSEPOIUpdates } from '../../hooks/useSSEPOIUpdates';
import DurationSelector from '../DurationSelector/DurationSelector';
import LocationInput from '../LocationInput/LocationInput';

// Component to handle map events
const MapEventHandler = ({ 
  onZoomEnd, 
  onMapClick, 
  useMapClick,
  onViewportChange
}: { 
  onZoomEnd: (zoom: number) => void;
  onMapClick?: (lat: number, lng: number) => void;
  useMapClick: boolean;
  onViewportChange?: () => void;
}) => {
  useMapEvents({
    zoomend: (e) => {
      const newZoom = e.target.getZoom();
      console.log(`Zoom changed to: ${newZoom}`);
      onZoomEnd(newZoom);
      if (onViewportChange) {
        // Debounce viewport changes
        setTimeout(onViewportChange, 300);
      }
    },
    moveend: (e) => {
      if (onViewportChange) {
        // Debounce viewport changes  
        setTimeout(onViewportChange, 300);
      }
    },
    click: (e) => {
      if (useMapClick && onMapClick) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
};

const Map: React.FC = () => {
  const { location, loading, error, getCurrentLocation } = useGeolocation();
  const [isochrone, setIsochrone] = useState(null);
  const [loadingIsochrone, setLoadingIsochrone] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(15);
  const [useMapClick, setUseMapClick] = useState(true);
  const [currentCenter, setCurrentCenter] = useState<{lat: number, lng: number} | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<{lat: number, lng: number, name: string} | null>(null);
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
  const [currentPolygonHash, setCurrentPolygonHash] = useState('');
  const [lastPOIUpdate, setLastPOIUpdate] = useState(Date.now());
  const [currentZoom, setCurrentZoom] = useState(14);
  const mapRef = useRef<L.Map | null>(null);

  const handleShowWalkingArea = async (lat?: number, lng?: number) => {
    setLoadingIsochrone(true);
    try {
      let centerLat, centerLng;
      
      if (lat !== undefined && lng !== undefined) {
        centerLat = lat;
        centerLng = lng;
      } else if (currentCenter) {
        centerLat = currentCenter.lat;
        centerLng = currentCenter.lng;
      } else if (mapRef.current) {
        const center = mapRef.current.getCenter();
        centerLat = center.lat;
        centerLng = center.lng;
      } else {
        throw new Error('No valid center coordinates available');
      }
      
      console.log(`Generating isochrone for ${selectedDuration} minutes at ${centerLat}, ${centerLng}`);
      
      const result = await api.post('/isochrone', {
        lat: centerLat,
        lng: centerLng,
        duration: selectedDuration
      });
      
      console.log("Isochrone data:", result.data);
      console.log("Setting new isochrone state...");
      
      setIsochrone(result.data);
      setCurrentCenter({ lat: centerLat, lng: centerLng });
      setSelectedLocation({ lat: centerLat, lng: centerLng, name: "Isochrone Center" });
      
      // Clear existing POIs and reload any checked categories
      const currentRestaurantState = showCategories.restaurants;
      const currentRecreationState = showCategories.recreation;
      
      setPois({ restaurants: [], recreation: [] });
      
      // Reload POIs for checked categories with new isochrone
      setTimeout(async () => {
        if (currentRestaurantState) {
          console.log("Reloading restaurant POIs for new isochrone...");
          setLoadingPOIs(prev => ({ ...prev, restaurants: true }));
          try {
            const restaurantResult = await getPOIs(result.data, 'restaurants');
            setPois(prev => ({ ...prev, restaurants: restaurantResult.pois }));
          } catch (error) {
            console.error('Failed to reload restaurant POIs:', error);
          } finally {
            setLoadingPOIs(prev => ({ ...prev, restaurants: false }));
          }
        }
        
        if (currentRecreationState) {
          console.log("Reloading recreation POIs for new isochrone...");
          setLoadingPOIs(prev => ({ ...prev, recreation: true }));
          try {
            const recreationResult = await getPOIs(result.data, 'recreation');
            setPois(prev => ({ ...prev, recreation: recreationResult.pois }));
          } catch (error) {
            console.error('Failed to reload recreation POIs:', error);
          } finally {
            setLoadingPOIs(prev => ({ ...prev, recreation: false }));
          }
        }
      }, 100);
      
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

  // Update polygon hash when isochrone or duration changes
  useEffect(() => {
    const generatePolygonHash = async () => {
      if (isochrone) {
        const data = JSON.stringify(isochrone) + selectedDuration.toString();
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        setCurrentPolygonHash(hashHex);
      }
    };
    
    generatePolygonHash();
  }, [isochrone, selectedDuration]);


  // SSE update handler
  const handleSSEPOIUpdate = (category: 'restaurants' | 'recreation', newPOIs: any[]) => {
    console.log(`🎉 Received ${newPOIs.length} new ${category} POIs via SSE`);
    setPois(prev => ({
      ...prev,
      [category]: [...prev[category], ...newPOIs]
    }));
  };

  // SSE hooks for real-time updates
  useSSEPOIUpdates('restaurants', showCategories.restaurants, currentPolygonHash, handleSSEPOIUpdate);
  useSSEPOIUpdates('recreation', showCategories.recreation, currentPolygonHash, handleSSEPOIUpdate);

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

  const createSelectedLocationIcon = (size = 28) => new L.DivIcon({
    html: `
      <div class="material-marker selected-location-marker" style="
        width: ${size + 8}px;
        height: ${size + 8}px;
        background: #ffffff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 3px 12px rgba(0,0,0,0.4);
        border: 3px solid #3498db;
        animation: pulse 2s infinite;
      ">
        <span class="material-icons" style="
          font-size: ${size}px;
          color: #3498db;
        ">location_on</span>
      </div>
      <style>
        @keyframes pulse {
          0% { box-shadow: 0 3px 12px rgba(0,0,0,0.4), 0 0 0 0 rgba(52, 152, 219, 0.7); }
          70% { box-shadow: 0 3px 12px rgba(0,0,0,0.4), 0 0 0 10px rgba(52, 152, 219, 0); }
          100% { box-shadow: 0 3px 12px rgba(0,0,0,0.4), 0 0 0 0 rgba(52, 152, 219, 0); }
        }
      </style>
    `,
    className: 'material-marker-container selected-location',
    iconSize: [size + 8, size + 8],
    iconAnchor: [(size + 8)/2, size + 8]
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
    console.log(`Filtering ${category} POIs at zoom ${currentZoom}: input ${poisArray.length} POIs`);
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
    if (currentZoom < 13) {
      clusteredPOIs = clusterNearbyPOIs(rankedPOIs, 0.01); // Large clustering distance
    } else if (currentZoom < 15) {
      clusteredPOIs = clusterNearbyPOIs(rankedPOIs, 0.005); // Medium clustering
    } else if (currentZoom < 17) {
      clusteredPOIs = clusterNearbyPOIs(rankedPOIs, 0.002); // Fine clustering
    } else {
      clusteredPOIs = clusterNearbyPOIs(rankedPOIs, 0.001); // Minimal clustering for high zoom
    }
    
    // Progressive zoom-based limits - more POIs as you zoom in
    let finalCount;
    if (currentZoom < 12) {
      finalCount = 8;
    } else if (currentZoom < 13) {
      finalCount = 15;
    } else if (currentZoom < 14) {
      finalCount = 25;
    } else if (currentZoom < 15) {
      finalCount = 40;
    } else if (currentZoom < 16) {
      finalCount = 60;
    } else if (currentZoom < 17) {
      finalCount = 80;
    } else if (currentZoom < 18) {
      finalCount = 100;
    } else {
      finalCount = clusteredPOIs.length;
    }
    
    const result = clusteredPOIs.slice(0, finalCount);
    console.log(`Zoom ${currentZoom}: showing ${result.length} out of ${clusteredPOIs.length} ${category} POIs`);
    return result;
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
      // Load POIs for entire isochrone area (cached/API call)
      setLoadingPOIs((prev) => ({ ...prev, [category]: true }));
      try {
        const result = await getPOIs(isochrone, category);
        console.log(`${category} POIs received:`, result.pois);
        console.log(`${category} POI count:`, result.pois.length);
        setPois((prev) => ({ ...prev, [category]: result.pois }));
        setLastPOIUpdate(Date.now());
      } catch (error) {
        console.error(`Failed to get ${category} POIs:`, error);
      } finally {
        setLoadingPOIs((prev) => ({ ...prev, [category]: false }));
      }
    }
  };
  const handleLocationSelect = (lat: number, lng: number, name: string) => {
    setCurrentCenter({ lat, lng });
    setSelectedLocation({ lat, lng, name });
    if (mapRef.current) {
      mapRef.current.setView([lat, lng], 14);
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    setCurrentCenter({ lat, lng });
    setSelectedLocation({ lat, lng, name: "Selected Location" });
  };

  const handleToggleInputMode = () => {
    setUseMapClick(!useMapClick);
  };

  // Convert map bounds to GeoJSON polygon for POI queries
  const boundsToGeoJSON = (bounds: L.LatLngBounds) => {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const nw = L.latLng(ne.lat, sw.lng);
    const se = L.latLng(sw.lat, ne.lng);
    
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [sw.lng, sw.lat],
            [se.lng, se.lat], 
            [ne.lng, ne.lat],
            [nw.lng, nw.lat],
            [sw.lng, sw.lat]
          ]]
        }
      }]
    };
  };

  // Filter POIs to show only those visible in current viewport
  const getViewportFilteredPOIs = (poisArray: any[]) => {
    if (!mapRef.current) return poisArray;
    
    const bounds = mapRef.current.getBounds();
    
    return poisArray.filter(poi => {
      return bounds.contains([poi.lat, poi.lng]);
    });
  };

  // Handle viewport changes (zoom/pan) - just trigger re-render, no API calls
  const handleViewportChange = () => {
    // Force re-render by updating a timestamp
    setLastPOIUpdate(Date.now());
  };

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      {/* Control Panel */}
      <div
        style={{
          position: "absolute",
          top: "10px",
          left: "10px",
          zIndex: 1000,
          backgroundColor: "white",
          padding: "15px",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          minWidth: "280px",
        }}
      >
        <DurationSelector 
          selectedDuration={selectedDuration}
          onDurationChange={setSelectedDuration}
        />
        
        <LocationInput 
          useMapClick={useMapClick}
          onToggleMode={handleToggleInputMode}
          onLocationSelect={handleLocationSelect}
          userLocation={location ? { lat: location.latitude, lng: location.longitude } : null}
        />
        
        <button
          onClick={() => handleShowWalkingArea()}
          disabled={loadingIsochrone || (!currentCenter && useMapClick)}
          style={{
            backgroundColor: "#9b59b6",
            color: "white",
            border: "none",
            padding: "12px 20px",
            borderRadius: "6px",
            cursor: (loadingIsochrone || (!currentCenter && useMapClick)) ? "not-allowed" : "pointer",
            opacity: (loadingIsochrone || (!currentCenter && useMapClick)) ? 0.6 : 1,
            width: "100%",
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          {loadingIsochrone ? "Loading..." : `Generate ${selectedDuration}min Walkable Area`}
        </button>
      </div>

      {/* POI Controls Panel */}
      {isochrone && (
        <div
          style={{
            position: "absolute",
            bottom: "10px",
            right: "10px",
            zIndex: 1000,
            backgroundColor: "white",
            padding: "15px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "14px", fontWeight: "600", color: "#333" }}>Points of Interest:</label>
            
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
              <input
                type="checkbox"
                checked={showCategories.restaurants}
                onChange={() => handleCategoryToggle('restaurants')}
                disabled={loadingPOIs.restaurants}
                style={{ transform: "scale(1.1)" }}
              />
              🍽️ Restaurants {loadingPOIs.restaurants && "(loading...)"}
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
              <input
                type="checkbox"
                checked={showCategories.recreation}
                onChange={() => handleCategoryToggle('recreation')}
                disabled={loadingPOIs.recreation}
                style={{ transform: "scale(1.1)" }}
              />
              🏞️ Recreation {loadingPOIs.recreation && "(loading...)"}
            </label>
          </div>
        </div>
      )}
      <MapContainer
        center={center}
        zoom={14}
        style={{ height: "100%", width: "100%" }}
        ref={mapRef}
      >
        <MapEventHandler 
          onZoomEnd={setCurrentZoom} 
          onMapClick={handleMapClick}
          useMapClick={useMapClick}
          onViewportChange={handleViewportChange}
        />
        <TileLayer 
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>"
        />
        {isochrone && (
          <GeoJSON 
            key={`isochrone-${selectedDuration}-${Date.now()}`}
            data={isochrone} 
            style={isochroneStyle} 
          />
        )}
        
        {/* Selected Location Marker */}
        {selectedLocation && (
          <Marker 
            position={[selectedLocation.lat, selectedLocation.lng]} 
            icon={createSelectedLocationIcon()}
          >
            <Popup>
              <div>
                <strong>📍 {selectedLocation.name}</strong><br/>
                <small>Selected Location</small><br/>
                <small>Lat: {selectedLocation.lat.toFixed(6)}</small><br/>
                <small>Lng: {selectedLocation.lng.toFixed(6)}</small>
              </div>
            </Popup>
          </Marker>
        )}
        
        {/* POI Markers with Viewport + Zoom Filtering & Ranking */}
        {showCategories.restaurants && getFilteredAndRankedPOIs(getViewportFilteredPOIs(pois.restaurants), 'restaurants').map(poi => (
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

        {showCategories.recreation && getFilteredAndRankedPOIs(getViewportFilteredPOIs(pois.recreation), 'recreation').map(poi => (
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
