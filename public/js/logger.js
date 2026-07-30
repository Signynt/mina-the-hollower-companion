// logger.js
// Small structured logger for the client. Mirrors to the browser console
// (tagged and colored for quick scanning) and forwards WARN/ERROR entries
// to the server so they land in logs/client.log for troubleshooting after
// the fact, even if nobody had devtools open at the time.

const STYLES = {
  DEBUG: "color:#8b8d98",
  INFO: "color:#dfa458",
  WARN: "color:#e0b04a;font-weight:bold",
  ERROR: "color:#e05a4a;font-weight:bold",
};

function forward(level, message, context) {
  if (level !== "WARN" && level !== "ERROR") return;
  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level, message, context: context ?? null }),
  }).catch(() => {
    // If the server itself is unreachable there's nowhere useful to log
    // this failure -- avoid an infinite loop of failed log calls.
  });
}

function make(level) {
  return (message, context) => {
    const tag = `%c[Mina Map:${level}]`;
    if (context !== undefined) {
      console.log(tag, STYLES[level], message, context);
    } else {
      console.log(tag, STYLES[level], message);
    }
    forward(level, message, context);
  };
}

export const logger = {
  debug: (message, context) => console.log("%c[Mina Map:DEBUG]", STYLES.DEBUG, message, context ?? ""),
  info: make("INFO"),
  warn: make("WARN"),
  error: make("ERROR"),
};

window.addEventListener("error", (e) => {
  logger.error("Uncaught exception", { message: e.message, filename: e.filename, lineno: e.lineno });
});
window.addEventListener("unhandledrejection", (e) => {
  logger.error("Unhandled promise rejection", { reason: String(e.reason) });
});
