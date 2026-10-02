# 👑 Kingmor — Premium Lua Script Protection

Premium Roblox Lua script protection system with HWID lock, key system, and Discord bot integration.

## ✨ Features

### 🆓 Free Plan
- Upload unlimited scripts (max **2 panels**)
- Key system + HWID lock
- `/setuppanel`, `/genkey`, `/whitelist` (lifetime allowed!)
- `/blacklist`, `/unblacklist` user
- `/setwebhook`
- Self HWID reset (1 day cooldown)

### 👑 Premium Plan — Rp 20.000 / $2
- Everything in Free
- Up to **5 panels** (vs 2 in free)
- `/freemode` — enable free mode
- `/blacklistrole` — blacklist roles
- `/unblacklist role`
- `/cooldownhwid` — custom HWID cooldown
- `/resethwiduser` — reset HWID for others
- Priority support

## 🚀 Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Copy env file**
   ```bash
   cp .env.example .env
   ```
   Fill in your `BOT_TOKEN`, `API_SECRET`, `SESSION_SECRET`, `DISCORD_CLIENT_SECRET`.

3. **Discord OAuth Setup**
   - Go to https://discord.com/developers/applications
   - Your App → OAuth2 → Add Redirect: `http://localhost:3000/auth/discord/callback`
   - Copy Client Secret to `.env`

4. **Run**
   ```bash
   # Terminal 1 - Web server
   npm start

   # Terminal 2 - Discord bot
   npm run bot

   # Or both at once
   npm run both
   ```

## 🎫 Bot Commands

| Command | Plan | Description |
|---------|------|-------------|
| `/setuppanel` | Free (2 max) / Premium (5 max) | Setup panel |
| `/whitelist` | Free/Premium | Whitelist user/role (lifetime OK) |
| `/genkey` | Free/Premium | Generate keys |
| `/keypremium` | Owner only | Create premium key for web redeem |
| `/freemode` | Premium | Enable free mode |
| `/blacklistrole` | Premium | Blacklist role |
| `/cooldownhwid` | Premium | Set HWID cooldown |
| `/premiumwhitelist` | Owner only | Grant/revoke premium |
| `/premiuminfo` | Everyone | Premium info |

## 🔑 Premium Key Redeem Flow

1. Owner creates key: `/keypremium duration:30d amount:5`
2. Bot gives key (e.g. `kmprem_abc123...`)
3. User goes to web dashboard → clicks "Redeem Premium Key"
4. Pastes key → premium activated instantly

## 📁 Data Files

All data stored in `data/`:
- `scripts.json` — uploaded scripts
- `keys.json` — script access keys
- `premium.json` — premium users
- `premium_keys.json` — redeemable premium keys
- `botconfig.json` — bot panel config
- `blacklist.json` — blacklist entries
- `hwid_cooldowns.json` — HWID reset cooldowns

## 🛡️ Security

- `API_SECRET` required for internal API calls (bot ↔ web)
- Session-based auth for web dashboard
- Discord OAuth for user login
- HWID lock per key
- Rate limiting recommended (add `express-rate-limit` for production)

## 📝 License

MIT