require("dotenv").config();
const { Pool } = require("pg");

const ssl =
  process.env.DATABASE_SSL !== "false" ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

// Atomically claim the oldest queued job.
// FOR UPDATE SKIP LOCKED ensures two parallel workers never claim the same row.
async function claimJob() {
  const result = await pool.query(`
    UPDATE jobs
    SET status = 'running',
        "claimedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  return result.rows[0] || null;
}

async function getDraft(draftId) {
  const result = await pool.query(`SELECT * FROM drafts WHERE id = $1`, [draftId]);
  return result.rows[0] || null;
}

async function updateJobPhase(jobId, phase) {
  await pool.query(
    `UPDATE jobs SET phase = $1, "updatedAt" = NOW() WHERE id = $2`,
    [phase, jobId]
  );
}

async function completeJob(jobId, draftId) {
  await pool.query(
    `UPDATE jobs
     SET status = 'succeeded',
         phase = 'completed',
         "completedAt" = NOW(),
         "updatedAt" = NOW()
     WHERE id = $1`,
    [jobId]
  );
  // Mark the draft completed so the user can start a new one
  await pool.query(
    `UPDATE drafts SET status = 'completed', "updatedAt" = NOW() WHERE id = $1`,
    [draftId]
  );
}

async function failJob(jobId, errorMessage) {
  await pool.query(
    `UPDATE jobs
     SET status = 'failed',
         phase = 'error',
         "errorMessage" = $1,
         "updatedAt" = NOW()
     WHERE id = $2`,
    [errorMessage, jobId]
  );
}

module.exports = { claimJob, getDraft, updateJobPhase, completeJob, failJob };
