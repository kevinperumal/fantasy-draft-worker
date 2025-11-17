// injected-script.js

(function startDraftObserverFromWindow() {
  const rawBackend = window.BACKEND_URL;
  const backendUrl = rawBackend ? rawBackend.replace(/\/+$/, "") : null;
  const sessionId =
    window.DRAFT_SESSION_ID || window.SESSION_ID || "unknown-session";

  if (!backendUrl) {
    console.error(
      "[DraftHelper] No window.BACKEND_URL found. Set it before injecting the script."
    );
    return;
  }

  console.log("[DraftHelper] Starting draft observer with config:", {
    backendUrl,
    sessionId,
  });

  const targetNode = document.querySelector(".pa3");
  if (!targetNode) {
    console.error(
      "[DraftHelper] Could not find draft log container (.pa3). " +
        "Are you sure you're in the draft room UI?"
    );
    return;
  }

  const configOpts = { attributes: true, childList: true, subtree: true };

  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type !== "childList" || !mutation.addedNodes.length) continue;

      const node = mutation.addedNodes[0];
      try {
        const container = node.childNodes[0]?.childNodes[1];
        if (!container) continue;

        let name = container.childNodes[0]?.innerText || "";
        let team = container.childNodes[2]?.innerText || "";
        let position = container.childNodes[4]?.innerText || "";

        name = name.split(" ").slice(0, 2).join(" ");
        team = team.toUpperCase();

        fetch(backendUrl + "/picks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            player: name,
            team,
            position,
          }),
        })
          .then((res) => {
            console.log("[DraftHelper] Sent pick:", name, res.status);
          })
          .catch((err) => {
            console.error("[DraftHelper] Error posting player", name, err);
          });
      } catch (err) {
        console.error("[DraftHelper] Error parsing mutation", err);
      }
    }
  });

  observer.observe(targetNode, configOpts);
  console.log(
    "[DraftHelper] Draft observer started for session",
    sessionId,
    "watching .pa3"
  );
})();
