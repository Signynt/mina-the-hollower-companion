# Mina the Hollower — Companion Map

A local, spoiler-free interactive companion map for playing *Mina the Hollower*
on a second monitor. Fog-of-war hides everything you haven't explored, you
drop pins for chests/items/notes as you go, and everything autosaves to disk.

---

## 1. What you need

- **Node.js 18+** (for the local web server) — https://nodejs.org
- **Python 3.9+** with **Pillow** (for the one-time tile generation step) — `pip install Pillow`
- Your 9 map layer PNGs (18367×17210px each)

## 2. Setup

```bash
# from this folder
npm install
pip install Pillow --break-system-packages   # (drop the flag if not needed on your system)
```

Put your 9 map images into `map_images/`, then open `layers.config.json` and
edit each entry's `"file"` to match your actual filenames, and `"label"` to
whatever you want shown in the floor switcher:

```json
{ "id": "layer-01", "label": "Overworld", "file": "layer_01.png" }
```

> Don't rename the `"id"` values later — pins and fog progress are stored
> keyed by that id, so changing it after you've started playing will look
> like a blank layer.

## 3. Generate the map tiles (one-time, per layer)

Browsers can't load an 18000×17000px image directly — it's well over a
gigabyte decoded in memory and would freeze the tab. This script slices each
layer into small tiles the way Google Maps does, so Leaflet only loads the
small pieces currently on screen:

```bash
python3 scripts/generate_tiles.py
```

This processes all 9 layers one at a time (to keep memory use bounded —
budget ~2–4GB free RAM and a couple of minutes per layer depending on your
machine). To (re)generate just one layer:

```bash
python3 scripts/generate_tiles.py --layer layer-03
```

Progress and any problems are logged to `logs/tile_generation.log` as well
as printed to the terminal. Fully transparent tiles (off-map areas) are
skipped on purpose — the app renders "no tile" as solid black, which is
exactly the spoiler-safe look we want.

## 4. Run it

```bash
npm start
```

Then open **http://localhost:5173** — put that window on your second
monitor.

---

## Controls

| Action | Input |
|---|---|
| Pan | Left-click drag |
| Zoom | Scroll wheel (zooms toward your cursor) |
| Reveal fog | Right-click + drag |
| Re-cover fog | **Shift** + Right-click + drag |
| Peek under fog (20% opacity, blurred) | Hold **F** |
| Place a pin | Left-click empty map → pick a type → title/notes |
| Edit a pin | Left-click the pin |
| Brush size | Slider in the left sidebar |

All fog progress, pins, and notes autosave to `data/save.json` about a
second after you stop interacting (you'll see the status in the top bar).
Use **Export JSON** / **Import JSON** in the left sidebar to back up your
progress or move it to another machine.

## Adding new pin types

Edit `public/js/icons.js` — add an entry to `PIN_TYPES` and it automatically
shows up in the placement menu, the filter list, and the map/notes rendering:

```js
{ id: "puzzle", label: "Puzzle", glyph: "🧩", toggleable: true, stateLabel: "Solved" }
```

## Troubleshooting

- **Server logs**: `logs/server.log` — every HTTP request plus any save/load
  errors.
- **Client logs**: `logs/client.log` — warnings/errors that happened in the
  browser get forwarded here automatically, in addition to your browser's
  own DevTools console (open with F12), which has more detail and color-coded
  log levels.
- **Tile generation logs**: `logs/tile_generation.log`.
- **A layer shows all-black even after generating tiles**: double-check
  `layers.config.json`'s `"file"` matches the actual filename in
  `map_images/`, and that `public/tiles/<layer-id>/` actually has files in it.
- **Map looks blurry when zoomed in**: this shouldn't happen — tiles render
  with `image-rendering: pixelated`. If you do see blur, check you're not
  running an old cached version of `public/css/style.css` (hard-refresh with
  Ctrl+Shift+R).
- **Port already in use**: run with `PORT=5174 npm start`.

## Project structure

```
server.js                 Express server: static files, autosave, import/export, logging
layers.config.json        Your 9 layer definitions (edit filenames/labels here)
scripts/generate_tiles.py Slices map_images/*.png into public/tiles/ pyramids
map_images/                ← put your source PNGs here (not included)
public/
  index.html
  css/style.css
  js/
    app.js                Wires everything together, input handling
    mapSetup.js            Leaflet + CRS.Simple map/tile setup
    fogLayer.js            Fog-of-war canvas layer (reveal/re-fog/peek)
    pins.js                Marker placement, editing, filtering
    sidebar.js              Floor switcher, filters, notes directory, search
    storage.js              Autosave/load/import/export against the server
    icons.js                Pin type library (edit here to add new types)
    logger.js               Client-side logging
  tiles/                   ← generated tile pyramids land here
data/save.json             Your autosaved progress (created on first run)
logs/                       server.log, client.log, tile_generation.log
```
