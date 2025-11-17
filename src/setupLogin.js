const path = require("path");
const puppeteer = require("puppeteer");
require("dotenv").config();

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  const { ESPN_LOGIN_URL } = process.env;

  // Go straight to the ESPN login page by default
  const loginUrl = ESPN_LOGIN_URL || "https://www.espn.com/login/";
  const profileDir = path.join(__dirname, "..", ".puppeteer-profile-pi"); // or .puppeteer-profile if that's what you're using

  const executablePath = "/usr/bin/chromium-browser"; // or /usr/bin/chromium

  console.log("Launching browser with persistent profile:", profileDir);
  console.log("Using Chromium at:", executablePath);

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,
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
  console.log("Opening login page:", loginUrl);
  await page.goto(loginUrl, { waitUntil: "networkidle2" });

  console.log();
  console.log("✅ SETUP MODE");
  console.log("1. In the browser window, log in normally (MyDisney/ESPN email + password).");
  console.log("2. Complete the email 2FA code.");
  console.log("3. After login, you might be redirected to ESPN or Fantasy – that's fine.");
  console.log("4. Once you're sure you're logged in, come back here and press ENTER.");
  console.log();

  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async () => {
    console.log("Closing browser and saving session to profile.");
    await browser.close();
    process.exit(0);
  });

  // keep process alive
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(60000);
  }
}

main().catch((err) => {
  console.error("Fatal error in setupLogin:", err);
  process.exit(1);
});

