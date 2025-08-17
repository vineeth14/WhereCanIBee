const axios = require("axios");

const buildOverpassQuery = (polygon, amenityTypes) => {
  //Convert Mapbox [lng, lat] coordinates to Overpass "lat lng" format
  const coordinates = polygon.features[0].geometry.coordinates[0];
  const polyString = coordinates
    .map((coord) => `${coord[1]} ${coord[0]}`)
    .join(" ");

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

// gets POIs for a category
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
      .map((element) => ({
        id: `overpass_${element.id}`,
        name: element.tags?.name || "Unnamed",
        category: element.tags?.amenity,
        lat: element.lat || element.center?.lat,
        lng: element.lon || element.center?.lon,
        tags: element.tags,
        provider: "overpass",
      }))
      .filter((poi) => poi.lat && poi.lng);
  } catch (error) {
    console.error("Overpass API error: ", error.message);
    throw new Error("Failed to fetch POIs from Overpass API");
  }
};

module.exports = { getPOIs };
