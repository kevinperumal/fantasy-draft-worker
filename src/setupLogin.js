require("dotenv").config();
const path = require("path");
const puppeteer = require("puppeteer");
const { SLOTS } = require("./slots");

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  // Accept --slot 0 or --slot 1 (defaults to slot 0 if not specified)
  const args = process.argv.slice(2);
  const slotArg = args.indexOf("--slot");
  const slotId = slotArg !== -1 ? parseInt(args[slotArg + 1], 10) : 0;

  const slot = SLOTS[slotId];
  if (!slot) {
    console.error(`Unknown slot: ${slotId}. Valid values are 0 and 1.`);
    process.exit(1);
  }

  const loginUrl = process.env.ESPN_LOGIN_URL || "https://www.espn.com/login/";
  const executablePath = process.env.CHROME_PATH || "/usr/bin/chromium-browser";
  const profileDir = path.join(__dirname, "..", slot.profileDir);

  console.log(`Setting up ESPN session for slot ${slot.id}`);
  console.log(`  Display:    ${slot.display}`);
  console.log(`  Profile:    ${profileDir}`);
  console.log(`  Chromium:   ${executablePath}`);
  console.log();

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
    userDataDir: profileDir,
    defaultViewport: null,
    executablePath,
    env: { ...process.env, DISPLAY: slot.display },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-infobars",
      "--window-size=1280,720",
    ],
  });

  const page = await browser.newPage();
  console.log("Opening login page:", loginUrl);
  await page.goto(loginUrl, { waitUntil: "networkidle2" });

  console.log();
  console.log("=== SETUP MODE ===");
  console.log("1. In the browser window, log in with the ESPN account for this slot.");
  console.log("2. Complete any email / 2FA verification.");
  console.log("3. Once logged in, come back here and press ENTER.");
  console.log();

  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async () => {
    console.log(`Saving session to profile: ${profileDir}`);
    await browser.close();
    process.exit(0);
  });

  // Keep process alive while the user logs in
  while (true) { // eslint-disable-line no-constant-condition
    await sleep(60000);
  }
}

main().catch((err) => {
  console.error("Fatal error in setupLogin:", err);
  process.exit(1);
});
