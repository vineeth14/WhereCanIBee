const axios = require("axios");

const getIsochrone = async (lat, lng) => {
  const response = await axios.post(
    "https://api.openrouteservice.org/v2/isochrones/foot-walking",
    {
      locations: [[lng, lat]],
      range: [1800],
      range_type: "time",
      attributes: ["area", "reachfactor"],
      smoothing: 0.1,
    },
    {
      headers: {
        Authorization: process.env.ORS_API_KEY,
        "Content-Type": "application/json",
      },
    },
  );
  return response.data;
};

module.exports = { getIsochrone };
