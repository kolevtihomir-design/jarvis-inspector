// background.js — service worker v1.2 (freemium)
// Screenshot capture + Jarvis API + history storage + keyboard shortcut + license

const JARVIS_URL = "https://smartpause-inspector-api.vercel.app"; // Production server
const HISTORY_KEY = "jv_history";
const LICENSE_KEY  = "jv_license_key";
const MAX_HISTORY = 30;

// ── Keyboard shortcut → toggle in active tab ──────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-inspector") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE" }).catch(() => {});
      }
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Screenshot capture ──────────────────────────────────────────────────
  if (msg.type === "CAPTURE_SCREEN") {
    chrome.tabs.captureVisibleTab(
      sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT,
      { format: "jpeg", quality: 80 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ dataUrl });
        }
      }
    );
    return true;
  }

  // ── Analyze via Jarvis backend ──────────────────────────────────────────
  if (msg.type === "ANALYZE") {
    // Read license key from storage, attach to payload
    chrome.storage.local.get(LICENSE_KEY, (stored) => {
      const licenseKey = stored[LICENSE_KEY] || "";
      const payload = { ...msg.payload, licenseKey };

      fetch(`${JARVIS_URL}/api/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(async r => {
          const data = await r.json();
          if (r.status === 429) {
            sendResponse({ error: "limit_reached", limitData: data });
            return;
          }
          if (!r.ok) throw new Error(`Jarvis сървърът върна HTTP ${r.status} — стартиран ли е?`);
          // Save to history
          saveToHistory({
            url:        msg.payload.url,
            title:      msg.payload.title,
            domain:     msg.payload.domain,
            verdict:    data.verdict,
            confidence: data.confidence,
            ts:         Date.now(),
          });
          sendResponse({ ok: true, data });
        })
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  // ── Load history ────────────────────────────────────────────────────────
  if (msg.type === "GET_HISTORY") {
    chrome.storage.local.get(HISTORY_KEY, (result) => {
      sendResponse({ history: result[HISTORY_KEY] || [] });
    });
    return true;
  }

  // ── Clear history ───────────────────────────────────────────────────────
  if (msg.type === "CLEAR_HISTORY") {
    chrome.storage.local.set({ [HISTORY_KEY]: [] }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Save license key ────────────────────────────────────────────────────
  if (msg.type === "SAVE_LICENSE") {
    chrome.storage.local.set({ [LICENSE_KEY]: msg.key }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Get license key ─────────────────────────────────────────────────────
  if (msg.type === "GET_LICENSE") {
    chrome.storage.local.get(LICENSE_KEY, (r) => {
      sendResponse({ key: r[LICENSE_KEY] || "" });
    });
    return true;
  }
});

async function saveToHistory(entry) {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  const history = result[HISTORY_KEY] || [];
  history.unshift(entry); // newest first
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}
