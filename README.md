# ⚡ Jarvis Inspector

**AI-powered detector for fake news, fake profiles & misinformation.**  
Chrome Extension + Mobile PWA + Standalone server. Payments via Lemon Squeezy.

---

## Quick Start

```bash
npm install
cp .env.example .env   # fill in at least one AI key
```

```bash
# Windows
Start-Inspector.bat

# Mac / Linux
npm start
```

Server → **http://localhost:3002**

---

## Lemon Squeezy Setup (one-time)

### 1. Create your store
Go to [app.lemonsqueezy.com](https://app.lemonsqueezy.com) → **New Store**

### 2. Create the products

| Plan | Price | Variant type |
|------|-------|-------------|
| Inspector PRO | €4.99/mo | Subscription |
| Inspector Creator | €9.99/mo | Subscription |
| Inspector Business | €49/mo | Subscription |

### 3. Copy Variant IDs → paste in `.env`
`LS Dashboard → Products → your product → Variants → copy the numeric ID`

```env
LS_VARIANT_PRO=123456
LS_VARIANT_CREATOR=123457
LS_VARIANT_BUSINESS=123458
LEMON_SQUEEZY_STORE_URL=https://your-store.lemonsqueezy.com
```

### 4. Add Webhook
`LS Dashboard → Settings → Webhooks → Add Webhook`

- **URL:** `http://YOUR_PUBLIC_IP:3002/api/webhooks/lemon-squeezy`
- **Secret:** any random string → paste in `.env` as `LEMON_SQUEEZY_WEBHOOK_SECRET`
- **Events to check:**
  - `subscription_created`
  - `subscription_activated`
  - `subscription_cancelled`
  - `subscription_expired`
  - `order_created`

> **Tip:** Use [ngrok](https://ngrok.com) to expose localhost while testing:  
> `ngrok http 3002` → copy the https URL → use as webhook URL

### 5. Done
When someone pays → Lemon Squeezy fires webhook → Inspector activates their license automatically. No manual work.

---

## Chrome Extension Install

1. `chrome://extensions` → Enable **Developer mode**
2. **Load unpacked** → select `jarvis-inspector-extension/`
3. Works on any page — press **Alt+J** or click the eye button

## Mobile PWA Install

1. Open `http://YOUR_LOCAL_IP:3002/inspector` on phone
2. Chrome menu → **Add to Home Screen**

---

## Pricing (Freemium)

| Plan | Price | Analyses/day | Features |
|------|-------|-------------|---------|
| Free | €0 | 10 | Basic verdict + highlighting |
| PRO | €4.99/mo | Unlimited | Social mode, full history, priority AI |
| Creator | €9.99/mo | Unlimited | PRO + follower checker + badge |
| Business | €49/mo | Unlimited | API access, 5 seats, PDF reports |

---

## AI Providers (all free tiers)

| Provider | Free limit | Sign up |
|----------|-----------|---------|
| Groq | 131,000 TPM | [console.groq.com](https://console.groq.com) |
| OpenRouter | Rate-limited | [openrouter.ai](https://openrouter.ai) |
| Google Gemini | 1,500 req/day | [aistudio.google.com](https://aistudio.google.com) |

Auto-fallback chain: Groq → OpenRouter → Gemini

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/inspect` | POST | Analyze a URL |
| `/api/usage` | GET | Check daily usage |
| `/api/verify-license` | POST | Validate a license key |
| `/api/checkout` | GET | Get Lemon Squeezy checkout URLs |
| `/api/webhooks/lemon-squeezy` | POST | LS webhook (auto-activates licenses) |
| `/api/local-access` | GET | Get local IP for mobile QR |
| `/inspector/` | GET | Mobile PWA |

---

## Tech Stack

- **Server:** Node.js + Express + TypeScript
- **Payments:** Lemon Squeezy (subscriptions + license keys + webhooks)
- **Extension:** Chrome Manifest V3
- **PWA:** Vanilla JS + Service Worker + Web Share Target
- **AI:** Groq / OpenRouter / Gemini

---

MIT License
