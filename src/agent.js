require("dotenv").config();
const { claimJob, getDraft, updateJobPhase, completeJob, failJob } = require("./db");
const { runDraftMonitor } = require("./runDraftMonitor");

const POLL_INTERVAL_MS = 2000;
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/+$/, "");

let isRunning = false;

async function poll() {
  if (isRunning) return;

  let job;
  try {
    job = await claimJob();
  } catch (err) {
    console.error("[agent] DB error during job claim:", err.message);
    return;
  }

  if (!job) return; // Queue is empty

  let draft;
  try {
    draft = await getDraft(job.draftId);
  } catch (err) {
    console.error("[agent] DB error fetching draft:", err.message);
    await failJob(job.id, "DB error: " + err.message).catch(() => {});
    return;
  }

  if (!draft) {
    console.error(`[agent] Draft ${job.draftId} not found for job ${job.id}`);
    await failJob(job.id, "Draft record not found").catch(() => {});
    return;
  }

  isRunning = true;
  console.log(`[agent] Claimed job ${job.id} | draft=${draft.leagueId} sport=${draft.sport}`);

  try {
    await runDraftMonitor({
      sport: draft.sport,
      leagueId: draft.leagueId,
      backendUrl: BACKEND_URL,
      onPhase: (phase) => updateJobPhase(job.id, phase),
    });

    await completeJob(job.id, draft.id);
    console.log(`[agent] Job ${job.id} completed successfully.`);
  } catch (err) {
    const message = err?.message || "Unknown error";

    await failJob(job.id, message).catch((dbErr) => {
      console.error("[agent] Failed to write failure to DB:", dbErr.message);
    });

    if (message === "SESSION_EXPIRED") {
      console.error("[agent] ESPN session expired. Run: npm run setup-login");
    } else {
      console.error(`[agent] Job ${job.id} failed:`, err);
    }
  } finally {
    isRunning = false;
  }
}

// Run once immediately, then on the interval
poll();
const interval = setInterval(poll, POLL_INTERVAL_MS);

console.log(`[agent] Worker agent started. Polling every ${POLL_INTERVAL_MS}ms.`);

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[agent] SIGTERM received. Stopping poll interval.");
  clearInterval(interval);
});
process.on("SIGINT", () => {
  console.log("[agent] SIGINT received. Stopping poll interval.");
  clearInterval(interval);
  process.exit(0);
});
