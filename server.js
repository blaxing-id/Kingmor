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
const BOT_INVITE_2 = "https://discord.com/oauth2/authorize?client_id=1555752792113811506&permissions=277293878288&integration_type=0&scope=bot";
const BOT_1_NAME = process.env.BOT_1_NAME || "Kingmor";
const BOT_1_TAG = process.env.BOT_1_TAG || "Kingmor#0001";
const BOT_1_AVATAR = process.env.BOT_1_AVATAR || "https://cdn.discordapp.com/embed/avatars/0.png";
const BOT_2_NAME = process.env.BOT_2_NAME || "Kingmor Alt";
const BOT_2_TAG = process.env.BOT_2_TAG || "Kingmor#0002";
const BOT_2_AVATAR = process.env.BOT_2_AVATAR || "https://cdn.discordapp.com/embed/avatars/1.png";
const PREMIUM_PRICE_IDR = "Rp 20.000";
const PREMIUM_PRICE_USD = "$2";
const SCRIPT_LIMIT = { free: 2, premium: 10 };
/** Max Lua source size in characters (~25MB). Keep under typical proxy/body limits. */
const MAX_SOURCE_CHARS = 25 * 1024 * 1024;
const OBF_LIMIT = { free: 5, premium: 15 };
const OBF_USAGE_FILE = path.join(DATA_DIR, "obf_usage.json");

fs.mkdirSync(SCRIPTS_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");
if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, "[]", "utf8");
if (!fs.existsSync(BOT_CONFIG_FILE)) fs.writeFileSync(BOT_CONFIG_FILE, "{}", "utf8");
if (!fs.existsSync(GUILDS_FILE)) fs.writeFileSync(GUILDS_FILE, "[]", "utf8");
if (!fs.existsSync(PREMIUM_FILE)) fs.writeFileSync(PREMIUM_FILE, "{}", "utf8");
if (!fs.existsSync(PREMIUM_KEYS_FILE)) fs.writeFileSync(PREMIUM_KEYS_FILE, "[]", "utf8");
if (!fs.existsSync(HWID_COOLDOWN_FILE)) fs.writeFileSync(HWID_COOLDOWN_FILE, "{}", "utf8");
if (!fs.existsSync(OBF_USAGE_FILE)) fs.writeFileSync(OBF_USAGE_FILE, "{}", "utf8");

app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

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
function readObfUsage() { return readJSON(OBF_USAGE_FILE, {}); }
function writeObfUsage(data) { writeJSON(OBF_USAGE_FILE, data); }
function obfLimitFor(userId) {
  return isPremium(userId) ? OBF_LIMIT.premium : OBF_LIMIT.free;
}
function getObfUsed(userId) {
  const u = readObfUsage()[String(userId)];
  return u && typeof u.count === "number" ? u.count : 0;
}
function incObfUsed(userId) {
  const all = readObfUsage();
  const id = String(userId);
  const cur = all[id] || { count: 0 };
  cur.count = (cur.count || 0) + 1;
  cur.lastAt = new Date().toISOString();
  all[id] = cur;
  writeObfUsage(all);
  return cur.count;
}
function generateId() {
  return crypto.randomBytes(7).toString("hex");
}

// ==================== SOURCE PROTECTION (Kingmor KM1) ====================
// Inspired by Faulmor-style staged delivery: source is XOR-scrambled at rest
// with a per-script key derived from API_SECRET. Loader decrypts only after
// key/HWID checks. This is NOT Faulmor's proprietary VM — that runs only on
// their servers — but the same idea: plain Lua never sits on disk / in transit
// without a gate.
function deriveScriptKey(scriptId) {
  return crypto.createHmac("sha256", String(API_SECRET || "kingmor")).update(String(scriptId)).digest();
}

function xorScramble(buf, keyBuf) {
  const out = Buffer.allocUnsafe(buf.length);
  const kl = keyBuf.length;
  for (let i = 0; i < buf.length; i++) {
    const ki = keyBuf[i % kl];
    const drift = ((i * 131 + Math.floor(i / kl)) % 256);
    out[i] = buf[i] ^ ki ^ drift;
  }
  return out;
}

/** Encrypt plaintext Lua → KM1 payload for disk storage */
function protectSource(plain, scriptId) {
  const key = deriveScriptKey(scriptId);
  const enc = xorScramble(Buffer.from(String(plain), "utf8"), key);
  return "KM1:" + enc.toString("base64");
}

/** Decrypt KM1 payload (or pass-through legacy plaintext) */
function unprotectSource(stored, scriptId) {
  if (stored == null) return "";
  const s = String(stored);
  if (!s.startsWith("KM1:")) return s; // legacy plaintext uploads
  try {
    const key = deriveScriptKey(scriptId);
    const enc = Buffer.from(s.slice(4), "base64");
    return xorScramble(enc, key).toString("utf8");
  } catch (e) {
    console.error("unprotectSource failed:", e.message);
    return "";
  }
}

function readScriptSource(script) {
  const filepath = path.join(SCRIPTS_DIR, script.filename);
  if (!fs.existsSync(filepath)) return null;
  const raw = fs.readFileSync(filepath, "utf8");
  return unprotectSource(raw, script.id);
}

// ==================== LUA OBFUSCATOR (high-compat KM-OBF) ====================
// Simple XOR + base64 + bootstrap. Tuned for executor compatibility (~max practical reliability).
function obfuscateLua(plainSource) {
  const src = String(plainSource || "");
  if (!src.trim()) return src;

  const rndU32 = () => crypto.randomBytes(4).readUInt32BE(0) >>> 0;
  const id = () => {
    const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
    let s = "_";
    for (let i = 0; i < 10; i++) s += alphabet[rndU32() % alphabet.length];
    return s;
  };

  const key = crypto.randomBytes(32);
  const seed = rndU32();

  function scramble(buf) {
    const out = Buffer.allocUnsafe(buf.length);
    let s = seed >>> 0;
    for (let i = 0; i < buf.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const k = key[i & 31];
      const drift = ((s & 255) ^ ((i * 131) & 255)) & 255;
      out[i] = buf[i] ^ k ^ drift;
    }
    return out;
  }

  const enc = scramble(Buffer.from(src, "utf8"));
  const b64 = enc.toString("base64");
  const pieceSize = 3500;
  const pieces = [];
  for (let i = 0; i < b64.length; i += pieceSize) pieces.push(b64.slice(i, i + pieceSize));

  const K = id(), S = id(), P = id(), bx = id(), b64d = id(), dec = id();
  const load = id(), fn = id(), err = id(), ok = id(), re = id();
  const keyLua = Array.from(key).join(",");
  const partsLua = pieces.map((p, i) => `  [${i + 1}]=[=[${p}]=]`).join(",\n");

  // Minimal, portable Lua — no bit32 required, no table.create, chunked concat
  return `-- Kingmor KM-OBF
local ${K}={${keyLua}}
local ${S}=${seed}
local ${P}={
${partsLua}
}
local function ${bx}(a,c)
  a=a%256 c=c%256
  local r,p=0,1
  for _=1,8 do
    local x,y=a%2,c%2
    if x~=y then r=r+p end
    a=(a-x)/2 c=(c-y)/2 p=p*2
  end
  return r
end
local function ${b64d}(data)
  local A="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  local L={}
  for i=1,#A do L[string.sub(A,i,i)]=i-1 end
  data=string.gsub(tostring(data or ""),"[^A-Za-z0-9%+/=]","")
  local out,val,bits={},0,0
  for i=1,#data do
    local ch=string.sub(data,i,i)
    if ch=="=" then break end
    local f=L[ch]
    if f then
      val=val*64+f
      bits=bits+6
      if bits>=8 then
        bits=bits-8
        local d=2^bits
        out[#out+1]=string.char(math.floor(val/d)%256)
        val=val%d
      end
    end
  end
  return table.concat(out)
end
local function ${dec}()
  local raw=${b64d}(table.concat(${P}))
  local chunks,buf,bi={},{},0
  local st=${S}
  for i=1,#raw do
    st=(1664525*st+1013904223)%4294967296
    local k=${K}[((i-1)%32)+1]
    local drift=${bx}(st%256,((i-1)*131)%256)
    bi=bi+1
    buf[bi]=string.char(${bx}(${bx}(string.byte(raw,i),k),drift))
    if bi>=4096 then
      chunks[#chunks+1]=table.concat(buf)
      buf={}
      bi=0
    end
  end
  if bi>0 then chunks[#chunks+1]=table.concat(buf) end
  return table.concat(chunks)
end
local ${load}=loadstring or load
if type(${load})~="function" then error("Kingmor: no loadstring",0) end
local src=${dec}()
local ${fn},${err}=${load}(src)
if not ${fn} then error("Kingmor: compile failed",0) end
local ${ok},${re}=pcall(${fn})
if not ${ok} then error(tostring(${re}),0) end
`;
}


// Ephemeral encrypted delivery for reliable large-script loading
const DELIVER_DIR = path.join(DATA_DIR, "deliver");
fs.mkdirSync(DELIVER_DIR, { recursive: true });

function scrambleBuffer(buf, key, seed) {
  const out = Buffer.allocUnsafe(buf.length);
  let s = seed >>> 0;
  for (let i = 0; i < buf.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const k = key[i & 31];
    const drift = ((s & 255) ^ ((i * 131) & 255)) & 255;
    out[i] = buf[i] ^ k ^ drift;
  }
  return out;
}

/** Scramble only a slice, advancing LCG to the correct global offset (multi-instance safe). */
function scrambleSlice(plainBuf, key, seed, start, length) {
  let s = seed >>> 0;
  for (let i = 0; i < start; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  }
  const end = Math.min(start + length, plainBuf.length);
  const out = Buffer.allocUnsafe(Math.max(0, end - start));
  for (let i = 0; i < out.length; i++) {
    const gi = start + i;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const k = key[gi & 31];
    const drift = ((s & 255) ^ ((gi * 131) & 255)) & 255;
    out[i] = plainBuf[gi] ^ k ^ drift;
  }
  return out;
}

/**
 * Reliable multi-instance loader:
 * - Key/seed embedded in tiny bootstrap (no shared /tmp cache)
 * - Each part request re-reads source + scrambleSlice (any Railway replica works)
 * - Small chunks + retries + multi transport
 */
function buildSecureLoader(plain, userKey, freeModeFlag, base, scriptId, doObfuscate) {
  let payload = String(plain || "");
  // Heavy OBF only for moderately sized scripts (large files stay transit-encrypted for max reliability)
  if (doObfuscate && Buffer.byteLength(payload, "utf8") <= 200 * 1024) {
    try {
      payload = obfuscateLua(payload);
    } catch (e) {
      console.error("obfuscateLua at deliver failed:", e.message);
    }
  }

  const key = crypto.randomBytes(32);
  const seed = crypto.randomBytes(4).readUInt32BE(0) >>> 0;
  const plainBuf = Buffer.from(payload, "utf8");
  const plainLen = plainBuf.length;
  const CHUNK = 96 * 1024;
  const keyLua = Array.from(key).join(",");
  const keyHex = key.toString("hex");
  const uk = String(userKey || "").toLowerCase().trim();

  const hwidBlock = freeModeFlag
    ? `pcall(function() httpget(${JSON.stringify(base + "/api/hwid/check?scriptId=" + scriptId + "&hwid=")} .. hwid) end)`
    : `do
  local ok,body = pcall(function()
    return httpget(${JSON.stringify(base + "/api/hwid/check?scriptId=" + scriptId + "&key=" + uk + "&hwid=")} .. hwid)
  end)
  if not ok or type(body) ~= "string" or body == "" then
    if lp then lp:Kick("[Kingmor] HWID Check Failed") end
    return
  end
  local data = nil
  pcall(function() data = HttpService:JSONDecode(body) end)
  if type(data) ~= "table" or not data.valid then
    local reason = (type(data) == "table" and data.reason) or "Invalid Key"
    if lp then lp:Kick("[Kingmor] " .. tostring(reason)) end
    return
  end
end`;

  const httpgetFn = `local function httpget(url)
  local list = {}
  local function add(f) if type(f)=="function" then list[#list+1]=f end end
  if type(request)=="function" then add(function(u) local r=request({Url=u,Method="GET",Headers={["User-Agent"]="Kingmor/5"}}) if type(r)=="table" then return r.Body or r.body or r.Data or r.data end end) end
  if type(http_request)=="function" then add(function(u) local r=http_request({Url=u,Method="GET"}) if type(r)=="table" then return r.Body or r.body end end) end
  if type(syn)=="table" and type(syn.request)=="function" then add(function(u) local r=syn.request({Url=u,Method="GET"}) if type(r)=="table" then return r.Body or r.body end end) end
  if type(http)=="table" and type(http.request)=="function" then add(function(u) local r=http.request({Url=u,Method="GET"}) if type(r)=="table" then return r.Body or r.body end end) end
  if type(fluxus)=="table" and type(fluxus.request)=="function" then add(function(u) local r=fluxus.request({Url=u,Method="GET"}) if type(r)=="table" then return r.Body or r.body end end) end
  add(function(u) if type(game.HttpGet)=="function" then return game:HttpGet(u) end end)
  add(function(u) return HttpService:GetAsync(u,true) end)
  local last="no http"
  for i=1,#list do
    local ok,res=pcall(list[i],url)
    if ok and type(res)=="string" and #res>0 then return res end
    last=tostring(res)
  end
  error(last)
end`;

  const sharedDecode = `local function bx(a,c)
  a=a%256;c=c%256
  if bit32 and bit32.bxor then return bit32.bxor(a,c) end
  local r,p=0,1
  for _=1,8 do local x,y=a%2,c%2 if x~=y then r=r+p end a,c,p=(a-x)/2,(c-y)/2,p*2 end
  return r
end
local function b64dec(data)
  local A="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  local L={} for i=1,#A do L[A:sub(i,i)]=i-1 end
  data=tostring(data or ""):gsub("%s+",""):gsub("[^A-Za-z0-9%+/=]","")
  local out,val,bits={},0,0
  for i=1,#data do
    local ch=data:sub(i,i)
    if ch=="=" then break end
    local f=L[ch]
    if f then
      val=val*64+f; bits=bits+6
      if bits>=8 then bits=bits-8; local d=2^bits; out[#out+1]=string.char(math.floor(val/d)%256); val=val%d end
    end
  end
  return table.concat(out)
end
local function decrypt(enc)
  local outChunks,buf,bi={}, {},0
  local s=seed
  for i=1,#enc do
    s=(1664525*s+1013904223)%4294967296
    local k=key[((i-1)%32)+1]
    local drift=bx(s%256,((i-1)*131)%256)
    bi=bi+1; buf[bi]=string.char(bx(bx(string.byte(enc,i),k),drift))
    if bi>=8192 then outChunks[#outChunks+1]=table.concat(buf); buf={}; bi=0 end
  end
  if bi>0 then outChunks[#outChunks+1]=table.concat(buf) end
  return table.concat(outChunks)
end
local function run(src)
  local loader=loadstring or load
  if type(loader)~="function" then if lp then lp:Kick("[Kingmor] No loadstring") end return end
  local fn,err=loader(src)
  if not fn then warn("[Kingmor] compile:",err) if lp then lp:Kick("[Kingmor] Script compile error") end return end
  local ok,re=pcall(fn)
  if not ok then warn("[Kingmor] runtime:",re) end
end`;

  // SMALL: inline — no extra HTTP (fixes download failed for normal scripts)
  const INLINE_MAX = 120 * 1024;
  if (plainLen <= INLINE_MAX) {
    const enc = scrambleBuffer(plainBuf, key, seed);
    const b64 = enc.toString("base64");
    const pieces = [];
    for (let i = 0; i < b64.length; i += 4000) {
      pieces.push("[=[" + b64.slice(i, i + 4000) + "]=]");
    }
    const partsLua = pieces.map((p, idx) => "  [" + (idx + 1) + "]=" + p).join(",\n");
    return `-- Kingmor secure loader v5-inline
local HttpService=game:GetService("HttpService")
local Players=game:GetService("Players")
local lp=Players.LocalPlayer
local hwid=""
pcall(function() hwid=tostring(game:GetService("RbxAnalyticsService"):GetClientId()) end)
${httpgetFn}
${hwidBlock}
local key={${keyLua}}
local seed=${seed}
local _p={
${partsLua}
}
${sharedDecode}
local enc=b64dec(table.concat(_p))
run(decrypt(enc))
`;
  }

  // LARGE: multi-part pack
  const parts = Math.max(1, Math.ceil(plainLen / CHUNK));
  const partBase = base + "/api/loader/" + scriptId + ".lua?pack=1&seed=" + seed + "&kh=" + keyHex + "&psz=" + CHUNK
    + (freeModeFlag ? "" : "&key=" + encodeURIComponent(uk));

  return `-- Kingmor secure loader v5-pack
local HttpService=game:GetService("HttpService")
local Players=game:GetService("Players")
local lp=Players.LocalPlayer
local hwid=""
pcall(function() hwid=tostring(game:GetService("RbxAnalyticsService"):GetClientId()) end)
${httpgetFn}
${hwidBlock}
local key={${keyLua}}
local seed=${seed}
local parts=${parts}
local partBase=${JSON.stringify(partBase + "&part=")}
${sharedDecode}
local function nap(sec) pcall(function() if task and task.wait then task.wait(sec) else wait(sec) end end) end
local pieces={}
for i=1,parts do
  local url=partBase..tostring(i)
  local body,lastErr=nil,nil
  for attempt=1,6 do
    local ok,res=pcall(httpget,url)
    if ok and type(res)=="string" and #res>8 then
      if res:sub(1,10)=="-- Kingmor" then lastErr="got bootstrap"
      elseif #res<500 and res:find("Kick",1,true) then local fn=(loadstring or load)(res) if fn then pcall(fn) end return
      else body=res break end
    else lastErr=tostring(res) end
    nap(0.45*attempt)
  end
  if not body then
    warn("[Kingmor] part fail",i,lastErr)
    if lp then lp:Kick("[Kingmor] Download failed part "..tostring(i)) end
    return
  end
  local okd,dec=pcall(b64dec,body)
  if not okd or type(dec)~="string" or #dec==0 then
    if lp then lp:Kick("[Kingmor] Decode failed part "..tostring(i)) end
    return
  end
  pieces[i]=dec
end
run(decrypt(table.concat(pieces)))
`;
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
  // After login, user must select a bot first
  if (!req.session.selectedBot && req.path !== "/select-bot" && !req.path.startsWith("/api/")) {
    return res.redirect("/select-bot");
  }
  next();
}
function isAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.id !== ADMIN_USER_ID) {
    return res.status(403).send(`Forbidden — You are logged in as ${req.session?.user?.id || "not logged in"}, but admin requires ${ADMIN_USER_ID}`);
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
.card{position:relative;overflow:hidden}
.card::before{content:"";position:absolute;inset:0 0 auto 0;height:1px;background:linear-gradient(90deg,transparent,rgba(242,193,78,.45),transparent)}
.btn-gold{box-shadow:0 8px 24px rgba(242,193,78,.18)}
.btn-discord:hover{filter:brightness(1.08)}
.stat{transition:border-color .15s,transform .15s}
.stat:hover{border-color:var(--line2);transform:translateY(-1px)}
.sc{transition:border-color .15s,box-shadow .15s}
.sc:hover{box-shadow:0 12px 28px rgba(0,0,0,.35)}

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
  const isAdminUser = user && user.id === ADMIN_USER_ID;
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
    ${link("/obf", "OBF Script", "obf")}
    ${isAdminUser ? link("/admin/sources", "🕵️ Player Source", "sources") : ""}
    ${isAdminUser ? link("/admin/dashboard", "🛡️ Admin", "admin") : ""}
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
      <li><code>/setuppanel</code> up to 10 panels</li>
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
    // If no bot selected yet → bot selection page
    if (!req.session.selectedBot) {
      return res.redirect("/select-bot");
    }
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Discord OAuth error:", err?.response?.data || err.message);
    res.redirect("/login?error=1");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ==================== SELECT BOT (after login) ====================
app.get("/select-bot", (req, res) => {
  if (!req.session || !req.session.user) return res.redirect("/login");

  const current = req.session.selectedBot || null;
  const body = `
<main class="wrap center">
  <div class="card bot-pick-card">
    <div class="brand" style="justify-content:center;margin-bottom:8px"><i>👑</i>Kingmor</div>
    <h1 style="text-align:center">Choose your bot</h1>
    <p style="text-align:center;margin-bottom:28px">Select which bot you want to use with this account. You can change it later from the dashboard.</p>

    <div class="bot-list">
      <div class="bot-row ${current === "1" ? "selected" : ""}" data-bot="1" onclick="selectBot('1')">
        <img class="bot-avatar" src="${BOT_1_AVATAR}" alt="${BOT_1_TAG}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
        <div class="bot-meta">
          <div class="bot-tag">${BOT_1_TAG}</div>
          <div class="bot-status ready">● Ready</div>
        </div>
        <a class="btn btn-ghost btn-sm bot-invite" href="${BOT_INVITE}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Invite</a>
      </div>

      <div class="bot-row ${current === "2" ? "selected" : ""}" data-bot="2" onclick="selectBot('2')">
        <img class="bot-avatar" src="${BOT_2_AVATAR}" alt="${BOT_2_TAG}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/1.png'">
        <div class="bot-meta">
          <div class="bot-tag">${BOT_2_TAG}</div>
          <div class="bot-status available">● Available — invite first</div>
        </div>
        <a class="btn btn-ghost btn-sm bot-invite" href="${BOT_INVITE_2}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Invite</a>
      </div>
    </div>

    ${current ? `<a class="btn btn-gold btn-block" style="margin-top:22px" href="/dashboard">Continue to Dashboard →</a>` : `<p class="bot-hint">Click a bot row to select it</p>`}
  </div>
</main>

<style>
.bot-pick-card{width:min(480px,100%);padding:36px 28px}
.bot-list{display:flex;flex-direction:column;gap:12px}
.bot-row{
  display:flex;align-items:center;gap:14px;
  padding:14px 16px;border-radius:14px;
  border:1px solid var(--line2);background:#0e0c0a;
  cursor:pointer;transition:border-color .15s,background .15s,transform .15s,box-shadow .15s
}
.bot-row:hover{border-color:rgba(242,193,78,.45);background:#14110e;transform:translateY(-1px)}
.bot-row.selected{
  border-color:rgba(242,193,78,.7);
  background:linear-gradient(135deg,rgba(242,193,78,.12),rgba(224,138,0,.04));
  box-shadow:0 0 0 1px rgba(242,193,78,.25),0 12px 32px rgba(0,0,0,.35)
}
.bot-avatar{
  width:48px;height:48px;border-radius:50%;
  border:2px solid var(--line2);object-fit:cover;flex-shrink:0;
  background:#1a1612
}
.bot-row.selected .bot-avatar{border-color:var(--gold)}
.bot-meta{flex:1;min-width:0}
.bot-tag{font-weight:700;font-size:15px;letter-spacing:-.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bot-status{font-size:12px;font-weight:600;margin-top:2px}
.bot-status.ready{color:var(--ok)}
.bot-status.available{color:var(--amber)}
.bot-invite{flex-shrink:0;min-width:78px}
.bot-hint{text-align:center;margin-top:18px;font-size:13px;color:var(--mute)}
</style>`;

  const script = `
async function selectBot(id) {
  try {
    var r = await fetch('/api/select-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot: id })
    });
    var d = await r.json();
    if (!r.ok) { toast(d.error || 'Failed to save', 'err'); return; }
    toast('Bot selected', 'ok');
    setTimeout(function(){ location.href = '/dashboard'; }, 700);
  } catch (e) {
    toast('Server error', 'err');
  }
}`;

  res.send(page({
    req,
    title: "Kingmor — Choose Bot",
    active: "",
    body,
    script,
    bare: true
  }));
});

app.post("/api/select-bot", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }
  const bot = String(req.body?.bot || "");
  if (bot !== "1" && bot !== "2") {
    return res.status(400).json({ error: "Bot must be 1 or 2" });
  }
  req.session.selectedBot = bot;
  res.json({ ok: true, selectedBot: bot });
});

// ==================== API WHOAMI (debug) ====================
app.get("/api/whoami", (req, res) => {
  if (!req.session || !req.session.user) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    id: req.session.user.id,
    username: req.session.user.username,
    isAdmin: req.session.user.id === ADMIN_USER_ID,
    adminUserIdInServer: ADMIN_USER_ID,
  });
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

app.get("/api/scripts/:id/source", requireAuth, (req, res) => {
  const db = readDB();
  const script = db.find((s) => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });
  if (script.ownerId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  let source = readScriptSource(script);
  if (source == null) return res.status(404).json({ error: "Source file missing" });
  const wantObfView = req.query.obf === "1" || req.query.obf === "true";
  if (wantObfView && script.obfuscated) {
    try { source = obfuscateLua(source); } catch (e) { console.error(e); }
  }
  res.json({
    id: script.id,
    name: script.name,
    enabled: script.enabled,
    obfuscated: !!script.obfuscated,
    source,
  });
});

// Admin can view original source from any user
app.get("/api/scripts/:id/source/admin", (req, res) => {
  const sessionAdmin = req.session && req.session.user && req.session.user.id === ADMIN_USER_ID;
  const headerAdmin = (() => {
    const provided = req.headers["x-requester-id"];
    const secret = req.headers["x-api-secret"];
    if (String(provided) !== ADMIN_USER_ID) return false;
    if (!secret) return false;
    const a = Buffer.from(String(secret));
    const b = Buffer.from(API_SECRET);
    if (a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(a, b); } catch { return false; }
  })();

  if (!sessionAdmin && !headerAdmin) {
    return res.status(403).json({ error: "Forbidden — admin only" });
  }

  const db = readDB();
  const script = db.find((s) => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });
  const source = readScriptSource(script);
  if (source == null) return res.status(404).json({ error: "Source file missing" });
  res.json({
    id: script.id,
    name: script.name,
    ownerId: script.ownerId,
    ownerUsername: script.ownerUsername,
    enabled: script.enabled,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
    source,
  });
});

// Admin download source as .lua file
app.get("/api/scripts/:id/source/admin/download", (req, res) => {
  const sessionAdmin = req.session && req.session.user && req.session.user.id === ADMIN_USER_ID;
  const headerAdmin = (() => {
    const provided = req.headers["x-requester-id"];
    const secret = req.headers["x-api-secret"];
    if (String(provided) !== ADMIN_USER_ID) return false;
    if (!secret) return false;
    const a = Buffer.from(String(secret));
    const b = Buffer.from(API_SECRET);
    if (a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(a, b); } catch { return false; }
  })();
  if (!sessionAdmin && !headerAdmin) {
    return res.status(403).json({ error: "Forbidden — admin only" });
  }
  const db = readDB();
  const script = db.find((s) => s.id === req.params.id);
  if (!script) return res.status(404).json({ error: "Script not found" });
  const source = readScriptSource(script);
  if (source == null) return res.status(404).json({ error: "Source file missing" });
  const safeName = String(script.name || script.id).replace(/[^a-zA-Z0-9._-]+/g, "_") + ".lua";
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  return res.send(source);
});

app.post("/api/scripts", requireAuth, (req, res) => {
  const { name, source, guildId } = req.body;
  if (!name || typeof name !== "string") return res.status(400).json({ error: "Script name is required" });
  if (!source || typeof source !== "string") return res.status(400).json({ error: "Lua source is required" });
  if (source.length > MAX_SOURCE_CHARS) return res.status(413).json({ error: `File too large. Maximum ${Math.floor(MAX_SOURCE_CHARS / (1024 * 1024))}MB.` });

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
  // KM1 protect-at-rest (obfuscation applied at loader time so each run is unique)
  const wantObf = req.body.obfuscate === true || req.body.obfuscate === "true" || req.body.obfuscate === 1;
  const protectedPayload = protectSource(source, id);
  fs.writeFileSync(path.join(SCRIPTS_DIR, filename), protectedPayload, "utf8");

  const script = {
    id, name: name.trim().slice(0, 100), filename, enabled: true,
    protected: true,
    obfuscated: wantObf,
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
    if (source.length > MAX_SOURCE_CHARS) {
      return res.status(413).json({ error: `File too large. Maximum ${Math.floor(MAX_SOURCE_CHARS / (1024 * 1024))}MB.` });
    }
    const filepath = path.join(SCRIPTS_DIR, script.filename);
    fs.writeFileSync(filepath, protectSource(source, script.id), "utf8");
    script.protected = true;
    if (req.body.obfuscate !== undefined) {
      script.obfuscated = req.body.obfuscate === true || req.body.obfuscate === "true" || req.body.obfuscate === 1;
    }
  } else if (req.body.obfuscate !== undefined) {
    script.obfuscated = req.body.obfuscate === true || req.body.obfuscate === "true" || req.body.obfuscate === 1;
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
  const seen = new Set();
  for (const guildId of Object.keys(botConfig)) {
    const g = botConfig[guildId];
    if (!g) continue;
    if (g.panels && typeof g.panels === "object") {
      for (const sid of Object.keys(g.panels)) {
        const p = g.panels[sid];
        if (p && String(p.ownerId) === String(ownerId) && !seen.has(sid)) {
          seen.add(sid);
          count++;
        }
      }
    } else if (g.panelScriptId && String(g.panelOwnerId) === String(ownerId) && !seen.has(g.panelScriptId)) {
      seen.add(g.panelScriptId);
      count++;
    }
  }
  const premium = isPremium(ownerId);
  const max = premium ? 10 : 2;
  // Optional: guildId + scriptId — replacing panel for the SAME script is free
  const guildId = req.query.guildId ? String(req.query.guildId) : null;
  const scriptId = req.query.scriptId ? String(req.query.scriptId) : null;
  let replacing = false;
  if (guildId && botConfig[guildId] && scriptId) {
    const g = botConfig[guildId];
    if (g.panels && g.panels[scriptId] && String(g.panels[scriptId].ownerId) === String(ownerId)) {
      replacing = true;
    } else if (g.panelScriptId === scriptId && String(g.panelOwnerId) === String(ownerId)) {
      replacing = true;
    }
  }
  res.json({
    count, max, premium, replacing,
    remaining: Math.max(0, max - count),
    canCreate: replacing || count < max,
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

  function sendLua(body, status = 200) {
    const text = typeof body === "string" ? body : String(body);
    res.status(status);
    res.set({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": Buffer.byteLength(text, "utf8"),
    });
    return res.end(text, "utf8");
  }

  if (!script) {
    return sendLua("-- Kingmor: Script not found", 404);
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

  // Chunk size under common executor HttpGet limits (~1MB). Scripts larger
  // than CHUNK_THRESHOLD are delivered via a tiny bootstrap that fetches parts.
  const CHUNK_THRESHOLD = 350 * 1024;
  const CHUNK_SIZE = 300 * 1024;

  const userAgent = (req.headers["user-agent"] || "").toLowerCase();
  const accept = (req.headers.accept || "").toLowerCase();
  const hasKey = typeof req.query.key === "string";
  const hasUid = typeof req.query.uid === "string";
  const isChunkReq = typeof req.query.chunk === "string";
  const isKnownExecutor = userAgent.includes("roblox") || userAgent.includes("lua")
    || userAgent.includes("synapse") || userAgent.includes("krnl")
    || userAgent.includes("fluxus") || userAgent.includes("hydrogen")
    || userAgent.includes("scriptware") || userAgent.includes("electron")
    || userAgent.includes("wave") || userAgent.includes("solara")
    || userAgent.includes("xeno") || userAgent.includes("seliware")
    || userAgent.includes("delta") || userAgent.includes("codex")
    || userAgent.includes("executor") || userAgent.includes("httpget");
  const isBrowserNav = accept.includes("text/html") && !hasKey && !hasUid && !isChunkReq && !req.query.raw;
  const isLoaderRequest = !isBrowserNav || isKnownExecutor || hasKey || hasUid || isChunkReq || req.query.raw === "1";

  function validateKey(providedKey) {
    if (isFreeMode) return { ok: true };
    if (!providedKey) return { ok: false, reason: "No Key Provided" };
    const allKeys = readKeys();
    const keyData = allKeys.find(k => k.key === providedKey && k.scriptId === scriptId);
    if (!keyData) return { ok: false, reason: "Invalid Key" };
    if (keyData.expiry && new Date(keyData.expiry) < new Date()) return { ok: false, reason: "Key Expired" };
    return { ok: true, keyData };
  }

  function buildBootstrap(sourceLen, keyValue, freeModeFlag) {
    const parts = Math.max(1, Math.ceil(sourceLen / CHUNK_SIZE));
    const keyLua = freeModeFlag ? "" : String(keyValue || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `-- Kingmor chunked loader (${parts} parts, ${sourceLen} bytes)
local _km_HttpService = game:GetService("HttpService")
local _km_Players = game:GetService("Players")
local _km_lp = _km_Players.LocalPlayer
local _km_hwid = ""
do
  local ok, id = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
  end)
  if ok then _km_hwid = tostring(id) end
end
${freeModeFlag ? `pcall(function()
  game:HttpGet("${base}/api/hwid/check?scriptId=${scriptId}&hwid=" .. _km_hwid)
end)` : `local _km_key = "${keyLua}"
local _km_checkUrl = "${base}/api/hwid/check?scriptId=${scriptId}&key=" .. _km_key .. "&hwid=" .. _km_hwid
local _km_ok, _km_body = pcall(function()
  return game:HttpGet(_km_checkUrl)
end)
if not _km_ok or not _km_body then
  if _km_lp then _km_lp:Kick("[Kingmor] HWID Check Failed") end
  return
end
local _km_data = nil
pcall(function() _km_data = _km_HttpService:JSONDecode(_km_body) end)
if not _km_data or not _km_data.valid then
  local reason = (type(_km_data) == "table" and _km_data.reason) or "Invalid Key"
  if _km_lp then _km_lp:Kick("[Kingmor] " .. tostring(reason)) end
  return
end`}
local _km_parts = ${parts}
local _km_buf = {}
for _km_i = 1, _km_parts do
  local _km_url = "${base}/api/loader/${scriptId}.lua?chunk=" .. tostring(_km_i) .. "&parts=" .. tostring(_km_parts)${freeModeFlag ? "" : ` .. "&key=" .. _km_key`}
  local _km_ok2, _km_chunk = pcall(function()
    return game:HttpGet(_km_url)
  end)
  if not _km_ok2 or type(_km_chunk) ~= "string" or #_km_chunk == 0 then
    if _km_lp then _km_lp:Kick("[Kingmor] Failed to download script part " .. tostring(_km_i)) end
    return
  end
  if string.sub(_km_chunk, 1, 10) == "-- Kingmor" and string.find(_km_chunk, "Kick", 1, true) then
    local fn, err = loadstring(_km_chunk)
    if fn then fn() end
    return
  end
  _km_buf[_km_i] = _km_chunk
end
local _km_src = table.concat(_km_buf)
local _km_fn, _km_err = loadstring(_km_src)
if not _km_fn then
  if _km_lp then _km_lp:Kick("[Kingmor] Script compile error") end
  warn("[Kingmor] compile error:", _km_err)
  return
end
_km_fn()`;
  }

  function buildInlineWrapper(sourceCode, keyValue, freeModeFlag) {
    if (freeModeFlag) {
      return `-- Kingmor Protection System
local _km_hwid = ""
pcall(function()
  _km_hwid = tostring(game:GetService("RbxAnalyticsService"):GetClientId())
end)
pcall(function()
  game:HttpGet("${base}/api/hwid/check?scriptId=${scriptId}&hwid=" .. _km_hwid)
end)

-- User script
${sourceCode}`;
    }
    const keyLua = String(keyValue || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `-- Kingmor Protection System
local _km_HttpService = game:GetService("HttpService")
local _km_Players = game:GetService("Players")
local _km_lp = _km_Players.LocalPlayer
local _km_hwid = ""
pcall(function()
  _km_hwid = tostring(game:GetService("RbxAnalyticsService"):GetClientId())
end)
local _km_key = "${keyLua}"
local _km_ok, _km_body = pcall(function()
  return game:HttpGet("${base}/api/hwid/check?scriptId=${scriptId}&key=" .. _km_key .. "&hwid=" .. _km_hwid)
end)
if not _km_ok or not _km_body then
  if _km_lp then _km_lp:Kick("[Kingmor] HWID Check Failed") end
  return
end
local _km_data = nil
pcall(function() _km_data = _km_HttpService:JSONDecode(_km_body) end)
if not _km_data or not _km_data.valid then
  local reason = (type(_km_data) == "table" and _km_data.reason) or "Invalid Key"
  if _km_lp then _km_lp:Kick("[Kingmor] " .. tostring(reason)) end
  return
end

-- User script
${sourceCode}`;
  }

  if (isLoaderRequest) {
    if (!script.enabled) return sendLua(kickPlayer("Script Disabled"));

    const plainSource = readScriptSource(script);
    if (plainSource == null || plainSource === "") return sendLua(kickPlayer("Source Missing"));
    const providedKey = (req.query.key || "").toLowerCase().trim();

    // ----- Pack part download (multi-instance safe: re-scramble from source) -----
    const isPack = req.query.pack === "1" || req.query.pack === "true";
    const partNum = req.query.part != null ? parseInt(req.query.part, 10) : NaN;
    if (isPack && Number.isFinite(partNum)) {
      const auth = validateKey(providedKey);
      if (!auth.ok) return sendLua(kickPlayer(auth.reason));
      const kh = String(req.query.kh || "");
      const seed = parseInt(req.query.seed, 10) >>> 0;
      const psz = Math.min(Math.max(parseInt(req.query.psz, 10) || 96 * 1024, 16 * 1024), 200 * 1024);
      if (!/^[a-f0-9]{64}$/i.test(kh)) return sendLua(kickPlayer("Bad Pack Key"));
      const packKey = Buffer.from(kh, "hex");
      if (packKey.length !== 32) return sendLua(kickPlayer("Bad Pack Key"));
      const plainBuf = Buffer.from(plainSource, "utf8");
      const startIdx = (Math.max(1, partNum) - 1) * psz;
      if (startIdx >= plainBuf.length) return sendLua("");
      try {
        const slice = scrambleSlice(plainBuf, packKey, seed, startIdx, psz);
        return sendLua(slice.toString("base64"));
      } catch (e) {
        console.error("pack part error:", e);
        return sendLua(kickPlayer("Pack Error"));
      }
    }

    // ----- Full loader bootstrap -----
    const auth = validateKey(providedKey);
    if (!auth.ok) return sendLua(kickPlayer(auth.reason));

    try {
      const doObf = script.obfuscated === true;
      const boot = buildSecureLoader(plainSource, providedKey, isFreeMode, base, scriptId, doObf);
      return sendLua(boot);
    } catch (e) {
      console.error("buildSecureLoader failed:", e);
      return sendLua(kickPlayer("Protect Error"));
    }
  }

  // Browser page (copy loader)
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
      ? `script_key="${userScriptKey}"\\nloadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua?key="..script_key))()`
      : `loadstring(game:HttpGet("${base}/api/loader/${scriptId}.lua"))()`;

  return res.status(200).send(page({
    req, title: `Kingmor • ${script.name}`, active: "", bare: true,
    body: `<main class="wrap center"><div class="card" style="text-align:center;width:min(620px,100%)">
      <span class="badge prem">👑 Source protected</span>
      <h1 style="margin-top:14px">${escapeHtml(script.name)}</h1>
      <p>Copy the loader below and run it in your executor.</p>
      <div class="code">${escapeHtml(loaderDisplay.replace(/\\\\n/g, "\\n"))}</div>
      <div class="stack"><button class="btn btn-gold btn-block" onclick="copyText(LOADER)">Copy loader</button></div>
    </div></main>`,
    script: `var LOADER=${JSON.stringify(loaderDisplay.replace(/\\n/g, "\n").replace(/\\\\n/g, "\n"))};`,
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
    return { ...script, source: readScriptSource(script) };
  }));
});

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
      <div><h2>Need more room?</h2><p>Premium gives you ${SCRIPT_LIMIT.premium} scripts, ${10} panels, free mode and more. Redeem a key in seconds.</p></div>
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


// ==================== STANDALONE OBF TOOL ====================
app.get("/obf", requireAuth, (req, res) => {
  const userId = String(req.session.user.id);
  const premium = isPremium(userId);
  const limit = obfLimitFor(userId);
  const used = getObfUsed(userId);
  const left = Math.max(0, limit - used);

  res.send(page({
    req,
    title: "Kingmor • OBF Script",
    active: "obf",
    body: `
<main class="wrap" style="padding:40px 0 60px">
  <div class="h-row"><h2>OBF Script</h2><div class="ln"></div></div>
  <p style="color:var(--mute);margin-bottom:20px;max-width:640px">
    Paste or upload a Lua script, obfuscate it, and download the result.
    This is a standalone tool — separate from Discord protect / panels.
  </p>

  <div class="stats" style="margin-bottom:24px">
    <div class="stat"><b>${used}/${limit}</b><span>OBF used</span></div>
    <div class="stat"><b>${left}</b><span>Remaining</span></div>
    <div class="stat"><b>${premium ? "Premium" : "Free"}</b><span>Plan (Free ${OBF_LIMIT.free} · Premium ${OBF_LIMIT.premium})</span></div>
  </div>

  ${left <= 0 ? `<div class="alert" style="margin-bottom:16px;padding:14px 16px;border:1px solid rgba(255,107,94,.4);border-radius:12px;background:rgba(255,107,94,.08)">
    <b>Quota reached.</b> Free: ${OBF_LIMIT.free} OBF · Premium: ${OBF_LIMIT.premium} OBF.
    ${!premium ? '<a class="btn btn-gold btn-sm" href="/redeem" style="margin-left:10px">Redeem Premium</a>' : ""}
  </div>` : ""}

  <section class="form">
    <input id="obfName" placeholder="Output filename (optional) e.g. myhub_obf" value="script_obf">
    <div class="file-row">
      <label class="btn btn-ghost btn-sm" for="obfFile">Choose .lua / .txt file</label>
      <input id="obfFile" type="file" accept=".lua,.txt,text/plain">
      <span id="obfFileName">No file selected</span>
    </div>
    <textarea id="obfSource" placeholder="Or paste your Lua source here" style="min-height:280px"></textarea>
    <button class="btn btn-gold" id="obfBtn" onclick="runObf()" ${left <= 0 ? "disabled" : ""}>
      ${left <= 0 ? "Quota reached" : "Obfuscate & download"}
    </button>
  </section>
</main>
`,
    script: `
var MAX=${MAX_SOURCE_CHARS};
function readObfFile(input){
  var f=input.files&&input.files[0]; if(!f)return;
  if(f.size>MAX){toast('Maximum file size is 25MB','err');input.value='';return;}
  $('obfFileName').textContent=f.name;
  var r=new FileReader();
  r.onload=function(){ $('obfSource').value=String(r.result||''); };
  r.readAsText(f);
}
document.getElementById('obfFile').addEventListener('change',function(){ readObfFile(this); });

async function runObf(){
  var source=$('obfSource').value;
  var name=($('obfName').value||'script_obf').trim().replace(/[^a-zA-Z0-9._-]+/g,'_') || 'script_obf';
  if(!source.trim()){toast('Paste or upload a Lua script first','err');return;}
  var b=$('obfBtn'); b.disabled=true; b.textContent='Obfuscating...';
  try{
    var r=await fetch('/api/obf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:source,name:name})});
    if(!r.ok){
      var d={}; try{d=await r.json()}catch(e){}
      toast(d.error||('OBF failed ('+r.status+')'),'err');
      b.disabled=false; b.textContent='Obfuscate & download';
      return;
    }
    var blob=await r.blob();
    var cd=r.headers.get('Content-Disposition')||'';
    var m=cd.match(/filename="?([^";]+)"?/i);
    var fname=m?m[1]:(name+'.lua');
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=fname;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    toast('Obfuscated file downloaded','ok');
    setTimeout(function(){ location.reload(); }, 600);
  }catch(e){
    toast('Server error','err');
    b.disabled=false; b.textContent='Obfuscate & download';
  }
}
`
  }));
});

app.post("/api/obf", requireAuth, (req, res) => {
  const userId = String(req.session.user.id);
  const { source, name } = req.body || {};
  if (!source || typeof source !== "string" || !source.trim()) {
    return res.status(400).json({ error: "Lua source is required" });
  }
  if (source.length > MAX_SOURCE_CHARS) {
    return res.status(413).json({ error: `File too large. Maximum ${Math.floor(MAX_SOURCE_CHARS / (1024 * 1024))}MB.` });
  }

  const limit = obfLimitFor(userId);
  const used = getObfUsed(userId);
  if (used >= limit) {
    return res.status(403).json({
      error: `OBF quota reached (${used}/${limit}). ${isPremium(userId) ? "Premium limit is 15." : "Free limit is 5. Redeem Premium for 15."}`,
      used, limit, premium: isPremium(userId),
    });
  }

  let out;
  try {
    out = obfuscateLua(source);
  } catch (e) {
    console.error("standalone obf failed:", e);
    return res.status(500).json({ error: "Obfuscation failed" });
  }
  if (!out || !String(out).trim()) {
    return res.status(500).json({ error: "Obfuscation produced empty output" });
  }

  const newCount = incObfUsed(userId);
  const safe = String(name || "script_obf").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "script_obf";
  const filename = safe.endsWith(".lua") ? safe : safe + ".lua";

  console.log(`🔒 OBF standalone: user ${userId} -> ${filename} (${newCount}/${limit})`);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Obf-Used", String(newCount));
  res.setHeader("X-Obf-Limit", String(limit));
  return res.send(out);
});

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
    <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="badge ${req.session.selectedBot === "2" ? "free" : "prem"}">
        Active bot: ${req.session.selectedBot === "2" ? BOT_2_TAG : BOT_1_TAG}
      </span>
      <a class="btn btn-ghost btn-sm" href="/select-bot">Change bot</a>
      <a class="btn btn-ghost btn-sm" href="${req.session.selectedBot === "2" ? BOT_INVITE_2 : BOT_INVITE}" target="_blank" rel="noopener">Invite this bot</a>
    </div>
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
    <label style="display:flex;align-items:center;gap:10px;margin:12px 0;cursor:pointer;user-select:none">
      <input type="checkbox" id="scriptObf" checked style="width:18px;height:18px;accent-color:var(--gold)">
      <span><b>Obfuscate on deliver</b> <span style="color:var(--mute);font-size:13px">(extra layer when buyer runs loader)</span></span>
    </label>
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
    <label style="display:flex;align-items:center;gap:10px;margin:12px 0;cursor:pointer;user-select:none">
      <input type="checkbox" id="editObf" style="width:18px;height:18px;accent-color:var(--gold)">
      <span><b>Obfuscate on deliver</b></span>
    </label>
    <div id="editObfNote" style="display:none;margin-bottom:10px">
      <button class="btn btn-ghost btn-sm" type="button" onclick="viewObfSource()">View obfuscated preview</button>
      <span style="color:var(--mute);font-size:12px;margin-left:8px">Preview only — keep editing plain source</span>
    </div>
    <div class="modal-act">
      <button class="btn btn-ghost" onclick="closeEdit()">Cancel</button>
      <button class="btn btn-gold" id="editSaveBtn" onclick="saveEdit()">Save changes</button>
    </div>
  </div>
</div>`;

  const script = `
var editingId=null;
var MAX=25*1024*1024;
function readFileInto(input,nameEl,onText){
  var f=input.files[0];if(!f)return;
  var n=f.name.toLowerCase();
  if(!n.endsWith('.lua')&&!n.endsWith('.txt')){toast('Only .lua or .txt files are allowed','err');input.value='';return;}
  if(f.size>MAX){toast('Maximum file size is 25MB','err');input.value='';return;}
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
  var obfuscate=!!$('scriptObf')&&$('scriptObf').checked;
  if(!name){toast('Enter a script name','err');return;}
  if(!source.trim()){toast('Add your Lua source','err');return;}
  var b=$('upBtn');b.disabled=true;b.textContent='Uploading...';
  try{
    var r=await fetch('/api/scripts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,source:source,obfuscate:obfuscate})});
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
  if($('editObf')) $('editObf').checked=false;
  if($('editObfNote')) $('editObfNote').style.display='none';
  $('editModal').classList.add('show');
  try{
    var r=await fetch('/api/scripts/'+id+'/source');var d=await r.json();
    if(!r.ok){toast(d.error||'Failed to load script','err');closeEdit();return;}
    $('editName').value=d.name;$('editSource').value=d.source||'';
    if($('editObf')) $('editObf').checked=!!d.obfuscated;
    if($('editObfNote')) $('editObfNote').style.display=d.obfuscated?'block':'none';
  }catch(e){toast('Failed to load script source','err');closeEdit();}
}
async function viewObfSource(){
  if(!editingId)return;
  try{
    var r=await fetch('/api/scripts/'+editingId+'/source?obf=1');var d=await r.json();
    if(!r.ok){toast(d.error||'Failed','err');return;}
    $('editSource').value=d.source||'';
    toast('Showing obfuscated preview — do not save unless you intend to replace source','ok');
  }catch(e){toast('Failed to load OBF preview','err');}
}
function closeEdit(){$('editModal').classList.remove('show');editingId=null;}
async function saveEdit(){
  if(!editingId)return;
  var name=$('editName').value.trim(),source=$('editSource').value;
  if(!name){toast('Script name cannot be empty','err');return;}
  if(!source.trim()){toast('Source code cannot be empty','err');return;}
  var b=$('editSaveBtn');b.disabled=true;b.textContent='Saving...';
  try{
    var r=await fetch('/api/scripts/'+editingId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,source:source,obfuscate:(!!$('editObf')&&$('editObf').checked)})});
    var d=await r.json();
    if(!r.ok){toast(d.error||'Failed to save','err');b.disabled=false;b.textContent='Save changes';return;}
    location.reload();
  }catch(e){toast('Server error','err');b.disabled=false;b.textContent='Save changes';}
}
$('editModal').addEventListener('click',function(e){if(e.target.id==='editModal')closeEdit();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&$('editModal').classList.contains('show'))closeEdit();});`;

  res.send(page({ req, title: "Kingmor — Dashboard", active: "dashboard", body, script }));
});

// ==================== ADMIN: PLAYER SOURCE ====================
app.get("/admin", isAdmin, (req, res) => {
  res.redirect("/admin/sources");
});

app.get("/admin/sources", isAdmin, (req, res) => {
  const db = readDB();
  const keys = readKeys();
  const base = getBaseUrl(req);

  const grouped = {};
  for (const s of db) {
    if (!grouped[s.ownerId]) {
      grouped[s.ownerId] = {
        ownerId: s.ownerId,
        ownerUsername: s.ownerUsername || "Unknown",
        scripts: [],
      };
    }
    grouped[s.ownerId].scripts.push(s);
  }

  const users = Object.values(grouped).sort((a, b) =>
    (a.ownerUsername || "").localeCompare(b.ownerUsername || "")
  );

  const totalScripts = db.length;
  const totalUsers = users.length;
  const totalKeys = keys.length;
  const enabledCount = db.filter(s => s.enabled).length;

  const userCards = users.map(u => {
    const scriptCards = u.scripts.map(s => {
      const filepath = path.join(SCRIPTS_DIR, s.filename);
      const exists = fs.existsSync(filepath);
      const size = exists ? fs.statSync(filepath).size : 0;
      const sizeStr = size > 1024 * 1024
        ? (size / 1024 / 1024).toFixed(2) + " MB"
        : size > 1024 ? (size / 1024).toFixed(1) + " KB" : size + " B";
      const scriptKeys = keys.filter(k => k.scriptId === s.id);
      const usedKeys = scriptKeys.filter(k => k.userId).length;
      const upd = s.updatedAt ? fmtDate(s.updatedAt) : (s.createdAt ? fmtDate(s.createdAt) : "-");
      return `
        <div class="src-script" data-script-id="${s.id}">
          <div class="src-head">
            <div>
              <div class="src-title">
                <span class="sc-st ${s.enabled ? "on" : "off"}">${s.enabled ? "● ON" : "● OFF"}</span>
                ${escapeHtml(s.name)}
              </div>
              <div class="src-meta">
                <span title="Script ID">🆔 ${escapeHtml(s.id)}</span>
                <span>📦 ${sizeStr}</span>
                <span>🔑 ${usedKeys}/${scriptKeys.length} keys used</span>
                <span>📅 ${escapeHtml(upd)}</span>
              </div>
            </div>
            <div class="src-act">
              <button class="btn btn-ghost btn-sm" onclick="viewSource('${s.id}', this)">View Source</button>
              <a class="btn btn-ghost btn-sm" href="/api/scripts/${s.id}/source/admin/download" download>Download</a>
              <button class="btn btn-ghost btn-sm" onclick="copyLoader('${escapeHtml(base)}/api/loader/${s.id}.lua')">Loader</button>
            </div>
          </div>
          <pre id="src-${s.id}" class="code src-pre" style="display:none"></pre>
        </div>
      `;
    }).join("");

    return `
      <div class="src-user">
        <div class="src-user-head">
          <div class="src-user-avatar">👤</div>
          <div>
            <div class="src-user-name">${escapeHtml(u.ownerUsername)}</div>
            <div class="src-user-id">ID: ${escapeHtml(u.ownerId)} • ${u.scripts.length} script(s)</div>
          </div>
          <div class="src-user-badges">
            ${isPremium(u.ownerId) ? '<span class="badge prem">👑 Premium</span>' : '<span class="badge free">Free</span>'}
          </div>
        </div>
        <div class="src-user-body">${scriptCards}</div>
      </div>
    `;
  }).join("");

  const body = `
<main class="wrap" style="padding-bottom:60px">
  <div class="page-head">
    <h1>🕵️ Player Source</h1>
    <p>View and download original Lua sources uploaded by every user. Admin only.</p>
  </div>

  <div class="stats" style="margin-top:0">
    <div class="stat"><b>${totalUsers}</b><span>Total users</span></div>
    <div class="stat"><b>${totalScripts}</b><span>Total scripts</span></div>
    <div class="stat"><b>${enabledCount}</b><span>Enabled scripts</span></div>
    <div class="stat"><b>${totalKeys}</b><span>Total keys</span></div>
  </div>

  <div class="h-row">
    <h2>Search</h2>
    <div class="ln"></div>
  </div>
  <input id="srcSearch" placeholder="Search by username or script name..." style="margin-bottom:20px">

  <div class="h-row">
    <h2>All players</h2>
    <div class="ln"></div>
  </div>

  <div id="srcList">
    ${userCards || `<div class="empty">No scripts have been uploaded yet.</div>`}
  </div>
</main>

<style>
.src-user{margin-bottom:22px;padding:20px;border:1px solid var(--line2);border-radius:16px;background:var(--panel)}
.src-user-head{display:flex;align-items:center;gap:14px;padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:14px;flex-wrap:wrap}
.src-user-avatar{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--gold),var(--amber));font-size:20px;flex-shrink:0}
.src-user-name{font-weight:700;font-size:16px;letter-spacing:-.3px}
.src-user-id{font-size:12px;color:var(--mute);font-family:var(--mono);margin-top:2px}
.src-user-badges{margin-left:auto}
.src-user-body{display:grid;gap:12px}
.src-script{padding:14px;border:1px solid var(--line);border-radius:12px;background:#0e0c0a}
.src-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start}
.src-title{font-weight:700;font-size:15px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.src-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--mute);font-family:var(--mono);margin-top:8px}
.src-act{display:flex;gap:8px;flex-wrap:wrap}
.src-pre{margin-top:12px;max-height:420px;overflow:auto;font-size:12px;line-height:1.55}
@media(max-width:700px){
  .src-head{flex-direction:column}
  .src-act{width:100%}
  .src-act .btn{flex:1}
  .src-user-badges{margin-left:0}
}
</style>

<script>
async function viewSource(id, btn){
  var pre = document.getElementById('src-' + id);
  if (pre.style.display === 'block') {
    pre.style.display = 'none';
    btn.textContent = 'View Source';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Loading...';
  pre.style.display = 'block';
  pre.textContent = '// Loading source...';
  try {
    var r = await fetch('/api/scripts/' + id + '/source/admin');
    if (!r.ok) {
      pre.textContent = '// Failed to load source (HTTP ' + r.status + ')';
      btn.disabled = false;
      btn.textContent = 'View Source';
      return;
    }
    var d = await r.json();
    pre.textContent = d.source || '// Empty source';
    btn.disabled = false;
    btn.textContent = 'Hide Source';
  } catch (e) {
    pre.textContent = '// Error: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'View Source';
  }
}

function downloadSource(id, name) {
  // Direct file download via dedicated endpoint (session cookie is sent automatically)
  var a = document.createElement('a');
  a.href = '/api/scripts/' + id + '/source/admin/download';
  a.download = '';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof toast === 'function') toast('Downloading...', 'ok');
}

function copyLoader(url){
  copyText('loadstring(game:HttpGet("' + url + '"))()');
}

document.getElementById('srcSearch').addEventListener('input', function(e){
  var q = e.target.value.toLowerCase().trim();
  document.querySelectorAll('.src-user').forEach(function(card){
    var text = card.textContent.toLowerCase();
    card.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
});
</script>`;

  res.send(page({
    req,
    title: "Kingmor — Player Source",
    active: "sources",
    body,
  }));
});

// ==================== ADMIN PAGE ====================

app.get("/admin/dashboard", isAdmin, (req, res) => {
  const db = readDB();
  const keys = readKeys();
  const premium = readPremium();
  const pkeys = readPremiumKeys();

  const rows = [
    ["Total scripts", db.length],
    ["Total users", new Set(db.map((s) => s.ownerId)).size],
    ["Total keys", keys.length],
    ["Enabled scripts", db.filter((s) => s.enabled).length],
    ["Premium users", Object.keys(premium).filter((id) => isPremium(id)).length],
    ["Premium keys (unused)", pkeys.filter((k) => !k.redeemedBy).length],
    ["Premium keys (redeemed)", pkeys.filter((k) => k.redeemedBy).length],
  ];
  const body = `<main class="wrap center"><div class="card" style="width:min(560px,100%)">
    <h1>Admin overview</h1>
    <div class="kv">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    <div class="stack">
      <a class="btn btn-gold btn-block" href="/admin/sources">🕵️ Player Source</a>
      <a class="btn btn-ghost btn-block" href="/dashboard">Back to dashboard</a>
    </div>
  </div></main>`;
  res.send(page({ req, title: "Kingmor — Admin", active: "admin", body, bare: true }));
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
