const express = require("express");
const cors = require("cors");

require("dotenv").config();
const axios = require("axios");
const { getIsochrone } = require("./services/orsService");
const { getPOIs } = require("./services/poiService");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ message: "Backend is running!" });
});

app.post("/api/isochrone", async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (!lat || !lng) {
      return res.status(400).json({ error: "Latitude and longitude required" });
    }
    const isochroneData = await getIsochrone(lat, lng);
    res.json(isochroneData);
  } catch (error) {
    console.error(
      "isochrone API error:",
      error.response?.data || error.message,
    );
    res.status(500).json({ error: "Failed to generate walking area" });
  }
});

app.post("/api/pois", async (req, res) => {
  try {
    const { polygon, category } = req.body;

    if (!polygon || !category) {
      return res.status(400).json({ error: "Polygon and category required" });
    }

    const pois = await getPOIs(polygon, category);
    res.json({ pois, category, count: pois.length });
  } catch (error) {
    console.error("POI API error:", error.message);
    res.status(500).json({ error: "Failed to fetch POIs" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
