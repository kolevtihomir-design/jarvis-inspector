// ═══════════════════════════════════════════════════════════════════════════
// JARVIS INSPECTOR — Standalone Server
// Напълно независим от главния Jarvis асистент.
// Порт: 3002  |  npm run inspector (или Start-Inspector.bat)
// ═══════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import cors from "cors";

const PORT   = Number(process.env.INSPECTOR_PORT || 3002);
const app    = express();
const __dir  = process.cwd();

app.use(cors()); // Chrome extension изисква CORS
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

function loadLicenses(): Record<string, LicenseRecord> {
  try { if (fs.existsSync(LICENSES_FILE)) return JSON.parse(fs.readFileSync(LICENSES_FILE, "utf-8")); }
  catch (_) {}
  return {};
}

function saveLicense(key: string, data: LicenseRecord) {
  const all = loadLicenses();
  all[key] = data;
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

async function callGroq(messages: any[]): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("no_groq_key");
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "llama-3.1-8b-instant", messages, temperature: 0.2, max_tokens: 512 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`groq_${r.status}`);
  const d = await r.json() as any;
  return d.choices[0].message.content;
}

async function callOpenRouter(messages: any[]): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("no_openrouter_key");
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3002", "X-Title": "Jarvis Inspector" },
    body: JSON.stringify({ model: "meta-llama/llama-3.1-8b-instruct:free", messages, temperature: 0.2, max_tokens: 512 }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`openrouter_${r.status}`);
  const d = await r.json() as any;
  return d.choices[0].message.content;
}

async function callGemini(messages: any[]): Promise<string> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no_gemini_key");
  // Convert to Gemini format
  const system = messages.find((m: any) => m.role === "system")?.content || "";
  const user   = messages.find((m: any) => m.role === "user")?.content || "";
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(25_000),
    }
  );
  if (!r.ok) throw new Error(`gemini_${r.status}`);
  const d = await r.json() as any;
  return d.candidates[0].content.parts[0].text;
}

async function callLLM(messages: any[]): Promise<{ text: string; provider: string; model: string }> {
  const providers = [
    { fn: callGroq,       name: "groq",       model: "llama-3.1-8b-instant" },
    { fn: callOpenRouter, name: "openrouter",  model: "llama-3.1-8b-instruct:free" },
    { fn: callGemini,     name: "gemini",      model: "gemini-1.5-flash" },
  ];
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
      licenseKey,
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
ВАЖНО: Отговаряш САМО валиден JSON без markdown.
Формат: {"verdict":"real"|"fake"|"suspicious"|"unknown","confidence":0-100,"explanation":"2-3 изречения на български","flags":["проблеми"],"suspicious_phrases":["фрази от текста"]}`
      : `Ти си Jarvis Inspector — AI детектор за дезинформация и фейк съдържание.
Анализираш уеб страници и казваш дали съдържанието е реално, фейк или подозрително.
ВАЖНО: Отговаряш САМО валиден JSON без markdown.
Формат: {"verdict":"real"|"fake"|"suspicious"|"unknown","confidence":0-100,"explanation":"2-3 изречения на български","flags":["конкретни проблеми"],"suspicious_phrases":["точни фрази от текста — максимум 5, до 5 думи всяка"]}`;

    const result = await callLLM([
      { role: "system", content: system },
      { role: "user",   content: `Анализирай:\n\n${ctx}` },
    ]);

    // Parse JSON
    let parsed: any = null;
    try {
      const clean = result.text.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (_) {
      parsed = { verdict: "unknown", confidence: 0, explanation: result.text.slice(0, 300), flags: [], suspicious_phrases: [] };
    }
    if (!Array.isArray(parsed?.suspicious_phrases)) parsed.suspicious_phrases = [];

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
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n⚡ Jarvis Inspector Server`);
  console.log(`   http://localhost:${PORT}/inspector`);
  console.log(`   Порт: ${PORT} | Лимит: ${FREE_DAILY_LIMIT} анализа/ден\n`);
});
