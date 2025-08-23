const axios = require("axios");

/**
 * Converts GeoJSON polygon coordinates to Overpass-compatible format
 */
const convertCoordinatesToOverpassFormat = (polygon) => {
  // Convert Mapbox [lng, lat] coordinates to Overpass "lat lng" format
  const coordinates = polygon.features[0].geometry.coordinates[0];
  return coordinates
    .map((coord) => `${coord[1]} ${coord[0]}`)
    .join(" ");
};

/**
 * Builds an Overpass QL query for finding POIs within a polygon
 */
const buildOverpassQuery = (polygon, amenityTypes) => {
  const polyString = convertCoordinatesToOverpassFormat(polygon);

  // Create union block with separate queries for each amenity type
  const nodeQueries = amenityTypes.map(type => `  node[amenity="${type}"](poly:"${polyString}")`);
  const wayQueries = amenityTypes.map(type => `  way[amenity="${type}"](poly:"${polyString}")`);
  
  return `
[out:json][timeout:25];
(
${nodeQueries.join(';\n')};
${wayQueries.join(';\n')};
);
out center;
`;
};

/**
 * Transforms OpenStreetMap element data to standardized POI format
 */
const transformElementToPOI = (element) => ({
  id: `overpass_${element.id}`,
  name: element.tags?.name || "Unnamed",
  category: element.tags?.amenity,
  lat: element.lat || element.center?.lat,
  lng: element.lon || element.center?.lon,
  tags: element.tags,
  provider: "overpass",
});

/**
 * Main function to fetch POIs for a given polygon and amenity types
 */
const getPOIs = async (polygon, amenityTypes) => {
  try {
    const query = buildOverpassQuery(polygon, amenityTypes);
    console.log('Overpass Query:', query);
    console.log('Amenity Types:', amenityTypes);
    
    const response = await axios.post(
      "https://overpass-api.de/api/interpreter",
      `data=${encodeURIComponent(query)}`,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 30000,
      },
    );
    
    console.log('Overpass API Response:', JSON.stringify(response.data, null, 2));
    
    return response.data.elements
      .map(transformElementToPOI)
      .filter((poi) => poi.lat && poi.lng);
      
  } catch (error) {
    console.error("Overpass API error: ", error.message);
    throw new Error("Failed to fetch POIs from Overpass API");
  }
};

module.exports = { getPOIs };
