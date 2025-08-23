const Database = require("better-sqlite3");
const crypto = require("crypto");
const { CATEGORIES } = require("./poiService");

class POICacheService {
  constructor() {
    this.db = new Database("poi_cache.db");
    this.spatialiteEnabled = false;
    
    this._loadSpatiaLiteExtension();
    this._initializeTables();
  }

  _loadSpatiaLiteExtension() {
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
  }

  // === CORE CACHE OPERATIONS ===

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

  /**
   * Calculates which parts of a polygon are not yet cached using spatial intersection
   * Returns only the uncached geometric area to minimize API calls
   */
  getUncachedArea(polygon, category) {
    if (!this.spatialiteEnabled) {
      return polygon; // Fallback: always fetch if no spatial support
    }

    const polygonWKT = this.polygonToWKT(polygon);

    // Find all cached areas that intersect with the requested polygon
    const overlappingCoverage = this.db
      .prepare(
        `
        SELECT polygon_geom FROM cache_coverage
        WHERE category = ? 
        AND ST_Intersects(polygon_geom, ST_GeomFromText(?, 4326))
        AND datetime(cached_at) > datetime('now', '-30 days')
      `,
      )
      .all(category, polygonWKT);

    if (overlappingCoverage.length === 0) {
      return polygon; // No cached areas, need to fetch entire polygon
    }

    try {
      // For multiple geometries, we need to union them first
      let unionedGeometry;
      if (overlappingCoverage.length === 1) {
        unionedGeometry = overlappingCoverage[0].polygon_geom;
      } else {
        // Create a temporary table with all cached geometries and union them
        const tempTableName = `temp_union_${Date.now()}`;
        this.db.exec(`CREATE TEMPORARY TABLE ${tempTableName} (geom GEOMETRY)`);
        
        const insertTemp = this.db.prepare(`INSERT INTO ${tempTableName} (geom) VALUES (?)`);
        for (const coverage of overlappingCoverage) {
          insertTemp.run(coverage.polygon_geom);
        }
        
        const unionResult = this.db
          .prepare(`SELECT ST_AsText(ST_Union(geom)) as union_geom FROM ${tempTableName}`)
          .get();
          
        this.db.exec(`DROP TABLE ${tempTableName}`);
        unionedGeometry = unionResult.union_geom;
      }

      const uncachedResult = this.db
        .prepare(
          `
          SELECT ST_AsText(ST_Difference(
            ST_GeomFromText(?, 4326),
            ST_GeomFromText(?, 4326)
          )) as uncached_area
        `,
        )
        .get(polygonWKT, unionedGeometry);

      return uncachedResult.uncached_area && uncachedResult.uncached_area !== 'GEOMETRYCOLLECTION EMPTY'
        ? this.wktToGeoJSON(uncachedResult.uncached_area)
        : null;
    } catch (error) {
      console.warn('Spatial difference calculation failed, fetching entire area:', error.message);
      return polygon;
    }
  }

  async cachePOIs(polygon, category, pois) {
    const insertPOI = this.db.prepare(`
      INSERT OR REPLACE INTO poi_cache
      (osm_id, name, category, lat, lng, tags, geom, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, SetSRID(MakePoint(?, ?), 4326), CURRENT_TIMESTAMP)
    `);

    const insertCoverage = this.db.prepare(`
      INSERT INTO cache_coverage
      (polygon_geom, category, poi_count, cached_at)
      VALUES (ST_GeomFromText(?, 4326), ?, ?, CURRENT_TIMESTAMP)
    `);

    const transaction = this.db.transaction((polygon, category, pois) => {
      // Cache individual POIs
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
      
      // Store coverage area for spatial intersection queries
      const polygonWKT = this.polygonToWKT(polygon);
      insertCoverage.run(polygonWKT, category, pois.length);
    });

    transaction(polygon, category, pois);
  }

  // === UTILITY FUNCTIONS ===

  polygonToWKT(polygon) {
    const coords = polygon.features[0].geometry.coordinates[0];
    const wktCoords = coords.map((c) => `${c[0]} ${c[1]}`).join(", ");
    return `POLYGON((${wktCoords}))`;
  }

  // Keep hashPolygon for SSE service compatibility
  hashPolygon(polygon, category) {
    const str = JSON.stringify(polygon) + category;
    return crypto.createHash("md5").update(str).digest("hex");
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

  // === DATABASE INITIALIZATION ===

  _initializeTables() {
    if (this.spatialiteEnabled) {
      this._migrateSpatialTables();
      this._createSpatialIndexes();
    } else {
      this._createFallbackTables();
    }
  }

  _migrateSpatialTables() {
    // Create tables with new schema
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
    `);

    // Check if cache_coverage table exists with old schema
    const tableInfo = this.db.prepare(`PRAGMA table_info(cache_coverage)`).all();
    const hasAreaHash = tableInfo.some(col => col.name === 'area_hash');

    if (hasAreaHash) {
      console.log("🔄 Migrating cache_coverage table to new spatial schema...");
      
      // Create new table with spatial schema
      this.db.exec(`
        CREATE TABLE cache_coverage_new (
          id INTEGER PRIMARY KEY,
          polygon_geom GEOMETRY,
          category TEXT,
          cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          poi_count INTEGER
        );
      `);

      // Clear old hash-based cache data (incompatible with new spatial system)
      this.db.exec(`DROP TABLE cache_coverage`);
      this.db.exec(`ALTER TABLE cache_coverage_new RENAME TO cache_coverage`);
      
      console.log("✅ Cache migration completed - old hash-based cache cleared");
    } else {
      // Create new table if it doesn't exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cache_coverage (
          id INTEGER PRIMARY KEY,
          polygon_geom GEOMETRY,
          category TEXT,
          cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          poi_count INTEGER
        );
      `);
    }
  }

  _createSpatialIndexes() {
    try {
      this.db.exec(`SELECT CreateSpatialIndex('poi_cache', 'geom');`);
      this.db.exec(`SELECT CreateSpatialIndex('cache_coverage', 'polygon_geom');`);
      console.log("✅ Database tables created with spatial indexes");
    } catch (err) {
      console.log("ℹ️  Spatial indexes already exist or couldn't be created");
    }
  }

  _createFallbackTables() {
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
        polygon_json TEXT,
        category TEXT,
        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        poi_count INTEGER
      );
    `);
    console.log("✅ Database tables created (non-spatial fallback)");
  }
}

module.exports = new POICacheService();

