// mapSetup.js
// Initializes the Leaflet map against a non-geographic pixel coordinate
// system (CRS.Simple), matching the tile pyramid produced by
// scripts/generate_tiles.py. One Leaflet tile layer exists per map layer,
// but only the active layer's tile layer is attached to the map at a time
// (swapped on floor change) to keep things fast.

import { logger } from "./logger.js";

const TILE_SIZE = 256;

export function computeMaxZoom(width, height) {
  return Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / TILE_SIZE)));
}

export function createMap(config) {
  const maxZoom = computeMaxZoom(config.sourceWidth, config.sourceHeight);

  const map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: 0,
    maxZoom: maxZoom + 2, // allow a little over-zoom for close inspection; browser upscales last tile crisply (pixelated)
    zoomSnap: 0.25,
    zoomDelta: 1,
    wheelPxPerZoomLevel: 90,
    zoomControl: true,
    attributionControl: false,
    preferCanvas: true,
  });

  // Bounds computed the standard Leaflet.CRS.Simple way: unproject the
  // pixel extents of the source image at the tile pyramid's native zoom.
  const southWest = map.unproject([0, config.sourceHeight], maxZoom);
  const northEast = map.unproject([config.sourceWidth, 0], maxZoom);
  const bounds = L.latLngBounds(southWest, northEast);

  map.setMaxBounds(bounds.pad(0.15));
  map.fitBounds(bounds);

  logger.info("Map initialized", { maxZoom, width: config.sourceWidth, height: config.sourceHeight });

  return { map, bounds, maxZoom, tileSize: TILE_SIZE };
}

export function buildTileLayer(layerId, mapMeta) {
  return L.tileLayer(`/tiles/${layerId}/{z}/{x}/{y}.png`, {
    tileSize: mapMeta.tileSize,
    minZoom: 0,
    maxZoom: mapMeta.map.getMaxZoom(),
    maxNativeZoom: mapMeta.maxZoom,
    noWrap: true,
    bounds: mapMeta.bounds,
    // A missing tile file is expected & desired for fully off-map areas --
    // it just falls through to the black map background. Don't spam 404s
    // as anything alarming; only genuinely broken requests get logged.
    errorTileUrl: "",
  });
}

/** Converts a Leaflet LatLng (as used on the map) to raw source-image pixel coords. */
export function latLngToPixel(map, latlng, nativeZoom) {
  const p = map.project(latlng, nativeZoom);
  return { x: p.x, y: p.y };
}

/** Converts raw source-image pixel coords to a Leaflet LatLng usable for markers. */
export function pixelToLatLng(map, x, y, nativeZoom) {
  return map.unproject([x, y], nativeZoom);
}
