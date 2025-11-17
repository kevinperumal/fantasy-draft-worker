// src/runDraftMonitor.js
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

// If you defined these helpers in another file, import them instead of redefining them
const {
  ensureJoinedLeague,
  enterDraftWhenOpen,
  enableAutopick,
} = require("./draftRoomHelpers.js"); // <-- adjust or remove if you keep them inline

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function runDraftMonitor({ sport, leagueId, backendUrl }) {
  // 👇 MUST match whatever you used in setup-login.js
  const profileDir = path.join(__dirname, "..", ".puppeteer-profile-pi");
  // 👇 Or /usr/bin/chromium if that's what `which chromium` returned
  const executablePath =
    process.env.CHROME_PATH || "/usr/bin/chromium-browser";

  const slowMo = Number(process.env.LOGIN_SLOWMO_MS || 50);
  const waitingRoomUrl = `https://fantasy.espn.com/${sport}/waitingroom?leagueId=${leagueId}`;

  console.log(
    `[worker] Starting monitor for league=${leagueId}, sport=${sport}`
  );
  console.log("[worker] Using backend URL:", backendUrl);
  console.log("[worker] Using profile:", profileDir);
  console.log("[worker] Using Chromium at:", executablePath);

  const browser = await puppeteer.launch({
    headless: false,
    slowMo,
    userDataDir: profileDir,
    defaultViewport: null,
    executablePath,
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
      if (text.includes("[DraftHelper]")) {
        console.log("[browser]", text);
      }
    });

    page.on("pageerror", (err) => {
      console.error("[browser error]", err);
    });

    console.log("[worker] Navigating to waiting room:", waitingRoomUrl);
    await page.goto(waitingRoomUrl, { waitUntil: "networkidle2" });
    await sleep(2000);

    // If session expired, bail out with a clear error
    const loginText = await page.evaluate(
      () => document.body.innerText.slice(0, 500) || ""
    );
    if (loginText.includes("Enter your email to continue")) {
      throw new Error("SESSION_EXPIRED");
    }

    // 1) Join league if needed
    await ensureJoinedLeague(page);

    // 2) Wait for 'Enter The Draft'
    await enterDraftWhenOpen(page);

    // 3) Inside draft room
    await sleep(5000);
    await enableAutopick(page);

    // 4) Expose backend URL into the page for the injected script
    console.log("[worker] Setting window.BACKEND_URL to:", backendUrl);
    await page.evaluate((url) => {
      window.BACKEND_URL = url;
      console.log("[browser] window.BACKEND_URL is now:", window.BACKEND_URL);
    }, backendUrl);

    // 5) Inject your watcher script
    const scriptPath = path.join(__dirname, "..", "injected-script.js");
    const scriptContent = fs.readFileSync(scriptPath, "utf8");
    console.log("[worker] Injecting draft watcher script...");
    await page.evaluate(scriptContent);

    console.log("[worker] Draft watcher is running. Keeping browser open...");
    // Do NOT close browser; leave it up for the draft
  } catch (err) {
    console.error("[worker] Fatal error in runDraftMonitor:", err);
    await browser.close();
    throw err;
  }
}

module.exports = { runDraftMonitor };
