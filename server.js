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
const HWID_COOLDOWN_FILE = path.join(DATA_DIR, "hwid_cooldowns.json");
const PREMIUM_KEYS_FILE = path.join(DATA_DIR, "premium_keys.json");
const BLACKLIST_FILE = path.join(DATA_DIR, "blacklist.json");

const ADMIN_USER_ID = "1485940617342353594";
const DISCORD_INVITE = "https://discord.gg/QgubzPzzy";
const PREMIUM_PRICE_IDR = "Rp 20.000";
const PREMIUM_PRICE_USD = "$2";

fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
const defaults = {
  [DB_FILE]: "[]", [KEYS_FILE]: "[]", [BOT_CONFIG_FILE]: "{}",
  [GUILDS_FILE]: "[]", [PREMIUM_FILE]: "{}", [HWID_COOLDOWN_FILE]: "{}",
  [PREMIUM_KEYS_FILE]: "[]", [BLACKLIST_FILE]: "[]",
};
Object.entries(defaults).forEach(([f, def]) => {
  if (!fs.existsSync(f)) fs.writeFileSync(f, def, "utf8");
});

app.use(express.json({ limit: "15mb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "kingmor-secret-key-change-this",
  resave: false, saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1545625902585487370";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "REPLACE_WITH_CLIENT_SECRET";
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "http://localhost:3000/auth/discord/callback";
const API_SECRET = process.env.API_SECRET;

if (!API_SECRET) { console.error("❌ FATAL: API_SECRET not set!"); process.exit(1); }

// ==================== HELPERS ====================
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
const readDB = () => readJSON(DB_FILE, []);
const writeDB = d => writeJSON(DB_FILE, d);
const readKeys = () => readJSON(KEYS_FILE, []);
const writeKeys = d => writeJSON(KEYS_FILE, d);
const readBotConfig = () => readJSON(BOT_CONFIG_FILE, {});
const writeBotConfig = d => writeJSON(BOT_CONFIG_FILE, d);
const readPremium = () => readJSON(PREMIUM_FILE, {});
const writePremium = d => writeJSON(PREMIUM_FILE, d);
const readCooldowns = () => readJSON(HWID_COOLDOWN_FILE, {});
const writeCooldowns = d => writeJSON(HWID_COOLDOWN_FILE, d);
const readPremiumKeys = () => readJSON(PREMIUM_KEYS_FILE, []);
const writePremiumKeys = d => writeJSON(PREMIUM_KEYS_FILE, d);

function isPremium(userId) {
  const p = readPremium();
  const e = p[String(userId)];
  if (!e) return false;
  if (e.expiry && new Date(e.expiry) < new Date()) return false;
  return true;
}
const generateId = () => crypto.randomBytes(7).toString("hex");

function escapeHtml(v) {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function getBaseUrl(req) {
  const p = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${p}://${req.get("host")}`;
}
function checkApiSecret(req) {
  const provided = req.headers["x-api-secret"];
  if (!provided || typeof provided !== "string") return false;
  const a = Buffer.from(provided), b = Buffer.from(API_SECRET);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
const requireAuth = (req, res, next) => (!req.session?.user ? res.redirect("/login") : next());
const isAdmin = (req, res, next) => (req.session?.user?.id !== ADMIN_USER_ID ? res.status(403).send("Forbidden") : next());
const requireInternalSecret = (req, res, next) => (!checkApiSecret(req) ? res.status(403).json({ error: "Forbidden" }) : next());

// ==================== SHARED CSS ====================
const SHARED_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { min-height: 100vh; font-family: 'Segoe UI', Arial, sans-serif; color: white;
  background: radial-gradient(circle at 10% 0%, rgba(255,200,0,.20), transparent 30%),
              radial-gradient(circle at 90% 100%, rgba(100,100,100,.15), transparent 35%), #0a0a0a; }
body::before { content: ""; position: fixed; top: -50%; left: -50%; width: 200%; height: 200%;
  background: conic-gradient(from 0deg, transparent, rgba(255,200,0,.03), transparent 30%);
  animation: rotate 30s linear infinite; pointer-events: none; z-index: 0; }
@keyframes rotate { to { transform: rotate(360deg); } }
.header { position: relative; z-index: 10; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid rgba(255,200,0,.2);
  background: linear-gradient(90deg, rgba(138,109,0,.95), rgba(255,215,0,.95), rgba(10,10,10,.98));
  flex-wrap: wrap; gap: 12px; backdrop-filter: blur(10px); }
.brand { display: flex; align-items: center; gap: 12px; }
.logo { width: 46px; height: 46px; display: flex; align-items: center; justify-content: center;
  border-radius: 13px; background: #ffd700; color: #0a0a0a; font-size: 25px;
  box-shadow: 0 0 25px rgba(255,200,0,.4); }
.brand h1 { font-size: 22px; font-weight: 900; color: #0a0a0a; letter-spacing: -.5px; }
.brand span { display: block; margin-top: 2px; color: rgba(0,0,0,.65); font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
.user-info { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.user-avatar { width: 36px; height: 36px; border-radius: 50%; border: 2px solid #ffd700; }
.user-name { font-size: 13px; font-weight: 800; color: #0a0a0a; }
.logout-btn { padding: 7px 14px; border: 1px solid rgba(0,0,0,.4); border-radius: 8px;
  background: transparent; color: rgba(0,0,0,.85); font-size: 12px; cursor: pointer; text-decoration: none; font-weight: 800; }
.logout-btn:hover { background: rgba(0,0,0,.1); }
.invite-btn { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px;
  border: none; border-radius: 8px; background: #5865F2; color: white;
  font-size: 12px; font-weight: 800; cursor: pointer; text-decoration: none; }
.invite-btn:hover { filter: brightness(1.1); }
.container { position: relative; z-index: 5; width: min(1150px, calc(100% - 24px)); margin: 28px auto; }
.tier-badge { display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900;
  letter-spacing: .5px; text-transform: uppercase; }
.tier-badge.premium { background: linear-gradient(90deg, #ffd700, #ffed4a);
  color: #0a0a0a; box-shadow: 0 0 20px rgba(255,200,0,.5); animation: shine 2s ease-in-out infinite; }
@keyframes shine { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.2); } }
.tier-badge.free { background: rgba(255,255,255,.08); color: rgba(255,255,255,.65);
  border: 1px solid rgba(255,255,255,.15); }
.section-head { display: flex; align-items: center; gap: 10px; margin: 26px 0 14px; }
.section-head h2 { font-size: 19px; color: #ffd700; font-weight: 900; }
.section-head .line { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(255,200,0,.5), transparent); }
.stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 22px; }
.stat-card { position: relative; padding: 18px 14px; border-radius: 15px;
  background: linear-gradient(145deg, rgba(30,30,30,.95), rgba(15,15,15,.98));
  border: 1px solid rgba(255,200,0,.2); text-align: center; overflow: hidden; }
.stat-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, #ffd700, transparent); }
.stat-card .value { font-size: 28px; font-weight: 900; color: #ffd700; text-shadow: 0 0 20px rgba(255,200,0,.4); }
.stat-card .label { font-size: 11px; color: rgba(255,255,255,.5); margin-top: 5px; letter-spacing: .5px; text-transform: uppercase; font-weight: 700; }
.hero { padding: 26px 24px; border-radius: 20px;
  background: linear-gradient(135deg, rgba(255,200,0,.10), rgba(100,100,100,.05));
  border: 1px solid rgba(255,200,0,.25); position: relative; overflow: hidden; }
.hero::before { content: ""; position: absolute; top: -80px; right: -80px;
  width: 250px; height: 250px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,200,0,.15), transparent 70%); pointer-events: none; }
.hero h2 { font-size: 24px; margin-bottom: 6px; color: #ffd700; font-weight: 900; position: relative; z-index: 1; }
.hero p { color: #aaa; font-size: 13px; position: relative; z-index: 1; }
.form-grid { margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; position: relative; z-index: 1; }
input, textarea { width: 100%; outline: none; border: 1px solid rgba(255,200,0,.2);
  border-radius: 11px; background: #1a1a1a; color: white; padding: 13px; font-family: inherit; font-size: 14px; transition: all .2s; }
input:focus, textarea:focus { border-color: #ffd700; box-shadow: 0 0 0 3px rgba(255,200,0,.15); background: #1c1c1c; }
textarea { grid-column: 1 / -1; min-height: 160px; resize: vertical; font-family: 'Courier New', monospace; font-size: 13px; }
.file-row { display: flex; align-items: center; gap: 10px; grid-column: 1 / -1; flex-wrap: wrap; }
.file-label { display: inline-flex; align-items: center; justify-content: center;
  padding: 12px 18px; border-radius: 11px; background: #ffd700; color: #0a0a0a;
  font-size: 13px; font-weight: 800; cursor: pointer; transition: all .2s; }
.file-label:hover { transform: translateY(-2px); filter: brightness(1.05); }
.file-name { color: #888; font-size: 12px; }
#fileInput, #editFileInput { display: none; }
.upload-button { grid-column: 1 / -1; width: 100%; padding: 15px; border: none; border-radius: 11px;
  background: linear-gradient(90deg, #ffd700, #ffed4a, #ffd700); background-size: 200% auto;
  color: #0a0a0a; font-weight: 900; cursor: pointer; font-size: 14px; transition: all .3s;
  box-shadow: 0 4px 20px rgba(255,200,0,.3); }
.upload-button:hover { transform: translateY(-2px); background-position: right center; box-shadow: 0 8px 30px rgba(255,200,0,.5); }
.scripts { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px,1fr)); gap: 14px; }
.script-card { position: relative; display: flex; align-items: center; justify-content: space-between;
  padding: 16px; border-radius: 16px; background: linear-gradient(145deg, #1a1a1a, #0d0d0d);
  border: 1px solid rgba(255,200,0,.15); transition: all .25s; }
.script-card:hover { border-color: rgba(255,200,0,.5); transform: translateY(-2px); box-shadow: 0 10px 30px rgba(0,0,0,.4); }
.script-info { display: flex; align-items: center; gap: 12px; min-width: 0; }
.script-icon { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  border-radius: 12px; background: linear-gradient(135deg, #ffd700, #ffed4a); font-size: 21px; flex-shrink: 0; }
.script-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 700; }
.script-status { margin-top: 3px; font-size: 11px; font-weight: 800; }
.script-status.on { color: #54ff88; } .script-status.off { color: #ff4d4d; }
.script-updated { margin-top: 2px; font-size: 10px; color: rgba(255,255,255,.35); }
.script-menu { position: relative; flex-shrink: 0; }
.dots { width: 38px; height: 38px; border: none; border-radius: 10px; background: #1c1c1c;
  color: #ffd700; font-size: 22px; cursor: pointer; transition: background .2s; }
.dots:hover { background: #2a2a2a; }
.menu { display: none; position: absolute; z-index: 100; right: 0; top: 45px; width: 200px;
  padding: 6px; border-radius: 12px; background: #1a1a1a;
  border: 1px solid rgba(255,200,0,.25); box-shadow: 0 15px 40px rgba(0,0,0,.7); }
.menu.show { display: block; animation: fadeIn .2s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
.menu button { width: 100%; padding: 10px; border: none; border-radius: 8px;
  background: transparent; color: #eee; text-align: left; cursor: pointer; font-size: 13px; transition: all .15s; }
.menu button:hover { background: #2a2a2a; color: #ffd700; }
.menu .delete { color: #ff4d4d; }
.empty { padding: 60px 20px; text-align: center; color: #666;
  border: 1px dashed rgba(255,200,0,.2); border-radius: 18px; font-size: 14px; }
.modal-overlay { display: none; position: fixed; inset: 0; z-index: 999;
  background: rgba(0,0,0,.8); backdrop-filter: blur(8px);
  align-items: center; justify-content: center; padding: 16px; }
.modal-overlay.show { display: flex; animation: fadeIn .2s; }
.modal { width: 100%; max-width: 760px; max-height: 90vh; overflow-y: auto;
  padding: 26px; border-radius: 20px; border: 1px solid rgba(255,200,0,.35);
  background: linear-gradient(145deg, #1a1a1a, #0d0d0d);
  box-shadow: 0 25px 80px rgba(0,0,0,.8), 0 0 80px rgba(255,200,0,.1); }
.modal h3 { color: #ffd700; font-size: 19px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
.modal label { display: block; font-size: 11px; font-weight: 800; letter-spacing: 1px;
  color: rgba(255,255,255,.45); margin-bottom: 6px; text-transform: uppercase; }
.modal textarea { min-height: 320px; }
.modal-actions { display: flex; gap: 10px; margin-top: 16px; }
.btn-cancel { flex: 1; padding: 13px; border: 1px solid rgba(255,255,255,.15); border-radius: 11px;
  background: transparent; color: #ccc; font-weight: 700; cursor: pointer; transition: background .2s; }
.btn-cancel:hover { background: rgba(255,255,255,.05); }
.btn-save { flex: 2; padding: 13px; border: none; border-radius: 11px;
  background: linear-gradient(90deg, #ffd700, #ffed4a); color: #0a0a0a;
  font-weight: 900; cursor: pointer; transition: all .2s; }
.btn-save:hover { transform: translateY(-2px); filter: brightness(1.05); }
.btn-save:disabled { opacity: .5; cursor: wait; transform: none; }
@media(max-width:700px) {
  .header { padding: 14px; }
  .user-name { display: none; }
  .container { width: calc(100% - 16px); margin-top: 16px; }
  .form-grid { grid-template-columns: 1fr; }
  textarea, .upload-button { grid-column: auto; }
  .modal { padding: 18px; }
  .brand h1 { font-size: 19px; }
}
`;

// ==================== AUTH ====================
app.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect("/");
  res.send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Kingmor — Login</title><style>
${SHARED_CSS}
.login-card { position: relative; z-index: 5; width: 100%; max-width: 420px; padding: 45px 32px;
  border-radius: 24px; border: 1px solid rgba(255,200,0,.25);
  background: linear-gradient(145deg, rgba(30,30,30,.95), rgba(15,15,15,.98));
  box-shadow: 0 25px 70px rgba(0,0,0,.5), 0 0 60px rgba(255,200,0,.08); text-align: center; }
.login-card .logo { width: 80px; height: 80px; margin: 0 auto 18px; border-radius: 22px;
  display: flex; align-items: center; justify-content: center; font-size: 44px;
  background: linear-gradient(135deg, #ffd700, #ffed4a);
  box-shadow: 0 0 45px rgba(255,200,0,.4); animation: pulse 2.5s ease-in-out infinite; }
@keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
.login-card h1 { font-size: 30px; font-weight: 900; margin-bottom: 6px;
  background: linear-gradient(90deg, #ffd700, #fff4b8, #ffd700);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.login-card .tagline { color: rgba(255,255,255,.5); font-size: 13px; margin-bottom: 32px; letter-spacing: .5px; }
.discord-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; padding: 15px 20px; border: none; border-radius: 14px;
  background: #5865F2; color: white; font-size: 15px; font-weight: 800;
  cursor: pointer; text-decoration: none; transition: all .2s; }
.discord-btn:hover { transform: translateY(-2px); filter: brightness(1.1); box-shadow: 0 10px 30px rgba(88,101,242,.4); }
.discord-btn svg { width: 22px; height: 22px; fill: white; }
.server-link, .invite-link { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  margin-top: 12px; width: 100%; padding: 13px 20px; border-radius: 12px;
  font-size: 13px; font-weight: 700; text-decoration: none; transition: all .2s; }
.server-link { border: 1px solid rgba(88,101,242,.4); background: rgba(88,101,242,.15); color: rgba(255,255,255,.8); }
.server-link:hover { background: rgba(88,101,242,.25); border-color: rgba(88,101,242,.7); color: white; }
.invite-link { border: 1px solid rgba(255,200,0,.3); background: rgba(255,200,0,.1); color: rgba(255,255,255,.75); }
.invite-link:hover { background: rgba(255,200,0,.2); border-color: rgba(255,200,0,.6); color: #ffd700; }
.features { display: flex; gap: 8px; margin-top: 24px; flex-wrap: wrap; justify-content: center; }
.feat-badge { padding: 6px 12px; border-radius: 20px; font-size: 10px; font-weight: 800;
  letter-spacing: .5px; text-transform: uppercase; background: rgba(255,200,0,.1);
  border: 1px solid rgba(255,200,0,.25); color: #ffd700; }
body { display: flex; align-items: center; justify-content: center; padding: 16px; }
</style></head><body>
<div class="login-card">
  <div class="logo">👑</div>
  <h1>Kingmor</h1>
  <p class="tagline">Premium Lua Script Protection System</p>
  <a class="discord-btn" href="/auth/discord">
    <svg viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.032.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
    Login with Discord
  </a>
  <a class="server-link" href="${DISCORD_INVITE}" target="_blank" rel="noopener">💬 Join Discord Server</a>
  <a class="invite-link" href="https://discord.com/oauth2/authorize?client_id=1545625902585487370&permissions=2952873984&integration_type=0&scope=bot" target="_blank" rel="noopener">🤖 Invite Bot</a>
  <div class="features">
    <span class="feat-badge">🔐 HWID</span>
    <span class="feat-badge">🔑 Keys</span>
    <span class="feat-badge">👑 Premium</span>
  </div>
</div></body></html>`);
});

app.get("/auth/discord", (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID, redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code", scope: "identify",
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/login");
  try {
    const t = await axios.post("https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code", code, redirect_uri: DISCORD_REDIRECT_URI,
      }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    const u = (await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${t.data.access_token}` } })).data;
    req.session.user = {
      id: u.id, username: u.username,
      avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
    };
    res.redirect("/");
  } catch (e) {
    console.error("OAuth error:", e?.response?.data || e.message);
    res.redirect("/login?error=1");
  }
});

app.get("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

// ==================== SCRIPTS API ====================
app.get("/api/scripts", requireAuth, (req, res) => {
  const uid = req.session.user.id;
  res.json(readDB().filter(s => s.ownerId === uid)
    .map(s => ({ id: s.id, name: s.name, enabled: s.enabled, createdAt: s.createdAt })));
});

app.get("/api/scripts/internal", requireInternalSecret, (req, res) => {
  const db = readDB(), ownerId = req.query.ownerId;
  const f = ownerId ? db.filter(s => String(s.ownerId) === String(ownerId)) : db;
  res.json(f.map(s => ({ id: s.id, name: s.name, enabled: s.enabled, ownerId: s.ownerId, ownerUsername: s.ownerUsername, guildId: s.guildId })));
});

app.get("/api/scripts/internal/:id", requireInternalSecret, (req, res) => {
  const s = readDB().find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json({ id: s.id, name: s.name, enabled: s.enabled, ownerId: s.ownerId, ownerUsername: s.ownerUsername, guildId: s.guildId });
});

app.get("/api/scripts/:id/source", requireAuth, (req, res) => {
  const s = readDB().find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  if (s.ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  const fp = path.join(SCRIPTS_DIR, s.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "Missing" });
  res.json({ id: s.id, name: s.name, enabled: s.enabled, source: fs.readFileSync(fp, "utf8") });
});

app.post("/api/scripts", requireAuth, (req, res) => {
  const { name, source, guildId } = req.body;
  if (!name || typeof name !== "string") return res.status(400).json({ error: "Name required" });
  if (!source || typeof source !== "string") return res.status(400).json({ error: "Source required" });
  if (source.length > 10 * 1024 * 1024) return res.status(413).json({ error: "Max 10MB" });

  const uid = req.session.user.id;
  const db = readDB();
  const existingCount = db.filter(s => String(s.ownerId) === String(uid)).length;
  const premium = isPremium(uid);
  const maxScripts = premium ? 5 : 2;

  if (existingCount >= maxScripts) {
    return res.status(403).json({
      error: `Script limit reached (${existingCount}/${maxScripts}). ${premium ? "" : "Upgrade to Premium for 5 scripts."}`,
      limitReached: true, max: maxScripts, current: existingCount, premium,
    });
  }

  const id = generateId();
  const filename = `${id}.lua`;
  fs.writeFileSync(path.join(SCRIPTS_DIR, filename), source, "utf8");
  const script = {
    id, name: name.trim().slice(0, 100), filename, enabled: true,
    ownerId: String(uid), ownerUsername: req.session.user.username,
    guildId: guildId || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.push(script); writeDB(db);
  res.json({ success: true, script: { id, name: script.name, enabled: true, createdAt: script.createdAt },
    loader: `${getBaseUrl(req)}/api/loader/${id}.lua` });
});

app.put("/api/scripts/:id", requireAuth, (req, res) => {
  const { name, source } = req.body;
  const db = readDB();
  const s = db.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  if (s.ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  if (name !== undefined) { if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Name empty" }); s.name = name.trim().slice(0, 100); }
  if (source !== undefined) {
    if (typeof source !== "string" || !source.trim()) return res.status(400).json({ error: "Source empty" });
    if (source.length > 10 * 1024 * 1024) return res.status(413).json({ error: "Max 10MB" });
    fs.writeFileSync(path.join(SCRIPTS_DIR, s.filename), source, "utf8");
  }
  s.updatedAt = new Date().toISOString();
  writeDB(db);
  res.json({ success: true, script: { id: s.id, name: s.name, enabled: s.enabled, updatedAt: s.updatedAt } });
});

app.post("/api/scripts/:id/toggle", requireAuth, (req, res) => {
  const db = readDB();
  const s = db.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  if (s.ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  s.enabled = !s.enabled; writeDB(db);
  res.json({ success: true, enabled: s.enabled });
});

app.delete("/api/scripts/:id", requireAuth, (req, res) => {
  const db = readDB();
  const i = db.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Not found" });
  if (db[i].ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  const fp = path.join(SCRIPTS_DIR, db[i].filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.splice(i, 1); writeDB(db);
  res.json({ success: true });
});

app.delete("/api/scripts/internal/:id", requireInternalSecret, (req, res) => {
  const reqOwner = req.headers["x-owner-id"];
  if (!reqOwner) return res.status(400).json({ error: "x-owner-id required" });
  const db = readDB();
  const i = db.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Not found" });
  if (String(db[i].ownerId) !== String(reqOwner)) return res.status(403).json({ error: "Not yours" });
  const s = db[i];
  const fp = path.join(SCRIPTS_DIR, s.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.splice(i, 1); writeDB(db);
  res.json({ success: true, name: s.name });
});

app.get("/api/scripts/limit", requireInternalSecret, (req, res) => {
  const ownerId = req.query.ownerId;
  if (!ownerId) return res.status(400).json({ error: "ownerId required" });
  const db = readDB();
  const count = db.filter(s => String(s.ownerId) === String(ownerId)).length;
  const premium = isPremium(ownerId);
  const max = premium ? 5 : 2;
  res.json({ count, max, premium, remaining: Math.max(0, max - count), canCreate: count < max });
});

app.get("/api/panels/count", requireInternalSecret, (req, res) => {
  const ownerId = req.query.ownerId;
  if (!ownerId) return res.status(400).json({ error: "ownerId required" });
  const cfg = readBotConfig();
  let count = 0;
  for (const gid of Object.keys(cfg)) {
    const g = cfg[gid];
    if (g && String(g.panelOwnerId) === String(ownerId) && g.panelScriptId) count++;
  }
  const premium = isPremium(ownerId);
  const max = premium ? 5 : 2;
  res.json({ count, max, premium, remaining: Math.max(0, max - count), canCreate: count < max });
});

// ==================== PREMIUM API ====================
app.get("/api/premium/status", requireInternalSecret, (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "userId required" });
  const premium = isPremium(userId);
  const entry = readPremium()[String(userId)] || null;
  res.json({ premium, expiry: entry?.expiry || null, since: entry?.since || null });
});

app.post("/api/premium/set", requireInternalSecret, (req, res) => {
  const { userId, expiry, remove } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  const p = readPremium();
  if (remove) { delete p[String(userId)]; writePremium(p); return res.json({ success: true, removed: true }); }
  p[String(userId)] = { expiry: expiry || null, since: p[String(userId)]?.since || new Date().toISOString(), updatedAt: new Date().toISOString() };
  writePremium(p);
  res.json({ success: true, premium: true, expiry });
});

app.get("/api/premium/info", (req, res) => {
  res.json({ priceIDR: PREMIUM_PRICE_IDR, priceUSD: PREMIUM_PRICE_USD, discord: DISCORD_INVITE });
});

app.post("/api/premium/redeem", requireAuth, (req, res) => {
  const { key } = req.body;
  const userId = req.session.user.id;
  if (!key || typeof key !== "string") return res.status(400).json({ error: "Key required" });

  const keys = readPremiumKeys();
  const keyData = keys.find(k => k.key === key.trim().toLowerCase() && !k.redeemedBy);
  if (!keyData) return res.status(400).json({ error: "Invalid or already used key" });

  const premium = readPremium();
  const existing = premium[String(userId)];

  let expiry;
  if (keyData.durationDays === 0) {
    expiry = null;
  } else {
    const baseTime = existing?.expiry && new Date(existing.expiry) > new Date()
      ? new Date(existing.expiry).getTime() : Date.now();
    expiry = new Date(baseTime + keyData.durationDays * 86400000).toISOString();
  }

  keyData.redeemedBy = String(userId);
  keyData.redeemedAt = new Date().toISOString();
  writePremiumKeys(keys);

  premium[String(userId)] = {
    expiry, since: existing?.since || new Date().toISOString(),
    updatedAt: new Date().toISOString(), grantedBy: "redeem-key",
  };
  writePremium(premium);

  res.json({ success: true, durationDays: keyData.durationDays, expiry, lifetime: keyData.durationDays === 0 });
});

app.get("/api/premium/my-status", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const entry = readPremium()[String(userId)] || null;
  res.json({ premium: isPremium(userId), expiry: entry?.expiry || null, since: entry?.since || null });
});

// ==================== HWID / COOLDOWN ====================
app.get("/api/cooldown/:scriptId", requireInternalSecret, (req, res) => {
  const e = readCooldowns()[req.params.scriptId] || {};
  res.json({ cooldownMs: e.cooldownMs || 86400000, default: !e.cooldownMs });
});

app.post("/api/cooldown/set", requireInternalSecret, (req, res) => {
  const { scriptId, userId, cooldownMs } = req.body;
  if (!scriptId || !userId) return res.status(400).json({ error: "scriptId + userId required" });
  if (!isPremium(userId)) return res.status(403).json({ error: "Premium required", premium: false });
  if (typeof cooldownMs !== "number" || cooldownMs < 60000) return res.status(400).json({ error: "cooldownMs >= 60000" });
  const cd = readCooldowns();
  cd[scriptId] = { cooldownMs, setBy: String(userId), updatedAt: new Date().toISOString() };
  writeCooldowns(cd);
  res.json({ success: true, cooldownMs });
});

app.post("/api/hwid/reset-self", requireInternalSecret, (req, res) => {
  const { userId, scriptId } = req.body;
  if (!userId || !scriptId) return res.status(400).json({ error: "userId + scriptId required" });
  const cooldownMs = readCooldowns()[scriptId]?.cooldownMs || 86400000;
  const keys = readKeys();
  const uk = keys.find(k => String(k.userId) === String(userId) && k.scriptId === scriptId);
  if (!uk) return res.status(404).json({ error: "No key found" });

  const last = uk.lastHwidReset ? new Date(uk.lastHwidReset).getTime() : 0;
  const now = Date.now();
  const elapsed = now - last;
  if (last && elapsed < cooldownMs) return res.json({ success: false, cooldown: true, remainingMs: cooldownMs - elapsed, cooldownMs });
  if (!uk.hwid) return res.json({ success: false, reason: "No HWID registered" });

  uk.hwid = null;
  uk.lastHwidReset = new Date().toISOString();
  writeKeys(keys);
  res.json({ success: true, cooldownMs, nextResetAt: new Date(now + cooldownMs).toISOString() });
});

app.get("/api/hwid/check", (req, res) => {
  const { scriptId, key, hwid } = req.query;
  if (!scriptId || !hwid) return res.json({ valid: false, reason: "Missing params" });

  const cfg = readBotConfig();
  const isFreeMode = Object.values(cfg).some(g => g?.freeMode?.[scriptId] === true);
  if (isFreeMode) {
    triggerWebhookAsync({ scriptId, key: null, hwid, userId: null, username: null });
    return res.json({ valid: true, freeMode: true });
  }
  if (!key) return res.json({ valid: false, reason: "No Key Provided" });

  const keys = readKeys();
  const kd = keys.find(k => k.key === key.toLowerCase().trim() && k.scriptId === scriptId);
  if (!kd) return res.json({ valid: false, reason: "Invalid Key" });
  if (kd.expiry && new Date(kd.expiry) < new Date()) return res.json({ valid: false, reason: "Key Expired" });

  if (!kd.hwid) {
    kd.hwid = hwid; writeKeys(keys);
    triggerWebhookAsync({ scriptId, key: kd.key, hwid, userId: kd.userId, username: kd.username });
    return res.json({ valid: true, bound: true });
  }
  if (kd.hwid !== hwid) return res.json({ valid: false, reason: "HWID Mismatch - Contact Admin" });

  triggerWebhookAsync({ scriptId, key: kd.key, hwid, userId: kd.userId, username: kd.username });
  return res.json({ valid: true });
});

app.post("/api/hwid/reset", requireInternalSecret, (req, res) => {
  const { userId, scriptId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  const keys = readKeys();
  let count = 0;
  const updated = keys.map(k => {
    if (String(k.userId) === String(userId) && (scriptId ? k.scriptId === scriptId : true) && k.hwid) {
      count++; return { ...k, hwid: null, lastHwidReset: new Date().toISOString() };
    }
    return k;
  });
  writeKeys(updated);
  res.json({ success: true, resetCount: count });
});

// ==================== WEBHOOK ====================
async function triggerWebhookAsync({ scriptId, key, hwid, userId, username }) {
  try {
    const url = readBotConfig().webhooks?.[scriptId];
    if (!url) return;
    const script = readDB().find(s => s.id === scriptId);
    await axios.post(url, { embeds: [{
      title: "👑 Script Executed", color: 0xFFD700,
      fields: [
        { name: "📜 Script", value: script?.name || scriptId, inline: false },
        { name: "👤 Discord User", value: userId ? `<@${userId}>` : (username || "Unknown"), inline: true },
        { name: "🔑 Key", value: key ? `\`${key}\`` : "Free Mode", inline: true },
        { name: "🖥️ HWID", value: hwid || "Not provided", inline: false },
      ], timestamp: new Date().toISOString(), footer: { text: "Kingmor 👑" },
    }]}, { timeout: 5000 });
  } catch (e) { console.error(`Webhook error (${scriptId}): ${e.message}`); }
}

app.get("/api/webhook/get", requireInternalSecret, (req, res) => {
  const { scriptId } = req.query;
  if (!scriptId) return res.status(400).json({ error: "scriptId required" });
  res.json({ webhook: readBotConfig().webhooks?.[scriptId] || null });
});

app.post("/api/webhook/set", requireInternalSecret, (req, res) => {
  const { scriptId, url } = req.body;
  if (!scriptId || !url) return res.status(400).json({ error: "scriptId + url required" });
  const cfg = readBotConfig();
  if (!cfg.webhooks) cfg.webhooks = {};
  cfg.webhooks[scriptId] = url;
  writeBotConfig(cfg);
  res.json({ success: true });
});

app.delete("/api/webhook/delete", requireInternalSecret, (req, res) => {
  const { scriptId } = req.body;
  const cfg = readBotConfig();
  if (cfg.webhooks?.[scriptId]) { delete cfg.webhooks[scriptId]; writeBotConfig(cfg); }
  res.json({ success: true });
});

// ==================== LOADER ====================
app.get("/api/loader/:id.lua", (req, res) => {
  const scriptId = req.params.id;
  const script = readDB().find(x => x.id === scriptId);
  if (!script) return res.status(404).type("text/plain").send("-- Kingmor: Script not found");

  const cfg = readBotConfig();
  const isFreeMode = Object.values(cfg).some(g => g?.freeMode?.[scriptId] === true);
  const base = getBaseUrl(req);

  function kickPlayer(reason) {
    return `local P = game:GetService("Players"); local L = P.LocalPlayer\nif L then L:Kick("[Kingmor] ${reason}") end\nreturn`;
  }
  function buildHwidWrapper(src, keyValue, freeMode) {
    if (freeMode) {
      return `-- Kingmor Protection System\nlocal _H = game:GetService("HttpService")\nlocal _P = game:GetService("Players")\nlocal _L = _P.LocalPlayer\nlocal _hwid = ""\nlocal _ok, _id = pcall(function() return game:GetService("RbxAnalyticsService"):GetClientId() end)\nif _ok then _hwid = tostring(_id) end\npcall(function() game:HttpGet("${base}/api/hwid/check?scriptId=${scriptId}&hwid=" .. _hwid) end)\n\n-- User script\n${src}`;
    }
    return `-- Kingmor Protection System\nlocal _H = game:GetService("HttpService")\nlocal _P = game:GetService("Players")\nlocal _L = _P.LocalPlayer\nlocal _hwid = ""\nlocal _ok, _id = pcall(function() return game:GetService("RbxAnalyticsService"):GetClientId() end)\nif _ok then _hwid = tostring(_id) end\nlocal _key = "${keyValue}"\nlocal _url = "${base}/api/hwid/check?scriptId=${scriptId}&key=" .. _key .. "&hwid=" .. _hwid\nlocal _s, _b = pcall(function() return game:HttpGet(_url) end)\nif not _s or not _b then _L:Kick("[Kingmor] HWID Check Failed") return end\nlocal _d = _H:JSONDecode(_b)\nif not _d or not _d.valid then local _r = (type(_d) == "table" and _d.reason) or "Invalid Key" _L:Kick("[Kingmor] " .. _r) return end\n\n-- User script\n${src}`;
  }

  const ua = req.headers["user-agent"] || "";
  const isRoblox = ua.includes("Roblox") || ua.includes("Lua") || ua.includes("Synapse") || ua.includes("Krnl")
    || ua.includes("Fluxus") || ua.includes("Hydrogen") || ua.includes("ScriptWare") || ua.includes("Electron");

  if (isRoblox) {
    if (!script.enabled) return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(kickPlayer("Script Disabled"));
    const fp = path.join(SCRIPTS_DIR, script.filename);
    if (!fs.existsSync(fp)) return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(kickPlayer("Source Missing"));
    const src = fs.readFileSync(fp, "utf8");
    if (isFreeMode) return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(buildHwidWrapper(src, "", true));

    const k = (req.query.key || "").toLowerCase().trim();
    if (!k) return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(kickPlayer("No Key Provided"));
    const kd = readKeys().find(x => x.key === k && x.scriptId === scriptId);
    if (!kd) return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(kickPlayer("Invalid Key"));
    if (kd.expiry && new Date(kd.expiry) < new Date()) return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(kickPlayer("Key Expired"));
    return res.status(200).type("text/plain").set("Cache-Control", "no-store").send(buildHwidWrapper(src, k, false));
  }

  // Browser view
  const uid = req.query.uid || null;
  let userKey = null;
  if (!isFreeMode && uid) {
    const uk = readKeys().find(k => String(k.userId) === String(uid) && k.scriptId === scriptId);
    if (uk && !(uk.expiry && new Date(uk.expiry) < new Date())) userKey = uk.key;
  }
  const loaderDisplay = isFreeMode
    ? `loadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua"))()`
    : userKey
      ? `script_key = "${userKey}"\nloadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua?key="..script_key))()`
      : `loadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua"))()`;

  return res.status(200).send(`<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kingmor • ${escapeHtml(script.name)}</title>
<style>
${SHARED_CSS}
body { display: flex; align-items: center; justify-content: center; padding: 20px; }
.loader-card { position: relative; z-index: 5; max-width: 650px; width: 100%; padding: 35px 30px;
  border-radius: 20px; border: 1px solid rgba(255,200,0,.3);
  background: linear-gradient(145deg, rgba(30,30,30,.95), rgba(15,15,15,.98));
  box-shadow: 0 25px 70px rgba(0,0,0,.6), 0 0 60px rgba(255,200,0,.08); text-align: center; }
.loader-card .logo { width: 60px; height: 60px; margin: 0 auto 14px; border-radius: 18px;
  display: flex; align-items: center; justify-content: center; font-size: 36px;
  background: linear-gradient(135deg, #ffd700, #ffed4a); box-shadow: 0 0 35px rgba(255,200,0,.3); }
.loader-card h1 { font-size: 24px; font-weight: 900; color: #ffd700; margin-bottom: 4px; }
.loader-card .subtitle { color: rgba(255,255,255,.5); font-size: 12px; margin-bottom: 20px; }
.protected-badge { display: inline-block; background: linear-gradient(90deg, #ffd700, #8a6d00);
  padding: 4px 16px; border-radius: 20px; font-size: 11px; font-weight: 900;
  color: #0a0a0a; letter-spacing: 1px; margin-bottom: 18px; }
.script-name { color: rgba(255,255,255,.7); font-size: 13px; margin-bottom: 18px; }
.script-name span { color: #ffd700; font-weight: 700; }
.loader-label { text-align: left; font-size: 11px; font-weight: 800; letter-spacing: 1px;
  color: rgba(255,255,255,.4); margin-bottom: 6px; text-transform: uppercase; }
.code-block { width: 100%; background: #000; border-radius: 12px;
  border: 1px solid rgba(255,200,0,.15); padding: 16px 18px;
  overflow-x: auto; text-align: left; box-shadow: inset 0 0 30px rgba(0,0,0,.4); }
.code-block code { font-family: 'Courier New', monospace; font-size: 13px; color: #ffd700;
  white-space: pre; word-break: break-all; display: block; }
.copy-btn { width: 100%; margin-top: 12px; padding: 13px; border: none; border-radius: 11px;
  cursor: pointer; font-size: 14px; font-weight: 900; color: #0a0a0a;
  background: linear-gradient(90deg, #ffd700, #ffed4a); transition: all .2s; }
.copy-btn:hover { transform: translateY(-2px); filter: brightness(1.05); }
</style></head><body>
<div class="loader-card">
  <div class="logo">👑</div>
  <h1>Kingmor</h1>
  <div class="subtitle">Lua Protection System</div>
  <div class="protected-badge">👑 SOURCE PROTECTED</div>
  <div class="script-name">SCRIPT: <span>${escapeHtml(script.name)}</span></div>
  <div class="loader-label">📜 LOADER</div>
  <div class="code-block"><code id="lc">${escapeHtml(loaderDisplay)}</code></div>
  <button class="copy-btn" onclick="copyLoader()">📋 Copy Loader</button>
</div>
<script>
const loader = ${JSON.stringify(loaderDisplay)};
async function copyLoader() {
  const btn = document.querySelector(".copy-btn");
  try { await navigator.clipboard.writeText(loader); btn.textContent = "✅ Copied!";
    setTimeout(() => btn.textContent = "📋 Copy Loader", 1800); }
  catch { const t = document.createElement("textarea"); t.value = loader;
    document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    btn.textContent = "✅ Copied!"; setTimeout(() => btn.textContent = "📋 Copy Loader", 1800); }
}
</script></body></html>`);
});

app.get("/files/loaders/:id.lua", (req, res) => res.redirect(`/api/loader/${req.params.id}.lua`));

// ==================== FREEMODE ====================
app.get("/api/freemode/:guildId/:scriptId", requireInternalSecret, (req, res) => {
  const cfg = readBotConfig();
  res.json({ freeMode: cfg[req.params.guildId]?.freeMode?.[req.params.scriptId] === true });
});

app.post("/api/freemode/update", requireInternalSecret, (req, res) => {
  const { guildId, scriptId, enabled } = req.body;
  if (!guildId || !scriptId) return res.status(400).json({ error: "guildId + scriptId required" });
  const cfg = readBotConfig();
  if (!cfg[guildId]) cfg[guildId] = {};
  if (!cfg[guildId].freeMode) cfg[guildId].freeMode = {};
  if (enabled) cfg[guildId].freeMode[scriptId] = true;
  else delete cfg[guildId].freeMode[scriptId];
  writeBotConfig(cfg);
  res.json({ success: true, freeMode: enabled });
});

// ==================== ADMIN ====================
app.get("/api/admin/guilds", isAdmin, (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(GUILDS_FILE, "utf8"))); } catch { res.json([]); }
});

app.post("/api/admin/guilds/update", requireInternalSecret, (req, res) => {
  const { guilds } = req.body;
  if (!Array.isArray(guilds)) return res.status(400).json({ error: "Invalid" });
  fs.writeFileSync(GUILDS_FILE, JSON.stringify(guilds, null, 2));
  res.json({ success: true });
});

// ==================== MAIN DASHBOARD ====================
app.get("/", requireAuth, (req, res) => {
  const db = readDB();
  const userId = req.session.user.id;
  const user = req.session.user;
  const userScripts = db.filter(s => s.ownerId === userId);
  const allKeys = readKeys();
  const totalKeys = allKeys.filter(k => k.createdBy === userId).length;
  const premiumStatus = isPremium(userId);
  const premiumData = readPremium()[String(userId)] || null;
  const maxScripts = premiumStatus ? 5 : 2;
  const scriptsLeft = Math.max(0, maxScripts - userScripts.length);
  const limitReached = userScripts.length >= maxScripts;

  const premiumBadge = premiumStatus
    ? `<div class="tier-badge premium">👑 PREMIUM${premiumData?.expiry ? ` • ${new Date(premiumData.expiry).toLocaleDateString()}` : " • LIFETIME"}</div>`
    : `<div class="tier-badge free">🆓 FREE</div>`;

  const cards = userScripts.map(s => {
    const base = getBaseUrl(req);
    const loaderPage = `${base}/api/loader/${s.id}.lua`;
    const loaderCode = `loadstring(game:HttpGet("${base}/api/loader/${s.id}.lua"))()`;
    const updatedAt = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "-";
    return `<div class="script-card">
  <div class="script-info">
    <div class="script-icon">👑</div>
    <div>
      <div class="script-name">${escapeHtml(s.name)}</div>
      <div class="script-status ${s.enabled ? "on" : "off"}">${s.enabled ? "● Enabled" : "● Disabled"}</div>
      <div class="script-updated">Updated: ${escapeHtml(updatedAt)}</div>
    </div>
  </div>
  <div class="script-menu">
    <button class="dots" onclick="toggleMenu('${s.id}')">⋮</button>
    <div class="menu" id="menu-${s.id}">
      <button onclick="openEdit('${s.id}')">✏️ Edit Source</button>
      <button onclick='openLoader(${JSON.stringify(loaderPage)})'>👑 Open Loader</button>
      <button onclick='copyLoaderCode(${JSON.stringify(loaderCode)})'>📋 Copy Loader</button>
      <button onclick="toggleScript('${s.id}')">${s.enabled ? "⏸ Disable" : "▶ Enable"}</button>
      <button class="delete" onclick="deleteScript('${s.id}')">🗑 Delete</button>
    </div>
  </div>
</div>`;
  }).join("");

  res.send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Kingmor — Lua Protection System</title>
<style>
${SHARED_CSS}

/* Tier comparison */
.showcase { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
@media (max-width: 720px) { .showcase { grid-template-columns: 1fr; } }
.tier-card { position: relative; padding: 22px; border-radius: 18px; overflow: hidden;
  background: linear-gradient(145deg, rgba(30,30,30,.95), rgba(15,15,15,.98));
  border: 1px solid rgba(255,255,255,.1); transition: all .25s; }
.tier-card:hover { transform: translateY(-3px); }
.tier-card.free { border-color: rgba(120,120,120,.35); }
.tier-card.premium { border-color: rgba(255,200,0,.5);
  background: linear-gradient(145deg, rgba(50,40,0,.85), rgba(20,15,0,.98));
  box-shadow: 0 0 40px rgba(255,200,0,.15); }
.tier-card.premium::before { content: ""; position: absolute; top: -40px; right: -40px;
  width: 180px; height: 180px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,200,0,.25), transparent 70%); pointer-events: none; }
.tier-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; position: relative; z-index: 1; }
.tier-title { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 900; }
.tier-title.free-title { color: #b8b8b8; }
.tier-title.premium-title { color: #ffd700; }
.tier-icon { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22px; }
.tier-icon.free-icon { background: rgba(120,120,120,.25); border: 1px solid rgba(160,160,160,.3); }
.tier-icon.premium-icon { background: linear-gradient(135deg, #ffd700, #ffed4a); box-shadow: 0 0 25px rgba(255,200,0,.45); }
.tier-price { font-size: 13px; font-weight: 800; padding: 5px 12px; border-radius: 20px; }
.tier-price.free-price { background: rgba(120,120,120,.2); color: #b8b8b8; border: 1px solid rgba(160,160,160,.3); }
.tier-price.premium-price { background: linear-gradient(90deg, #ffd700, #ffed4a); color: #0a0a0a; }
.tier-features { list-style: none; position: relative; z-index: 1; }
.tier-features li { padding: 7px 0; font-size: 13px; line-height: 1.45; display: flex; gap: 8px;
  align-items: flex-start; border-bottom: 1px dashed rgba(255,255,255,.06); }
.tier-features li:last-child { border-bottom: none; }
.tier-features li .ok { color: #54ff88; font-weight: 900; flex-shrink: 0; }
.tier-features li .no { color: #ff4d4d; font-weight: 900; flex-shrink: 0; }
.tier-features li code { background: rgba(255,200,0,.12); border: 1px solid rgba(255,200,0,.3);
  padding: 1px 6px; border-radius: 5px; color: #ffd700; font-size: 11px; font-family: 'Courier New', monospace; }

/* Redeem premium */
.redeem-box { padding: 22px; border-radius: 18px; margin-bottom: 22px;
  background: linear-gradient(135deg, rgba(255,200,0,.12), rgba(100,100,100,.05));
  border: 1px solid rgba(255,200,0,.4); position: relative; overflow: hidden; }
.redeem-box::before { content: ""; position: absolute; top: -50%; right: -10%;
  width: 300px; height: 300px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,200,0,.2), transparent 70%); pointer-events: none; }
.redeem-inner { position: relative; z-index: 1; }
.redeem-inner h3 { color: #ffd700; font-size: 18px; margin-bottom: 6px; font-weight: 900; }
.redeem-inner .sub { color: rgba(255,255,255,.6); font-size: 12px; margin-bottom: 14px; }
.redeem-form { display: flex; gap: 10px; flex-wrap: wrap; }
.redeem-form input { flex: 1; min-width: 220px; }
.redeem-btn { padding: 13px 26px; border: none; border-radius: 11px;
  background: linear-gradient(90deg, #ffd700, #ffed4a); color: #0a0a0a;
  font-weight: 900; cursor: pointer; font-size: 14px; transition: all .2s;
  box-shadow: 0 4px 20px rgba(255,200,0,.3); }
.redeem-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(255,200,0,.5); }
.redeem-btn:disabled { opacity: .5; cursor: wait; transform: none; }
.redeem-msg { margin-top: 12px; padding: 12px; border-radius: 10px; font-size: 13px; display: none; }
.redeem-msg.show { display: block; }
.redeem-msg.success { background: rgba(84,255,136,.1); border: 1px solid rgba(84,255,136,.3); color: #54ff88; }
.redeem-msg.error { background: rgba(255,77,77,.1); border: 1px solid rgba(255,77,77,.3); color: #ff4d4d; }

/* Limits */
.limit-badge { display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 20px; font-size: 11px; font-weight: 800;
  background: rgba(255,200,0,.1); border: 1px solid rgba(255,200,0,.3); color: #ffd700;
  margin-bottom: 14px; }
.limit-badge.full { background: rgba(255,77,77,.1); border-color: rgba(255,77,77,.4); color: #ff4d4d; }
.upgrade-cta { padding: 14px 18px; border-radius: 12px; margin-bottom: 14px;
  background: linear-gradient(135deg, rgba(255,200,0,.15), rgba(255,200,0,.05));
  border: 1px solid rgba(255,200,0,.4); display: flex; align-items: center;
  justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.upgrade-cta .text { font-size: 13px; color: rgba(255,255,255,.85); }
.upgrade-cta .text strong { color: #ffd700; }
.upgrade-cta a { padding: 10px 20px; border-radius: 10px;
  background: linear-gradient(90deg, #ffd700, #ffed4a); color: #0a0a0a;
  text-decoration: none; font-weight: 900; font-size: 13px; transition: all .2s; }
.upgrade-cta a:hover { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(255,200,0,.4); }

/* How to buy */
.howto { padding: 22px; border-radius: 18px; margin-bottom: 22px;
  background: linear-gradient(135deg, rgba(255,200,0,.10), rgba(100,100,100,.05));
  border: 1px solid rgba(255,200,0,.3); }
.howto h3 { color: #ffd700; font-size: 18px; margin-bottom: 6px; font-weight: 900; }
.howto .sub { color: rgba(255,255,255,.6); font-size: 12px; margin-bottom: 16px; }
.rules-list { list-style: none; counter-reset: step; margin-bottom: 18px; }
.rules-list li { counter-increment: step; padding: 10px 0 10px 42px; position: relative;
  font-size: 13px; line-height: 1.55; color: rgba(255,255,255,.85);
  border-bottom: 1px dashed rgba(255,255,255,.06); }
.rules-list li:last-child { border-bottom: none; }
.rules-list li::before { content: counter(step); position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #ffd700, #ffed4a); color: #0a0a0a;
  font-weight: 900; font-size: 13px; box-shadow: 0 0 15px rgba(255,200,0,.4); }
.rules-list li strong { color: #ffd700; }
.rules-list li code { background: rgba(255,200,0,.12); border: 1px solid rgba(255,200,0,.3);
  padding: 2px 7px; border-radius: 5px; color: #ffd700; font-size: 12px; font-family: 'Courier New', monospace; }
.join-buttons { display: flex; gap: 10px; flex-wrap: wrap; }
.join-btn { display: inline-flex; align-items: center; gap: 8px; padding: 13px 22px;
  border-radius: 12px; text-decoration: none; font-size: 14px; font-weight: 900; transition: all .2s; }
.join-btn.discord { background: #5865F2; color: white; }
.join-btn.discord:hover { transform: translateY(-2px); filter: brightness(1.1); }
.join-btn.buy { background: linear-gradient(90deg, #ffd700, #ffed4a); color: #0a0a0a;
  box-shadow: 0 0 25px rgba(255,200,0,.35); }
.join-btn.buy:hover { transform: translateY(-2px); filter: brightness(1.08); }
</style></head><body>
<header class="header">
  <div class="brand">
    <div class="logo">👑</div>
    <div><h1>Kingmor</h1><span>Lua Protection System</span></div>
  </div>
  <div class="user-info">
    ${premiumBadge}
    <img class="user-avatar" src="${escapeHtml(user.avatar)}" alt="avatar">
    <span class="user-name">${escapeHtml(user.username)}</span>
    <a class="invite-btn" href="https://discord.com/oauth2/authorize?client_id=1545625902585487370&permissions=2952873984&integration_type=0&scope=bot" target="_blank" rel="noopener">Invite Bot</a>
    <a class="logout-btn" href="/logout">Logout</a>
  </div>
</header>

<main class="container">
  <div class="stats-row">
    <div class="stat-card"><div class="value">${userScripts.length}/${maxScripts}</div><div class="label">Scripts</div></div>
    <div class="stat-card"><div class="value">${userScripts.filter(s => s.enabled).length}</div><div class="label">Enabled</div></div>
    <div class="stat-card"><div class="value">${totalKeys}</div><div class="label">Keys Generated</div></div>
    <div class="stat-card"><div class="value">${scriptsLeft}</div><div class="label">Scripts Left</div></div>
  </div>

  <div class="section-head"><h2>📤 Protect Your Scripts</h2><div class="line"></div></div>

  <div class="limit-badge ${limitReached ? "full" : ""}">
    ${limitReached ? "⚠️ Script limit reached" : "✅"} ${userScripts.length}/${maxScripts} scripts used
    ${premiumStatus ? "• 👑 Premium" : "• 🆓 Free"}
  </div>

  ${limitReached && !premiumStatus ? `
  <div class="upgrade-cta">
    <div class="text">🚀 <strong>Upgrade to Premium</strong> to unlock <strong>5 scripts</strong>, free mode, role blacklist, custom HWID cooldown & more!</div>
    <a href="${DISCORD_INVITE}" target="_blank" rel="noopener">💎 Upgrade Now</a>
  </div>` : ""}

  <section class="hero">
    <h2>👑 Upload Script</h2>
    <p>Upload a Lua/TXT file or paste your source manually.</p>
    <div class="form-grid">
      <input id="scriptName" placeholder="Script name...">
      <div class="file-row">
        <label class="file-label" for="fileInput">📁 Upload File</label>
        <input id="fileInput" type="file" accept=".lua,.txt,text/plain">
        <span class="file-name" id="fileName">No file selected</span>
      </div>
      <textarea id="scriptSource" placeholder="Paste your Lua source here..."></textarea>
      <button class="upload-button" onclick="uploadScript()" ${limitReached ? "disabled" : ""}>
        ${limitReached ? "🚫 Limit Reached — Upgrade to Premium" : "👑 Protect & Upload"}
      </button>
    </div>
  </section>

  <div class="section-head"><h2>📜 Your Scripts</h2><div class="line"></div></div>
  <section class="scripts">
    ${cards || `<div class="empty">👑 No scripts yet.<br>Upload your first Lua script above.</div>`}
  </section>

  <div class="section-head"><h2>💎 Plans &amp; Features</h2><div class="line"></div></div>

  <div class="showcase">
    <div class="tier-card free">
      <div class="tier-header">
        <div class="tier-title free-title"><div class="tier-icon free-icon">🆓</div><span>Free</span></div>
        <div class="tier-price free-price">$0</div>
      </div>
      <ul class="tier-features">
        <li><span class="ok">✓</span> <strong>Max 2 scripts</strong></li>
        <li><span class="ok">✓</span> Key system &amp; HWID lock</li>
        <li><span class="ok">✓</span> <strong>Lifetime whitelist</strong> (♾️ no limit!)</li>
        <li><span class="ok">✓</span> <strong>/setuppanel</strong> — up to <strong>2 panels</strong></li>
        <li><span class="ok">✓</span> <strong>/genkey</strong>, <strong>/whitelist</strong></li>
        <li><span class="ok">✓</span> <strong>/blacklist</strong> user &amp; <strong>/unblacklist</strong> user</li>
        <li><span class="ok">✓</span> <strong>/setwebhook</strong></li>
        <li><span class="ok">✓</span> Self HWID reset (1 day cooldown)</li>
        <li><span class="no">✗</span> <code>/freemode</code> — Premium only</li>
        <li><span class="no">✗</span> <code>/blacklistrole</code> — Premium only</li>
        <li><span class="no">✗</span> <code>/cooldownhwid</code> — Premium only</li>
        <li><span class="no">✗</span> <code>/resethwiduser</code> — Premium only</li>
      </ul>
    </div>

    <div class="tier-card premium">
      <div class="tier-header">
        <div class="tier-title premium-title"><div class="tier-icon premium-icon">👑</div><span>Premium</span></div>
        <div class="tier-price premium-price">Rp 20.000 / $2</div>
      </div>
      <ul class="tier-features">
        <li><span class="ok">✓</span> <strong>Everything in Free</strong></li>
        <li><span class="ok">✓</span> <strong>Max 5 scripts</strong> ⭐</li>
        <li><span class="ok">✓</span> <strong>/setuppanel</strong> — up to <strong>5 panels</strong></li>
        <li><span class="ok">✓</span> <strong>/freemode</strong> — free mode for any script</li>
        <li><span class="ok">✓</span> <strong>/blacklistrole</strong> — blacklist roles</li>
        <li><span class="ok">✓</span> <strong>/unblacklist role</strong></li>
        <li><span class="ok">✓</span> <strong>/cooldownhwid</strong> — custom cooldown (<code>30m</code>, <code>1h</code>, <code>3d</code>)</li>
        <li><span class="ok">✓</span> <strong>/resethwiduser</strong> — reset HWID for any user</li>
        <li><span class="ok">✓</span> Priority support</li>
        <li><span class="ok">✓</span> Early access to new features</li>
      </ul>
    </div>
  </div>

  <div class="section-head"><h2>🎫 Redeem Premium Key</h2><div class="line"></div></div>
  <div class="redeem-box">
    <div class="redeem-inner">
      <h3>🔑 Have a Premium Key?</h3>
      <p class="sub">Paste your premium key below to activate or extend your Premium subscription instantly.</p>
      <div class="redeem-form">
        <input id="premiumKey" placeholder="kmprem_xxxxxxxxxxxxxxxxxxxxxxxx" autocomplete="off">
        <button class="redeem-btn" id="redeemBtn" onclick="redeemPremium()">🎁 Redeem</button>
      </div>
      <div class="redeem-msg" id="redeemMsg"></div>
    </div>
  </div>

  <div class="section-head"><h2>🎫 How to Buy Premium</h2><div class="line"></div></div>
  <div class="howto">
    <h3>👑 Upgrade to Premium</h3>
    <p class="sub">Follow the steps below to purchase Premium via our Discord server ticket system.</p>
    <ol class="rules-list">
      <li>Join our official <strong>Discord server</strong> using the button below.</li>
      <li>Go to the <code>#purchasing</code> channel and read the pinned instructions.</li>
      <li>Open a <strong>ticket</strong> by clicking the ticket button in the ticket channel.</li>
      <li>Tell staff which plan you want: 🇮🇩 <strong>Rp 20.000</strong> / 🌍 <strong>$2 USD</strong></li>
      <li>Send the payment using the method provided by staff (QRIS, PayPal, etc.).</li>
      <li>Once payment is confirmed, your Premium is activated <strong>instantly</strong>.</li>
    </ol>
    <div class="join-buttons">
      <a class="join-btn discord" href="${DISCORD_INVITE}" target="_blank" rel="noopener">💬 Join Discord</a>
      <a class="join-btn buy" href="${DISCORD_INVITE}" target="_blank" rel="noopener">💎 Buy Premium</a>
    </div>
  </div>
</main>

<div class="modal-overlay" id="editModal">
  <div class="modal">
    <h3>✏️ Edit Script Source</h3>
    <label for="editName">Script Name</label>
    <input id="editName" placeholder="Script name...">
    <div style="height:14px"></div>
    <label>Source Code</label>
    <div class="file-row">
      <label class="file-label" for="editFileInput">📁 Replace with File</label>
      <input id="editFileInput" type="file" accept=".lua,.txt,text/plain">
      <span class="file-name" id="editFileName">No file selected</span>
    </div>
    <textarea id="editSource" placeholder="Paste your Lua source here..."></textarea>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeEdit()">Cancel</button>
      <button class="btn-save" id="editSaveBtn" onclick="saveEdit()">💾 Save Changes</button>
    </div>
  </div>
</div>

<script>
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const scriptName = document.getElementById("scriptName");
const scriptSource = document.getElementById("scriptSource");
let editingScriptId = null;

fileInput.addEventListener("change", function() {
  const file = this.files[0]; if (!file) return;
  const fn = file.name.toLowerCase();
  if (!fn.endsWith(".lua") && !fn.endsWith(".txt")) { alert("Only .lua or .txt files!"); this.value = ""; return; }
  if (file.size > 10 * 1024 * 1024) { alert("Max 10MB."); this.value = ""; return; }
  fileName.textContent = file.name;
  scriptName.value = file.name.replace(/\\.(lua|txt)$/i, "");
  const r = new FileReader(); r.onload = e => scriptSource.value = e.target.result; r.readAsText(file);
});

function toggleMenu(id) {
  document.querySelectorAll(".menu").forEach(m => m.classList.remove("show"));
  document.getElementById("menu-" + id)?.classList.toggle("show");
}
document.addEventListener("click", e => {
  if (!e.target.closest(".script-menu")) document.querySelectorAll(".menu").forEach(m => m.classList.remove("show"));
});

async function uploadScript() {
  const name = scriptName.value.trim(), source = scriptSource.value;
  if (!name) return alert("Enter script name!");
  if (!source.trim()) return alert("Enter Lua source!");
  try {
    const r = await fetch("/api/scripts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, source }) });
    const d = await r.json();
    if (!r.ok) {
      if (d.limitReached) {
        alert("🚫 Script limit reached! " + (d.premium ? "" : "Upgrade to Premium for 5 scripts."));
        return;
      }
      alert(d.error || "Upload failed"); return;
    }
    location.reload();
  } catch { alert("Server error!"); }
}

async function toggleScript(id) {
  const r = await fetch("/api/scripts/" + id + "/toggle", { method: "POST" });
  if (r.ok) location.reload(); else alert("Failed");
}
async function deleteScript(id) {
  if (!confirm("Delete this script?")) return;
  const r = await fetch("/api/scripts/" + id, { method: "DELETE" });
  if (r.ok) location.reload(); else alert("Failed");
}
async function copyLoaderCode(c) {
  try { await navigator.clipboard.writeText(c); alert("Loader copied!"); }
  catch { alert("Failed to copy"); }
}
function openLoader(url) { window.open(url, "_blank"); }

/* Redeem premium key */
async function redeemPremium() {
  const input = document.getElementById("premiumKey");
  const btn = document.getElementById("redeemBtn");
  const msg = document.getElementById("redeemMsg");
  const key = input.value.trim();
  if (!key) { showMsg("Please enter a key", "error"); return; }
  btn.disabled = true; btn.textContent = "Redeeming...";
  try {
    const r = await fetch("/api/premium/redeem", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const d = await r.json();
    if (!r.ok) { showMsg("❌ " + (d.error || "Failed to redeem"), "error"); return; }
    if (d.lifetime) showMsg("🎉 Premium LIFETIME activated! Refreshing...", "success");
    else showMsg(\`🎉 Premium activated for \${d.durationDays} days! Expires: \${new Date(d.expiry).toLocaleString()}\`, "success");
    setTimeout(() => location.reload(), 2000);
  } catch { showMsg("❌ Server error", "error"); }
  finally { btn.disabled = false; btn.textContent = "🎁 Redeem"; }
}
function showMsg(text, type) {
  const m = document.getElementById("redeemMsg");
  m.textContent = text; m.className = "redeem-msg show " + type;
}

/* Edit modal */
async function openEdit(id) {
  editingScriptId = id;
  const m = document.getElementById("editModal");
  const n = document.getElementById("editName"), s = document.getElementById("editSource");
  const f = document.getElementById("editFileInput"), fn = document.getElementById("editFileName");
  f.value = ""; fn.textContent = "No file selected";
  n.value = "Loading..."; s.value = "Loading..."; m.classList.add("show");
  try {
    const r = await fetch("/api/scripts/" + id + "/source");
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Failed"); closeEdit(); return; }
    n.value = d.name; s.value = d.source || "";
  } catch { alert("Failed to load"); closeEdit(); }
}
function closeEdit() { document.getElementById("editModal").classList.remove("show"); editingScriptId = null; }
document.getElementById("editFileInput").addEventListener("change", function() {
  const f = this.files[0]; if (!f) return;
  const fn = f.name.toLowerCase();
  if (!fn.endsWith(".lua") && !fn.endsWith(".txt")) { alert("Only .lua or .txt!"); this.value = ""; return; }
  if (f.size > 10 * 1024 * 1024) { alert("Max 10MB."); this.value = ""; return; }
  document.getElementById("editFileName").textContent = f.name;
  const r = new FileReader(); r.onload = e => document.getElementById("editSource").value = e.target.result; r.readAsText(f);
});
async function saveEdit() {
  if (!editingScriptId) return;
  const name = document.getElementById("editName").value.trim();
  const source = document.getElementById("editSource").value;
  if (!name) return alert("Name cannot be empty!");
  if (!source.trim()) return alert("Source cannot be empty!");
  const btn = document.getElementById("editSaveBtn");
  btn.disabled = true; btn.textContent = "Saving...";
  try {
    const r = await fetch("/api/scripts/" + editingScriptId, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, source }),
    });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "Failed"); btn.disabled = false; btn.textContent = "💾 Save Changes"; return; }
    location.reload();
  } catch { alert("Server error"); btn.disabled = false; btn.textContent = "💾 Save Changes"; }
}
document.getElementById("editModal").addEventListener("click", e => {
  if (e.target.id === "editModal") closeEdit();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.getElementById("editModal").classList.contains("show")) closeEdit();
});
</script>
</body></html>`);
});

// ==================== HEALTH ====================
app.get("/health", (req, res) => res.status(200).json({ status: "ok", uptime: process.uptime() }));

app.listen(PORT, () => {
  console.log(`👑 Kingmor running on port ${PORT}`);
  console.log(`🔐 API_SECRET: ${API_SECRET ? "loaded (" + API_SECRET.length + " chars)" : "MISSING"}`);
  console.log(`💎 Premium: ${PREMIUM_PRICE_IDR} / ${PREMIUM_PRICE_USD}`);
  console.log(`📢 Discord: ${DISCORD_INVITE}`);
});
