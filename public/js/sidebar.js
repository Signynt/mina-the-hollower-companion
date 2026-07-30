// sidebar.js
// Builds and updates the left sidebar (floors, filters), right sidebar
// (notes directory + search), toolbar floor quickswitch, and save status
// indicator. Pure UI wiring -- state and persistence live in app.js.

import { PIN_TYPES, getPinType } from "./icons.js";

export function buildFloorSelector({ layers, activeLayerId, onSelect }) {
  const list = document.getElementById("floor-list");
  const quick = document.getElementById("floor-quickswitch");
  list.innerHTML = "";
  quick.innerHTML = "";

  layers.forEach((layer) => {
    const item = document.createElement("div");
    item.className = "floor-item" + (layer.id === activeLayerId ? " active" : "");
    item.textContent = layer.label;
    item.addEventListener("click", () => onSelect(layer.id));
    list.appendChild(item);

    const qbtn = document.createElement("button");
    qbtn.className = "quickswitch-btn" + (layer.id === activeLayerId ? " active" : "");
    qbtn.textContent = layer.label.length > 14 ? layer.label.slice(0, 13) + "…" : layer.label;
    qbtn.title = layer.label;
    qbtn.addEventListener("click", () => onSelect(layer.id));
    quick.appendChild(qbtn);
  });
}

export function markActiveFloor(activeLayerId) {
  document.querySelectorAll("#floor-list .floor-item").forEach((el, i) => {});
}

export function buildPinFilters({ onChange }) {
  const container = document.getElementById("pin-filters");
  container.innerHTML = "";
  PIN_TYPES.forEach((type) => {
    const row = document.createElement("label");
    row.className = "filter-row";
    row.innerHTML = `<input type="checkbox" checked data-type="${type.id}" /><span class="icon">${type.glyph}</span><span>${type.label}</span>`;
    const checkbox = row.querySelector("input");
    checkbox.addEventListener("change", () => {
      const hidden = new Set(
        Array.from(container.querySelectorAll("input[type=checkbox]"))
          .filter((c) => !c.checked)
          .map((c) => c.dataset.type)
      );
      onChange({ hiddenTypes: hidden });
    });
    container.appendChild(row);
  });

  document.getElementById("filter-hide-opened").addEventListener("change", (e) => {
    onChange({ hideOpened: e.target.checked });
  });
}

export function wireSearch(onChange) {
  const input = document.getElementById("note-search");
  let t = null;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => onChange(input.value), 120);
  });
}

export function renderNotesList({ layers, pinsByLayer, activeLayerId, searchTerm, onSelect }) {
  const container = document.getElementById("notes-list");
  container.innerHTML = "";
  const term = (searchTerm || "").trim().toLowerCase();

  const layerLabelFor = (id) => (layers.find((l) => l.id === id) || {}).label || id;

  const entries = [];
  Object.keys(pinsByLayer).forEach((layerId) => {
    (pinsByLayer[layerId] || []).forEach((pin) => {
      if (!pin.title && !pin.note) return; // skip freshly-placed, unedited pins
      entries.push({ ...pin, layerId });
    });
  });

  const filtered = entries.filter((pin) => {
    if (!term) return true;
    return (pin.title || "").toLowerCase().includes(term) || (pin.note || "").toLowerCase().includes(term);
  });

  filtered.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "note-empty";
    empty.textContent = term ? "No notes match your search." : "No notes yet — click the map to add one.";
    container.appendChild(empty);
    return;
  }

  filtered.forEach((pin) => {
    const type = getPinType(pin.type);
    const el = document.createElement("div");
    el.className = "note-item";
    el.innerHTML = `
      <div class="note-title">${type.glyph} ${escapeHtml(pin.title || type.label)}</div>
      <div class="note-floor">${escapeHtml(layerLabelFor(pin.layerId))}</div>
      ${pin.note ? `<div class="note-snippet">${escapeHtml(pin.note.slice(0, 90))}</div>` : ""}
    `;
    el.addEventListener("click", () => onSelect(pin));
    container.appendChild(el);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function wireSidebarToggles() {
  document.getElementById("toggle-left-sidebar").addEventListener("click", () => {
    document.getElementById("left-sidebar").classList.toggle("collapsed");
  });
  document.getElementById("toggle-right-sidebar").addEventListener("click", () => {
    document.getElementById("right-sidebar").classList.toggle("collapsed");
  });
}

export function setSaveStatus(state, message) {
  const el = document.getElementById("save-status");
  el.textContent = message;
  el.className = "save-status " + (state === "saving" || state === "pending" ? "saving" : state === "error" ? "error" : "");
}
