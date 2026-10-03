const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SCRIPTS_DIR = path.join(DATA_DIR, "scripts");
const DB_FILE = path.join(DATA_DIR, "scripts.json");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");
const BOT_CONFIG_FILE = path.join(DATA_DIR, "botconfig.json");
const GUILDS_FILE = path.join(DATA_DIR, "guilds.json");
const PREMIUM_FILE = path.join(DATA_DIR, "premium.json");
const PREMIUM_KEYS_FILE = path.join(DATA_DIR, "premium_keys.json");
const HWID_COOLDOWN_FILE = path.join(DATA_DIR, "hwid_cooldowns.json");

const PUBLIC_DIR = path.join(__dirname, "public");

const ADMIN_USER_ID = "1485940617342353594";
const DISCORD_INVITE = "https://discord.gg/QgubzPzzy";
const BOT_INVITE = "https://discord.com/oauth2/authorize?client_id=1545625902585487370&permissions=2952873984&integration_type=0&scope=bot";
const PREMIUM_PRICE_IDR = "Rp 20.000";
const PREMIUM_PRICE_USD = "$2";
const SCRIPT_LIMIT = { free: 2, premium: 5 };

fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");
if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, "[]", "utf8");
if (!fs.existsSync(BOT_CONFIG_FILE)) fs.writeFileSync(BOT_CONFIG_FILE, "{}", "utf8");
if (!fs.existsSync(GUILDS_FILE)) fs.writeFileSync(GUILDS_FILE, "[]", "utf8");
if (!fs.existsSync(PREMIUM_FILE)) fs.writeFileSync(PREMIUM_FILE, "{}", "utf8");
if (!fs.existsSync(PREMIUM_KEYS_FILE)) fs.writeFileSync(PREMIUM_KEYS_FILE, "[]", "utf8");
if (!fs.existsSync(HWID_COOLDOWN_FILE)) fs.writeFileSync(HWID_COOLDOWN_FILE, "{}", "utf8");

app.use(express.json({ limit: "15mb" }));

// ==================== STATIC FILES ====================
app.use(express.static(PUBLIC_DIR, {
  maxAge: "7d",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".webmanifest")) {
      res.setHeader("Content-Type", "application/manifest+json");
    }
  },
}));

const faviconFallbacks = [
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "apple-touch-icon.png",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "site.webmanifest",
];
for (const file of faviconFallbacks) {
  app.get(`/${file}`, (req, res) => {
    const inPublic = path.join(PUBLIC_DIR, file);
    const inRoot = path.join(__dirname, file);
    if (fs.existsSync(inPublic)) return res.sendFile(inPublic);
    if (fs.existsSync(inRoot)) {
      if (file.endsWith(".webmanifest")) {
        res.setHeader("Content-Type", "application/manifest+json");
      }
      return res.sendFile(inRoot);
    }
    return res.status(404).send("Not found");
  });
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || "kingmor-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1545625902585487370";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "REPLACE_WITH_CLIENT_SECRET";
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "http://localhost:3000/auth/discord/callback";

const API_SECRET = process.env.API_SECRET;

if (!API_SECRET) {
  console.error("❌ FATAL: env var API_SECRET is not set!");
  process.exit(1);
}

// ==================== DATA HELPERS ====================
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function readDB() { return readJSON(DB_FILE, []); }
function writeDB(data) { writeJSON(DB_FILE, data); }
function readKeys() { return readJSON(KEYS_FILE, []); }
function writeKeys(data) { writeJSON(KEYS_FILE, data); }
function readBotConfig() { return readJSON(BOT_CONFIG_FILE, {}); }
function writeBotConfig(data) { writeJSON(BOT_CONFIG_FILE, data); }
function readPremium() { return readJSON(PREMIUM_FILE, {}); }
function writePremium(data) { writeJSON(PREMIUM_FILE, data); }
function readPremiumKeys() { return readJSON(PREMIUM_KEYS_FILE, []); }
function writePremiumKeys(data) { writeJSON(PREMIUM_KEYS_FILE, data); }
function readCooldowns() { return readJSON(HWID_COOLDOWN_FILE, {}); }
function writeCooldowns(data) { writeJSON(HWID_COOLDOWN_FILE, data); }

function isPremium(userId) {
  const p = readPremium();
  const entry = p[String(userId)];
  if (!entry) return false;
  if (entry.expiry && new Date(entry.expiry) < new Date()) return false;
  return true;
}
function scriptLimitFor(userId) {
  return isPremium(userId) ? SCRIPT_LIMIT.premium : SCRIPT_LIMIT.free;
}
function generateId() {
  return crypto.randomBytes(7).toString("hex");
}
function generatePremiumKey() {
  const part = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return `KINGMOR-${part()}-${part()}-${part()}`;
}
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function fmtDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function getBaseUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${protocol}://${req.get("host")}`;
}
function checkApiSecret(req) {
  const provided = req.headers["x-api-secret"];
  if (!provided || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(API_SECRET);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect("/login");
  next();
}
function isAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.id !== ADMIN_USER_ID) {
    return res.status(403).send("Forbidden");
  }
  next();
}
function requireInternalSecret(req, res, next) {
  if (!checkApiSecret(req)) {
    console.warn(`⚠️  Internal API rejected: bad/missing x-api-secret on ${req.method} ${req.originalUrl} from ${req.ip}`);
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// ==================== UI KIT ====================
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Sora:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;

const FAVICON = `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" href="/favicon.ico">
<link rel="manifest" href="/site.webmanifest">`;

const CSS = `
:root{--bg:#0a0908;--panel:#14110e;--panel2:#1a1612;--line:#2b241c;--line2:#3d3226;--gold:#f2c14e;--amber:#e08a00;--ink:#f6f0e4;--mute:#a39786;--ok:#6fdc8c;--bad:#ff6b5e;--mono:'JetBrains Mono','Courier New',monospace}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Sora','Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6;min-height:100vh;
background-image:radial-gradient(900px 520px at 88% -8%,rgba(242,193,78,.11),transparent 60%),radial-gradient(700px 420px at -10% 35%,rgba(224,138,0,.06),transparent 60%);background-repeat:no-repeat}
a{color:inherit;text-decoration:none}
button,input,textarea{font-family:inherit}
:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.wrap{width:min(1120px,calc(100% - 32px));margin:0 auto}

.nav{position:sticky;top:0;z-index:50;background:rgba(10,9,8,.82);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.nav-in{display:flex;align-items:center;gap:24px;height:64px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;letter-spacing:-.2px}
.brand i{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-style:normal;font-size:17px;background:linear-gradient(135deg,var(--gold),var(--amber));color:#1a1100}
.nav-links{display:flex;gap:4px;margin-left:12px;flex:1}
.nav-links a{padding:8px 14px;border-radius:8px;font-size:14px;color:var(--mute);font-weight:500;transition:color .15s,background .15s}
.nav-links a:hover{color:var(--ink);background:rgba(255,255,255,.04)}
.nav-links a.on{color:var(--gold)}
.nav-right{display:flex;align-items:center;gap:10px}
.avatar{width:32px;height:32px;border-radius:50%;border:2px solid var(--line2)}
.burger{display:none;background:none;border:1px solid var(--line2);color:var(--ink);width:40px;height:40px;border-radius:10px;font-size:18px;cursor:pointer}
@media(max-width:860px){
 .burger{display:block;margin-left:auto}
 .nav-links{display:none;position:absolute;top:64px;left:0;right:0;flex-direction:column;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px 16px;margin:0}
 .nav-links.open{display:flex}
 .nav-right .uname{display:none}
 .nav-right{margin-left:0}
}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 20px;border-radius:10px;font-weight:700;font-size:14px;border:1px solid transparent;cursor:pointer;transition:transform .15s,filter .15s,background .15s;white-space:nowrap}
.btn:hover{transform:translateY(-1px)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-gold{background:linear-gradient(135deg,var(--gold),var(--amber));color:#1a1100}
.btn-gold:hover{filter:brightness(1.08)}
.btn-ghost{background:transparent;border-color:var(--line2);color:var(--ink)}
.btn-ghost:hover{background:rgba(255,255,255,.04)}
.btn-discord{background:#5865F2;color:#fff}
.btn-sm{padding:8px 14px;font-size:13px}
.btn-block{width:100%}
.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700}
.badge.prem{background:linear-gradient(135deg,var(--gold),var(--amber));color:#1a1100}
.badge.free{background:rgba(255,255,255,.06);border:1px solid var(--line2);color:var(--mute)}

.hero{padding:84px 0 64px;display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center}
.hero h1{font-size:clamp(34px,5vw,58px);line-height:1.08;letter-spacing:-1.6px;font-weight:800}
.hero h1 em{font-style:normal;background:linear-gradient(135deg,var(--gold),var(--amber));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p.lead{margin-top:20px;color:var(--mute);font-size:17px;max-width:520px}
.hero-cta{margin-top:30px;display:flex;gap:12px;flex-wrap:wrap}
.hero-stats{margin-top:38px;display:flex;gap:34px;flex-wrap:wrap}
.hero-stats b{display:block;font-size:26px;letter-spacing:-.5px}
.hero-stats span{font-size:13px;color:var(--mute)}
@media(max-width:860px){.hero{grid-template-columns:1fr;padding:48px 0 40px;gap:36px}}

.term{border:1px solid var(--line2);border-radius:16px;background:#0e0c0a;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(242,193,78,.05);overflow:hidden}
.term-bar{display:flex;align-items:center;gap:7px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--panel)}
.term-bar s{width:10px;height:10px;border-radius:50%;background:var(--line2);text-decoration:none}
.term-bar span{margin-left:8px;font-size:12px;color:var(--mute);font-family:var(--mono)}
.term-body{padding:20px 18px;font-family:var(--mono);font-size:12.5px;line-height:1.9;overflow-x:auto}
.term-body .c{color:#6e6355}
.term-body .k{color:var(--gold)}
.term-body .s{color:#9fd3a8;white-space:pre-wrap;word-break:break-all}
.term-body .ok{color:var(--ok)}
.term-body .ln{display:block;opacity:0;animation:ln .35s forwards}
.term-body .ln:nth-child(1){animation-delay:.2s}.term-body .ln:nth-child(2){animation-delay:.5s}.term-body .ln:nth-child(3){animation-delay:.8s}
.term-body .ln:nth-child(4){animation-delay:1.3s}.term-body .ln:nth-child(5){animation-delay:1.7s}.term-body .ln:nth-child(6){animation-delay:2.1s}.term-body .ln:nth-child(7){animation-delay:2.5s}
@keyframes ln{to{opacity:1}}

.section{padding:72px 0;border-top:1px solid var(--line)}
.section h2{font-size:clamp(26px,3.4vw,38px);letter-spacing:-1px;line-height:1.15;font-weight:800}
.section .sub{color:var(--mute);margin-top:12px;max-width:560px}
.split{display:grid;grid-template-columns:.8fr 1.2fr;gap:56px}
@media(max-width:860px){.split{grid-template-columns:1fr;gap:28px}}
.rows>div{padding:20px 0;border-bottom:1px solid var(--line)}
.rows>div:first-child{padding-top:0}
.rows h3{font-size:16px;font-weight:700}
.rows p{color:var(--mute);font-size:14px;margin-top:4px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:36px;counter-reset:s}
.steps>div{padding:24px;border:1px solid var(--line);border-radius:14px;background:var(--panel);counter-increment:s}
.steps>div::before{content:counter(s);display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--amber));color:#1a1100;font-weight:800;font-size:14px;margin-bottom:14px}
.steps h3{font-size:16px}.steps p{color:var(--mute);font-size:14px;margin-top:6px}
@media(max-width:860px){.steps{grid-template-columns:1fr}}
.cta-band{margin:0 0 72px;padding:44px 32px;border-radius:20px;border:1px solid rgba(242,193,78,.3);background:linear-gradient(135deg,rgba(242,193,78,.12),rgba(224,138,0,.04));display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.cta-band h2{font-size:26px;letter-spacing:-.6px}
.cta-band p{color:var(--mute);margin-top:6px}

.page-head{padding:64px 0 28px}
.page-head h1{font-size:clamp(30px,4.4vw,46px);letter-spacing:-1.2px;font-weight:800}
.page-head p{color:var(--mute);margin-top:10px;max-width:560px}
.plans{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:28px}
@media(max-width:760px){.plans{grid-template-columns:1fr}}
.plan{padding:30px;border-radius:18px;border:1px solid var(--line);background:var(--panel);position:relative}
.plan.prem{border-color:rgba(242,193,78,.55);background:linear-gradient(160deg,#211a0c,#120f0a);box-shadow:0 0 60px rgba(242,193,78,.08)}
.plan h3{font-size:20px;display:flex;align-items:center;gap:10px}
.price{margin:14px 0 4px;font-size:34px;font-weight:800;letter-spacing:-1px}
.price small{font-size:14px;color:var(--mute);font-weight:500;letter-spacing:0}
.plan .note{color:var(--mute);font-size:13px;min-height:20px}
.plan ul{list-style:none;margin:22px 0 26px}
.plan li{padding:9px 0 9px 28px;position:relative;font-size:14px;border-bottom:1px solid rgba(255,255,255,.05)}
.plan li:last-child{border-bottom:none}
.plan li::before{content:"✓";position:absolute;left:0;color:var(--ok);font-weight:800}
.plan li.no{color:var(--mute)}
.plan li.no::before{content:"✕";color:var(--bad)}
.plan code{font-family:var(--mono);font-size:12px;background:rgba(242,193,78,.1);border:1px solid rgba(242,193,78,.25);color:var(--gold);padding:1px 6px;border-radius:5px}
.buy{margin-top:56px;display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:760px){.buy{grid-template-columns:1fr}}
.box{padding:26px;border:1px solid var(--line);border-radius:16px;background:var(--panel)}
.box h3{font-size:17px;margin-bottom:12px}
.box ol{padding-left:20px;color:var(--mute);font-size:14px}
.box ol li{padding:5px 0}
.box ol b{color:var(--ink)}
.faq details{border-bottom:1px solid var(--line);padding:16px 0}
.faq summary{cursor:pointer;font-weight:600;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq summary::after{content:"+";color:var(--gold);font-size:20px;line-height:1}
.faq details[open] summary::after{content:"–"}
.faq p{color:var(--mute);font-size:14px;margin-top:10px;max-width:680px}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:32px 0 8px}
.stat{padding:18px 20px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
.stat b{display:block;font-size:26px;letter-spacing:-.6px}
.stat span{font-size:13px;color:var(--mute)}
.meter{height:6px;border-radius:99px;background:var(--line);margin-top:10px;overflow:hidden}
.meter i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--amber))}
.h-row{display:flex;align-items:center;gap:14px;margin:44px 0 16px}
.h-row h2{font-size:20px;letter-spacing:-.4px}
.h-row .ln{flex:1;height:1px;background:var(--line)}
.alert{padding:14px 18px;border-radius:12px;border:1px solid rgba(255,107,94,.35);background:rgba(255,107,94,.07);font-size:14px;margin-bottom:16px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.alert.gold{border-color:rgba(242,193,78,.35);background:rgba(242,193,78,.07)}
.form{padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--panel);display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:700px){.form{grid-template-columns:1fr}}
input,textarea{width:100%;border:1px solid var(--line2);border-radius:10px;background:#0e0c0a;color:var(--ink);padding:13px 14px;font-size:14px}
input:focus,textarea:focus{border-color:var(--gold);outline:none}
textarea{grid-column:1/-1;min-height:170px;resize:vertical;font-family:var(--mono);font-size:12.5px}
.file-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.file-row label{cursor:pointer}
.file-row span{color:var(--mute);font-size:13px}
.form .btn{grid-column:1/-1}
input[type=file]{display:none}
.scripts{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.sc{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
.sc:hover{border-color:var(--line2)}
.sc-info{display:flex;align-items:center;gap:12px;min-width:0}
.sc-ic{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(135deg,var(--gold),var(--amber));font-size:20px;flex-shrink:0}
.sc-name{font-weight:700;font-size:15px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-st{font-size:12px;font-weight:600}
.sc-st.on{color:var(--ok)}.sc-st.off{color:var(--bad)}
.sc-up{font-size:11px;color:var(--mute)}
.dots{width:36px;height:36px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--gold);font-size:20px;cursor:pointer}
.menu{display:none;position:absolute;right:12px;top:58px;z-index:20;width:200px;padding:6px;border:1px solid var(--line2);border-radius:12px;background:var(--panel2);box-shadow:0 18px 40px rgba(0,0,0,.6)}
.menu.show{display:block}
.menu button{display:block;width:100%;text-align:left;padding:10px 12px;border:none;border-radius:8px;background:transparent;color:var(--ink);font-size:13px;cursor:pointer}
.menu button:hover{background:rgba(255,255,255,.05);color:var(--gold)}
.menu .del{color:var(--bad)}
.empty{padding:44px 20px;text-align:center;color:var(--mute);border:1px dashed var(--line2);border-radius:16px;font-size:14px}
.modal-bg{display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.72);backdrop-filter:blur(5px);align-items:center;justify-content:center;padding:16px}
.modal-bg.show{display:flex}
.modal{width:100%;max-width:760px;max-height:90vh;overflow-y:auto;padding:26px;border:1px solid var(--line2);border-radius:18px;background:var(--panel)}
.modal h3{font-size:18px;margin-bottom:16px}
.modal label.l{display:block;font-size:12px;color:var(--mute);margin:12px 0 6px}
.modal textarea{min-height:300px}
.modal-act{display:flex;gap:10px;margin-top:16px}
.modal-act .btn{flex:1}

.center{min-height:calc(100vh - 64px);display:grid;place-items:center;padding:32px 0}
.card{width:min(460px,100%);padding:34px 30px;border:1px solid var(--line2);border-radius:20px;background:var(--panel);box-shadow:0 30px 80px rgba(0,0,0,.5)}
.card h1{font-size:26px;letter-spacing:-.8px}
.card p{color:var(--mute);font-size:14px;margin-top:8px}
.card .stack{display:grid;gap:12px;margin-top:22px}
.kv{margin-top:20px;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.kv div{display:flex;justify-content:space-between;gap:12px;padding:11px 14px;font-size:13px;border-bottom:1px solid var(--line)}
.kv div:last-child{border-bottom:none}
.kv span{color:var(--mute)}
.code{margin-top:16px;padding:14px;border:1px solid var(--line2);border-radius:12px;background:#0e0c0a;font-family:var(--mono);font-size:12.5px;color:var(--gold);white-space:pre-wrap;word-break:break-all;text-align:left}
.mono{font-family:var(--mono);letter-spacing:.5px}

.foot{border-top:1px solid var(--line);padding:34px 0;margin-top:20px}
.foot-in{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;color:var(--mute);font-size:13px}
.foot-in nav{display:flex;gap:18px}
.foot-in a:hover{color:var(--gold)}
.toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);opacity:0;z-index:999;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;background:var(--panel2);border:1px solid var(--line2);transition:all .25s;max-width:calc(100% - 32px)}
.toast.show{opacity:1;transform:translate(-50%,0)}
.toast.ok{border-color:rgba(111,220,140,.5)}.toast.err{border-color:rgba(255,107,94,.5)}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.term-body .ln{opacity:1}}
`;

const SHARED_JS = `
function $(i){return document.getElementById(i);}
function toast(msg,type){var t=document.createElement('div');t.className='toast '+(type||'');t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.classList.add('show');},10);setTimeout(function(){t.classList.remove('show');setTimeout(function(){t.remove();},300);},3400);}
function toggleNav(){$('navLinks').classList.toggle('open');}
async function copyText(txt){try{await navigator.clipboard.writeText(txt);toast('Copied to clipboard','ok');}catch(e){toast('Copy failed','err');}}
`;

function page({ req, title, active, body, script, bare }) {
  const user = req.session && req.session.user;
  const prem = user ? isPremium(user.id) : false;
  const link = (href, label, key) => `<a href="${href}"${active === key ? ' class="on"' : ""}>${label}</a>`;
  const right = user
    ? `<span class="badge ${prem ? "prem" : "free"}">${prem ? "👑 Premium" : "Free"}</span>
       <img class="avatar" src="${escapeHtml(user.avatar)}" alt="">
       <span class="uname" style="font-size:13px;font-weight:600">${escapeHtml(user.username)}</span>
       <a class="btn btn-ghost btn-sm" href="/logout">Logout</a>`
    : `<a class="btn btn-gold btn-sm" href="/login">Login with Discord</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="theme-color" content="#0a0908">
${FAVICON}
${FONTS}
<style>${CSS}</style>
</head>
<body>
<header class="nav"><div class="wrap nav-in">
  <a class="brand" href="/"><i>👑</i>Kingmor</a>
  <button class="burger" onclick="toggleNav()" aria-label="Menu">☰</button>
  <nav class="nav-links" id="navLinks">
    ${link("/", "Home", "home")}
    ${link("/#features", "Features", "features")}
    ${link("/pricing", "Pricing", "pricing")}
    ${link("/redeem", "Redeem Key", "redeem")}
    ${link("/dashboard", "Dashboard", "dashboard")}
    <a href="${DISCORD_INVITE}" target="_blank" rel="noopener">Discord</a>
  </nav>
  <div class="nav-right">${right}</div>
</div></header>
${body}
${bare ? "" : `<footer class="foot"><div class="wrap foot-in">
  <span>👑 Kingmor — Lua script protection</span>
  <nav><a href="/pricing">Pricing</a><a href="/redeem">Redeem</a><a href="${BOT_INVITE}" target="_blank" rel="noopener">Invite bot</a><a href="${DISCORD_INVITE}" target="_blank" rel="noopener">Support</a></nav>
</div></footer>`}
<script>${SHARED_JS}${script || ""}</script>
</body>
</html>`;
}

function planCards(currentUser) {
  const prem = currentUser ? isPremium(currentUser.id) : false;
  const freeBtn = currentUser
    ? `<a class="btn btn-ghost btn-block" href="/dashboard">Open dashboard</a>`
    : `<a class="btn btn-ghost btn-block" href="/login">Start free</a>`;
  const premBtn = prem
    ? `<a class="btn btn-gold btn-block" href="/redeem">Extend with a key</a>`
    : `<a class="btn btn-gold btn-block" href="/redeem">Redeem a Premium key</a>`;
  return `
<div class="plans">
  <div class="plan">
    <h3>Free</h3>
    <div class="price">$0 <small>forever</small></div>
    <div class="note">Everything you need to protect your first scripts.</div>
    <ul>
      <li><b>${SCRIPT_LIMIT.free} scripts</b></li>
      <li><b>Lifetime whitelist</b> — no expiry limit</li>
      <li>Key system &amp; HWID lock</li>
      <li><code>/setuppanel</code> up to 2 panels</li>
      <li><code>/genkey</code>, <code>/whitelist</code>, <code>/blacklist</code>, <code>/setwebhook</code></li>
      <li>Self HWID reset (1 day cooldown)</li>
      <li class="no"><code>/freemode</code></li>
      <li class="no"><code>/blacklistrole</code> &amp; <code>/unblacklist role</code></li>
      <li class="no"><code>/cooldownhwid</code> &amp; <code>/resethwiduser</code></li>
    </ul>
    ${freeBtn}
  </div>
  <div class="plan prem">
    <h3>Premium <span class="badge prem">👑</span></h3>
    <div class="price">${PREMIUM_PRICE_IDR} <small>/ ${PREMIUM_PRICE_USD}</small></div>
    <div class="note">Key duration depends on the key you buy (up to lifetime).</div>
    <ul>
      <li><b>Everything in Free</b></li>
      <li><b>${SCRIPT_LIMIT.premium} scripts</b></li>
      <li><code>/setuppanel</code> up to 5 panels</li>
      <li><code>/freemode</code> — let anyone run a script without a key</li>
      <li><code>/blacklistrole</code> &amp; <code>/unblacklist role</code></li>
      <li><code>/cooldownhwid</code> — custom HWID reset cooldown</li>
      <li><code>/resethwiduser</code> — reset HWID for any user</li>
      <li>Priority support on Discord</li>
    </ul>
    ${premBtn}
  </div>
</div>`;
}

// ==================== AUTH ====================
app.get("/login", (req, res) => {
  if (req.session && req.session.user) return res.redirect("/dashboard");
  res.send(page({
    req, title: "Kingmor — Login", active: "", bare: true,
    body: `<main class="wrap center"><div class="card" style="text-align:center">
      <div class="brand" style="justify-content:center;margin-bottom:18px"><i>👑</i>Kingmor</div>
      <h1>Log in to Kingmor</h1>
      <p>Use your Discord account to manage and protect your Lua scripts.</p>
      <div class="stack">
        <a class="btn btn-discord btn-block" href="/auth/discord">Login with Discord</a>
        <a class="btn btn-ghost btn-block" href="${DISCORD_INVITE}" target="_blank" rel="noopener">Join our Discord server</a>
        <a class="btn btn-ghost btn-block" href="${BOT_INVITE}" target="_blank" rel="noopener">Invite the bot to your server</a>
      </div>
    </div></main>`,
  }));
});

app.get("/auth/discord", (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/login");
  try {
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const { access_token } = tokenRes.data;
    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const discordUser = userRes.data;
    req.session.user = {
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
    };
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Discord OAuth error:", err?.response?.data || err.message);
    res.redirect("/login?error=1");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ==================== API SCRIPTS ====================

app.get("/api/scripts", requireAuth, (req, res) => {
  const db = readDB();
  const userId = req.session.user.id;
  res.json(
    db
      .filter((s) => s.ownerId === userId)
      .map((s) => ({ id: s.id, name: s.name, enabled: s.enabled, createdAt: s.createdAt }))
  );
});

app.get("/api/scripts/internal", requireInternalSecret, (req, res) => {
  const db = readDB();
  const ownerId = req.query.ownerId;
  const filtered = ownerId ? db.filter((s) => String(s.ownerId) === String(ownerId)) : db;
  res.json(
    filtered.map((s) => ({
      id: s.id, name: s.name, enabled: s.enabled,
      ownerId: s.ownerId, ownerUsername: s.ownerUsername, guildId: s.guildId,
    }))
  );
});

app.get("/api/scripts/internal/:id", requireInternalSecret, (req, res) => {
  const db = readDB();
  const script = db.find((s) => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });
  res.json({
    id: script.id, name: script.name, enabled: script.enabled,
    ownerId: script.ownerId, ownerUsername: script.ownerUsername, guildId: script.guildId,
  });
});

// User lihat source script miliknya sendiri
app.get("/api/scripts/:id/source", requireAuth, (req, res) => {
  const db = readDB();
  const script = db.find((s) => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });
  if (script.ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  const filepath = path.join(SCRIPTS_DIR, script.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Source file missing" });
  res.json({
    id: script.id,
    name: script.name,
    enabled: script.enabled,
    source: fs.readFileSync(filepath, "utf8"),
  });
});

// ⭐ NEW: Admin bisa lihat source asli script milik user manapun
app.get("/api/scripts/:id/source/admin", requireInternalSecret, (req, res) => {
  const requesterId = req.headers["x-requester-id"];
  if (String(requesterId) !== ADMIN_USER_ID) {
    return res.status(403).json({ error: "Forbidden - Admin only" });
  }
  const db = readDB();
  const script = db.find((s) => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });
  const filepath = path.join(SCRIPTS_DIR, script.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: "Source file missing" });
  res.json({
    id: script.id,
    name: script.name,
    ownerId: script.ownerId,
    ownerUsername: script.ownerUsername,
    enabled: script.enabled,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
    source: fs.readFileSync(filepath, "utf8"),
  });
});

app.post("/api/scripts", requireAuth, (req, res) => {
  const { name, source, guildId } = req.body;
  if (!name || typeof name !== "string") return res.status(400).json({ error: "Script name is required" });
  if (!source || typeof source !== "string") return res.status(400).json({ error: "Lua source is required" });
  if (source.length > 10 * 1024 * 1024) return res.status(413).json({ error: "File too large. Maximum 10MB." });

  const userId = String(req.session.user.id);
  const db = readDB();
  const owned = db.filter((s) => String(s.ownerId) === userId).length;
  const premium = isPremium(userId);
  const limit = premium ? SCRIPT_LIMIT.premium : SCRIPT_LIMIT.free;
  if (owned >= limit) {
    return res.status(403).json({
      error: premium
        ? `Script limit reached (${owned}/${limit}). Delete a script to upload a new one.`
        : `Free plan allows ${limit} scripts (${owned}/${limit}). Redeem a Premium key to get ${SCRIPT_LIMIT.premium}.`,
      limitReached: true, count: owned, limit, premium,
    });
  }

  const id = generateId();
  const filename = `${id}.lua`;
  fs.writeFileSync(path.join(SCRIPTS_DIR, filename), source, "utf8");

  const script = {
    id, name: name.trim().slice(0, 100), filename, enabled: true,
    ownerId: userId, ownerUsername: req.session.user.username,
    guildId: guildId || null, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.push(script);
  writeDB(db);

  console.log(`✅ Script created: "${script.name}" (${script.id}) by ${script.ownerId}`);

  const base = getBaseUrl(req);
  res.json({
    success: true,
    script: { id: script.id, name: script.name, enabled: script.enabled, createdAt: script.createdAt },
    loader: `${base}/api/loader/${id}.lua`,
  });
});

app.put("/api/scripts/:id", requireAuth, (req, res) => {
  const { name, source } = req.body;
  const db = readDB();
  const script = db.find((x) => x.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });
  if (script.ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Script name cannot be empty" });
    }
    script.name = name.trim().slice(0, 100);
  }

  if (source !== undefined) {
    if (typeof source !== "string" || !source.trim()) {
      return res.status(400).json({ error: "Lua source cannot be empty" });
    }
    if (source.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: "File too large. Maximum 10MB." });
    }
    const filepath = path.join(SCRIPTS_DIR, script.filename);
    fs.writeFileSync(filepath, source, "utf8");
  }

  script.updatedAt = new Date().toISOString();
  writeDB(db);

  console.log(`✏️  Script updated: "${script.name}" (${script.id}) by ${script.ownerId}`);

  res.json({
    success: true,
    script: { id: script.id, name: script.name, enabled: script.enabled, updatedAt: script.updatedAt },
  });
});

app.post("/api/scripts/:id/toggle", requireAuth, (req, res) => {
  const db = readDB();
  const script = db.find((x) => x.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });
  if (script.ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  script.enabled = !script.enabled;
  writeDB(db);
  res.json({ success: true, enabled: script.enabled });
});

app.delete("/api/scripts/:id", requireAuth, (req, res) => {
  const db = readDB();
  const index = db.findIndex((x) => x.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Script not found" });
  if (db[index].ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  const script = db[index];
  const filepath = path.join(SCRIPTS_DIR, script.filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  db.splice(index, 1);
  writeDB(db);
  res.json({ success: true });
});

app.delete("/api/scripts/internal/:id", requireInternalSecret, (req, res) => {
  const requestOwnerId = req.headers["x-owner-id"];
  if (!requestOwnerId) return res.status(400).json({ error: "x-owner-id header required" });
  const db = readDB();
  const index = db.findIndex((x) => x.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Script not found" });
  if (String(db[index].ownerId) !== String(requestOwnerId)) return res.status(403).json({ error: "You do not own this script" });
  const script = db[index];
  const filepath = path.join(SCRIPTS_DIR, script.filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  db.splice(index, 1);
  writeDB(db);
  res.json({ success: true, name: script.name });
});

// ==================== PANEL LIMIT CHECK ====================
app.get("/api/panels/count", requireInternalSecret, (req, res) => {
  const ownerId = req.query.ownerId;
  if (!ownerId) return res.status(400).json({ error: "ownerId required" });
  const botConfig = readBotConfig();
  let count = 0;
  for (const guildId of Object.keys(botConfig)) {
    const g = botConfig[guildId];
    if (g && String(g.panelOwnerId) === String(ownerId) && g.panelScriptId) {
      count++;
    }
  }
  const premium = isPremium(ownerId);
  const max = premium ? 5 : 2;
  res.json({
    count, max, premium,
    remaining: Math.max(0, max - count),
    canCreate: count < max,
  });
});

// ==================== PREMIUM API ====================

app.get("/api/premium/status", requireInternalSecret, (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "userId required" });
  const premium = isPremium(userId);
  const p = readPremium();
  const entry = p[String(userId)] || null;
  res.json({
    premium,
    expiry: entry?.expiry || null,
    since: entry?.since || null,
  });
});

app.post("/api/premium/set", requireInternalSecret, (req, res) => {
  const { userId, expiry, remove } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  const p = readPremium();
  if (remove) {
    delete p[String(userId)];
    writePremium(p);
    return res.json({ success: true, removed: true });
  }
  p[String(userId)] = {
    expiry: expiry || null,
    since: p[String(userId)]?.since || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writePremium(p);
  res.json({ success: true, premium: true, expiry });
});

app.get("/api/premium/info", (req, res) => {
  res.json({
    priceIDR: PREMIUM_PRICE_IDR,
    priceUSD: PREMIUM_PRICE_USD,
    discord: DISCORD_INVITE,
  });
});

app.post("/api/premiumkey/create", requireInternalSecret, (req, res) => {
  const { durationMs, amount, createdBy } = req.body;
  const isLifetime = durationMs === null || durationMs === undefined;
  if (!isLifetime && (typeof durationMs !== "number" || durationMs < 60 * 1000)) {
    return res.status(400).json({ error: "durationMs must be null (lifetime) or a number >= 60000" });
  }
  const n = Math.min(Math.max(parseInt(amount, 10) || 1, 1), 50);
  const all = readPremiumKeys();
  const created = [];
  for (let i = 0; i < n; i++) {
    let key;
    do { key = generatePremiumKey(); } while (all.some((k) => k.key === key));
    all.push({
      key,
      durationMs: isLifetime ? null : durationMs,
      createdBy: createdBy ? String(createdBy) : null,
      createdAt: new Date().toISOString(),
      redeemedBy: null,
      redeemedAt: null,
    });
    created.push(key);
  }
  writePremiumKeys(all);
  res.json({ success: true, keys: created, lifetime: isLifetime, durationMs: isLifetime ? null : durationMs });
});

const redeemAttempts = new Map();
app.post("/api/premium/redeem", requireAuth, (req, res) => {
  const user = req.session.user;
  const userId = String(user.id);
  const now = Date.now();

  let rec = redeemAttempts.get(userId);
  if (!rec || now > rec.reset) rec = { count: 0, reset: now + 10 * 60 * 1000 };
  if (rec.count >= 10) {
    redeemAttempts.set(userId, rec);
    return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  }

  const raw = typeof req.body.key === "string" ? req.body.key.trim().toUpperCase() : "";
  const fail = (status, error) => {
    rec.count++;
    redeemAttempts.set(userId, rec);
    return res.status(status).json({ error });
  };

  if (!/^KINGMOR-[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/.test(raw)) {
    return fail(400, "Invalid key format. Premium keys look like KINGMOR-XXXXXX-XXXXXX-XXXXXX.");
  }

  const keys = readPremiumKeys();
  const entry = keys.find((k) => k.key === raw);
  if (!entry) return fail(404, "Key not found.");
  if (entry.redeemedBy) return fail(409, "This key has already been redeemed.");

  const p = readPremium();
  const existing = p[userId];
  let newExpiry;
  if (entry.durationMs === null) {
    newExpiry = null;
  } else if (existing && !existing.expiry) {
    newExpiry = null;
  } else {
    const current = existing && existing.expiry ? new Date(existing.expiry).getTime() : 0;
    const base = current > now ? current : now;
    newExpiry = new Date(base + entry.durationMs).toISOString();
  }

  p[userId] = {
    expiry: newExpiry,
    since: existing?.since || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    via: "key",
  };
  writePremium(p);

  entry.redeemedBy = userId;
  entry.redeemedByUsername = user.username;
  entry.redeemedAt = new Date().toISOString();
  writePremiumKeys(keys);

  console.log(`👑 Premium key redeemed by ${userId} (${user.username}) → expiry: ${newExpiry || "lifetime"}`);
  res.json({ success: true, expiry: newExpiry, lifetime: newExpiry === null });
});

// ==================== HWID COOLDOWN API ====================

app.get("/api/cooldown/:scriptId", requireInternalSecret, (req, res) => {
  const cooldowns = readCooldowns();
  const entry = cooldowns[req.params.scriptId] || {};
  res.json({
    cooldownMs: entry.cooldownMs || 24 * 60 * 60 * 1000,
    default: !entry.cooldownMs,
  });
});

app.post("/api/cooldown/set", requireInternalSecret, (req, res) => {
  const { scriptId, userId, cooldownMs } = req.body;
  if (!scriptId || !userId) return res.status(400).json({ error: "scriptId and userId required" });
  if (!isPremium(userId)) return res.status(403).json({ error: "Premium required", premium: false });
  if (typeof cooldownMs !== "number" || cooldownMs < 60 * 1000) {
    return res.status(400).json({ error: "cooldownMs must be a number >= 60000 (1 minute)" });
  }
  const cooldowns = readCooldowns();
  cooldowns[scriptId] = {
    cooldownMs,
    setBy: String(userId),
    updatedAt: new Date().toISOString(),
  };
  writeCooldowns(cooldowns);
  res.json({ success: true, cooldownMs });
});

app.post("/api/hwid/reset-self", requireInternalSecret, (req, res) => {
  const { userId, scriptId } = req.body;
  if (!userId || !scriptId) return res.status(400).json({ error: "userId and scriptId required" });

  const cooldowns = readCooldowns();
  const entry = cooldowns[scriptId] || {};
  const cooldownMs = entry.cooldownMs || 24 * 60 * 60 * 1000;

  const keys = readKeys();
  const userKey = keys.find(k => String(k.userId) === String(userId) && k.scriptId === scriptId);
  if (!userKey) return res.status(404).json({ error: "No key found for this script" });

  const lastReset = userKey.lastHwidReset ? new Date(userKey.lastHwidReset).getTime() : 0;
  const now = Date.now();
  const elapsed = now - lastReset;

  if (lastReset && elapsed < cooldownMs) {
    return res.json({ success: false, cooldown: true, remainingMs: cooldownMs - elapsed, cooldownMs });
  }

  if (!userKey.hwid) {
    return res.json({ success: false, reason: "No HWID registered" });
  }

  userKey.hwid = null;
  userKey.lastHwidReset = new Date().toISOString();
  writeKeys(keys);

  res.json({ success: true, cooldownMs, nextResetAt: new Date(now + cooldownMs).toISOString() });
});

// ==================== HWID ENDPOINTS ====================

app.get("/api/hwid/check", (req, res) => {
  const { scriptId, key, hwid } = req.query;

  if (!scriptId || !hwid) {
    return res.type("application/json").json({ valid: false, reason: "Missing params" });
  }

  const botConfig = readBotConfig();
  const isFreeMode = !!(botConfig[req.query.guildId]?.freeMode?.[scriptId]) ||
    Object.values(botConfig).some(g => g?.freeMode?.[scriptId] === true);

  if (isFreeMode) {
    triggerWebhookAsync({ scriptId, key: null, hwid, userId: null, username: null });
    return res.json({ valid: true, freeMode: true });
  }

  if (!key) {
    return res.json({ valid: false, reason: "No Key Provided" });
  }

  const keys = readKeys();
  const keyData = keys.find(k => k.key === key.toLowerCase().trim() && k.scriptId === scriptId);

  if (!keyData) return res.json({ valid: false, reason: "Invalid Key" });
  if (keyData.expiry && new Date(keyData.expiry) < new Date()) {
    return res.json({ valid: false, reason: "Key Expired" });
  }

  if (!keyData.hwid) {
    keyData.hwid = hwid;
    writeKeys(keys);
    triggerWebhookAsync({ scriptId, key: keyData.key, hwid, userId: keyData.userId, username: keyData.username });
    return res.json({ valid: true, bound: true });
  }

  if (keyData.hwid !== hwid) {
    return res.json({ valid: false, reason: "HWID Mismatch - Contact Admin" });
  }

  triggerWebhookAsync({ scriptId, key: keyData.key, hwid, userId: keyData.userId, username: keyData.username });
  return res.json({ valid: true });
});

app.post("/api/hwid/reset", requireInternalSecret, (req, res) => {
  const { userId, scriptId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const keys = readKeys();
  let resetCount = 0;

  const updated = keys.map(k => {
    const isOwner = String(k.userId) === String(userId);
    const isScript = scriptId ? k.scriptId === scriptId : true;
    if (isOwner && isScript && k.hwid) {
      resetCount++;
      return { ...k, hwid: null, lastHwidReset: new Date().toISOString() };
    }
    return k;
  });

  writeKeys(updated);
  res.json({ success: true, resetCount });
});

// ==================== WEBHOOK ENDPOINTS ====================

async function triggerWebhookAsync({ scriptId, key, hwid, userId, username }) {
  try {
    const botConfig = readBotConfig();
    const webhookUrl = botConfig.webhooks?.[scriptId];
    if (!webhookUrl) return;

    const db = readDB();
    const script = db.find(s => s.id === scriptId);
    const scriptName = script ? script.name : scriptId;
    const userField = userId ? `<@${userId}>` : (username || "Unknown");

    await axios.post(webhookUrl, {
      embeds: [{
        title: "👑 Script Executed",
        color: 0xFFD700,
        fields: [
          { name: "📜 Script", value: scriptName, inline: false },
          { name: "👤 Discord User", value: userField, inline: true },
          { name: "🔑 Key", value: key ? `\`${key}\`` : "Free Mode", inline: true },
          { name: "🖥️ HWID", value: hwid || "Not provided", inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Kingmor 👑" },
      }]
    }, { timeout: 5000 });
  } catch (err) {
    console.error(`❌ Webhook trigger error (script: ${scriptId}): ${err.message}`);
  }
}

app.get("/api/webhook/get", requireInternalSecret, (req, res) => {
  const { scriptId } = req.query;
  if (!scriptId) return res.status(400).json({ error: "scriptId required" });
  const botConfig = readBotConfig();
  res.json({ webhook: botConfig.webhooks?.[scriptId] || null });
});

app.post("/api/webhook/set", requireInternalSecret, (req, res) => {
  const { scriptId, url } = req.body;
  if (!scriptId || !url) return res.status(400).json({ error: "scriptId and url required" });
  const botConfig = readBotConfig();
  if (!botConfig.webhooks) botConfig.webhooks = {};
  botConfig.webhooks[scriptId] = url;
  writeBotConfig(botConfig);
  res.json({ success: true });
});

app.delete("/api/webhook/delete", requireInternalSecret, (req, res) => {
  const { scriptId } = req.body;
  if (!scriptId) return res.status(400).json({ error: "scriptId required" });
  const botConfig = readBotConfig();
  if (botConfig.webhooks?.[scriptId]) {
    delete botConfig.webhooks[scriptId];
    writeBotConfig(botConfig);
  }
  res.json({ success: true });
});

// ==================== LOADER ENDPOINT ====================

app.get("/api/loader/:id.lua", (req, res) => {
  const scriptId = req.params.id;
  const db = readDB();
  const script = db.find((x) => x.id === scriptId);

  if (!script) {
    return res.status(404).type("text/plain").send("-- Kingmor: Script not found");
  }

  const botConfig = readBotConfig();
  const isFreeMode = Object.values(botConfig).some(g => g?.freeMode?.[scriptId] === true);
  const base = getBaseUrl(req);

  function kickPlayer(reason) {
    return `local Players = game:GetService("Players")
local LocalPlayer = Players.LocalPlayer
if LocalPlayer then
    LocalPlayer:Kick("[Kingmor] ${reason}")
end
return`;
  }

  function buildHwidWrapper(sourceCode, keyValue, freeModeFlag) {
    if (freeModeFlag) {
      return `-- Kingmor Protection System
local _km_HttpService = game:GetService("HttpService")
local _km_Players = game:GetService("Players")
local _km_lp = _km_Players.LocalPlayer

local _km_hwid = ""
local _km_ok, _km_id = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)
if _km_ok then _km_hwid = tostring(_km_id) end

pcall(function()
    game:HttpGet("${base}/api/hwid/check?scriptId=${scriptId}&hwid=" .. _km_hwid)
end)

-- User script
${sourceCode}`;
    }

    return `-- Kingmor Protection System
local _km_HttpService = game:GetService("HttpService")
local _km_Players = game:GetService("Players")
local _km_lp = _km_Players.LocalPlayer

local _km_hwid = ""
local _km_ok, _km_id = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)
if _km_ok then _km_hwid = tostring(_km_id) end

local _km_key = "${keyValue}"
local _km_checkUrl = "${base}/api/hwid/check?scriptId=${scriptId}&key=" .. _km_key .. "&hwid=" .. _km_hwid

local _km_success, _km_body = pcall(function()
    return game:HttpGet(_km_checkUrl)
end)

if not _km_success or not _km_body then
    _km_lp:Kick("[Kingmor] HWID Check Failed")
    return
end

local _km_data = _km_HttpService:JSONDecode(_km_body)
if not _km_data or not _km_data.valid then
    local _km_reason = (type(_km_data) == "table" and _km_data.reason) or "Invalid Key"
    _km_lp:Kick("[Kingmor] " .. _km_reason)
    return
end

-- User script
${sourceCode}`;
  }

  const userAgent = req.headers["user-agent"] || "";
  const isRobloxRequest = userAgent.includes("Roblox") || userAgent.includes("Lua")
    || userAgent.includes("Synapse") || userAgent.includes("Krnl")
    || userAgent.includes("Fluxus") || userAgent.includes("Hydrogen")
    || userAgent.includes("ScriptWare") || userAgent.includes("Electron");

  if (isRobloxRequest) {
    if (!script.enabled) {
      return res.status(200).type("text/plain").set("Cache-Control", "no-store")
        .send(kickPlayer("Script Disabled"));
    }

    const fp = path.join(SCRIPTS_DIR, script.filename);
    if (!fs.existsSync(fp)) {
      return res.status(200).type("text/plain").set("Cache-Control", "no-store")
        .send(kickPlayer("Source Missing"));
    }

    const sourceCode = fs.readFileSync(fp, "utf8");

    if (isFreeMode) {
      const wrapped = buildHwidWrapper(sourceCode, "", true);
      return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(wrapped);
    }

    const providedKey = (req.query.key || "").toLowerCase().trim();
    if (!providedKey) {
      return res.status(200).type("text/plain").set("Cache-Control", "no-store")
        .send(kickPlayer("No Key Provided"));
    }

    const allKeys = readKeys();
    const keyData = allKeys.find(k => k.key === providedKey && k.scriptId === scriptId);

    if (!keyData) {
      return res.status(200).type("text/plain").set("Cache-Control", "no-store")
        .send(kickPlayer("Invalid Key"));
    }

    if (keyData.expiry && new Date(keyData.expiry) < new Date()) {
      return res.status(200).type("text/plain").set("Cache-Control", "no-store")
        .send(kickPlayer("Key Expired"));
    }

    const wrapped = buildHwidWrapper(sourceCode, providedKey, false);
    return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(wrapped);
  }

  const uid = req.query.uid || null;
  let userScriptKey = null;
  if (!isFreeMode && uid) {
    const allKeys = readKeys();
    const userKey = allKeys.find(k => String(k.userId) === String(uid) && k.scriptId === scriptId);
    if (userKey) {
      const isExpired = userKey.expiry && new Date(userKey.expiry) < new Date();
      if (!isExpired) userScriptKey = userKey.key;
    }
  }

  const loaderDisplay = isFreeMode
    ? `loadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua"))()`
    : userScriptKey
      ? `script_key = "${userScriptKey}"\nloadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua?key="..script_key))()`
      : `loadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua"))()`;

  return res.status(200).send(page({
    req, title: `Kingmor • ${script.name}`, active: "", bare: true,
    body: `<main class="wrap center"><div class="card" style="text-align:center;width:min(620px,100%)">
      <span class="badge prem">👑 Source protected</span>
      <h1 style="margin-top:14px">${escapeHtml(script.name)}</h1>
      <p>Copy the loader below and run it in your executor.</p>
      <div class="code">${escapeHtml(loaderDisplay)}</div>
      <div class="stack"><button class="btn btn-gold btn-block" onclick="copyText(LOADER)">Copy loader</button></div>
    </div></main>`,
    script: `var LOADER=${JSON.stringify(loaderDisplay)};`,
  }));
});

// ==================== FILES LOADER (redirect) ====================
app.get("/files/loaders/:id.lua", (req, res) => {
  res.redirect(`/api/loader/${req.params.id}.lua`);
});

// ==================== FREEMODE ====================

app.get("/api/freemode/:guildId/:scriptId", requireInternalSecret, (req, res) => {
  const { guildId, scriptId } = req.params;
  const botConfig = readBotConfig();
  res.json({ freeMode: botConfig[guildId]?.freeMode?.[scriptId] === true });
});

app.post("/api/freemode/update", requireInternalSecret, (req, res) => {
  const { guildId, scriptId, enabled } = req.body;
  if (!guildId || !scriptId) return res.status(400).json({ error: "guildId and scriptId are required" });
  const botConfig = readBotConfig();
  if (!botConfig[guildId]) botConfig[guildId] = {};
  if (!botConfig[guildId].freeMode) botConfig[guildId].freeMode = {};
  if (enabled) {
    botConfig[guildId].freeMode[scriptId] = true;
  } else {
    delete botConfig[guildId].freeMode[scriptId];
  }
  writeBotConfig(botConfig);
  res.json({ success: true, freeMode: enabled });
});

// ==================== ADMIN API ====================

app.get("/api/admin/guilds", isAdmin, (req, res) => {
  res.json(readJSON(GUILDS_FILE, []));
});

app.post("/api/admin/guilds/update", requireInternalSecret, (req, res) => {
  const { guilds } = req.body;
  if (!guilds || !Array.isArray(guilds)) return res.status(400).json({ error: "Invalid guilds data" });
  fs.writeFileSync(GUILDS_FILE, JSON.stringify(guilds, null, 2));
  res.json({ success: true });
});

app.get("/api/admin/scripts", isAdmin, (req, res) => {
  const db = readDB();
  res.json(db.map(script => {
    const filepath = path.join(SCRIPTS_DIR, script.filename);
    return { ...script, source: fs.existsSync(filepath) ? fs.readFileSync(filepath, "utf8") : null };
  }));
});

// ⭐ NEW: Admin lihat semua scripts dikelompokkan per user
app.get("/api/admin/users/scripts", isAdmin, (req, res) => {
  const db = readDB();
  const grouped = {};
  for (const s of db) {
    if (!grouped[s.ownerId]) {
      grouped[s.ownerId] = { ownerId: s.ownerId, ownerUsername: s.ownerUsername, scripts: [] };
    }
    grouped[s.ownerId].scripts.push({
      id: s.id, name: s.name, enabled: s.enabled,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    });
  }
  res.json(Object.values(grouped));
});

app.get("/api/admin/premium", isAdmin, (req, res) => {
  res.json(readPremium());
});

app.get("/api/admin/premiumkeys", isAdmin, (req, res) => {
  res.json(readPremiumKeys());
});

// ==================== PUBLIC PAGES ====================

app.get("/", (req, res) => {
  const db = readDB();
  const base = getBaseUrl(req);
  const user = req.session && req.session.user;
  const nScripts = db.length;
  const nUsers = new Set(db.map((s) => s.ownerId)).size;
  const nKeys = readKeys().length;
  const nGuilds = readJSON(GUILDS_FILE, []).length;

  const body = `
<main class="wrap">
  <section class="hero">
    <div>
      <h1>Ship your Lua scripts behind a <em>key and a lock</em>.</h1>
      <p class="lead">Kingmor keeps your source on the server, hands it only to buyers with a valid key, and binds every key to one device. You manage it all from Discord.</p>
      <div class="hero-cta">
        <a class="btn btn-gold" href="${user ? "/dashboard" : "/login"}">${user ? "Open dashboard" : "Get started free"}</a>
        <a class="btn btn-ghost" href="/pricing">See pricing</a>
        <a class="btn btn-discord" href="${BOT_INVITE}" target="_blank" rel="noopener">Invite bot</a>
      </div>
      <div class="hero-stats">
        <div><b>${nScripts}</b><span>scripts protected</span></div>
        <div><b>${nUsers}</b><span>developers</span></div>
        <div><b>${nKeys}</b><span>keys issued</span></div>
        <div><b>${nGuilds}</b><span>Discord servers</span></div>
      </div>
    </div>
    <div class="term" aria-label="Example loader session">
      <div class="term-bar"><s></s><s></s><s></s><span>executor</span></div>
      <div class="term-body">
        <span class="ln"><span class="c">-- what your buyer runs</span></span>
        <span class="ln"><span class="k">script_key</span> = <span class="s">"a91f…c0d4"</span></span>
        <span class="ln"><span class="k">loadstring</span>(game:<span class="k">HttpGet</span>(<span class="s">"${escapeHtml(base)}/api/loader/3fa9…e1.lua?key="</span>..script_key))()</span>
        <span class="ln"><span class="c">-- server side</span></span>
        <span class="ln"><span class="ok">✓</span> key valid, not expired</span>
        <span class="ln"><span class="ok">✓</span> HWID matches the bound device</span>
        <span class="ln"><span class="ok">✓</span> source delivered, webhook sent</span>
      </div>
    </div>
  </section>

  <section class="section" id="features">
    <div class="split">
      <div>
        <h2>Everything a script seller needs, nothing they don't.</h2>
        <p class="sub">Upload once on the web, then sell and support from your Discord server.</p>
      </div>
      <div class="rows">
        <div><h3>Source stays on the server</h3><p>Buyers load your script through a protected loader. They never get the raw file.</p></div>
        <div><h3>Keys and HWID lock</h3><p>Every key binds to the first device that uses it. Wrong device, expired key, or no key and the player is kicked.</p></div>
        <div><h3>Discord control panel</h3><p>Post a panel with Redeem Key, Get Script, Get Role, Reset HWID and Stats buttons. Whitelist users or whole roles with a slash command.</p></div>
        <div><h3>Execution webhooks</h3><p>Get a Discord message every time your script runs: who, which key, which device.</p></div>
        <div><h3>Blacklists and free mode</h3><p>Block abusers in one command. Premium can also blacklist roles or open a script to everyone for a launch.</p></div>
        <div><h3>Self-service HWID reset</h3><p>Buyers reset their own device with a cooldown, so you stop answering the same ticket.</p></div>
      </div>
    </div>
  </section>

  <section class="section">
    <h2>From upload to first sale</h2>
    <div class="steps">
      <div><h3>Upload your script</h3><p>Log in with Discord and paste or upload your .lua file. Free accounts can protect ${SCRIPT_LIMIT.free} scripts.</p></div>
      <div><h3>Set up your server</h3><p>Invite the bot, run <span class="mono">/setuppanel</span>, then whitelist buyers or generate keys.</p></div>
      <div><h3>Buyers run the loader</h3><p>They press Get Script on the panel, run the loader, and the key and device checks happen automatically.</p></div>
    </div>
  </section>

  <section class="section" style="border-top:none;padding-top:0">
    <div class="cta-band">
      <div><h2>Need more room?</h2><p>Premium gives you ${SCRIPT_LIMIT.premium} scripts, ${5} panels, free mode and more. Redeem a key in seconds.</p></div>
      <div class="hero-cta" style="margin:0"><a class="btn btn-gold" href="/pricing">Compare plans</a><a class="btn btn-ghost" href="/redeem">Redeem a key</a></div>
    </div>
  </section>
</main>`;
  res.send(page({ req, title: "Kingmor — Lua Protection System", active: "home", body }));
});

app.get("/pricing", (req, res) => {
  const user = req.session && req.session.user;
  const body = `
<main class="wrap">
  <div class="page-head">
    <h1>Pricing</h1>
    <p>Start free. Upgrade when you need more scripts and more control over who can use them.</p>
  </div>
  ${planCards(user)}

  <div class="buy">
    <div class="box">
      <h3>How to get Premium</h3>
      <ol>
        <li>Join the <b>Kingmor Discord</b> server.</li>
        <li>Open a <b>ticket</b> and tell staff you want Premium (${PREMIUM_PRICE_IDR} in Indonesia, ${PREMIUM_PRICE_USD} international).</li>
        <li>Pay with the method staff gives you (QRIS, PayPal, etc.).</li>
        <li>Staff sends you a <b>Premium key</b>.</li>
        <li>Log in here and enter it on the <a href="/redeem" style="color:var(--gold)">Redeem</a> page. Premium turns on instantly.</li>
      </ol>
      <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn btn-discord btn-sm" href="${DISCORD_INVITE}" target="_blank" rel="noopener">Join Discord</a>
        <a class="btn btn-gold btn-sm" href="/redeem">Redeem a key</a>
      </div>
    </div>
    <div class="box faq">
      <h3>Questions</h3>
      <details><summary>Is the lifetime whitelist really free?</summary><p>Yes. Free accounts can whitelist users for any duration, including lifetime. The free limit is on scripts and panels, not on whitelist length.</p></details>
      <details><summary>What happens when Premium expires?</summary><p>Your scripts keep working. You just can't upload new ones above the free limit, create more than 2 panels, or use Premium-only commands until you redeem another key.</p></details>
      <details><summary>Can I stack keys?</summary><p>Yes. Redeeming a key while Premium is active adds its duration to your current expiry. A lifetime key never expires.</p></details>
      <details><summary>Can I share a key?</summary><p>Each Premium key can be redeemed once, by one Discord account.</p></details>
    </div>
  </div>
</main>`;
  res.send(page({ req, title: "Kingmor — Pricing", active: "pricing", body }));
});

// ==================== REDEEM ====================

app.get("/redeem", requireAuth, (req, res) => {
  const user = req.session.user;
  const userId = String(user.id);
  const prem = isPremium(userId);
  const entry = readPremium()[userId];
  const planRow = prem
    ? (entry && entry.expiry ? `Premium until ${fmtDate(entry.expiry)}` : "Premium (lifetime)")
    : (entry && entry.expiry ? `Expired on ${fmtDate(entry.expiry)}` : "Free");

  const body = `
<main class="wrap center"><div class="card">
  <h1>Redeem Premium key</h1>
  <p>Enter the key you received from Kingmor staff. Duration is added to your account right away.</p>
  <div class="kv">
    <div><span>Account</span><b>${escapeHtml(user.username)}</b></div>
    <div><span>Current plan</span><b>${escapeHtml(planRow)}</b></div>
    <div><span>Script slots</span><b>${scriptLimitFor(userId)}</b></div>
  </div>
  <div class="stack">
    <input id="rk" class="mono" placeholder="KINGMOR-XXXXXX-XXXXXX-XXXXXX" autocomplete="off" spellcheck="false">
    <button class="btn btn-gold btn-block" id="rb" onclick="redeem()">Redeem key</button>
    <a class="btn btn-ghost btn-block" href="/pricing">Where do I get a key?</a>
  </div>
</div></main>`;

  const script = `
$('rk').addEventListener('keydown',function(e){if(e.key==='Enter')redeem();});
async function redeem(){
  var key=$('rk').value.trim();
  if(!key){toast('Enter your Premium key','err');return;}
  var b=$('rb');b.disabled=true;b.textContent='Redeeming...';
  try{
    var r=await fetch('/api/premium/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:key})});
    var d=await r.json();
    if(!r.ok){toast(d.error||'Redeem failed','err');b.disabled=false;b.textContent='Redeem key';return;}
    toast(d.lifetime?'Premium activated: lifetime':'Premium activated until '+d.expiry.slice(0,10),'ok');
    setTimeout(function(){location.href='/dashboard';},1400);
  }catch(e){toast('Server error','err');b.disabled=false;b.textContent='Redeem key';}
}`;
  res.send(page({ req, title: "Kingmor — Redeem Premium", active: "redeem", body, script, bare: true }));
});

// ==================== DASHBOARD ====================

app.get("/dashboard", requireAuth, (req, res) => {
  const db = readDB();
  const user = req.session.user;
  const userId = String(user.id);
  const base = getBaseUrl(req);
  const scripts = db.filter((s) => String(s.ownerId) === userId);
  const totalKeys = readKeys().filter((k) => k.createdBy === userId).length;
  const premium = isPremium(userId);
  const pdata = readPremium()[userId] || null;
  const limit = scriptLimitFor(userId);
  const reached = scripts.length >= limit;
  const pct = Math.min(100, Math.round((scripts.length / limit) * 100));
  const planText = premium ? (pdata && pdata.expiry ? `Premium · until ${fmtDate(pdata.expiry)}` : "Premium · lifetime") : "Free plan";

  const cards = scripts.map((s) => {
    const loaderUrl = `${base}/api/loader/${s.id}.lua`;
    const loaderCode = `loadstring(game:HttpGet("${loaderUrl}"))()`;
    const upd = s.updatedAt ? fmtDate(s.updatedAt) : "-";
    return `
<div class="sc">
  <div class="sc-info">
    <div class="sc-ic">👑</div>
    <div>
      <div class="sc-name">${escapeHtml(s.name)}</div>
      <div class="sc-st ${s.enabled ? "on" : "off"}">${s.enabled ? "● Enabled" : "● Disabled"}</div>
      <div class="sc-up">Updated ${escapeHtml(upd)}</div>
    </div>
  </div>
  <button class="dots" onclick="toggleMenu('${s.id}')" aria-label="Script actions">⋮</button>
  <div class="menu" id="menu-${s.id}">
    <button onclick="openEdit('${s.id}')">Edit source</button>
    <button onclick="copyText(${escapeHtml(JSON.stringify(loaderCode))})">Copy loader</button>
    <button onclick="window.open(${escapeHtml(JSON.stringify(loaderUrl))},'_blank')">Open loader page</button>
    <button onclick="toggleScript('${s.id}')">${s.enabled ? "Disable" : "Enable"}</button>
    <button class="del" onclick="deleteScript('${s.id}')">Delete</button>
  </div>
</div>`;
  }).join("");

  const limitAlert = reached
    ? `<div class="alert ${premium ? "" : "gold"}"><span>${premium
        ? `You're using all ${limit} Premium script slots. Delete a script to upload another.`
        : `You're using ${scripts.length}/${limit} free script slots. Redeem a Premium key to get ${SCRIPT_LIMIT.premium}.`}</span>${premium ? "" : `<a class="btn btn-gold btn-sm" href="/redeem">Redeem key</a>`}</div>`
    : "";

  const body = `
<main class="wrap" style="padding-bottom:40px">
  <div class="page-head" style="padding-bottom:0">
    <h1>Dashboard</h1>
    <p>Manage your protected scripts. Use the Discord bot for keys, whitelists and panels.</p>
  </div>

  <div class="stats">
    <div class="stat"><b>${escapeHtml(planText)}</b><span>Your plan</span>${premium ? "" : `<div style="margin-top:10px"><a class="btn btn-gold btn-sm" href="/redeem">Redeem Premium key</a></div>`}</div>
    <div class="stat"><b>${scripts.length} / ${limit}</b><span>Script slots used</span><div class="meter"><i style="width:${pct}%"></i></div></div>
    <div class="stat"><b>${scripts.filter((s) => s.enabled).length}</b><span>Enabled scripts</span></div>
    <div class="stat"><b>${totalKeys}</b><span>Keys you generated</span></div>
  </div>

  <div class="h-row"><h2>Upload a script</h2><div class="ln"></div></div>
  ${limitAlert}
  <section class="form">
    <input id="scriptName" placeholder="Script name">
    <div class="file-row">
      <label class="btn btn-ghost btn-sm" for="fileInput">Choose .lua / .txt file</label>
      <input id="fileInput" type="file" accept=".lua,.txt,text/plain">
      <span id="fileName">No file selected</span>
    </div>
    <textarea id="scriptSource" placeholder="Or paste your Lua source here"></textarea>
    <button class="btn btn-gold" id="upBtn" onclick="uploadScript()" ${reached ? "disabled" : ""}>${reached ? "Script limit reached" : "Protect and upload"}</button>
  </section>

  <div class="h-row"><h2>Your scripts</h2><div class="ln"></div></div>
  <section class="scripts">
    ${cards || `<div class="empty" style="grid-column:1/-1">No scripts yet. Upload your first Lua script above.</div>`}
  </section>
</main>

<div class="modal-bg" id="editModal">
  <div class="modal">
    <h3>Edit script</h3>
    <label class="l" for="editName">Script name</label>
    <input id="editName" placeholder="Script name">
    <label class="l">Source code</label>
    <div class="file-row" style="margin-bottom:10px">
      <label class="btn btn-ghost btn-sm" for="editFileInput">Replace with file</label>
      <input id="editFileInput" type="file" accept=".lua,.txt,text/plain">
      <span id="editFileName">No file selected</span>
    </div>
    <textarea id="editSource" placeholder="Paste your Lua source here"></textarea>
    <div class="modal-act">
      <button class="btn btn-ghost" onclick="closeEdit()">Cancel</button>
      <button class="btn btn-gold" id="editSaveBtn" onclick="saveEdit()">Save changes</button>
    </div>
  </div>
</div>`;

  const script = `
var editingId=null;
var MAX=10*1024*1024;
function readFileInto(input,nameEl,onText){
  var f=input.files[0];if(!f)return;
  var n=f.name.toLowerCase();
  if(!n.endsWith('.lua')&&!n.endsWith('.txt')){toast('Only .lua or .txt files are allowed','err');input.value='';return;}
  if(f.size>MAX){toast('Maximum file size is 10MB','err');input.value='';return;}
  nameEl.textContent=f.name;
  var rd=new FileReader();rd.onload=function(e){onText(e.target.result,f.name);};rd.readAsText(f);
}
$('fileInput').addEventListener('change',function(){
  readFileInto(this,$('fileName'),function(t,n){$('scriptSource').value=t;$('scriptName').value=n.replace(/\\.(lua|txt)$/i,'');});
});
$('editFileInput').addEventListener('change',function(){
  readFileInto(this,$('editFileName'),function(t){$('editSource').value=t;});
});
function toggleMenu(id){
  document.querySelectorAll('.menu').forEach(function(m){if(m.id!=='menu-'+id)m.classList.remove('show');});
  var m=$('menu-'+id);if(m)m.classList.toggle('show');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.menu')&&!e.target.closest('.dots'))document.querySelectorAll('.menu').forEach(function(m){m.classList.remove('show');});
});
async function uploadScript(){
  var name=$('scriptName').value.trim(),source=$('scriptSource').value;
  if(!name){toast('Enter a script name','err');return;}
  if(!source.trim()){toast('Add your Lua source','err');return;}
  var b=$('upBtn');b.disabled=true;b.textContent='Uploading...';
  try{
    var r=await fetch('/api/scripts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,source:source})});
    var d=await r.json();
    if(!r.ok){toast(d.error||'Upload failed','err');b.disabled=false;b.textContent='Protect and upload';return;}
    location.reload();
  }catch(e){toast('Server error','err');b.disabled=false;b.textContent='Protect and upload';}
}
async function toggleScript(id){
  var r=await fetch('/api/scripts/'+id+'/toggle',{method:'POST'});
  if(r.ok)location.reload();else toast('Failed to change status','err');
}
async function deleteScript(id){
  if(!confirm('Delete this script? This cannot be undone.'))return;
  var r=await fetch('/api/scripts/'+id,{method:'DELETE'});
  if(r.ok)location.reload();else toast('Delete failed','err');
}
async function openEdit(id){
  editingId=id;
  $('editFileInput').value='';$('editFileName').textContent='No file selected';
  $('editName').value='Loading...';$('editSource').value='Loading...';
  $('editModal').classList.add('show');
  try{
    var r=await fetch('/api/scripts/'+id+'/source');var d=await r.json();
    if(!r.ok){toast(d.error||'Failed to load script','err');closeEdit();return;}
    $('editName').value=d.name;$('editSource').value=d.source||'';
  }catch(e){toast('Failed to load script source','err');closeEdit();}
}
function closeEdit(){$('editModal').classList.remove('show');editingId=null;}
async function saveEdit(){
  if(!editingId)return;
  var name=$('editName').value.trim(),source=$('editSource').value;
  if(!name){toast('Script name cannot be empty','err');return;}
  if(!source.trim()){toast('Source code cannot be empty','err');return;}
  var b=$('editSaveBtn');b.disabled=true;b.textContent='Saving...';
  try{
    var r=await fetch('/api/scripts/'+editingId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,source:source})});
    var d=await r.json();
    if(!r.ok){toast(d.error||'Failed to save','err');b.disabled=false;b.textContent='Save changes';return;}
    location.reload();
  }catch(e){toast('Server error','err');b.disabled=false;b.textContent='Save changes';}
}
$('editModal').addEventListener('click',function(e){if(e.target.id==='editModal')closeEdit();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&$('editModal').classList.contains('show'))closeEdit();});`;

  res.send(page({ req, title: "Kingmor — Dashboard", active: "dashboard", body, script }));
});

// ==================== ADMIN PAGE ====================

app.get("/admin/dashboard", isAdmin, (req, res) => {
  const db = readDB();
  const keys = readKeys();
  const premium = readPremium();
  const pkeys = readPremiumKeys();

  // Group scripts per user
  const grouped = {};
  for (const s of db) {
    if (!grouped[s.ownerId]) {
      grouped[s.ownerId] = { ownerId: s.ownerId, ownerUsername: s.ownerUsername, scripts: [] };
    }
    grouped[s.ownerId].scripts.push(s);
  }

  const rows = [
    ["Total scripts", db.length],
    ["Total users", new Set(db.map((s) => s.ownerId)).size],
    ["Total keys", keys.length],
    ["Enabled scripts", db.filter((s) => s.enabled).length],
    ["Premium users", Object.keys(premium).filter((id) => isPremium(id)).length],
    ["Premium keys (unused)", pkeys.filter((k) => !k.redeemedBy).length],
    ["Premium keys (redeemed)", pkeys.filter((k) => k.redeemedBy).length],
  ];

  const userBlocks = Object.values(grouped).map(u => {
    const scriptList = u.scripts.map(s => `
      <div style="margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:10px;background:#0e0c0a">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <b>${escapeHtml(s.name)}</b>
          <span style="color:${s.enabled ? "var(--ok)" : "var(--bad)"};font-size:12px">${s.enabled ? "● Enabled" : "● Disabled"}</span>
        </div>
        <div style="font-size:11px;color:var(--mute);font-family:var(--mono);margin-top:4px">ID: ${s.id}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="viewSource('${s.id}')">View source</button>
        <pre id="src-${s.id}" class="code" style="display:none;max-height:400px;overflow:auto;margin-top:10px"></pre>
      </div>
    `).join("");
    return `
      <div style="margin-top:24px;padding:18px;border:1px solid var(--line2);border-radius:14px">
        <h3 style="font-size:15px">👤 ${escapeHtml(u.ownerUsername || "Unknown")} <span style="color:var(--mute);font-size:12px">(${u.ownerId})</span></h3>
        <div style="color:var(--mute);font-size:12px">${u.scripts.length} script(s)</div>
        ${scriptList}
      </div>
    `;
  }).join("");

  const body = `<main class="wrap" style="padding-bottom:40px">
    <div class="page-head">
      <h1>Admin overview</h1>
      <p>Only admin (ID: ${ADMIN_USER_ID}) can access this page.</p>
    </div>
    <div class="stats" style="margin-top:0">
      ${rows.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("")}
    </div>

    <div class="h-row"><h2>All users & scripts</h2><div class="ln"></div></div>
    ${userBlocks || `<div class="empty">No scripts uploaded yet.</div>`}

    <div class="stack" style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap">
      <a class="btn btn-gold" href="/dashboard">Back to dashboard</a>
    </div>
  </main>

  <script>
  async function viewSource(id){
    var pre=document.getElementById('src-'+id);
    if(pre.style.display==='block'){pre.style.display='none';return;}
    pre.style.display='block';
    pre.textContent='Loading...';
    try{
      var r=await fetch('/api/admin/scripts');
      var arr=await r.json();
      var found=arr.find(function(x){return x.id===id});
      pre.textContent=found && found.source ? found.source : '// Source not found';
    }catch(e){pre.textContent='// Failed to load source';}
  }
  </script>`;

  res.send(page({ req, title: "Kingmor — Admin", active: "", body, bare: false }));
});

// ==================== HEALTH CHECK ====================
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log(`Kingmor running on port ${PORT}`);
  console.log(`API_SECRET loaded: ${API_SECRET ? "yes (" + API_SECRET.length + " chars)" : "NO"}`);
  console.log(`Premium price: ${PREMIUM_PRICE_IDR} / ${PREMIUM_PRICE_USD}`);
  console.log(`Script limits: free ${SCRIPT_LIMIT.free}, premium ${SCRIPT_LIMIT.premium}`);
});
