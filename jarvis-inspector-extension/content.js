// content.js v1.2 — Jarvis Inspector
// Features: floating button, analysis panel, text highlighting,
//           history tab, social media mode, Alt+J toggle, PRO / Lemon Squeezy

const INSPECTOR_SERVER = "http://localhost:3002";

// Fetch checkout URL dynamically from server (uses LS_STORE_URL from .env)
async function getCheckoutUrl(plan = "pro") {
  try {
    const r = await fetch(`${INSPECTOR_SERVER}/api/checkout`);
    const d = await r.json();
    return d[plan] || d.store || "https://jarvis-inspector.lemonsqueezy.com";
  } catch (_) {
    return "https://jarvis-inspector.lemonsqueezy.com";
  }
}

(function () {
  "use strict";
  if (document.getElementById("jv-btn")) return;

  // ── Social media detection ──────────────────────────────────────────────
  const SOCIAL_DOMAINS = {
    "instagram.com":  { name: "Instagram",  icon: "📸", mode: "profile" },
    "tiktok.com":     { name: "TikTok",     icon: "🎵", mode: "profile" },
    "twitter.com":    { name: "Twitter/X",  icon: "𝕏",  mode: "post"    },
    "x.com":          { name: "Twitter/X",  icon: "𝕏",  mode: "post"    },
    "facebook.com":   { name: "Facebook",   icon: "📘", mode: "post"    },
    "youtube.com":    { name: "YouTube",    icon: "▶️",  mode: "video"   },
    "linkedin.com":   { name: "LinkedIn",   icon: "💼", mode: "profile" },
  };
  const socialMeta = Object.entries(SOCIAL_DOMAINS)
    .find(([d]) => window.location.hostname.includes(d))?.[1] || null;

  // ── Icons ───────────────────────────────────────────────────────────────
  const EYE_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`;

  const SPIN_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M21 12a9 9 0 1 1-9-9" stroke-dasharray="40" stroke-dashoffset="10"/>
  </svg>`;

  // ── DOM setup ───────────────────────────────────────────────────────────
  const btn = document.createElement("button");
  btn.id = "jv-btn";
  btn.title = `JARVIS Inspector — Alt+J${socialMeta ? ` (${socialMeta.icon} ${socialMeta.name})` : ""}`;
  btn.innerHTML = EYE_SVG;
  // Social indicator dot
  if (socialMeta) {
    const dot = document.createElement("span");
    dot.className = "jv-social-dot";
    dot.textContent = socialMeta.icon;
    btn.appendChild(dot);
  }
  document.body.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = "jv-panel";
  panel.style.display = "none";
  document.body.appendChild(panel);

  let isOpen = false;
  let currentTab = "result"; // "result" | "history"
  let highlights = []; // DOM marks added to page

  // ── Text highlighting ───────────────────────────────────────────────────
  function clearHighlights() {
    highlights.forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
    highlights = [];
  }

  function highlightPhrases(phrases, verdict) {
    if (!phrases || !phrases.length) return;
    clearHighlights();

    const colorClass = verdict === "fake" ? "jv-hl-fake"
                     : verdict === "suspicious" ? "jv-hl-suspicious"
                     : "jv-hl-real";

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // Skip our own UI elements and scripts
          const tag = node.parentElement?.tagName?.toLowerCase();
          if (["script","style","noscript","jv-panel","#jv-btn"].some(t => tag === t)) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.closest?.("#jv-panel,#jv-btn")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const newHighlights = [];
    const lowerPhrases = phrases.map(p => p.toLowerCase().trim()).filter(p => p.length > 3);

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      const lowerText = text.toLowerCase();

      for (const phrase of lowerPhrases) {
        let idx = lowerText.indexOf(phrase);
        if (idx < 0) continue;

        try {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + phrase.length);
          const mark = document.createElement("mark");
          mark.className = `jv-highlight ${colorClass}`;
          mark.title = `⚡ JARVIS: подозрителна фраза`;
          range.surroundContents(mark);
          newHighlights.push(mark);
          break; // one phrase per text node to avoid nesting issues
        } catch (_) { /* skip overlapping ranges */ }
      }
    }

    highlights = newHighlights;
    return newHighlights.length;
  }

  // ── Panel rendering ─────────────────────────────────────────────────────
  function renderTabs(active) {
    return `
      <div class="jv-tabs">
        <button class="jv-tab ${active === "result"  ? "jv-tab-active" : ""}" data-tab="result">🔍 Резултат</button>
        <button class="jv-tab ${active === "history" ? "jv-tab-active" : ""}" data-tab="history">📋 История</button>
        <button class="jv-tab jv-tab-pro ${active === "pro" ? "jv-tab-active" : ""}" data-tab="pro">⚡ PRO</button>
        <button class="jv-close-btn" id="jv-close">✕</button>
      </div>`;
  }

  function showLoading() {
    panel.style.display = "block";
    isOpen = true;
    panel.innerHTML = `
      <div class="jv-inner">
        <div class="jv-header">
          <span class="jv-logo">⚡ JARVIS INSPECTOR${socialMeta ? ` ${socialMeta.icon}` : ""}</span>
          <button class="jv-close-btn" id="jv-close">✕</button>
        </div>
        ${renderTabs("result")}
        <div class="jv-loading-inner">
          <div class="jv-spinner"></div>
          <span>${socialMeta ? `Анализирам ${socialMeta.name} ${socialMeta.mode}...` : "Анализирам страницата..."}</span>
        </div>
      </div>`;
    attachTabListeners();
  }

  function showError(msg) {
    panel.innerHTML = `
      <div class="jv-inner">
        <div class="jv-header">
          <span class="jv-logo">⚡ JARVIS INSPECTOR</span>
          <button class="jv-close-btn" id="jv-close">✕</button>
        </div>
        ${renderTabs("result")}
        <div class="jv-error-inner">
          ❌ ${msg}<br><br>
          <span style="color:#475569;font-size:10px;">Увери се, че Jarvis работи на localhost:3001</span>
        </div>
      </div>`;
    attachTabListeners();
  }

  function showResult(data) {
    const { verdict = "unknown", confidence = 0, explanation = "",
            flags = [], suspicious_phrases = [], provider = "", model = "" } = data;

    const meta = {
      real:        { icon: "✅", label: "РЕАЛНО",       sub: "Съдържанието изглежда достоверно" },
      fake:        { icon: "❌", label: "ФЕЙК",          sub: "Вероятно невярно или манипулирано" },
      suspicious:  { icon: "⚠️", label: "ПОДОЗРИТЕЛНО", sub: "Проверете допълнителни източници" },
      unknown:     { icon: "🔍", label: "НЕЯСНО",        sub: "Недостатъчна информация" },
    };
    const m = meta[verdict] || meta.unknown;
    const pct = Math.min(100, Math.max(0, Number(confidence)));
    const flagsHtml = flags.length
      ? `<div class="jv-flags">${flags.map(f => `<span class="jv-flag">${f}</span>`).join("")}</div>`
      : "";

    // Highlight count
    const hlCount = highlightPhrases(suspicious_phrases, verdict);
    const hlBadge = hlCount
      ? `<div class="jv-hl-badge">🖊️ ${hlCount} фраз${hlCount === 1 ? "а" : "и"} маркирани в страницата</div>`
      : "";

    panel.innerHTML = `
      <div class="jv-inner">
        <div class="jv-header">
          <span class="jv-logo">⚡ JARVIS INSPECTOR${socialMeta ? ` ${socialMeta.icon}` : ""}</span>
          <button class="jv-close-btn" id="jv-close">✕</button>
        </div>
        ${renderTabs("result")}
        <div class="jv-verdict jv-verdict-${verdict}">
          <span class="jv-verdict-icon">${m.icon}</span>
          <div>
            <div class="jv-verdict-label">${m.label}</div>
            <div class="jv-verdict-sub">${m.sub}</div>
          </div>
        </div>
        <div class="jv-verdict-${verdict} jv-conf-wrap">
          <div class="jv-conf-label">
            <span>УВЕРЕНОСТ</span><span>${pct}%</span>
          </div>
          <div class="jv-conf-bar"><div class="jv-conf-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="jv-explanation">${explanation}</div>
        ${flagsHtml}
        ${hlBadge}
        <div class="jv-footer">
          <span class="jv-domain">🌐 ${window.location.hostname}</span>
          ${provider ? `<span class="jv-provider">${provider}${model ? " / " + model.split("/").pop()?.slice(0,18) : ""}</span>` : ""}
        </div>
        ${hlCount ? `<div class="jv-clear-hl" id="jv-clear-hl">✕ Изчисти маркирането</div>` : ""}
      </div>`;

    attachTabListeners();
    document.getElementById("jv-clear-hl")?.addEventListener("click", () => {
      clearHighlights();
      document.getElementById("jv-clear-hl")?.remove();
      document.querySelector(".jv-hl-badge")?.remove();
    });
  }

  async function showHistory() {
    currentTab = "history";
    const resp = await chrome.runtime.sendMessage({ type: "GET_HISTORY" });
    const history = resp?.history || [];

    const icons = { real: "✅", fake: "❌", suspicious: "⚠️", unknown: "🔍" };
    const colors = { real: "#10b981", fake: "#f87171", suspicious: "#fbbf24", unknown: "#64748b" };

    const items = history.length === 0
      ? `<div class="jv-hist-empty">Няма записани анализи още</div>`
      : history.map(h => `
          <div class="jv-hist-item" data-url="${h.url}">
            <span class="jv-hist-icon">${icons[h.verdict] || "🔍"}</span>
            <div class="jv-hist-info">
              <div class="jv-hist-domain" style="color:${colors[h.verdict] || "#64748b"}">${h.domain || "?"}</div>
              <div class="jv-hist-title">${(h.title || h.url || "").slice(0, 48)}</div>
              <div class="jv-hist-time">${new Date(h.ts).toLocaleString("bg-BG", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}</div>
            </div>
            <span class="jv-hist-pct">${h.confidence ?? "?"}%</span>
          </div>`).join("");

    panel.innerHTML = `
      <div class="jv-inner">
        <div class="jv-header">
          <span class="jv-logo">⚡ JARVIS INSPECTOR</span>
          <button class="jv-close-btn" id="jv-close">✕</button>
        </div>
        ${renderTabs("history")}
        <div class="jv-hist-list">${items}</div>
        ${history.length > 0 ? `<div class="jv-clear-hist" id="jv-clear-hist">🗑 Изчисти историята</div>` : ""}
      </div>`;

    attachTabListeners();

    // Click on history item → open in new tab
    panel.querySelectorAll(".jv-hist-item[data-url]").forEach(el => {
      el.addEventListener("click", () => {
        window.open(el.dataset.url, "_blank");
      });
    });

    document.getElementById("jv-clear-hist")?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
      showHistory();
    });
  }

  function attachTabListeners() {
    document.getElementById("jv-close")?.addEventListener("click", closePanel);
    panel.querySelectorAll(".jv-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        const t = tab.dataset.tab;
        if (t === "history") showHistory();
        else if (t === "pro") showPro();
        else if (t === "result") {
          currentTab = "result";
          panel.style.display = "block";
        }
      });
    });
  }

  // ── Limit reached screen ─────────────────────────────────────────────────
  function showLimitReached(limitData) {
    const used  = limitData?.used  ?? 10;
    const limit = limitData?.limit ?? 10;
    panel.innerHTML = `
      <div class="jv-inner">
        <div class="jv-header">
          <span class="jv-logo">⚡ JARVIS INSPECTOR</span>
          <button class="jv-close-btn" id="jv-close">✕</button>
        </div>
        ${renderTabs("pro")}
        <div class="jv-limit-box">
          <div class="jv-limit-icon">🔒</div>
          <div class="jv-limit-title">Дневен лимит достигнат</div>
          <div class="jv-limit-sub">Използвал си <strong>${used}/${limit}</strong> безплатни анализа за днес.<br>Надгради до PRO за неограничени.</div>
          <a class="jv-upgrade-btn" id="jv-upgrade-link-limit" href="#" target="_blank">⚡ Надгради до PRO — €4.99/мо</a>
          <div class="jv-limit-or">или въведи лиценз ключ</div>
          <div class="jv-license-row">
            <input class="jv-license-input" id="jv-license-input" type="text" placeholder="JARVIS-XXXX-XXXX-XXXX" />
            <button class="jv-license-btn" id="jv-license-save">✓</button>
          </div>
          <div id="jv-license-msg" class="jv-license-msg"></div>
        </div>
      </div>`;
    attachTabListeners();
    attachLicenseListeners();
  }

  // ── PRO settings screen ──────────────────────────────────────────────────
  async function showPro() {
    currentTab = "pro";
    const resp = await chrome.runtime.sendMessage({ type: "GET_LICENSE" });
    const currentKey = resp?.key || "";

    panel.innerHTML = `
      <div class="jv-inner">
        <div class="jv-header">
          <span class="jv-logo">⚡ JARVIS INSPECTOR</span>
          <button class="jv-close-btn" id="jv-close">✕</button>
        </div>
        ${renderTabs("pro")}
        <div class="jv-pro-inner">
          <div class="jv-pro-title">⚡ JARVIS PRO</div>
          <div class="jv-pro-features">
            <div class="jv-pro-row">✅ Неограничени анализи</div>
            <div class="jv-pro-row">✅ Социален режим (Instagram, TikTok)</div>
            <div class="jv-pro-row">✅ Пълна история</div>
            <div class="jv-pro-row">✅ Приоритетен AI модел</div>
          </div>
          <a class="jv-upgrade-btn" id="jv-upgrade-link-pro" href="#" target="_blank">Купи PRO — €4.99/мо →</a>
          <div class="jv-pro-sep">Лиценз ключ</div>
          <div class="jv-license-row">
            <input class="jv-license-input" id="jv-license-input" type="text"
              placeholder="JARVIS-XXXX-XXXX-XXXX"
              value="${currentKey}" />
            <button class="jv-license-btn" id="jv-license-save">✓</button>
          </div>
          ${currentKey ? `<div class="jv-license-msg jv-license-ok">✅ Лиценз активен</div>` : ""}
          <div id="jv-license-msg" class="jv-license-msg"></div>
        </div>
      </div>`;
    attachTabListeners();
    attachLicenseListeners();
  }

  function attachLicenseListeners() {
    // Load dynamic checkout URL from server
    getCheckoutUrl("pro").then(url => {
      ["jv-upgrade-link-limit", "jv-upgrade-link-pro"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.href = url;
      });
    });

    document.getElementById("jv-license-save")?.addEventListener("click", async () => {
      const input = document.getElementById("jv-license-input");
      const key = input?.value?.trim();
      if (!key) return;
      const msgEl = document.getElementById("jv-license-msg");
      if (msgEl) msgEl.textContent = "Проверявам...";

      try {
        const r = await fetch("http://localhost:3002/api/verify-license", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ licenseKey: key }),
        });
        const data = await r.json();
        if (data.valid) {
          await chrome.runtime.sendMessage({ type: "SAVE_LICENSE", key });
          if (msgEl) { msgEl.textContent = `✅ Активиран! План: ${data.plan}`; msgEl.className = "jv-license-msg jv-license-ok"; }
        } else {
          if (msgEl) { msgEl.textContent = `❌ ${data.error || "Невалиден ключ"}`; msgEl.className = "jv-license-msg jv-license-err"; }
        }
      } catch (err) {
        if (msgEl) { msgEl.textContent = `❌ Грешка: ${err.message}`; msgEl.className = "jv-license-msg jv-license-err"; }
      }
    });
  }

  function closePanel() {
    panel.style.display = "none";
    isOpen = false;
  }

  // ── Main analyze flow ───────────────────────────────────────────────────
  async function runAnalysis() {
    if (isOpen && currentTab === "result") {
      closePanel();
      return;
    }

    btn.classList.add("jv-loading");
    btn.innerHTML = SPIN_SVG;
    showLoading();
    currentTab = "result";

    try {
      // Screenshot
      let screenshot = null;
      try {
        const capResp = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREEN" });
        if (capResp?.dataUrl) screenshot = capResp.dataUrl;
      } catch (_) {}

      // Page context
      const selectedText = window.getSelection().toString().slice(0, 1000).trim();
      const description  = document.querySelector("meta[name='description']")?.getAttribute("content") || "";
      const author       = document.querySelector("meta[name='author']")?.getAttribute("content") || "";
      const published    = document.querySelector("meta[property='article:published_time']")?.getAttribute("content")
                        || document.querySelector("time")?.getAttribute("datetime") || "";
      const ogType       = document.querySelector("meta[property='og:type']")?.getAttribute("content") || "";

      // For social pages, grab visible profile text
      let socialText = "";
      if (socialMeta) {
        socialText = Array.from(document.querySelectorAll("h1,h2,[class*='username'],[class*='bio'],[class*='description']"))
          .map(el => el.textContent?.trim())
          .filter(Boolean)
          .slice(0, 5)
          .join(" | ")
          .slice(0, 500);
      }

      const payload = {
        url:         window.location.href,
        title:       document.title,
        domain:      window.location.hostname,
        selectedText: selectedText || socialText,
        description, author, published, ogType,
        socialMode:  socialMeta?.mode || null,
        socialPlatform: socialMeta?.name || null,
        screenshot:  (selectedText.length < 50 && !socialMeta) ? screenshot : null,
      };

      const resp = await chrome.runtime.sendMessage({ type: "ANALYZE", payload });

      if (resp?.error === "limit_reached") showLimitReached(resp.limitData);
      else if (resp?.error) showError(resp.error);
      else if (resp?.data) {
        showResult(resp.data);
        // Update usage display after successful analysis
        chrome.storage.local.get("jv_license_key", (s) => {
          const lk = s["jv_license_key"] || "";
          fetch("http://localhost:3002/api/usage", lk ? { headers: { "x-license-key": lk } } : undefined)
            .then(r => r.json())
            .then(u => {
              if (!u.isPro && u.limit) {
                const badge = document.createElement("div");
                badge.style.cssText = "text-align:center;font-size:9px;color:#334155;font-family:monospace;padding:4px 16px 8px";
                badge.textContent = `${u.used}/${u.limit} безплатни анализа днес`;
                panel.querySelector(".jv-inner")?.appendChild(badge);
              }
            }).catch(() => {});
        });
      }
      else showError("Неочакван отговор");

    } catch (err) {
      showError(err.message || "Неизвестна грешка");
    } finally {
      btn.classList.remove("jv-loading");
      btn.innerHTML = EYE_SVG;
      if (socialMeta) {
        const dot = document.createElement("span");
        dot.className = "jv-social-dot";
        dot.textContent = socialMeta.icon;
        btn.appendChild(dot);
      }
    }
  }

  // ── Event listeners ─────────────────────────────────────────────────────
  btn.addEventListener("click", (e) => { e.stopPropagation(); runAnalysis(); });

  // Alt+J from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE") runAnalysis();
  });

  document.addEventListener("click", (e) => {
    if (isOpen && !panel.contains(e.target) && e.target !== btn) closePanel();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) closePanel();
  });

})();
