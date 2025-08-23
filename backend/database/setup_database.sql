SELECT load_extension('mod_spatialite');

CREATE TABLE poi_cache(
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

SELECT CreateSpatialIndex('poi_cache', 'geom');

CREATE TABLE cache_coverage(
    id INTEGER PRIMARY KEY,
    area_hash TEXT UNIQUE, 
    polygon_geom GEOMETRY,
    category TEXT,
    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    poi_count INTEGER
);

SELECT CreateSpatialIndex('cache_coverage', 'polygon_geom');
