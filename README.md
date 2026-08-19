# ⚡ Jarvis Inspector

**AI-powered detector for fake news, fake profiles & misinformation.**  
Works as a Chrome Extension, a Mobile PWA, and a standalone server.

---

## What it does

- **Analyzes any webpage** — real, fake, suspicious, or unknown
- **Social media mode** — detects fake Instagram/TikTok/Twitter profiles
- **Highlights suspicious phrases** directly on the page
- **Mobile PWA** — install on Android/iOS, share links directly to Inspector
- **Alt+J** keyboard shortcut on any page

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up API keys
```bash
cp .env.example .env
# Fill in at least one API key (Groq is free and fast)
```

### 3. Start the server
```bash
# Windows
Start-Inspector.bat

# Mac / Linux
npm start
```

Server runs at **http://localhost:3002**

### 4. Install Chrome Extension
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `jarvis-inspector-extension/` folder

### 5. Install Mobile PWA
1. Open `http://YOUR_LOCAL_IP:3002/inspector` on your phone
2. Chrome menu → **Add to Home Screen**

---

## Pricing (Freemium)

| Plan | Price | Analyses/day |
|------|-------|-------------|
| Free | €0 | 10 |
| PRO | €4.99/mo | Unlimited |
| Creator | €9.99/mo | Unlimited + badge |
| Business | €49/mo | API + 5 seats |

**[Buy PRO →](https://jarvis-inspector.lemonsqueezy.com)**

---

## API Keys (all free tiers)

| Provider | Free Limit | Sign up |
|----------|-----------|---------|
| Groq | 131,000 TPM | [console.groq.com](https://console.groq.com) |
| OpenRouter | Rate-limited | [openrouter.ai](https://openrouter.ai) |
| Google Gemini | 1,500 req/day | [aistudio.google.com](https://aistudio.google.com) |

---

## Tech Stack

- **Server**: Node.js + Express + TypeScript
- **Extension**: Chrome Manifest V3
- **PWA**: Vanilla JS + Service Worker + Web Share Target API
- **AI**: Groq / OpenRouter / Gemini (auto-fallback chain)

---

## License

MIT — use freely, sell your own instance, or buy a hosted PRO plan.
