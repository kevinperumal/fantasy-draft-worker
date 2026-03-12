require("dotenv").config();
const path = require("path");
const { SLOTS } = require("./slots");
const { startDisplay, stopDisplay } = require("./display");
const {
  claimJobForUser,
  getUserIdByUsername,
  getDraft,
  updateJobPhase,
  completeJob,
  failJob,
} = require("./db");
const { runDraftMonitor } = require("./runDraftMonitor");

const POLL_INTERVAL_MS = 2000;
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/+$/, "");

// Resolve slot userIds from usernames at startup.
// If a slot's username is not configured the slot stays inactive.
async function resolveSlots() {
  for (const slot of SLOTS) {
    if (!slot.username) {
      console.warn(`[agent] Slot ${slot.id} has no SLOT${slot.id}_USERNAME configured — inactive.`);
      continue;
    }
    const userId = await getUserIdByUsername(slot.username);
    if (userId) {
      slot.userId = userId;
      console.log(`[agent] Slot ${slot.id}: username="${slot.username}" → userId=${userId}`);
    } else {
      console.warn(`[agent] Slot ${slot.id}: no user found for username "${slot.username}" — inactive.`);
    }
  }
}

// Run a single job on the given slot (Xvfb + Puppeteer + phase reporting).
// Slot is marked inUse before this is called; released in the finally block.
async function runJob(job, slot) {
  let draft;
  try {
    draft = await getDraft(job.draftId);
  } catch (err) {
    console.error(`[agent] DB error fetching draft for job ${job.id}:`, err.message);
    await failJob(job.id, "DB error: " + err.message).catch(() => {});
    return;
  }

  if (!draft) {
    console.error(`[agent] Draft ${job.draftId} not found for job ${job.id}`);
    await failJob(job.id, "Draft record not found").catch(() => {});
    return;
  }

  console.log(
    `[agent] Slot ${slot.id} | job=${job.id} | draft=${draft.leagueId} sport=${draft.sport} display=${slot.display}`
  );

  let xvfb;
  try {
    xvfb = await startDisplay(slot.display);
    console.log(`[agent] Xvfb started on ${slot.display}`);
  } catch (err) {
    console.error(`[agent] Failed to start Xvfb on ${slot.display}:`, err.message);
    await failJob(job.id, "Failed to start virtual display: " + err.message).catch(() => {});
    return;
  }

  try {
    await runDraftMonitor({
      sport: draft.sport,
      leagueId: draft.leagueId,
      backendUrl: BACKEND_URL,
      display: slot.display,
      profileDir: path.join(__dirname, "..", slot.profileDir),
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
      console.error(
        `[agent] Session expired on slot ${slot.id}. Run: npm run setup-login:slot${slot.id}`
      );
    } else {
      console.error(`[agent] Job ${job.id} failed:`, err);
    }
  } finally {
    stopDisplay(xvfb);
    console.log(`[agent] Xvfb stopped on ${slot.display}`);
    slot.inUse = false;
  }
}

async function poll() {
  for (const slot of SLOTS) {
    if (slot.inUse || !slot.userId) continue;

    let job;
    try {
      job = await claimJobForUser(slot.userId);
    } catch (err) {
      console.error(`[agent] DB error claiming job for slot ${slot.id}:`, err.message);
      continue;
    }

    if (!job) continue;

    // Mark in-use synchronously before yielding to the event loop
    slot.inUse = true;
    runJob(job, slot); // intentionally not awaited — runs concurrently
  }
}

async function main() {
  console.log("[agent] Starting worker agent...");
  await resolveSlots();

  const activeSlots = SLOTS.filter((s) => s.userId);
  if (activeSlots.length === 0) {
    console.error("[agent] No active slots configured. Set SLOT0_USERNAME and/or SLOT1_USERNAME.");
    process.exit(1);
  }

  console.log(`[agent] ${activeSlots.length} active slot(s). Polling every ${POLL_INTERVAL_MS}ms.`);

  poll();
  const interval = setInterval(poll, POLL_INTERVAL_MS);

  process.on("SIGTERM", () => {
    console.log("[agent] SIGTERM received. Stopping.");
    clearInterval(interval);
  });
  process.on("SIGINT", () => {
    console.log("[agent] SIGINT received. Stopping.");
    clearInterval(interval);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[agent] Fatal startup error:", err);
  process.exit(1);
});
