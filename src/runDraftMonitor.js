const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const {
  ensureJoinedLeague,
  enterDraftWhenOpen,
  enableAutopick,
} = require("./draftRoomHelpers.js");

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Resolves when the browser disconnects or the page closes —
// whichever comes first. Used to keep the function alive for the
// duration of the draft without busy-polling.
function waitForBrowserClose(browser, page) {
  return new Promise((resolve) => {
    browser.once("disconnected", resolve);
    page.once("close", resolve);
  });
}

// Poll the page every 15s looking for signals that the draft has ended.
// Resolves (without throwing) when draft end is detected.
function waitForDraftEnd(page) {
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      try {
        const ended = await page.evaluate(() => {
          const text = document.body.innerText || '';
          return (
            text.includes('Draft Complete') ||
            text.includes('Your draft is complete') ||
            text.includes('Draft is over') ||
            text.includes('Draft Results') ||
            document.querySelector('.draft-complete') !== null ||
            document.querySelector('[class*="draftComplete"]') !== null
          );
        });
        if (ended) {
          console.log('[worker] Draft end detected in page content.');
          clearInterval(interval);
          resolve();
        }
      } catch {
        // Page may be navigating — ignore and retry next tick
      }
    }, 15000);
  });
}

// onPhase is a fire-and-forget callback — errors are logged but never
// allowed to interrupt the automation itself.
function reportPhase(onPhase, phase) {
  onPhase(phase).catch((err) => {
    console.warn(`[worker] Phase update to '${phase}' failed:`, err.message);
  });
}

async function runDraftMonitor({
  sport,
  leagueId,
  backendUrl,
  onPhase = async () => {},
  // Slot-provided values; fall back to legacy single-display defaults
  display = process.env.DISPLAY || ":0",
  profileDir = path.join(__dirname, "..", ".puppeteer-profile-pi"),
}) {
  const executablePath = process.env.CHROME_PATH || "/usr/bin/chromium-browser";
  const slowMo = Number(process.env.LOGIN_SLOWMO_MS || 50);
  const waitingRoomUrl = `https://fantasy.espn.com/${sport}/waitingroom?leagueId=${leagueId}`;

  console.log(`[worker] Starting monitor for league=${leagueId}, sport=${sport}`);
  console.log("[worker] Using backend URL:", backendUrl);

  reportPhase(onPhase, "starting");

  const browser = await puppeteer.launch({
    headless: false,
    slowMo,
    userDataDir: profileDir,
    defaultViewport: null,
    executablePath,
    env: { ...process.env, DISPLAY: display },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-infobars",
      "--window-size=1280,720",
    ],
  });

  try {
    const page = await browser.newPage();

    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[DraftHelper]")) console.log("[browser]", text);
    });
    page.on("pageerror", (err) => console.error("[browser error]", err));

    reportPhase(onPhase, "logging_in");

    console.log("[worker] Navigating to waiting room:", waitingRoomUrl);
    await page.goto(waitingRoomUrl, { waitUntil: "networkidle2" });
    await sleep(2000);

    const currentUrl = page.url();
    const loginText = await page.evaluate(
      () => document.body.innerText.slice(0, 500) || ""
    );
    const loggedOut =
      currentUrl.includes("/login") ||
      currentUrl.includes("signin") ||
      loginText.includes("Enter your email to continue");
    if (loggedOut) {
      throw new Error("SESSION_EXPIRED");
    }

    reportPhase(onPhase, "waiting_room");

    await ensureJoinedLeague(page);
    await enterDraftWhenOpen(page);

    reportPhase(onPhase, "draft_live");

    await sleep(10000); // wait for draft room UI to fully render
    await enableAutopick(page);

    console.log("[worker] Setting window.BACKEND_URL to:", backendUrl);
    await page.evaluate((url, league) => {
      window.BACKEND_URL = url;
      window.DRAFT_LEAGUE_ID = league;
    }, backendUrl, leagueId);

    const scriptPath = path.join(__dirname, "..", "injected-script.js");
    const scriptContent = fs.readFileSync(scriptPath, "utf8");
    console.log("[worker] Injecting draft watcher script...");
    await page.evaluate(scriptContent);

    console.log("[worker] Draft watcher running. Waiting for draft to end...");
    await Promise.race([
      waitForBrowserClose(browser, page),
      waitForDraftEnd(page),
    ]);
    console.log("[worker] Draft session ended.");
  } catch (err) {
    console.error("[worker] Fatal error in runDraftMonitor:", err);
    try { await browser.close(); } catch {}
    throw err;
  }

  try { await browser.close(); } catch {}
}

module.exports = { runDraftMonitor };
