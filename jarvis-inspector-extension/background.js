// background.js — service worker v1.2 (freemium)
// Screenshot capture + Jarvis API + history storage + keyboard shortcut + license

const JARVIS_URL = "https://smartpause-inspector-api.vercel.app";
const HISTORY_KEY = "jv_history";
const LICENSE_KEY  = "jv_license_key";
const MAX_HISTORY = 30;
