// Core dependencies
const express = require("express");
const cors = require("cors");
require("dotenv").config();

// External libraries
const axios = require("axios");

// Internal services
const { getIsochrone } = require("./services/orsService");
const { getPOIs } = require("./services/poiService");
const cacheService = require("./services/cacheService");
const sseService = require("./services/sseService");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cache-Control"],
    credentials: true,
  }),
);

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ message: "Backend is running!" });
});

app.post("/api/isochrone", async (req, res) => {
  try {
    const { lat, lng, duration } = req.body;
    if (!lat || !lng) {
      return res.status(400).json({ error: "Latitude and longitude required" });
    }
    if (!duration || ![15, 30, 45, 60].includes(duration)) {
      return res
        .status(400)
        .json({
          error: "Duration is required and must be 15, 30, 45 or 60 minutes",
        });
    }
    const isochroneData = await getIsochrone(lat, lng, duration);
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
  const { polygon, category } = req.body;
  try {
    const cachedPOIs = await cacheService.getCachedPOIs(polygon, category);

    // If we have cached POIs, return them immediately
    if (cachedPOIs.length > 0) {
      res.json({
        pois: cachedPOIs,
        category,
        count: cachedPOIs.length,
        cached: true,
      });

      // Still check for updates in background
      setImmediate(async () => {
        try {
          const uncachedArea = cacheService.getUncachedArea(polygon, category);
          if (uncachedArea) {
            console.log("Checking for new POIs in uncached areas...");
            const newPOIs = await getPOIs(uncachedArea, category);
            if (newPOIs.length > 0) {
              await cacheService.cachePOIs(uncachedArea, category, newPOIs);
              sseService.broadcastPOIUpdates(category, newPOIs, polygon);
            }
          }
        } catch (bgError) {
          console.error("Background POI fetch failed:", bgError);
        }
      });
    } else {
      // No cache - fetch immediately and return results
      console.log("No cached POIs found, fetching from API...");
      const pois = await getPOIs(polygon, category);

      // Cache the results for next time
      await cacheService.cachePOIs(polygon, category, pois);

      res.json({
        pois,
        category,
        count: pois.length,
        cached: false,
      });
    }
  } catch (error) {
    console.error("POI service failed:", error);
    res.status(500).json({ error: "Failed to fetch POIs" });
  }
});

app.get("/api/pois/stream/:category", (req, res) => {
  // Set SSE headers without credentials since EventSource doesn't support them
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "http://localhost:3000",
    "Access-Control-Allow-Methods": "GET",
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  const clientId = sseService.addConnection(req.params.category, res);
  req.on("close", () =>
    sseService.removeConnection(req.params.category, clientId),
  );
  req.on("aborted", () =>
    sseService.removeConnection(req.params.category, clientId),
  );
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
