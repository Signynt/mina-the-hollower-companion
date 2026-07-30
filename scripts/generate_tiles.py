#!/usr/bin/env python3
"""
generate_tiles.py

Slices the huge per-layer map PNGs (map_images/*.png, ~18367x17210px each)
into a Leaflet-compatible tile pyramid under public/tiles/<layer-id>/<z>/<x>/<y>.png

Why this is needed:
Browsers cannot efficiently load/pan/zoom a single ~18000x17000px image (it would
be well over 1GB decoded in memory and would freeze the tab). Leaflet instead
expects small 256x256 tiles per zoom level, loaded on demand.

Approach (memory-conscious):
  1. Open the source image once per layer (Pillow lazily decodes on access).
  2. Build the *highest* zoom level tiles by cropping directly from the source.
  3. Build every lower zoom level by downsampling 2x2 blocks of the level above
     (nearest-neighbor, to keep pixel-art edges crisp), never touching the full
     source image more than once.
  4. Fully-transparent tiles are skipped entirely (saves disk + requests) --
     the map container has a black background, so "no tile" already renders
     as solid black, which is exactly the spoiler-safe behavior we want for
     off-map areas.

Usage:
  pip install Pillow
  python3 scripts/generate_tiles.py                 # process all layers
  python3 scripts/generate_tiles.py --layer layer-03 # process a single layer
  python3 scripts/generate_tiles.py --tile-size 256

Requires ~2-4GB free RAM per layer while it runs (one layer is processed at a
time to keep memory bounded). This is a one-time offline preprocessing step;
it does not affect runtime performance of the web app itself.
"""
import argparse
import json
import logging
import math
import os
import sys
import time

try:
    from PIL import Image
except ImportError:
    print("Pillow is required. Install it with: pip install Pillow")
    sys.exit(1)

Image.MAX_IMAGE_PIXELS = None  # these are legitimate large images, disable the decompression-bomb guard

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_PATH = os.path.join(ROOT, "logs", "tile_generation.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("tiler")


def load_config():
    cfg_path = os.path.join(ROOT, "layers.config.json")
    with open(cfg_path, "r", encoding="utf-8") as f:
        return json.load(f)


def max_zoom_for(width, height, tile_size):
    largest = max(width, height)
    return max(0, math.ceil(math.log2(largest / tile_size)))


def crop_base_tile(src_img, x, y, tile_size, level_dim_px):
    """Crop one tile at the native (max-zoom) resolution, padding with
    transparency if it runs past the image edge."""
    left = x * tile_size
    top = y * tile_size
    right = min(left + tile_size, src_img.width)
    bottom = min(top + tile_size, src_img.height)
    if left >= src_img.width or top >= src_img.height:
        return None
    region = src_img.crop((left, top, right, bottom))
    if region.width < tile_size or region.height < tile_size:
        canvas = Image.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))
        canvas.paste(region, (0, 0))
        region = canvas
    return region


def is_fully_transparent(img):
    alpha = img.getchannel("A")
    return alpha.getbbox() is None


def save_tile(img, out_dir, x, y):
    if img is None or is_fully_transparent(img):
        return False
    os.makedirs(out_dir, exist_ok=True)
    img.save(os.path.join(out_dir, f"{y}.png"), optimize=True)
    return True


def generate_layer(layer, tile_size, out_root):
    layer_id = layer["id"]
    src_path = os.path.join(ROOT, "map_images", layer["file"])
    if not os.path.exists(src_path):
        log.warning("Skipping %s -- source file not found: %s", layer_id, src_path)
        return

    log.info("=== Layer %s (%s) : opening source image ===", layer_id, layer["file"])
    t0 = time.time()
    src = Image.open(src_path).convert("RGBA")
    width, height = src.size
    max_zoom = max_zoom_for(width, height, tile_size)
    log.info("%s: %dx%d px, maxZoom=%d", layer_id, width, height, max_zoom)

    layer_out = os.path.join(out_root, layer_id)

    # --- Base (max zoom) level: crop directly from source ---
    tiles_x = math.ceil((tile_size * (2 ** max_zoom)) / tile_size)
    dim_tiles = 2 ** max_zoom
    written = 0
    considered = 0
    for tx in range(dim_tiles):
        if tx * tile_size >= width:
            break
        for ty in range(dim_tiles):
            if ty * tile_size >= height:
                break
            considered += 1
            tile = crop_base_tile(src, tx, ty, tile_size, dim_tiles * tile_size)
            out_dir = os.path.join(layer_out, str(max_zoom), str(tx))
            if save_tile(tile, out_dir, tx, ty):
                written += 1
    log.info(
        "%s: zoom %d done (%d/%d tiles kept, rest fully transparent/off-map)",
        layer_id, max_zoom, written, considered,
    )

    # free the huge source image now; lower levels are built from tiles on disk
    src.close()

    # --- Lower zoom levels: downsample 2x2 blocks of the level above ---
    for z in range(max_zoom - 1, -1, -1):
        dim_tiles_z = 2 ** z
        parent_dim = 2 ** (z + 1)
        written = 0
        considered = 0
        for tx in range(dim_tiles_z):
            for ty in range(dim_tiles_z):
                considered += 1
                quad = Image.new("RGBA", (tile_size * 2, tile_size * 2), (0, 0, 0, 0))
                any_child = False
                for dx in range(2):
                    for dy in range(2):
                        cx, cy = tx * 2 + dx, ty * 2 + dy
                        child_path = os.path.join(layer_out, str(z + 1), str(cx), f"{cy}.png")
                        if os.path.exists(child_path):
                            child_img = Image.open(child_path)
                            quad.paste(child_img, (dx * tile_size, dy * tile_size))
                            any_child = True
                if not any_child:
                    continue
                resized = quad.resize((tile_size, tile_size), Image.NEAREST)
                out_dir = os.path.join(layer_out, str(z), str(tx))
                if save_tile(resized, out_dir, tx, ty):
                    written += 1
        log.info("%s: zoom %d done (%d/%d tiles kept)", layer_id, z, written, considered)

    elapsed = time.time() - t0
    log.info("=== Layer %s complete in %.1fs ===", layer_id, elapsed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--layer", help="Only process a single layer id (e.g. layer-03)")
    parser.add_argument("--tile-size", type=int, default=256)
    args = parser.parse_args()

    config = load_config()
    tile_size = args.tile_size
    out_root = os.path.join(ROOT, "public", "tiles")
    os.makedirs(out_root, exist_ok=True)

    layers = config["layers"]
    if args.layer:
        layers = [l for l in layers if l["id"] == args.layer]
        if not layers:
            log.error("No layer with id '%s' found in layers.config.json", args.layer)
            sys.exit(1)

    log.info("Starting tile generation for %d layer(s), tile size %dpx", len(layers), tile_size)
    for layer in layers:
        try:
            generate_layer(layer, tile_size, out_root)
        except Exception:
            log.exception("Failed generating tiles for layer %s", layer.get("id"))
    log.info("All done. Tiles written to %s", out_root)


if __name__ == "__main__":
    main()
