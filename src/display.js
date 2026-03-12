const { spawn } = require("child_process");

// Start a virtual framebuffer on the given display number (e.g. ":99").
// Resolves with the child process once Xvfb has had time to initialize.
// Rejects if Xvfb errors or exits before the startup window closes.
function startDisplay(displayNum) {
  return new Promise((resolve, reject) => {
    const xvfb = spawn(
      "Xvfb",
      [displayNum, "-screen", "0", "1280x720x24"],
      { detached: false, stdio: ["ignore", "ignore", "pipe"] }
    );

    let settled = false;

    function settle(fn) {
      if (!settled) { settled = true; fn(); }
    }

    xvfb.on("error", (err) => {
      settle(() => reject(new Error(`Xvfb spawn error on ${displayNum}: ${err.message}`)));
    });

    xvfb.on("exit", (code) => {
      settle(() =>
        reject(new Error(`Xvfb exited early on ${displayNum} with code ${code}`))
      );
    });

    // Give Xvfb time to create the socket before Chromium tries to connect
    setTimeout(() => {
      settle(() => resolve(xvfb));
    }, 500);
  });
}

function stopDisplay(xvfbProcess) {
  if (!xvfbProcess) return;
  try {
    xvfbProcess.kill("SIGTERM");
  } catch {
    // Already dead — nothing to do
  }
}

module.exports = { startDisplay, stopDisplay };
