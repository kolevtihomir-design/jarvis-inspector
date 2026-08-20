// ═══════════════════════════════════════════════════════════════════════════
// JARVIS INSPECTOR — Standalone Server
// Напълно независим от главния Jarvis асистент.
// Порт: 3002  |  npm run inspector (или Start-Inspector.bat)
// ═══════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import cors from "cors";

const PORT   = Number(process.env.INSPECTOR_PORT || 3002);
const app    = express();
const __dir  = process.cwd();

// ── Lemon Squeezy config ──────────────────────────────────────────────────
const LS_API_KEY         = process.env.LEMON_SQUEEZY_API_KEY || "";
const LS_WEBHOOK_SECRET  = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || "";
const LS_STORE_URL       = process.env.LEMON_SQUEEZY_STORE_URL || "https://jarvis-inspector.lemonsqueezy.com";
const LS_VARIANTS: Record<string, string> = {
  pro:      process.env.LS_VARIANT_PRO      || "",
  creator:  process.env.LS_VARIANT_CREATOR  || "",
  business: process.env.LS_VARIANT_BUSINESS || "",
};

function lsCheckoutUrl(plan: "pro" | "creator" | "business"): string {
  const variantId = LS_VARIANTS[plan];
  if (variantId) return `${LS_STORE_URL}/checkout/buy/${variantId}`;
  return `${LS_STORE_URL}`; // fallback to store homepage
}

app.use(cors()); // Chrome extension изисква CORS

// ── Webhook raw body (трябва ПРЕДИ express.json) ──────────────────────────
app.use("/api/webhooks/lemon-squeezy",
  express.raw({ type: "application/json" })
);

app.use(express.json({ limit: "10mb" }));

// ── Serve PWA ────────────────────────────────────────────────────────────
const pwaPath = path.join(__dir, "inspector-pwa");
app.use("/inspector", express.static(pwaPath));
app.get("/inspector",  (_, res) => res.sendFile(path.join(pwaPath, "index.html")));
app.get("/inspector/", (_, res) => res.sendFile(path.join(pwaPath, "index.html")));

// ── Freemium ──────────────────────────────────────────────────────────────
const FREE_DAILY_LIMIT = 10;
const DATA_DIR         = path.join(__dir, "inspector-data");
const LICENSES_FILE    = path.join(DATA_DIR, "licenses.json");
const LEMON_API        = "https://api.lemonsqueezy.com/v1/licenses";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ip → { count, day }
const usageMap = new Map<string, { count: number; day: string }>();

function today() { return new Date().toISOString().slice(0, 10); }

// Cleanup old IPs every hour to prevent memory leaks
setInterval(() => {
  const t = today();
  usageMap.forEach((data, ip) => {
    if (data.day !== t) usageMap.delete(ip);
  });
}, 60 * 60 * 1000);

function getUsage(ip: string) {
  const t = today();
  const r = usageMap.get(ip);
  return (!r || r.day !== t) ? { count: 0, day: t } : r;
}

function incUsage(ip: string) {
  const t = today();
  const n = { count: getUsage(ip).count + 1, day: t };
  usageMap.set(ip, n);
  return n.count;
}

type LicenseRecord = { valid: boolean; plan: string; email: string; activatedAt: string };

let cachedLicenses: Record<string, LicenseRecord> | null = null;
let lastLicenseCheck = 0;

function loadLicenses(): Record<string, LicenseRecord> {
  const now = Date.now();
  if (cachedLicenses && now - lastLicenseCheck < 5000) return cachedLicenses;
  try {
    if (fs.existsSync(LICENSES_FILE)) {
      cachedLicenses = JSON.parse(fs.readFileSync(LICENSES_FILE, "utf-8"));
      lastLicenseCheck = now;
      return cachedLicenses!;
    }
  } catch (_) {}
  return {};
}

function saveLicense(key: string, data: LicenseRecord) {
  const all = loadLicenses();
  all[key] = data;
  cachedLicenses = all;
  lastLicenseCheck = Date.now();
  fs.writeFileSync(LICENSES_FILE, JSON.stringify(all, null, 2), "utf-8");
}

function checkPro(licenseKey: string): boolean {
  if (!licenseKey) return false;
  return !!loadLicenses()[licenseKey]?.valid;
}

function clientIP(req: express.Request): string {
  return ((req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown")
    .split(",")[0].trim();
}

// ── Lightweight LLM caller ────────────────────────────────────────────────
// Groq → OpenRouter → Gemini. Без зависимости от главния Jarvis.
// Поддържа key-pool (comma-separated GROQ_API_KEYS / OPENROUTER_API_KEYS).

function getKeyPool(envPrefix: string): string[] {
  const pool = (process.env[`${envPrefix}_API_KEYS`] || "").split(",").map(k => k.trim()).filter(Boolean);
  if (pool.length) return pool;
  const single = (process.env[`${envPrefix}_API_KEY`] || "").trim();
  return single ? [single] : [];
}

async function callGroq(messages: any[]): Promise<string> {
  const keys = getKeyPool("GROQ");
  if (!keys.length) throw new Error("no_groq_key");
  for (const key of keys) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "llama-3.1-8b-instant", messages, temperature: 0.2, max_tokens: 512 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`groq_${r.status}`);
      const d = await r.json() as any;
      return d.choices[0].message.content;
    } catch (e: any) {
      if (keys.indexOf(key) === keys.length - 1) throw e;
      console.warn(`[GROQ] key #${keys.indexOf(key)} failed: ${e.message} — trying next`);
    }
  }
  throw new Error("groq_all_keys_failed");
}

async function callOpenRouter(messages: any[]): Promise<string> {
  const keys = getKeyPool("OPENROUTER");
  if (!keys.length) throw new Error("no_openrouter_key");
  // Безплатни модели по приоритет — потвърдени работещи (20.08.2026)
  const OR_MODELS = [
    "nvidia/nemotron-3.5-lightning:free",
    "nvidia/nemotron-nano-9b-v2:free",
    "liquid/lfm-2.5-2.6b:free",
    "meta-llama/llama-3.1-8b-instruct:free",
  ];
  for (const key of keys) {
    for (const model of OR_MODELS) {
      try {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${key}`, "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3002", "X-Title": "Jarvis Inspector",
          },
          body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 512 }),
          signal: AbortSignal.timeout(25_000),
        });
        if (!r.ok) throw new Error(`openrouter_${r.status}`);
        const d = await r.json() as any;
        const content = d.choices?.[0]?.message?.content;
        if (!content) throw new Error("empty_response");
        return content;
      } catch (e: any) {
        console.warn(`[OPENROUTER] ${model} failed: ${e.message}`);
      }
    }
  }
  throw new Error("openrouter_all_models_failed");
}

async function callGemini(messages: any[]): Promise<string> {
  // Поддържа GEMINI_API_KEYS (pool) → GEMINI_API_KEY → GOOGLE_API_KEY (legacy)
  const poolEnv = (process.env.GEMINI_API_KEYS || "").trim();
  const singleKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  const geminiKeys = poolEnv
    ? poolEnv.split(",").map(k => k.trim()).filter(k => k && !k.startsWith("AQ."))
    : singleKey && !singleKey.startsWith("AQ.") ? [singleKey] : [];
  if (!geminiKeys.length) throw new Error("no_gemini_key"); // няма валиден AIzaSy... ключ
  // Convert to Gemini format
  const system = messages.find((m: any) => m.role === "system")?.content || "";
  const userMsg = messages.find((m: any) => m.role === "user");

  let parts: any[] = [];
  if (typeof userMsg?.content === "string") {
    parts.push({ text: `${system}\n\n${userMsg.content}` });
  } else if (Array.isArray(userMsg?.content)) {
    parts.push({ text: `${system}\n\n` });
    for (const item of userMsg.content) {
      if (item.type === "text") {
        parts[0].text += item.text;
      } else if (item.type === "image_url") {
        const match = item.image_url.url.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
      }
    }
  }

  // Loops: всеки ключ × всеки модел — при 429 се преминава на следващ ключ
  // ПОТВЪРДЕНО 15.08.2026: gemini-2.0-flash, gemini-1.5-flash → 404 за нови users.
  // gemini-flash-latest е единственият работещ alias (сочи към текущия Flash production).
  const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.0-flash-lite", "gemini-1.5-flash-8b"];
  for (const apiKey of geminiKeys) {
    for (const model of GEMINI_MODELS) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
            }),
            signal: AbortSignal.timeout(25_000),
          }
        );
        if (!r.ok) {
          if (r.status === 429) { console.warn(`[GEMINI] key#${geminiKeys.indexOf(apiKey)} quota → next key`); break; }
          throw new Error(`gemini_${r.status}`);
        }
        const d = await r.json() as any;
        return d.candidates[0].content.parts[0].text;
      } catch (e: any) {
        const isLast = model === GEMINI_MODELS[GEMINI_MODELS.length - 1] && apiKey === geminiKeys[geminiKeys.length - 1];
        console.warn(`[GEMINI] key#${geminiKeys.indexOf(apiKey)} ${model}: ${e.message}`);
        if (isLast) throw e;
      }
    }
  }
  throw new Error("gemini_all_keys_failed");
}

async function callLLM(messages: any[], requiresVision = false): Promise<{ text: string; provider: string; model: string }> {
  let providers = [
    { fn: callGroq,       name: "groq",       model: "llama-3.1-8b-instant" },
    { fn: callOpenRouter, name: "openrouter",  model: "nemotron-3.5-lightning:free" },
    { fn: callGemini,     name: "gemini",      model: "gemini-flash-latest" },
  ];

  if (requiresVision) {
    // Only Gemini is guaranteed to have vision in this setup right now
    providers = providers.filter(p => p.name === "gemini");
  }

  for (const p of providers) {
    try {
      const text = await p.fn(messages);
      return { text, provider: p.name, model: p.model };
    } catch (e: any) {
      console.warn(`[INSPECTOR] ${p.name} failed: ${e.message}`);
    }
  }
  throw new Error("Всички AI доставчици са недостъпни. Провери API ключовете в .env");
}

// ── /api/checkout — returns Lemon Squeezy checkout URLs ──────────────────
app.get("/api/checkout", (_req, res) => {
  res.json({
    pro:      lsCheckoutUrl("pro"),
    creator:  lsCheckoutUrl("creator"),
    business: lsCheckoutUrl("business"),
    store:    LS_STORE_URL,
  });
});

// ── /api/webhooks/lemon-squeezy — automatic license activation ────────────
// Lemon Squeezy sends POST here on every subscription event.
// Set this URL in LS dashboard → Settings → Webhooks:
//   http://YOUR_IP:3002/api/webhooks/lemon-squeezy
app.post("/api/webhooks/lemon-squeezy", (req, res) => {
  // 1. Verify signature
  const sig  = req.headers["x-signature"] as string;
  const body = req.body as Buffer;

  if (LS_WEBHOOK_SECRET) {
    if (!sig) {
      console.warn("[WEBHOOK] Missing signature — rejected");
      return res.status(401).json({ error: "missing signature" });
    }
    const hmac    = crypto.createHmac("sha256", LS_WEBHOOK_SECRET);
    const digest  = hmac.update(body).digest("hex");
    const sigBuffer = Buffer.from(sig);
    const digestBuffer = Buffer.from(digest);
    if (sigBuffer.length !== digestBuffer.length || !crypto.timingSafeEqual(sigBuffer, digestBuffer)) {
      console.warn("[WEBHOOK] Invalid signature — rejected");
      return res.status(401).json({ error: "invalid signature" });
    }
  }

  // 2. Parse payload
  let payload: any;
  try { payload = JSON.parse(body.toString()); }
  catch (_) { return res.status(400).json({ error: "invalid json" }); }

  const event    = payload?.meta?.event_name as string;
  const email    = payload?.data?.attributes?.user_email as string || "";
  const status   = payload?.data?.attributes?.status as string || "";
  const lsKey    = payload?.data?.attributes?.license_key?.key as string || "";
  const planName = (payload?.data?.attributes?.variant_name as string || "").toLowerCase();
  const plan     = planName.includes("creator") ? "creator"
                 : planName.includes("business") ? "business"
                 : "pro";

  console.log(`[WEBHOOK] ${event} | ${email} | plan:${plan} | status:${status}`);

  // 3. Act on event
  if (["subscription_created", "subscription_activated", "order_created"].includes(event)) {
    // Find or generate a license key for this subscription
    const activationKey = lsKey || `JARVIS-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    saveLicense(activationKey, {
      valid: true, plan, email,
      activatedAt: new Date().toISOString(),
    });
    console.log(`[WEBHOOK] Activated license ${activationKey} for ${email}`);
  }

    if (["subscription_cancelled", "subscription_expired", "subscription_paused"].includes(event)) {
      if (lsKey) {
        const all = loadLicenses();
        if (all[lsKey]) {
          saveLicense(lsKey, { ...all[lsKey], valid: false });
          console.log(`[WEBHOOK] Deactivated license ${lsKey} for ${email}`);
        }
      }
    }

  res.json({ received: true });
});

// ── /api/local-access ────────────────────────────────────────────────────
app.get("/api/local-access", (_, res) => {
  const ifaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const iface of list || []) {
      if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
    }
  }
  const ip = ips[0] || "127.0.0.1";
  res.json({ ip, port: PORT, inspectorUrl: `http://${ip}:${PORT}/inspector`, ips });
});

// ── /api/health ──────────────────────────────────────────────────────────
app.get("/api/health", (_, res) => {
  res.json({ status: "ok" });
});

// ── /api/usage ───────────────────────────────────────────────────────────
app.get("/api/usage", (req, res) => {
  const ip  = clientIP(req);
  const key = (req.headers["x-license-key"] as string) || "";
  const pro = checkPro(key);
  const { count } = getUsage(ip);
  const licenses = loadLicenses();
  res.json({
    used:      count,
    limit:     pro ? null : FREE_DAILY_LIMIT,
    remaining: pro ? null : Math.max(0, FREE_DAILY_LIMIT - count),
    isPro:     pro,
    plan:      pro ? (licenses[key]?.plan || "pro") : "free",
    resetAt:   `${today()}T23:59:59`,
  });
});

// ── /api/verify-license ──────────────────────────────────────────────────
app.post("/api/verify-license", async (req, res) => {
  const { licenseKey } = req.body;
  if (!licenseKey) return res.status(400).json({ error: "Липсва license key" });

  // Local cache
  const cached = loadLicenses()[licenseKey];
  if (cached?.valid) return res.json({ valid: true, plan: cached.plan, email: cached.email, cached: true });

  const lsKey = process.env.LEMON_SQUEEZY_API_KEY;
  if (!lsKey) {
    // Dev mode — ключ JARVIS-* е валиден
    if (licenseKey.startsWith("JARVIS-")) {
      saveLicense(licenseKey, { valid: true, plan: "pro", email: "dev@local", activatedAt: new Date().toISOString() });
      return res.json({ valid: true, plan: "pro", email: "dev@local" });
    }
    return res.status(503).json({ error: "Добави LEMON_SQUEEZY_API_KEY в .env за истинска проверка" });
  }

  try {
    const r = await fetch(`${LEMON_API}/validate`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${lsKey}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ license_key: licenseKey, instance_name: "Jarvis Inspector" }),
    });
    const d = await r.json() as any;
    if (d?.valid) {
      const plan = d.meta?.product_name?.toLowerCase().includes("creator") ? "creator"
                 : d.meta?.product_name?.toLowerCase().includes("business") ? "business"
                 : "pro";
      const email = d.meta?.customer_email || "";
      saveLicense(licenseKey, { valid: true, plan, email, activatedAt: new Date().toISOString() });
      return res.json({ valid: true, plan, email });
    }
    return res.status(400).json({ valid: false, error: d?.error || "Невалиден лиценз" });
  } catch (err: any) {
    return res.status(500).json({ error: `Грешка: ${err.message}` });
  }
});

// ── /api/inspect ─────────────────────────────────────────────────────────
app.post("/api/inspect", async (req, res) => {
  try {
    const {
      url, title, domain, selectedText, description,
      author, published, ogType,
      socialMode, socialPlatform,
      licenseKey, image
    } = req.body;

    // Rate limiting
    const ip  = clientIP(req);
    const pro = checkPro(licenseKey || "");

    if (!pro) {
      const { count } = getUsage(ip);
      if (count >= FREE_DAILY_LIMIT) {
        return res.status(429).json({
          error: "limit_reached",
          used:  count,
          limit: FREE_DAILY_LIMIT,
          message: `Дневен лимит от ${FREE_DAILY_LIMIT} анализа достигнат. Надгради до PRO.`,
          upgradeUrl: "https://jarvis-inspector.lemonsqueezy.com",
        });
      }
      incUsage(ip);
    }

    // Build context
    const ctx = [
      `URL: ${url}`,
      `Заглавие: ${title || "(без заглавие)"}`,
      `Домейн: ${domain}`,
      description    ? `Описание: ${description}` : "",
      author         ? `Автор: ${author}` : "",
      published      ? `Публикувано: ${published}` : "",
      ogType         ? `Тип: ${ogType}` : "",
      selectedText   ? `Текст: "${selectedText}"` : "",
      socialPlatform ? `Платформа: ${socialPlatform} (режим: ${socialMode})` : "",
    ].filter(Boolean).join("\n");

    const isSocial = !!socialMode;
    const system = isSocial
      ? `Ти си Jarvis Inspector — AI анализатор на социални медии.
Проверяваш профили и публикации за автентичност, фалшиви последователи, scam акаунти.
Ако ти е подадена снимка (скрийншот), анализирай визуално за съмнителни елементи (AI генерирано, монтажи).
ВАЖНО: Отговаряш САМО валиден JSON без markdown.
Формат: {"verdict":"real"|"fake"|"suspicious"|"unknown","confidence":0-100,"explanation":"2-3 изречения на български","flags":["проблеми"],"suspicious_phrases":["фрази от текста"]}`
      : `Ти си Jarvis Inspector — AI детектор за дезинформация и фейк съдържание.
Анализираш уеб страници и казваш дали съдържанието е реално, фейк или подозрително.
Ако ти е подадена снимка (скрийншот), анализирай я за следи от AI генерация или манипулация.
ВАЖНО: Отговаряш САМО валиден JSON без markdown.
Формат: {"verdict":"real"|"fake"|"suspicious"|"unknown","confidence":0-100,"explanation":"2-3 изречения на български","flags":["конкретни проблеми"],"suspicious_phrases":["точни фрази от текста — максимум 5, до 5 думи всяка"]}`;

    let userContent: any = `Анализирай:\n\n${ctx}`;
    let requiresVision = false;

    if (image) {
      requiresVision = true;
      userContent = [
        { type: "text", text: `Анализирай следното съдържание и предоставената снимка (скрийншот):\n\n${ctx}` },
        { type: "image_url", image_url: { url: image } }
      ];
    }

    const result = await callLLM([
      { role: "system", content: system },
      { role: "user",   content: userContent },
    ], requiresVision);

    // Parse JSON
    let parsed: any = null;
    try {
      const clean = result.text.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (_) {
      parsed = { verdict: "unknown", confidence: 0, explanation: result.text.slice(0, 300), flags: [], suspicious_phrases: [] };
    }
    if (!parsed) parsed = {};
    if (!Array.isArray(parsed.suspicious_phrases)) parsed.suspicious_phrases = [];

    res.json({ ...parsed, provider: result.provider, model: result.model });
  } catch (err: any) {
    console.error("[INSPECTOR]", err.message);
    res.status(500).json({
      verdict: "unknown", confidence: 0,
      explanation: `Грешка при анализ: ${err.message}`,
      flags: ["server_error"], suspicious_phrases: [],
      provider: "none", model: "",
    });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n⚡ Jarvis Inspector Server`);
    console.log(`   http://localhost:${PORT}/inspector`);
    console.log(`   Порт: ${PORT} | Лимит: ${FREE_DAILY_LIMIT} анализа/ден\n`);
  });
}

export default app;
