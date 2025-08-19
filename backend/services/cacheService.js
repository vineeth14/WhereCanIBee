const Database = require("better-sqlite3");
const crypto = require("crypto");
const { CATEGORIES } = require("./poiService");

class POICacheService {
  constructor() {
    this.db = new Database("poi_cache.db");
    this.spatialiteEnabled = false;
    
    // Try to load SpatiaLite extension with common paths
    const spatialitePaths = [
      "/opt/homebrew/lib/mod_spatialite.dylib",
      "/usr/local/lib/mod_spatialite.dylib",
      "/opt/homebrew/lib/libspatialite.dylib", 
      "/usr/local/lib/libspatialite.dylib",
      "mod_spatialite"
    ];
    
    for (const path of spatialitePaths) {
      try {
        this.db.loadExtension(path);
        console.log(`✅ SpatiaLite loaded from: ${path}`);
        this.spatialiteEnabled = true;
        break;
      } catch (err) {
        console.log(`❌ Failed to load SpatiaLite from: ${path}`);
      }
    }
    
    if (!this.spatialiteEnabled) {
      console.warn("⚠️  Could not load SpatiaLite extension. Using fallback cache without spatial functions.");
    }
    
    this.initTables();
  }

  async getCachedPOIs(polygon, category) {
    const wkt = this.polygonToWKT(polygon);
    const amenityTypes = CATEGORIES[category];
    
    if (!amenityTypes) {
      throw new Error(`Unknown category: ${category}`);
    }
    
    const stmt = this.db.prepare(`
      SELECT id, osm_id, name, category, lat, lng, tags
      FROM poi_cache
      WHERE category IN (${amenityTypes.map(() => "?").join(",")})
      AND ST_Within(geom, ST_GeomFromText(?, 4326))
      AND datetime(updated_at) > datetime('now', '-30 days')
    `);
    return stmt.all(...amenityTypes, wkt);
  }

  // Calculate uncached area (isochrone - cached_coverage)
  getUncachedArea(polygon, category) {
    const polygonWKT = this.polygonToWKT(polygon);
    const areaHash = this.hashPolygon(polygon, category);

    const coverage = this.db
      .prepare(
        `
        SELECT polygon_geom FROM cache_coverage
        WHERE area_hash = ? AND category = ?
        AND datetime(cached_at) > datetime('now', '-30 days')
      `,
      )
      .get(areaHash, category);

    if (coverage) {
      const uncachedWKT = this.db
        .prepare(
          `
          SELECT ST_AsText(ST_Difference(
            ST_GeomFromText(?, 4326), ?
          )) as uncached_area
        `,
        )
        .get(polygonWKT, coverage.polygon_geom);
      return uncachedWKT.uncached_area
        ? this.wktToGeoJSON(uncachedWKT.uncached_area)
        : null;
    }
    return polygon;
  }

  // Cache new POIs
  async cachePOIs(polygon, category, pois) {
    const insertPOI = this.db.prepare(`
      INSERT OR REPLACE INTO poi_cache
      (osm_id, name, category, lat, lng, tags, geom, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, SetSRID(MakePoint(?, ?), 4326), CURRENT_TIMESTAMP)
    `);

    const insertCoverage = this.db.prepare(`
      INSERT OR REPLACE INTO cache_coverage
      (area_hash, polygon_geom, category, poi_count)
      VALUES (?, ST_GeomFromText(?, 4326), ?, ?)
    `);

    const transaction = this.db.transaction((polygon, category, pois) => {
      for (const poi of pois) {
        insertPOI.run(
          poi.id,
          poi.name,
          poi.category,
          poi.lat,
          poi.lng,
          JSON.stringify(poi.tags),
          poi.lng,
          poi.lat,
        );
      }
      const areaHash = this.hashPolygon(polygon, category);
      const polygonWKT = this.polygonToWKT(polygon);
      insertCoverage.run(areaHash, polygonWKT, category, pois.length);
    });

    transaction(polygon, category, pois);
  }

  polygonToWKT(polygon) {
    const coords = polygon.features[0].geometry.coordinates[0];
    const wktCoords = coords.map((c) => `${c[0]} ${c[1]}`).join(", ");
    return `POLYGON((${wktCoords}))`;
  }

  hashPolygon(polygon, category) {
    const str = JSON.stringify(polygon) + category;
    return crypto.createHash("md5").update(str).digest("hex");
  }

  initTables() {
    if (this.spatialiteEnabled) {
      // Create tables with spatial features
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS poi_cache (
          id INTEGER PRIMARY KEY,
          osm_id TEXT,
          name TEXT,
          category TEXT,
          lat REAL,
          lng REAL,
          tags TEXT,
          geom GEOMETRY,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cache_coverage (
          id INTEGER PRIMARY KEY,
          area_hash TEXT UNIQUE,
          polygon_geom GEOMETRY,
          category TEXT,
          cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          poi_count INTEGER
        );
      `);

      // Create spatial indexes
      try {
        this.db.exec(`SELECT CreateSpatialIndex('poi_cache', 'geom');`);
        this.db.exec(`SELECT CreateSpatialIndex('cache_coverage', 'polygon_geom');`);
        console.log("✅ Database tables created with spatial indexes");
      } catch (err) {
        // Indexes might already exist, that's OK
        console.log("ℹ️  Spatial indexes already exist or couldn't be created");
      }
    } else {
      // Fallback tables without spatial features
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS poi_cache (
          id INTEGER PRIMARY KEY,
          osm_id TEXT,
          name TEXT,
          category TEXT,
          lat REAL,
          lng REAL,
          tags TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cache_coverage (
          id INTEGER PRIMARY KEY,
          area_hash TEXT UNIQUE,
          polygon_json TEXT,
          category TEXT,
          cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          poi_count INTEGER
        );
      `);
      console.log("✅ Database tables created (non-spatial fallback)");
    }
  }

  wktToGeoJSON(wkt) {
    if (!wkt || wkt === "GEOMETRYCOLLECTION EMPTY") return null;
    const polygonMatch = wkt.match(/POLYGON\(\((.*?)\)\)/);
    if (!polygonMatch) return null;
    const coordsString = polygonMatch[1];
    const coordinates = coordsString.split(",").map((coord) => {
      const [lng, lat] = coord.trim().split(" ").map(Number);
      return [lng, lat];
    });
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [coordinates],
          },
        },
      ],
    };
  }
}

module.exports = new POICacheService();

