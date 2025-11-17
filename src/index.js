// src/index.js
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const puppeteer = require("puppeteer");

const {
  ensureJoinedLeague,
  enterDraftWhenOpen,
  enableAutopick,
} = require("./draftRoomHelpers");

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  const { ESPN_SPORT, ESPN_LEAGUE_ID, BACKEND_URL, LOGIN_SLOWMO_MS } =
    process.env;

  const sport = ESPN_SPORT || "baseball";
  const leagueId = ESPN_LEAGUE_ID;
  if (!leagueId) {
    throw new Error("ESPN_LEAGUE_ID must be set in .env for this CLI script");
  }

  const waitingRoomUrl = `https://fantasy.espn.com/${sport}/waitingroom?leagueId=${leagueId}`;

  // IMPORTANT: profile dir must match what you used in setup-login
  const profileDir = path.join(__dirname, "..", ".puppeteer-profile-pi");
  const executablePath =
    process.env.CHROME_PATH || "/usr/bin/chromium-browser"; // or /usr/bin/chromium

  console.log("Launching browser with persistent profile:", profileDir);
  console.log("Using Chromium at:", executablePath);

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: Number(LOGIN_SLOWMO_MS || 50),
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

  const page = await browser.newPage();

  console.log("Navigating to waiting room:", waitingRoomUrl);
  await page.goto(waitingRoomUrl, { waitUntil: "networkidle2" });
  await sleep(2000);

  // If Disney login shows up again, user needs to re-run setup
  const loginText = await page.evaluate(() => {
    return document.body.innerText.slice(0, 500) || "";
  });

  if (loginText.includes("Enter your email to continue")) {
    console.error(
      "It looks like your ESPN/MyDisney session expired and login is required again."
    );
    console.error(
      "Run:  npm run setup-login   to refresh your session, then rerun this worker."
    );
    await browser.close();
    process.exit(1);
  }

  await ensureJoinedLeague(page);
  await enterDraftWhenOpen(page);

  await sleep(5000); // let draft UI render fully

  await enableAutopick(page);

  // Expose backend URL into the page for injected script
  const backendUrl = BACKEND_URL || "http://localhost:3000";
  console.log("Setting window.BACKEND_URL to:", backendUrl);
  await page.evaluate((url) => {
    window.BACKEND_URL = url;
  }, backendUrl);

  try {
    const scriptPath = path.join(__dirname, "..", "injected-script.js");
    console.log("Reading injected script from:", scriptPath);
    const scriptContent = fs.readFileSync(scriptPath, "utf8");

    console.log("Injecting script into draft page...");
    await page.evaluate(scriptContent);

    console.log(
      "Script injection complete. Your draft watcher should now be running inside the draft room."
    );
  } catch (err) {
    console.error("Error injecting script:", err);
  }

  console.log("Worker is now idle and keeping the browser open.");
  console.log("Leave this running during your draft. Press Ctrl+C here to stop.");

  while (true) {
    await sleep(60000);
  }
}

main().catch((err) => {
  console.error("Fatal error in worker:", err);
  process.exit(1);
});
