// src/server.js
require("dotenv").config();
const express = require("express");
const { runDraftMonitor } = require("./runDraftMonitor");

const app = express();
app.use(express.json());

app.post("/run", async (req, res) => {
  const { leagueId, sport = "baseball" } = req.body || {};

  if (!leagueId) {
    return res.status(400).json({ error: "leagueId is required" });
  }

  const backendUrl = process.env.BACKEND_URL || "http://backend:3000";

  // fire-and-forget
  runDraftMonitor({ leagueId, sport, backendUrl })
    .then(() => {
      console.log("[worker] runDraftMonitor completed normally.");
    })
    .catch((err) => {
      if (err.message === "SESSION_EXPIRED") {
        console.error("[worker] Session expired – need to rerun setup-login on the Pi.");
      } else {
        console.error("[worker] runDraftMonitor failed:", err);
      }
    });

  res.status(202).json({ status: "started", leagueId, sport });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Heartbeat every 30 seconds
setInterval(() => {
  const url = (process.env.BACKEND_URL || "").replace(/\/+$/, "") + "/worker/heartbeat";

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ts: new Date().toISOString() }),
  })
    .then((res) => {
      console.log(`[worker] Heartbeat -> ${res.status}`);
    })
    .catch((err) => {
      console.error("[worker] Heartbeat error:", err.message);
    });
}, 30000);

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`[worker] Listening on port ${PORT}`);
});
