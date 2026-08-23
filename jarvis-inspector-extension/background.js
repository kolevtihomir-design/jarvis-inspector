// background.js — service worker v1.2 (freemium)
// Screenshot capture + Jarvis API + history storage + keyboard shortcut + license

const JARVIS_URL = "https://smartpause-inspector-api.vercel.app";
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

  // ── Badge ───────────────────────────────────────────────────────────────
  if (msg.type === "SET_BADGE") {
    const map = { real: { text: "R", color: "#22c55e" }, fake: { text: "F", color: "#ef4444" }, suspicious: { text: "S", color: "#f59e0b" }, unknown: { text: "?", color: "#64748b" } };
    const b = map[msg.verdict] || map.unknown;
    chrome.action.setBadgeText({ text: b.text });
    chrome.action.setBadgeBackgroundColor({ color: b.color });
    sendResponse({ ok: true });
    return;
  }

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
    chrome.storage.local.get(LICENSE_KEY, (stored) => {
      const licenseKey = stored[LICENSE_KEY] || "";
      const lang = (navigator.language || "en").split("-")[0].toLowerCase();
      const payload = { ...msg.payload, licenseKey, lang };

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
          if (!r.ok) throw new Error(`Jarvis server HTTP ${r.status}`);
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

  if (msg.type === "GET_HISTORY") {
    chrome.storage.local.get(HISTORY_KEY, (result) => {
      sendResponse({ history: result[HISTORY_KEY] || [] });
    });
    return true;
  }

  if (msg.type === "CLEAR_HISTORY") {
    chrome.storage.local.set({ [HISTORY_KEY]: [] }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "SAVE_LICENSE") {
    chrome.storage.local.set({ [LICENSE_KEY]: msg.key }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

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
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}
