// server.js
// Local Express server for the Mina the Hollower companion map.
// Responsible for: serving static assets + generated tiles, persisting
// autosave data to disk as JSON, import/export, and centralized logging
// (both server-side HTTP logs and forwarded client-side logs) so everything
// ends up in logs/ for troubleshooting.

const express = require("express");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 5173;
const DATA_DIR = path.join(ROOT, "data");
const SAVE_FILE = path.join(DATA_DIR, "save.json");
const LOG_DIR = path.join(ROOT, "logs");
const SERVER_LOG = path.join(LOG_DIR, "server.log");
const CLIENT_LOG = path.join(LOG_DIR, "client.log");

for (const dir of [DATA_DIR, LOG_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---- simple file logger (appends, also mirrors to console) -------------
function logLine(file, level, message) {
  const line = `${new Date().toISOString()} [${level}] ${message}\n`;
  fs.appendFile(file, line, (err) => {
    if (err) console.error("Failed to write log file:", err);
  });
  const consoleFn = level === "ERROR" ? console.error : console.log;
  consoleFn(line.trim());
}
const serverLog = {
  info: (msg) => logLine(SERVER_LOG, "INFO", msg),
  warn: (msg) => logLine(SERVER_LOG, "WARN", msg),
  error: (msg) => logLine(SERVER_LOG, "ERROR", msg),
};

const app = express();
app.use(express.json({ limit: "50mb" })); // fog grids can be a few MB base64

// HTTP access log -> logs/server.log (and console)
const morganStream = {
  write: (line) => logLine(SERVER_LOG, "HTTP", line.trim()),
};
app.use(morgan("combined", { stream: morganStream }));

// ---- static assets --------------------------------------------------------
app.use(express.static(path.join(ROOT, "public")));

// ---- API: layer config ----------------------------------------------------
app.get("/api/layers", (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "layers.config.json"), "utf-8"));
    res.json(cfg);
  } catch (err) {
    serverLog.error(`GET /api/layers failed: ${err.message}`);
    res.status(500).json({ error: "Could not read layers.config.json" });
  }
});

// ---- API: autosave / load --------------------------------------------------
function emptySave() {
  return { version: 1, updatedAt: null, layers: {} };
}

app.post("/api/reset", (req, res) => {
  try {
    if (fs.existsSync(SAVE_FILE)) fs.unlinkSync(SAVE_FILE);
    serverLog.info("Save data reset successfully");
    res.json({ ok: true });
  } catch (err) {
    serverLog.error(`POST /api/reset failed: ${err.message}`);
    res.status(500).json({ error: "Could not reset save file" });
  }
});

app.get("/api/save", (req, res) => {
  try {
    if (!fs.existsSync(SAVE_FILE)) {
      return res.json(emptySave());
    }
    const raw = fs.readFileSync(SAVE_FILE, "utf-8");
    res.json(JSON.parse(raw));
  } catch (err) {
    serverLog.error(`GET /api/save failed: ${err.message}`);
    res.status(500).json({ error: "Could not read save file" });
  }
});

app.post("/api/save", (req, res) => {
  try {
    const payload = req.body || {};
    payload.updatedAt = new Date().toISOString();
    // write atomically: temp file then rename, so a crash mid-write can't corrupt the save
    const tmp = SAVE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, SAVE_FILE);
    res.json({ ok: true, updatedAt: payload.updatedAt });
  } catch (err) {
    serverLog.error(`POST /api/save failed: ${err.message}`);
    res.status(500).json({ error: "Could not write save file" });
  }
});

// ---- API: export (download current save as a file) ------------------------
app.get("/api/export", (req, res) => {
  try {
    if (!fs.existsSync(SAVE_FILE)) {
      return res.status(404).json({ error: "No save data yet" });
    }
    res.setHeader("Content-Disposition", 'attachment; filename="mina-map-save.json"');
    res.sendFile(SAVE_FILE);
  } catch (err) {
    serverLog.error(`GET /api/export failed: ${err.message}`);
    res.status(500).json({ error: "Could not export save file" });
  }
});

// ---- API: import (overwrite save with an uploaded JSON file) --------------
app.post("/api/import", (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== "object" || !payload.layers) {
      return res.status(400).json({ error: "Invalid save file format" });
    }
    payload.updatedAt = new Date().toISOString();
    fs.writeFileSync(SAVE_FILE, JSON.stringify(payload));
    serverLog.info("Save data imported successfully");
    res.json({ ok: true });
  } catch (err) {
    serverLog.error(`POST /api/import failed: ${err.message}`);
    res.status(500).json({ error: "Could not import save file" });
  }
});

// ---- API: client-side log forwarding --------------------------------------
// The frontend posts warnings/errors here so troubleshooting logs live in
// one place (logs/client.log) even though the app runs in the browser.
app.post("/api/log", (req, res) => {
  try {
    const { level = "INFO", message = "", context = null } = req.body || {};
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    logLine(CLIENT_LOG, String(level).toUpperCase(), `${message}${contextStr}`);
    res.json({ ok: true });
  } catch (err) {
    serverLog.error(`POST /api/log failed: ${err.message}`);
    res.status(500).json({ error: "Could not write client log" });
  }
});

// ---- fallback: single page app ---------------------------------------------
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/tiles/")) return next();
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

// ---- error handling ---------------------------------------------------------
app.use((err, req, res, next) => {
  serverLog.error(`Unhandled error on ${req.method} ${req.path}: ${err.stack || err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

process.on("uncaughtException", (err) => {
  serverLog.error(`Uncaught exception: ${err.stack || err.message}`);
});
process.on("unhandledRejection", (reason) => {
  serverLog.error(`Unhandled rejection: ${reason}`);
});

app.listen(PORT, () => {
  serverLog.info(`Mina the Hollower companion map server listening on http://localhost:${PORT}`);
  console.log(`\n  Mina the Hollower — Companion Map`);
  console.log(`  → http://localhost:${PORT}\n`);
});
