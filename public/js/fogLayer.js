// fogLayer.js
// A custom Leaflet layer that draws a black fog-of-war mask over the map.
// The fog is stored as a low-resolution grid (independent of the huge
// source image resolution -- see layers.config.json: fogGridResolution)
// where 0 = fogged (draw solid black) and 1 = erased (fully transparent,
// letting the real map tile show through). Only the grid cells intersecting
// the current viewport are drawn each frame, so redraws stay cheap even
// though the underlying source image is enormous.

import { logger } from "./logger.js";

// Implemented as a proper L.Layer subclass (via L.Layer.extend) rather than
// a plain duck-typed object, so it gets full lifecycle support (pane
// handling, addTo/remove, internal Leaflet bookkeeping like _leaflet_id)
// for free and behaves exactly like any other Leaflet layer.
//
// This requires Leaflet's global `L` to already be defined at the moment
// this module is evaluated (i.e. public/vendor/leaflet/leaflet.js, loaded
// as a plain <script> in index.html, must appear before the <script
// type="module" src="js/app.js"> tag that imports this file). If that
// ordering is ever changed, fail with a clear, specific message instead of
// a cryptic "L is not defined" from deep inside this file.
if (typeof L === "undefined") {
  throw new Error(
    "Leaflet (global `L`) is not defined while loading fogLayer.js. " +
      "public/vendor/leaflet/leaflet.js must load (as a plain <script>, before " +
      "the type=module app.js tag) before this module can be imported. " +
      "Check the browser Network tab for a failed request to vendor/leaflet/leaflet.js."
  );
}

const FogLayerBase = L.Layer.extend({
  initialize(opts) {
    this._init(opts);
  },
});

export class FogLayer extends FogLayerBase {
  _init({ sourceWidth, sourceHeight, gridWidth, gridHeight, nativeZoom }) {
    this.sourceWidth = sourceWidth;
    this.sourceHeight = sourceHeight;
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.nativeZoom = nativeZoom;
    this.cellWpx = sourceWidth / gridWidth;
    this.cellHpx = sourceHeight / gridHeight;
    this.grid = new Uint8Array(gridWidth * gridHeight); // 0 = fogged (default), 1 = erased
    this.peeking = false;
    this._map = null;
    this._canvas = null;
    this._ctx = null;
    this._dpr = 1;
    this._gridCanvas = document.createElement("canvas");
    this._gridCanvas.width = gridWidth;
    this._gridCanvas.height = gridHeight;
    this._gridCtx = this._gridCanvas.getContext("2d");
    this._rebuildGridCanvas();
    this._frameRequested = false;
  }

  /** Replace the grid wholesale (e.g. loading from a save file). */
  setGrid(uint8ArrayLike) {
    if (uint8ArrayLike && uint8ArrayLike.length === this.grid.length) {
      this.grid = Uint8Array.from(uint8ArrayLike);
    } else {
      logger.warn("Fog grid size mismatch on load; starting fresh", {
        expected: this.grid.length,
        got: uint8ArrayLike ? uint8ArrayLike.length : null,
      });
      this.grid = new Uint8Array(this.gridWidth * this.gridHeight);
    }
    this._rebuildGridCanvas();
    this.requestDraw();
  }

  /** Base64-encode the grid for saving. */
  serialize() {
    let binary = "";
    for (let i = 0; i < this.grid.length; i++) binary += String.fromCharCode(this.grid[i]);
    return btoa(binary);
  }

  static deserialize(base64, gridWidth, gridHeight) {
    if (!base64) return new Uint8Array(gridWidth * gridHeight);
    try {
      const binary = atob(base64);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
      return arr;
    } catch (err) {
      logger.error("Failed to decode fog grid, starting fresh", { message: err.message });
      return new Uint8Array(gridWidth * gridHeight);
    }
  }

  onAdd(map) {
    this._map = map;
    const pane = map.createPane("fogPane");
    pane.classList.add("fog-canvas-pane");
    this._canvas = L.DomUtil.create("canvas", "fog-canvas");
    pane.appendChild(this._canvas);
    this._ctx = this._canvas.getContext("2d");
    this._canvas.style.position = "absolute";
    this._canvas.style.left = "0";
    this._canvas.style.top = "0";

    map.on("move zoom viewreset", this._onViewChange, this);
    map.on("resize", this._onResize, this);
    this._resizeCanvas();
    this.requestDraw();
    return this;
  }

  onRemove(map) {
    map.off("move zoom viewreset", this._onViewChange, this);
    map.off("resize", this._onResize, this);
    if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
    this._map = null;
  }

  addTo(map) {
    map.addLayer(this);
    return this;
  }

  _onViewChange() {
    this._updateCanvasPosition();
    this.requestDraw();
  }

  _onResize() {
    this._resizeCanvas();
    this.requestDraw();
  }

  _resizeCanvas() {
    if (!this._map || !this._canvas) return;
    const size = this._map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._dpr = dpr;

    this._canvas.width = size.x * dpr;
    this._canvas.height = size.y * dpr;
    this._canvas.style.width = size.x + "px";
    this._canvas.style.height = size.y + "px";

    this._updateCanvasPosition();
  }
  
  _rebuildGridCanvas() {
    if (!this._gridCtx) return;
    const image = this._gridCtx.createImageData(this.gridWidth, this.gridHeight);
    const data = image.data;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] !== 0) continue;
      const offset = i * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 255;
    }
    this._gridCtx.putImageData(image, 0, 0);
  }

  _setGridCanvasCell(x, y, value) {
    if (!this._gridCtx) return;
    if (value === 0) {
      this._gridCtx.fillStyle = "#000000";
      this._gridCtx.fillRect(x, y, 1, 1);
    } else {
      this._gridCtx.clearRect(x, y, 1, 1);
    }
  }

  setPeek(active) {
    this.peeking = active;
    this.requestDraw();
  }

  requestDraw() {
    if (this._frameRequested) return;
    this._frameRequested = true;
    requestAnimationFrame(() => {
      this._frameRequested = false;
      this._draw();
    });
  }

  _updateCanvasPosition() {
    if (!this._map || !this._canvas) return;
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);
  }

  _draw() {
    if (!this._map || !this._ctx) return;
    const ctx = this._ctx;
    const size = this._map.getSize();
    const dpr = this._dpr || 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    ctx.imageSmoothingEnabled = false;
    ctx.filter = this.peeking ? "blur(0px)" : "none";
    ctx.globalAlpha = this.peeking ? 0.8 : 1.0;
    ctx.globalCompositeOperation = "source-over";

    const zoomScale = Math.pow(2, this._map.getZoom() - this.nativeZoom);

    // Get the pixel coordinates of the current viewport's top-left corner
    const viewBounds = this._map.getPixelBounds();
    const topLeft = viewBounds.min;

    // Scale the fog canvas and offset it by the negative top-left position
    ctx.setTransform(
      dpr * this.cellWpx * zoomScale,
      0,
      0,
      dpr * this.cellHpx * zoomScale,
      -topLeft.x * dpr,
      -topLeft.y * dpr
    );
    ctx.drawImage(this._gridCanvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1.0;
    ctx.filter = "none";
  }

  /**
   * Erase or re-fog a square brush centered on a source-pixel coordinate.
   * radiusPx is in *source image* pixels (already converted by the caller
   * from screen pixels using the current zoom).
   */
  paintAt(sourceX, sourceY, radiusPx, erase) {
    const cx = Math.floor(sourceX / this.cellWpx);
    const cy = Math.floor(sourceY / this.cellHpx);
    const cellRadiusX = Math.max(1, Math.ceil(radiusPx / this.cellWpx));
    const cellRadiusY = Math.max(1, Math.ceil(radiusPx / this.cellHpx));
    const value = erase ? 1 : 0;
    let changed = false;
    for (let y = cy - cellRadiusY; y <= cy + cellRadiusY; y++) {
      if (y < 0 || y >= this.gridHeight) continue;
      for (let x = cx - cellRadiusX; x <= cx + cellRadiusX; x++) {
        if (x < 0 || x >= this.gridWidth) continue;
        const idx = y * this.gridWidth + x;
        if (this.grid[idx] !== value) {
          this.grid[idx] = value;
          this._setGridCanvasCell(x, y, value);
          changed = true;
        }
      }
    }
    if (changed) this.requestDraw();
    return changed;
  }

  /** Percent of the map that has been revealed, for potential UI display. */
  percentRevealed() {
    let revealed = 0;
    for (let i = 0; i < this.grid.length; i++) revealed += this.grid[i];
    return (revealed / this.grid.length) * 100;
  }
}
