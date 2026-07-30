// pins.js
// Handles marker placement, the type-picker + editor floating menus, and
// rendering/filtering pins for whichever floor is currently active.
// Pin data itself is owned by app.js (the single source of truth that gets
// persisted); this module renders it and reports mutations back up via the
// onMutate callback.

import { PIN_TYPES, getPinType } from "./icons.js";
import { logger } from "./logger.js";

function uid() {
  return "pin_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export class PinManager {
  constructor({ map, mapMeta, onMutate, onSelect }) {
    this.map = map;
    this.mapMeta = mapMeta;
    this.onMutate = onMutate; // (layerId, pins[]) => void
    this.onSelect = onSelect; // (pin) => void, for e.g. highlighting in notes list
    this.layerId = null;
    this.pins = [];
    this.markers = new Map(); // pin.id -> L.Marker
    this.markerLayer = L.layerGroup().addTo(map);
    this.filters = { hiddenTypes: new Set(), hideOpened: false, searchTerm: "" };
    this._pendingNewPinLatLng = null;

    this.typeMenuEl = document.getElementById("pin-type-menu");
    this.editorEl = document.getElementById("pin-editor");
    this._buildTypeMenu();
    this._wireEditor();

    this.map.on("click", (e) => this._onMapClick(e));
  }

  loadLayer(layerId, pins) {
    this.layerId = layerId;
    this.pins = pins || [];
    this._renderAll();
  }

  setFilters(filters) {
    this.filters = { ...this.filters, ...filters };
    this._applyFilters();
  }

  _renderAll() {
    this.markerLayer.clearLayers();
    this.markers.clear();
    for (const pin of this.pins) this._renderMarker(pin);
    this._applyFilters();
  }

  _renderMarker(pin) {
    const type = getPinType(pin.type);
    const latlng = this.map.unproject([pin.x, pin.y], this.mapMeta.maxZoom);
    const icon = L.divIcon({
      className: "",
      html: `<div class="map-pin ${pin.state === "opened" ? "state-opened" : ""}">${type.glyph}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    const marker = L.marker(latlng, { icon, pinId: pin.id });
    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      this.openEditor(pin, e.containerPoint);
      if (this.onSelect) this.onSelect(pin);
    });
    marker.addTo(this.markerLayer);
    this.markers.set(pin.id, marker);
  }

  _applyFilters() {
    const { hiddenTypes, hideOpened, searchTerm } = this.filters;
    const term = (searchTerm || "").trim().toLowerCase();
    for (const pin of this.pins) {
      const marker = this.markers.get(pin.id);
      if (!marker) continue;
      let visible = true;
      if (hiddenTypes.has(pin.type)) visible = false;
      if (hideOpened && pin.state === "opened") visible = false;
      let matchesSearch = true;
      if (term) {
        matchesSearch =
          (pin.title || "").toLowerCase().includes(term) || (pin.note || "").toLowerCase().includes(term);
      }
      const el = marker.getElement();
      if (!el) continue;
      const inner = el.querySelector(".map-pin");
      if (!visible) {
        el.style.display = "none";
      } else {
        el.style.display = "";
        if (inner) inner.classList.toggle("dimmed", term.length > 0 && !matchesSearch);
      }
    }
  }

  _onMapClick(e) {
    // Ignore clicks that are actually the tail end of a right-drag or a
    // shift-click, and ignore clicks on UI chrome.
    this._pendingNewPinLatLng = e.latlng;
    this._openTypeMenu(e.containerPoint);
  }

  _buildTypeMenu() {
    this.typeMenuEl.innerHTML = "";
    for (const type of PIN_TYPES) {
      const opt = document.createElement("div");
      opt.className = "pin-type-option";
      opt.innerHTML = `<span>${type.glyph}</span><span>${type.label}</span>`;
      opt.addEventListener("click", () => this._createPinOfType(type.id));
      this.typeMenuEl.appendChild(opt);
    }
  }

  _openTypeMenu(containerPoint) {
    this._positionFloating(this.typeMenuEl, containerPoint);
    this.typeMenuEl.hidden = false;
    this.editorEl.hidden = true;
    const closeOnce = (ev) => {
      if (!this.typeMenuEl.contains(ev.target)) {
        this.typeMenuEl.hidden = true;
        document.removeEventListener("mousedown", closeOnce, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeOnce, true), 0);
  }

  _createPinOfType(typeId) {
    this.typeMenuEl.hidden = true;
    if (!this._pendingNewPinLatLng) return;
    const point = this.map.project(this._pendingNewPinLatLng, this.mapMeta.maxZoom);
    const pin = {
      id: uid(),
      type: typeId,
      x: Math.round(point.x),
      y: Math.round(point.y),
      title: "",
      note: "",
      state: "unopened",
      createdAt: new Date().toISOString(),
    };
    this.pins.push(pin);
    this._renderMarker(pin);
    this._applyFilters();
    this._mutate();
    const marker = this.markers.get(pin.id);
    const cp = this.map.latLngToContainerPoint(marker.getLatLng());
    this.openEditor(pin, cp, /*isNew*/ true);
    logger.info("Pin created", { type: typeId, layer: this.layerId });
  }

  openEditor(pin, containerPoint, isNew = false) {
    this._activePin = pin;
    this._isNewPin = isNew;
    const type = getPinType(pin.type);
    document.getElementById("pin-editor-title").value = pin.title || "";
    document.getElementById("pin-editor-note").value = pin.note || "";
    const stateRow = document.getElementById("pin-editor-state-row");
    const stateBox = document.getElementById("pin-editor-state");
    if (type.toggleable) {
      stateRow.hidden = false;
      document.getElementById("pin-editor-state-label").textContent = type.stateLabel || "Completed";
      stateBox.checked = pin.state === "opened";
    } else {
      stateRow.hidden = true;
    }
    this._positionFloating(this.editorEl, containerPoint);
    this.editorEl.hidden = false;
    this.typeMenuEl.hidden = true;
    document.getElementById("pin-editor-title").focus();
  }

  _wireEditor() {
    document.getElementById("pin-editor-save").addEventListener("click", () => this._saveEditor());
    document.getElementById("pin-editor-cancel").addEventListener("click", () => this._cancelEditor());
    document.getElementById("pin-editor-delete").addEventListener("click", () => this._deleteActivePin());
    document.getElementById("pin-editor-title").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this._saveEditor();
      if (e.key === "Escape") this._cancelEditor();
    });
  }

  _saveEditor() {
    if (!this._activePin) return;
    const pin = this._activePin;
    pin.title = document.getElementById("pin-editor-title").value.trim() || getPinType(pin.type).label;
    pin.note = document.getElementById("pin-editor-note").value.trim();
    const type = getPinType(pin.type);
    if (type.toggleable) {
      pin.state = document.getElementById("pin-editor-state").checked ? "opened" : "unopened";
    }
    const marker = this.markers.get(pin.id);
    if (marker) {
      const el = marker.getElement();
      const inner = el && el.querySelector(".map-pin");
      if (inner) inner.classList.toggle("state-opened", pin.state === "opened");
    }
    this.editorEl.hidden = true;
    this._activePin = null;
    this._applyFilters();
    this._mutate();
    logger.debug("Pin saved", { id: pin.id });
  }

  _cancelEditor() {
    if (this._isNewPin && this._activePin && !this._activePin.title) {
      this._removePin(this._activePin);
    }
    this.editorEl.hidden = true;
    this._activePin = null;
  }

  _deleteActivePin() {
    if (this._activePin) this._removePin(this._activePin);
    this.editorEl.hidden = true;
    this._activePin = null;
  }

  _removePin(pin) {
    const marker = this.markers.get(pin.id);
    if (marker) {
      this.markerLayer.removeLayer(marker);
      this.markers.delete(pin.id);
    }
    this.pins = this.pins.filter((p) => p.id !== pin.id);
    this._mutate();
    logger.info("Pin deleted", { id: pin.id });
  }

  panTo(pin) {
    const latlng = this.map.unproject([pin.x, pin.y], this.mapMeta.maxZoom);
    this.map.setView(latlng, Math.max(this.map.getZoom(), this.mapMeta.maxZoom - 1), { animate: true });
    const marker = this.markers.get(pin.id);
    if (marker) {
      setTimeout(() => this.openEditor(pin, this.map.latLngToContainerPoint(latlng)), 300);
    }
  }

  _positionFloating(el, containerPoint) {
    const wrap = document.getElementById("map-wrap").getBoundingClientRect();
    let x = containerPoint.x;
    let y = containerPoint.y;
    el.style.left = x + "px";
    el.style.top = y + "px";
    // clamp after showing so we can measure; deferred to next frame
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      let nx = x, ny = y;
      if (rect.right > wrap.width) nx -= rect.right - wrap.width + 10;
      if (rect.bottom > wrap.height) ny -= rect.bottom - wrap.height + 10;
      if (nx < 0) nx = 4;
      if (ny < 0) ny = 4;
      el.style.left = nx + "px";
      el.style.top = ny + "px";
    });
  }

  _mutate() {
    if (this.onMutate) this.onMutate(this.layerId, this.pins);
  }
}
