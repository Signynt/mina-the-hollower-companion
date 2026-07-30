// storage.js
// Talks to the local Express backend (server.js) to autosave progress
// (fog + pins per layer) to data/save.json, and handles export/import of
// that same JSON for backups or moving between machines.

import { logger } from "./logger.js";

let saveTimer = null;
let pendingState = null;
let onStatusChange = () => {};

export function onSaveStatusChange(fn) {
  onStatusChange = fn;
}

export async function loadSave() {
  try {
    const res = await fetch("/api/save");
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    logger.info("Save data loaded", { updatedAt: data.updatedAt });
    return data;
  } catch (err) {
    logger.error("Failed to load save data, starting with a blank save", { message: err.message });
    onStatusChange("error", "Could not load save — starting fresh");
    return { version: 1, updatedAt: null, layers: {} };
  }
}

/** Debounced autosave: call this often (every fog stroke / pin edit); the
 * actual network write is throttled to avoid hammering the disk mid-drag. */
export function scheduleSave(state, delayMs = 700) {
  pendingState = state;
  onStatusChange("pending", "Unsaved changes…");
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, delayMs);
}

export async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pendingState) return;
  const toSave = pendingState;
  onStatusChange("saving", "Saving…");
  try {
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toSave),
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    pendingState = null;
    onStatusChange("saved", "All progress saved");
    logger.debug("Autosave complete");
  } catch (err) {
    logger.error("Autosave failed", { message: err.message });
    onStatusChange("error", "Autosave failed — will retry");
    // retry shortly rather than losing the change silently
    saveTimer = setTimeout(flushSave, 3000);
  }
}

// Flush on tab close so a stroke right before closing isn't lost.
window.addEventListener("beforeunload", () => {
  if (pendingState) {
    try {
      navigator.sendBeacon(
        "/api/save",
        new Blob([JSON.stringify(pendingState)], { type: "application/json" })
      );
    } catch (err) {
      // best-effort only
    }
  }
});

export function exportSave() {
  window.location.href = "/api/export";
  logger.info("Export triggered");
}

export async function importSave(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    if (!json || typeof json !== "object" || !json.layers) {
      throw new Error("File does not look like a valid Mina Map save (missing 'layers')");
    }
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    logger.info("Save data imported");
    return json;
  } catch (err) {
    logger.error("Import failed", { message: err.message });
    throw err;
  }
}

export async function resetSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingState = null;
  try {
    const res = await fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    onStatusChange("saved", "Save reset");
    logger.info("Save data reset");
  } catch (err) {
    logger.error("Reset failed", { message: err.message });
    onStatusChange("error", "Reset failed");
    throw err;
  }
}
