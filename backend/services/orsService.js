const axios = require("axios");

const getIsochrone = async (lat, lng) => {
  const response = await axios.get(
    `https://api.mapbox.com/isochrone/v1/mapbox/walking/${lng},${lat}`,
    {
      params: {
        contours_minutes: 30,
        polygons: true,
        access_token: process.env.MAPBOX_API_KEY,
      },
    },
  );
  return response.data;
};

module.exports = { getIsochrone };
