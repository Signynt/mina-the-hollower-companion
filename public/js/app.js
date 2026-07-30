// app.js
// Application entry point. Owns the central state object, wires the map /
// fog / pins / sidebar / storage modules together, and handles the raw
// input events (right-click erase drag, F-to-peek, floor switching).

import { logger } from "./logger.js";
import { createMap, buildTileLayer } from "./mapSetup.js";
import { FogLayer } from "./fogLayer.js";
import { PinManager } from "./pins.js";
import * as storage from "./storage.js";
import * as sidebar from "./sidebar.js";

const state = {
  config: null,
  mapMeta: null,
  activeLayerId: null,
  save: { version: 1, layers: {} },
  gridWidth: 0,
  gridHeight: 0,
};

const tileLayers = new Map(); // layerId -> L.TileLayer
const fogLayers = new Map(); // layerId -> FogLayer
let pinManager = null;
let brushScreenPx = 70;
let isPeeking = false;
let isPainting = false;
let paintErase = true;

function showToast(message, isError = false) {
  const stack = document.getElementById("toast-stack");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function ensureLayerSaveEntry(layerId) {
  if (!state.save.layers[layerId]) {
    state.save.layers[layerId] = { fog: null, pins: [] };
  }
  return state.save.layers[layerId];
}

function persist() {
  storage.scheduleSave(state.save);
}

async function boot() {
  logger.info("Booting Mina the Hollower companion map");

  if (typeof L === "undefined") {
    const msg = "Leaflet failed to load (vendor/leaflet/leaflet.js). The map can't start.";
    logger.error(msg);
    sidebar.setSaveStatus("error", "Leaflet failed to load");
    showToast(msg, true);
    return;
  }

  let config;
  try {
    const res = await fetch("/api/layers");
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    config = await res.json();
  } catch (err) {
    logger.error("Failed to load layers.config.json", { message: err.message });
    showToast("Could not load map configuration. Check the server console.", true);
    return;
  }
  state.config = config;
  state.gridWidth = config.fogGridResolution;
  state.gridHeight = Math.round(config.fogGridResolution * (config.sourceHeight / config.sourceWidth));

  state.save = await storage.loadSave();
  storage.onSaveStatusChange((s, msg) => sidebar.setSaveStatus(s, msg));

  const mapMeta = createMap(config);
  state.mapMeta = mapMeta;

  pinManager = new PinManager({
    map: mapMeta.map,
    mapMeta,
    onMutate: (layerId, pins) => {
      ensureLayerSaveEntry(layerId).pins = pins;
      persist();
      refreshNotesList();
    },
    onSelect: () => {},
  });

  sidebar.wireSidebarToggles();
  sidebar.buildFloorSelector({
    layers: config.layers,
    activeLayerId: config.layers[0].id,
    onSelect: switchLayer,
  });
  sidebar.buildPinFilters({
    onChange: (partial) => {
      pinManager.setFilters(partial);
    },
  });
  sidebar.wireSearch((term) => {
    pinManager.setFilters({ searchTerm: term });
    refreshNotesList(term);
  });

  wireFogInput(mapMeta.map);
  wirePeek();
  wireBrushSlider();
  wireImportExport();

  switchLayer(config.layers[0].id);

  logger.info("App ready");
}

function getOrCreateTileLayer(layerId) {
  if (!tileLayers.has(layerId)) {
    tileLayers.set(layerId, buildTileLayer(layerId, state.mapMeta));
  }
  return tileLayers.get(layerId);
}

function getOrCreateFogLayer(layerId) {
  if (!fogLayers.has(layerId)) {
    const fog = new FogLayer({
      sourceWidth: state.config.sourceWidth,
      sourceHeight: state.config.sourceHeight,
      gridWidth: state.gridWidth,
      gridHeight: state.gridHeight,
      nativeZoom: state.mapMeta.maxZoom,
    });
    const entry = ensureLayerSaveEntry(layerId);
    if (entry.fog) {
      fog.setGrid(FogLayer.deserialize(entry.fog, state.gridWidth, state.gridHeight));
    }
    fogLayers.set(layerId, fog);
  }
  return fogLayers.get(layerId);
}

function switchLayer(layerId) {
  const map = state.mapMeta.map;

  if (state.activeLayerId) {
    const prevTile = tileLayers.get(state.activeLayerId);
    const prevFog = fogLayers.get(state.activeLayerId);
    if (prevTile && map.hasLayer(prevTile)) map.removeLayer(prevTile);
    if (prevFog && map.hasLayer(prevFog)) map.removeLayer(prevFog);
    saveFogFor(state.activeLayerId);
  }

  state.activeLayerId = layerId;
  const tile = getOrCreateTileLayer(layerId);
  const fog = getOrCreateFogLayer(layerId);
  tile.addTo(map);
  fog.addTo(map);

  const entry = ensureLayerSaveEntry(layerId);
  pinManager.loadLayer(layerId, entry.pins || []);

  sidebar.buildFloorSelector({ layers: state.config.layers, activeLayerId: layerId, onSelect: switchLayer });
  refreshNotesList();

  logger.info("Switched floor", { layerId });
}

function saveFogFor(layerId) {
  const fog = fogLayers.get(layerId);
  if (!fog) return;
  ensureLayerSaveEntry(layerId).fog = fog.serialize();
}

function refreshNotesList(term) {
  const pinsByLayer = {};
  Object.keys(state.save.layers).forEach((id) => {
    pinsByLayer[id] = state.save.layers[id].pins || [];
  });
  sidebar.renderNotesList({
    layers: state.config.layers,
    pinsByLayer,
    activeLayerId: state.activeLayerId,
    searchTerm: term ?? document.getElementById("note-search").value,
    onSelect: (pin) => {
      if (pin.layerId !== state.activeLayerId) switchLayer(pin.layerId);
      setTimeout(() => pinManager.panTo(pin), pin.layerId !== state.activeLayerId ? 150 : 0);
    },
  });
}

// ---------------- Fog painting input (right-click drag) ----------------
function pxToSourcePx(distancePx) {
  const map = state.mapMeta.map;
  return distancePx * Math.pow(2, state.mapMeta.maxZoom - map.getZoom());
}

function paintFromEvent(e) {
  const map = state.mapMeta.map;
  const fog = fogLayers.get(state.activeLayerId);
  if (!fog) return;
  const containerPoint = map.mouseEventToContainerPoint(e);
  const latlng = map.containerPointToLatLng(containerPoint);
  const p = map.project(latlng, state.mapMeta.maxZoom);
  const radius = pxToSourcePx(brushScreenPx / 2);
  const changed = fog.paintAt(p.x, p.y, radius, paintErase);
  if (changed) {
    saveFogFor(state.activeLayerId);
    persist();
  }
}

function wireFogInput(map) {
  const container = map.getContainer();
  container.addEventListener("contextmenu", (e) => e.preventDefault());

  container.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return; // right button only
    isPainting = true;
    paintErase = !e.shiftKey;
    map.dragging.disable(); // avoid the map panning while painting
    paintFromEvent(e);
  });

  window.addEventListener("mousemove", (e) => {
    if (!isPainting) return;
    paintErase = !e.shiftKey;
    paintFromEvent(e);
  });

  window.addEventListener("mouseup", (e) => {
    if (!isPainting) return;
    if (e.button === 2) {
      isPainting = false;
      map.dragging.enable();
    }
  });

  // Safety net: if the mouse leaves the window entirely while painting.
  window.addEventListener("blur", () => {
    if (isPainting) {
      isPainting = false;
      map.dragging.enable();
    }
  });
}

// ---------------- Peek mode (spacebar) ----------------
function wirePeek() {
  document.addEventListener("keydown", (e) => {
    if (e.code !== "KeyF" || e.repeat) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return; // don't hijack typing
    if (isPeeking) return;
    e.preventDefault();
    isPeeking = true;
    const fog = fogLayers.get(state.activeLayerId);
    if (fog) fog.setPeek(true);
  });
  document.addEventListener("keyup", (e) => {
    if (e.code !== "KeyF") return;
    isPeeking = false;
    const fog = fogLayers.get(state.activeLayerId);
    if (fog) fog.setPeek(false);
  });
}

function wireBrushSlider() {
  const slider = document.getElementById("brush-size");
  brushScreenPx = Number(slider.value);
  slider.addEventListener("input", () => {
    brushScreenPx = Number(slider.value);
  });
}

// ---------------- Import / export ----------------
function wireImportExport() {
  document.getElementById("btn-export").addEventListener("click", () => {
    saveFogFor(state.activeLayerId);
    storage.flushSave().then(() => storage.exportSave());
  });

  document.getElementById("btn-reset").addEventListener("click", async () => {
    const ok = window.confirm("Reset all saved fog, pins, and settings? This cannot be undone.");
    if (!ok) return;
    try {
      await storage.resetSave();
      window.location.reload();
    } catch (err) {
      showToast("Reset failed: " + err.message, true);
    }
  });

  const fileInput = document.getElementById("import-file-input");
  document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const imported = await storage.importSave(file);
      state.save = imported;
      tileLayers.forEach((layer, id) => {
        if (state.mapMeta.map.hasLayer(layer)) state.mapMeta.map.removeLayer(layer);
      });
      fogLayers.forEach((layer, id) => {
        if (state.mapMeta.map.hasLayer(layer)) state.mapMeta.map.removeLayer(layer);
      });
      fogLayers.clear();
      const current = state.activeLayerId;
      state.activeLayerId = null;
      switchLayer(current || state.config.layers[0].id);
      showToast("Save data imported successfully.");
    } catch (err) {
      showToast("Import failed: " + err.message, true);
    }
  });
}

// Periodically snapshot the active layer's fog into the save object so a
// long uninterrupted painting session still autosaves incrementally.
setInterval(() => {
  if (state.activeLayerId) saveFogFor(state.activeLayerId);
}, 4000);

boot().catch((err) => {
  logger.error("Fatal error during boot", { message: err.message, stack: err.stack });
  showToast("Something went wrong starting the app — check the console.", true);
});
