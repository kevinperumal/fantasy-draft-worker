// src/draftRoomHelpers.js

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function findClickableByText(page, text) {
  const handle = await page.evaluateHandle((targetText) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

    const candidates = Array.from(
      document.querySelectorAll('button, a, div[role="button"]')
    );

    return (
      candidates.find((el) =>
        norm(el.innerText || el.textContent || "").includes(targetText)
      ) || null
    );
  }, text);

  const el = handle.asElement();
  if (!el) {
    await handle.dispose();
    return null;
  }
  return el;
}

async function findElementByXPath(page, xpath) {
  const handle = await page.evaluateHandle((xp) => {
    const result = document.evaluate(
      xp,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  }, xpath);

  const el = handle.asElement();
  if (!el) {
    await handle.dispose();
    return null;
  }
  return el;
}

// Click "Join This League" if present, then clear the success modal
async function ensureJoinedLeague(page) {
  console.log("Checking if we need to join this league...");

  const joinBtn = await findElementByXPath(
    page,
    "//button[contains(., 'Join This League')]"
  );

  if (!joinBtn) {
    console.log("No 'Join This League' button found. Assuming already joined.");
    return;
  }

  console.log("Found 'Join This League' button. Clicking...");
  await joinBtn.click();
  await sleep(3000); // wait for modal to fully render

  try {
    console.log("Waiting for success modal...");

    // Try several possible modal dismiss/confirm buttons
    const dismissXPath =
      "//button[contains(., 'Return to Draft Waiting Room')] | " +
      "//button[contains(., 'Back to Waiting Room')] | " +
      "//button[contains(., 'Confirm')] | " +
      "//button[contains(., 'OK')] | " +
      "//button[contains(., 'Join')]";

    const dismissBtn = await findElementByXPath(page, dismissXPath);

    if (dismissBtn) {
      const label = await page.evaluate((el) => el.innerText || el.textContent, dismissBtn);
      console.log(`Clicking modal button: "${label?.trim()}"...`);
      await dismissBtn.click();
      await sleep(2000);
    } else {
      console.log("No modal button found; reloading to confirm join...");
    }
  } catch (e) {
    console.warn("Error handling success modal:", e);
  }

  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1000);
}

// Wait until "Enter The Draft" is available, then click it.
// Also re-attempts "Join This League" on each poll in case the first attempt
// failed to fully complete (e.g. modal dismissal didn't work).
async function enterDraftWhenOpen(page) {
  console.log("Waiting for 'Enter The Draft' to become available...");

  while (true) {
    const enterBtn = await findClickableByText(page, "Enter The Draft");

    if (enterBtn) {
      console.log("'Enter The Draft' button found. Clicking...");
      await enterBtn.click();

      try {
        await page.waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 30000,
        });
      } catch (e) {
        console.warn(
          "Navigation after clicking 'Enter The Draft' may have timed out:",
          e
        );
      }
      console.log("Should now be in the live draft room.");
      return;
    }

    // Re-attempt join in case the earlier attempt didn't fully complete
    await ensureJoinedLeague(page);

    console.log("'Enter The Draft' not yet visible, refreshing waiting room in 10s...");
    await sleep(10000);
    await page.reload({ waitUntil: "networkidle2" });
  }
}

// Try to toggle Autopick on once inside the draft room
async function enableAutopick(page) {
  console.log("Attempting to enable Autopick...");

  try {
    const toggle = await findElementByXPath(
      page,
      "//*[contains(text(), 'Autopick')]/following::button[1] | " +
        "//*[contains(text(), 'Autopick')]/following::*[self::input or self::div][1]"
    );

    if (toggle) {
      console.log("Found an Autopick control; clicking it...");
      await toggle.click();
      console.log("Autopick click attempted. Verify in UI that it is ON.");
    } else {
      console.warn(
        "Could not find Autopick toggle. You may need to tweak the XPath in enableAutopick()."
      );
    }
  } catch (e) {
    console.error("Error trying to enable Autopick:", e);
  }
}

module.exports = {
  ensureJoinedLeague,
  enterDraftWhenOpen,
  enableAutopick,
};
