const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const CONFIG = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID || "1545625902585487370",
  apiBase: process.env.API_BASE,
  apiSecret: process.env.API_SECRET
};

const missing = [];
if (!CONFIG.token) missing.push("BOT_TOKEN");
if (!CONFIG.apiBase) missing.push("API_BASE");
if (!CONFIG.apiSecret) missing.push("API_SECRET");

if (missing.length > 0) {
  console.error(`❌ FATAL: The following env vars are not set: ${missing.join(", ")}`);
  process.exit(1);
}

CONFIG.apiBase = CONFIG.apiBase.replace(/\/+$/, "");

// Owner ID yang boleh pakai /premiumwhitelist
const OWNER_ID = "1485940617342353594";

const DATA_DIR = path.join(__dirname, "data");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");
const CONFIG_FILE = path.join(DATA_DIR, "botconfig.json");
const BLACKLIST_FILE = path.join(DATA_DIR, "blacklist.json");
const PREMIUM_FILE = path.join(DATA_DIR, "premium.json");
const HWID_COOLDOWN_FILE = path.join(DATA_DIR, "hwid_cooldowns.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, "[]", "utf8");
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, "{}", "utf8");
if (!fs.existsSync(BLACKLIST_FILE)) fs.writeFileSync(BLACKLIST_FILE, "[]", "utf8");
if (!fs.existsSync(PREMIUM_FILE)) fs.writeFileSync(PREMIUM_FILE, "{}", "utf8");
if (!fs.existsSync(HWID_COOLDOWN_FILE)) fs.writeFileSync(HWID_COOLDOWN_FILE, "{}", "utf8");

// ==================== FILE HELPERS ====================
function readKeys() { try { return JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")); } catch { return []; } }
function writeKeys(data) { fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2)); }
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; } }
function writeConfig(data) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2)); }
function readBlacklist() { try { return JSON.parse(fs.readFileSync(BLACKLIST_FILE, "utf8")); } catch { return []; } }
function writeBlacklist(data) { fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2)); }
function readPremium() { try { return JSON.parse(fs.readFileSync(PREMIUM_FILE, "utf8")); } catch { return {}; } }
function writePremium(data) { fs.writeFileSync(PREMIUM_FILE, JSON.stringify(data, null, 2)); }

// ==================== PREMIUM HELPERS ====================
const PREMIUM_INFO = {
  discord: "https://discord.gg/7Sqw6arUM",
  priceIDR: "Rp 20.000",
  priceUSD: "$2"
};

function isPremiumLocal(userId) {
  const p = readPremium();
  const entry = p[String(userId)];
  if (!entry) return false;
  if (entry.expiry && new Date(entry.expiry) < new Date()) return false;
  return true;
}

async function checkPremium(userId) {
  try {
    const res = await axios.get(`${CONFIG.apiBase}/api/premium/status`, {
      headers: internalHeaders, params: { userId }, timeout: 8000
    });
    return res.data.premium === true;
  } catch {
    return isPremiumLocal(userId);
  }
}

function premiumRequiredReply(commandName, extraNote) {
  const embed = new EmbedBuilder()
    .setTitle("👑 Premium Feature")
    .setDescription(
      `The command \`/${commandName}\` is only available for **Kingmor Premium** users.\n\n` +
      `**Why upgrade?**\n` +
      `• 🚫 \`/blacklistrole\` — blacklist roles\n` +
      `• 🔓 \`/unblacklist role\` — unblacklist roles\n` +
      `• ⏱️ \`/cooldownhwid\` — custom HWID reset cooldown\n` +
      `• 🔄 \`/resethwiduser\` — reset HWID for any user\n` +
      `• ♾️ Lifetime whitelist (no 30-day limit)\n\n` +
      `**Price:**\n` +
      `🇮🇩 ${PREMIUM_INFO.priceIDR} • 🌍 ${PREMIUM_INFO.priceUSD}\n\n` +
      `**How to buy:**\n` +
      `1. Join our Discord server\n` +
      `2. Open a **ticket** in the ticket channel\n` +
      `3. Go to the **purchasing** channel\n` +
      `4. Follow the instructions to complete your purchase`
    )
    .setColor(0xFFD700)
    .setFooter({ text: "Kingmor 👑" });

  if (extraNote) embed.addFields({ name: "ℹ️ Note", value: extraNote });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("💎 Buy Premium")
      .setStyle(ButtonStyle.Link)
      .setURL(PREMIUM_INFO.discord)
  );

  return { embeds: [embed], components: [row], ephemeral: true };
}

// ==================== DURATION HELPERS ====================
function parseDuration(str) {
  const m = String(str).trim().toLowerCase().match(/^(\d+)\s*(s|m|h|d|w)?$/);
  if (!m) return null;
  const n = parseInt(m[1]);
  const unit = (m[2] || "m").toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[unit];
  return n * mult;
}
function formatDuration(ms) {
  if (ms >= 604800000) return `${(ms / 604800000).toFixed(2)} week(s)`;
  if (ms >= 86400000) return `${(ms / 86400000).toFixed(2)} day(s)`;
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(2)} hour(s)`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(2)} minute(s)`;
  return `${(ms / 1000).toFixed(0)} second(s)`;
}

// ==================== BLACKLIST HELPERS ====================
function isBlacklisted(userId) {
  return readBlacklist().some(b => b.type !== "role" && String(b.userId) === String(userId));
}
function isRoleBlacklisted(roleId) {
  return readBlacklist().some(b => b.type === "role" && String(b.roleId) === String(roleId));
}
async function checkUserBlacklisted(interaction) {
  if (isBlacklisted(interaction.user.id)) return "user";
  if (!interaction.guild) return null;
  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    for (const roleId of member.roles.cache.keys()) {
      if (isRoleBlacklisted(roleId)) return roleId;
    }
  } catch {}
  return null;
}

// ==================== MISC HELPERS ====================
function generateKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 40 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function hasPermission(member, guildId) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const cfg = readConfig();
  const roleId = cfg[guildId]?.whitelistRole;
  if (!roleId) return false;
  return member.roles.cache.has(roleId);
}

function getGuildPanelScript(guildId) {
  const cfg = readConfig()[guildId] || {};
  const scriptId = cfg.panelScriptId;
  const ownerId = cfg.panelOwnerId;
  if (!scriptId) return null;
  return { scriptId, ownerId: ownerId || null };
}

const internalHeaders = { "x-api-secret": CONFIG.apiSecret };

async function fetchScriptById(scriptId) {
  try {
    const res = await axios.get(`${CONFIG.apiBase}/api/scripts/internal/${scriptId}`, {
      headers: internalHeaders, timeout: 8000
    });
    return res.data || null;
  } catch (err) {
    console.error(`❌ fetchScriptById(${scriptId}) failed: ${describeAxiosError(err)}`);
    return null;
  }
}

function describeAxiosError(err) {
  if (err.response) return `HTTP ${err.response.status} — ${JSON.stringify(err.response.data)}`;
  if (err.request) return `No response from server: ${err.code || err.message}`;
  return err.message;
}

// ==================== CACHE ====================
const scriptCache = new Map();
const CACHE_TTL = 30000;

async function getScriptsByOwner(ownerId, { bypassCache = false } = {}) {
  const cacheKey = `scripts_${ownerId}`;
  const cached = scriptCache.get(cacheKey);
  if (!bypassCache && cached && (Date.now() - cached.timestamp) < CACHE_TTL) return cached.data;
  try {
    const res = await axios.get(`${CONFIG.apiBase}/api/scripts/internal`, {
      headers: internalHeaders, params: { ownerId }, timeout: 8000
    });
    const data = res.data || [];
    scriptCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    console.error(`❌ getScriptsByOwner(${ownerId}) failed: ${describeAxiosError(err)}`);
    if (cached) {
      console.warn(`⚠️  Using stale cache for ownerId ${ownerId}`);
      return cached.data;
    }
    return [];
  }
}

function clearCache(ownerId) {
  if (ownerId) scriptCache.delete(`scripts_${ownerId}`);
  else scriptCache.clear();
}

// ==================== TEMP DATA ====================
const panelTempData = new Map();
const buyerRoleTempData = new Map();
const freeModeTempData = new Map();
const webhookTempData = new Map();
const blacklistRoleTempData = new Map();
const cooldownTempData = new Map();
const resetHwidUserTempData = new Map();
const premiumWhitelistTempData = new Map();

// ==================== GUILDS LIST ====================
async function updateGuildsList() {
  try {
    const guilds = client.guilds.cache.map(g => ({
      id: g.id, name: g.name, icon: g.icon, memberCount: g.memberCount
    }));
    await axios.post(`${CONFIG.apiBase}/api/admin/guilds/update`,
      { guilds }, { headers: internalHeaders, timeout: 8000 }
    );
    console.log(`✅ Updated guilds list: ${guilds.length} guilds`);
  } catch (err) {
    console.error(`❌ Failed to update guilds list: ${describeAxiosError(err)}`);
  }
}

// ==================== CLIENT ====================
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const commands = [
  new SlashCommandBuilder()
    .setName("setuppanel")
    .setDescription("Setup panel embed with script selection")
    .addStringOption(o => o.setName("title").setDescription("Title").setRequired(true))
    .addStringOption(o => o.setName("description").setDescription("Description").setRequired(true)),

  new SlashCommandBuilder()
    .setName("whitelistrole")
    .setDescription("Set admin role")
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("setbuyerrole")
    .setDescription("Set buyer role for specific script")
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("genkey")
    .setDescription("Generate key")
    .addIntegerOption(o => o.setName("days").setDescription("Duration in days (0=lifetime)").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Number of keys").setRequired(false)),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist user/role for the script registered in this server")
    .addIntegerOption(o => o.setName("days").setDescription("Duration in days (0=lifetime, PREMIUM only)").setRequired(true))
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(false))
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(false)),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist user")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("blacklistrole")
    .setDescription("[PREMIUM] Blacklist a role from using scripts")
    .addRoleOption(o => o.setName("role").setDescription("Role to blacklist").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Unblacklist user or role (role is PREMIUM only)")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(false))
    .addRoleOption(o => o.setName("role").setDescription("Role (PREMIUM only)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("revoke")
    .setDescription("Revoke key/user")
    .addStringOption(o => o.setName("key").setDescription("Key").setRequired(false))
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(false)),

  new SlashCommandBuilder()
    .setName("listkeys")
    .setDescription("View all keys"),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View user info")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("deletescript")
    .setDescription("Delete your script from Kingmor"),

  new SlashCommandBuilder()
    .setName("freemode")
    .setDescription("Enable or disable free mode for a script"),

  new SlashCommandBuilder()
    .setName("resethwid")
    .setDescription("Reset HWID for user")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("resethwiduser")
    .setDescription("[PREMIUM] Reset HWID for a specific user on a specific script")
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)),

  new SlashCommandBuilder()
    .setName("cooldownhwid")
    .setDescription("[PREMIUM] Set custom HWID reset cooldown for a script")
    .addStringOption(o =>
      o.setName("cooldown")
        .setDescription("Cooldown duration (e.g. 30m, 1h, 6h, 1d, 3d)")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("premiuminfo")
    .setDescription("View premium info, price, and how to buy"),

  // ==================== PREMIUMWHITELIST (OWNER ONLY) ====================
  new SlashCommandBuilder()
    .setName("premiumwhitelist")
    .setDescription("[OWNER ONLY] Grant or revoke Premium access for a user")
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("Grant Premium access to a user")
        .addUserOption(o => o.setName("user").setDescription("User to grant Premium").setRequired(true))
        .addStringOption(o => o.setName("duration")
          .setDescription("Duration (e.g. 7d, 30d, 1y, lifetime)")
          .setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("remove")
        .setDescription("Revoke Premium access from a user")
        .addUserOption(o => o.setName("user").setDescription("User to revoke Premium").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("List all Premium users")
    )
    .addSubcommand(sub =>
      sub.setName("check")
        .setDescription("Check Premium status of a user")
        .addUserOption(o => o.setName("user").setDescription("User to check").setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName("clearcache")
    .setDescription("Clear script cache (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("checkconnection")
    .setDescription("Check connection between bot and web dashboard (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("setwebhook")
    .setDescription("Set a webhook URL to receive notifications when a script is executed")
    .addStringOption(o =>
      o.setName("url")
        .setDescription("Discord Webhook URL")
        .setRequired(true)
    ),
].map(c => c.toJSON());

client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);
  try {
    await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: commands });
    console.log(`👑 Bot ready: ${client.user.tag}`);
    console.log(`🔗 API_BASE: ${CONFIG.apiBase}`);
    console.log(`💎 Premium: ${PREMIUM_INFO.priceIDR} / ${PREMIUM_INFO.priceUSD}`);
    console.log(`📢 Discord: ${PREMIUM_INFO.discord}`);
    console.log(`🔐 Owner ID: ${OWNER_ID}`);
    await updateGuildsList();
    setInterval(updateGuildsList, 60 * 1000);
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
});

client.on("guildCreate", async (guild) => {
  console.log(`✅ Joined guild: ${guild.name} (${guild.id})`);
  await updateGuildsList();
});

client.on("guildDelete", async (guild) => {
  console.log(`❌ Left guild: ${guild.name} (${guild.id})`);
  await updateGuildsList();
});

// ==================== PANEL EMBED ====================
async function sendPanelEmbed(channel, title, description, scriptId, scriptName, ownerId, guildId) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xFFD700)
    .setFooter({ text: `Kingmor 👑 • ${scriptName}` })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("redeem_key").setLabel("Redeem Key").setEmoji("🔑").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`get_script:${ownerId}:${scriptId}`).setLabel("Get Script").setEmoji("👑").setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`get_role:${scriptId}`).setLabel("Get Role").setEmoji("👤").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`reset_hwid:${scriptId}`).setLabel("Reset HWID").setEmoji("⚙️").setStyle(ButtonStyle.Secondary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`get_stats:${scriptId}`).setLabel("Get Stats").setEmoji("📊").setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ embeds: [embed], components: [row1, row2, row3] });

  const cfg = readConfig();
  if (!cfg[guildId]) cfg[guildId] = {};
  cfg[guildId].panelChannelId = channel.id;
  cfg[guildId].panelScriptId = scriptId;
  cfg[guildId].panelOwnerId = ownerId;
  writeConfig(cfg);
}

// ==================== INTERACTION HANDLER ====================
client.on("interactionCreate", async interaction => {
  try {
    // Blacklist check untuk semua interaksi di guild
    if ((interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) && interaction.guild) {
      const blCheck = await checkUserBlacklisted(interaction);
      if (blCheck) {
        const msg = blCheck === "user"
          ? "❌ You have been blacklisted by the owner."
          : `❌ Your role <@&${blCheck}> has been blacklisted from using scripts.`;
        return interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }

    // ==================== BUTTONS ====================
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith("get_script:")) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const parts = customId.split(":");
          const ownerId = parts[1];
          const scriptId = parts[2];

          let isFreeMode = false;
          try {
            const freeModeRes = await axios.get(`${CONFIG.apiBase}/api/freemode/${interaction.guildId}/${scriptId}`, {
              headers: internalHeaders, timeout: 8000
            });
            isFreeMode = freeModeRes.data.freeMode === true;
          } catch (err) {
            console.error(`❌ freemode check failed: ${describeAxiosError(err)}`);
            const cfg = readConfig()[interaction.guildId] || {};
            isFreeMode = cfg.freeMode && cfg.freeMode[scriptId] === true;
          }

          if (isFreeMode) {
            const loaderCode = `loadstring(game:HttpGet("${CONFIG.apiBase}/api/loader/${scriptId}.lua"))()`;
            return interaction.editReply({ content: `\`\`\`lua\n${loaderCode}\n\`\`\`` }).catch(() => {});
          }

          const keys = readKeys();
          const validKey = keys.find(k => String(k.userId) === String(interaction.user.id) && k.scriptId === scriptId);

          if (!validKey) {
            return interaction.editReply({ content: "❌ You don't have a key for this script!" }).catch(() => {});
          }

          if (validKey.expiry && new Date(validKey.expiry) < new Date()) {
            return interaction.editReply({ content: "❌ Your key has expired!" }).catch(() => {});
          }

          const loaderCode = `script_key = "${validKey.key}"\nloadstring(game:HttpGet("${CONFIG.apiBase}/api/loader/${validKey.scriptId}.lua?key="..script_key))()`;
          return interaction.editReply({ content: `\`\`\`lua\n${loaderCode}\n\`\`\`` }).catch(() => {});
        } catch (err) {
          console.error("Get script error:", err);
          return interaction.editReply({ content: "❌ Failed to get script. Please try again." }).catch(() => {});
        }
      }

      if (customId === "redeem_key") {
        try {
          const modal = new ModalBuilder().setCustomId("modal_redeem").setTitle("Redeem Key");
          const keyInput = new TextInputBuilder()
            .setCustomId("input_key").setLabel("Key")
            .setPlaceholder("Enter your key here...").setStyle(TextInputStyle.Short).setRequired(true);
          modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
          return interaction.showModal(modal).catch(() => {});
        } catch {
          return interaction.reply({ content: "❌ Failed to open modal.", ephemeral: true }).catch(() => {});
        }
      }

      if (customId.startsWith("get_role:") || customId === "get_role") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = customId.includes(":") ? customId.split(":")[1] : null;
          const cfg = readConfig()[interaction.guildId] || {};
          const buyerRoleId = scriptId && cfg.buyerRoles && cfg.buyerRoles[scriptId]
            ? cfg.buyerRoles[scriptId] : cfg.buyerRole;

          if (!buyerRoleId) return interaction.editReply({ content: "❌ Buyer role has not been set for this script!" }).catch(() => {});

          const keys = readKeys();
          const userKeys = keys.filter(k => String(k.userId) === String(interaction.user.id));
          if (userKeys.length === 0) return interaction.editReply({ content: "❌ You don't have a key!" }).catch(() => {});

          if (scriptId) {
            const validKey = userKeys.find(k => k.scriptId === scriptId);
            if (!validKey) return interaction.editReply({ content: "❌ You don't have a key for this script!" }).catch(() => {});
          }

          const member = await interaction.guild.members.fetch(interaction.user.id);
          if (member.roles.cache.has(buyerRoleId)) return interaction.editReply({ content: "✅ You already have the buyer role!" }).catch(() => {});
          await member.roles.add(buyerRoleId);
          return interaction.editReply({ content: "✅ Buyer role has been assigned!" }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to assign role." }).catch(() => {});
        }
      }

      if (customId.startsWith("reset_hwid:") || customId === "reset_hwid") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = customId.includes(":") ? customId.split(":")[1] : null;
          if (!scriptId) {
            return interaction.editReply({ content: "❌ Invalid script reference." }).catch(() => {});
          }

          const result = await axios.post(`${CONFIG.apiBase}/api/hwid/reset-self`,
            { userId: interaction.user.id, scriptId },
            { headers: internalHeaders, timeout: 8000 }
          );

          const data = result.data;
          if (data.cooldown) {
            const remaining = formatDuration(data.remainingMs);
            const cooldownTotal = formatDuration(data.cooldownMs);
            return interaction.editReply({
              content: `⏳ You already reset your HWID recently.\n**Cooldown:** ${cooldownTotal}\n**Try again in:** ${remaining}`
            }).catch(() => {});
          }
          if (!data.success) {
            return interaction.editReply({ content: `❌ ${data.reason || "Failed to reset HWID"}` }).catch(() => {});
          }

          return interaction.editReply({
            content: `✅ HWID has been reset!\nYou can reset again in **${formatDuration(data.cooldownMs)}**.`
          }).catch(() => {});
        } catch (err) {
          console.error(`❌ reset_hwid failed: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to reset HWID." }).catch(() => {});
        }
      }

      if (customId.startsWith("get_stats:") || customId === "get_stats") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = customId.includes(":") ? customId.split(":")[1] : null;
          const keys = readKeys();
          const userKeys = keys.filter(k => String(k.userId) === String(interaction.user.id));
          if (userKeys.length === 0) return interaction.editReply({ content: "❌ You don't have any active key!" }).catch(() => {});

          const relevantKeys = scriptId ? userKeys.filter(k => k.scriptId === scriptId) : userKeys;
          let stats = `📊 **YOUR KEY STATUS**\n\n`;
          relevantKeys.forEach(k => {
            const isExpired = k.expiry && new Date(k.expiry) < new Date();
            stats += `• Status: ${isExpired ? "❌ Expired" : "✅ Active"}\n`;
            stats += `• HWID: ${k.hwid ? "🔒 Bound" : "🔓 Not bound"}\n`;
            stats += `• Expiry: ${k.expiry ? new Date(k.expiry).toLocaleDateString() : "♾️ Lifetime"}\n`;
            stats += `• Key: \`${k.key}\`\n\n`;
          });
          if (stats.length > 2000) stats = stats.slice(0, 1990) + "\n...";
          return interaction.editReply({ content: stats }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to get stats." }).catch(() => {});
        }
      }
    }

    // ==================== MODAL ====================
    if (interaction.isModalSubmit() && interaction.customId === "modal_redeem") {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      try {
        const keyInput = interaction.fields.getTextInputValue("input_key").toLowerCase().trim();
        const keys = readKeys();
        const keyData = keys.find(k => k.key === keyInput);

        if (!keyData) return interaction.editReply({ content: "❌ Invalid key." }).catch(() => {});

        const existingKey = keys.find(k =>
          k.key !== keyInput &&
          String(k.userId) === String(interaction.user.id) &&
          k.scriptId === keyData.scriptId &&
          !(k.expiry && new Date(k.expiry) < new Date())
        );
        if (existingKey) {
          return interaction.editReply({
            content: "❌ You already have access to this script. You cannot redeem another key for it."
          }).catch(() => {});
        }

        if (keyData.userId && String(keyData.userId) !== String(interaction.user.id)) {
          return interaction.editReply({ content: "❌ This key is already used by another user." }).catch(() => {});
        }

        keyData.userId = String(interaction.user.id);
        keyData.username = interaction.user.username;
        keyData.redeemedAt = new Date().toISOString();
        writeKeys(keys);

        const cfg = readConfig()[interaction.guildId] || {};
        const buyerRoleId = cfg.buyerRoles && cfg.buyerRoles[keyData.scriptId]
          ? cfg.buyerRoles[keyData.scriptId] : cfg.buyerRole;

        if (buyerRoleId) {
          try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.roles.add(buyerRoleId);
          } catch {}
        }

        return interaction.editReply({ content: "✅ Key redeemed successfully!" }).catch(() => {});
      } catch {
        return interaction.editReply({ content: "❌ Failed to redeem key." }).catch(() => {});
      }
    }

    // ==================== SELECT MENUS ====================
    if (interaction.isStringSelectMenu()) {

      if (interaction.customId === "deletescript_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          await axios.delete(`${CONFIG.apiBase}/api/scripts/internal/${scriptId}`, {
            headers: { ...internalHeaders, "x-owner-id": interaction.user.id }, timeout: 8000
          });
          const keys = readKeys();
          writeKeys(keys.filter(k => k.scriptId !== scriptId));
          clearCache(interaction.user.id);
          return interaction.editReply({ content: "✅ Script and all its keys have been permanently deleted!" }).catch(() => {});
        } catch (err) {
          console.error(`❌ deletescript failed: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to delete script." }).catch(() => {});
        }
      }

      if (interaction.customId === "freemode_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          const tempData = freeModeTempData.get(interaction.user.id);
          if (!tempData) return interaction.editReply({ content: "❌ Session expired. Please run /freemode again." }).catch(() => {});

          const { mode } = tempData;
          freeModeTempData.delete(interaction.user.id);

          const cfg = readConfig();
          if (!cfg[interaction.guildId]) cfg[interaction.guildId] = {};
          if (!cfg[interaction.guildId].freeMode) cfg[interaction.guildId].freeMode = {};

          const enabled = mode === "enable";
          if (enabled) cfg[interaction.guildId].freeMode[scriptId] = true;
          else delete cfg[interaction.guildId].freeMode[scriptId];
          writeConfig(cfg);

          try {
            await axios.post(`${CONFIG.apiBase}/api/freemode/update`,
              { guildId: interaction.guildId, scriptId, enabled },
              { headers: internalHeaders, timeout: 8000 }
            );
          } catch (err) {
            console.error(`❌ freemode/update failed: ${describeAxiosError(err)}`);
          }

          return interaction.editReply({
            content: `✅ Free mode has been **${enabled ? "ENABLED" : "DISABLED"}**!`
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to update free mode." }).catch(() => {});
        }
      }

      if (interaction.customId === "freemode_mode_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const mode = interaction.values[0];
          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          freeModeTempData.set(interaction.user.id, { mode });
          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder()
              .setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name)
              .setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("freemode_select").setPlaceholder("Select a script...").addOptions(options);

          return interaction.editReply({
            content: `Select a script to ${mode} free mode:`,
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to load scripts." }).catch(() => {});
        }
      }

      if (interaction.customId === "cooldownhwid_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          const temp = cooldownTempData.get(interaction.user.id);
          if (!temp) return interaction.editReply({ content: "❌ Session expired. Run /cooldownhwid again." }).catch(() => {});
          cooldownTempData.delete(interaction.user.id);

          await axios.post(`${CONFIG.apiBase}/api/cooldown/set`,
            { scriptId, userId: interaction.user.id, cooldownMs: temp.ms },
            { headers: internalHeaders, timeout: 8000 }
          );

          const myScripts = await getScriptsByOwner(interaction.user.id);
          const s = myScripts.find(x => x.id === scriptId);
          return interaction.editReply({
            content: `✅ HWID reset cooldown for **${s?.name || scriptId}** set to **${formatDuration(temp.ms)}**.`
          }).catch(() => {});
        } catch (err) {
          console.error(`❌ cooldownhwid_select failed: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to set cooldown." }).catch(() => {});
        }
      }

      if (interaction.customId === "resethwiduser_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          const temp = resetHwidUserTempData.get(interaction.user.id);
          if (!temp) return interaction.editReply({ content: "❌ Session expired. Run /resethwiduser again." }).catch(() => {});
          resetHwidUserTempData.delete(interaction.user.id);

          await axios.post(`${CONFIG.apiBase}/api/hwid/reset`,
            { userId: temp.targetUserId, scriptId },
            { headers: internalHeaders, timeout: 8000 }
          );

          return interaction.editReply({
            content: `✅ HWID reset for <@${temp.targetUserId}>.`
          }).catch(() => {});
        } catch (err) {
          console.error(`❌ resethwiduser_select failed: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to reset HWID." }).catch(() => {});
        }
      }

      if (interaction.customId.startsWith("blacklistrole_select:")) {
        await interaction.deferReply({ ephemeral: false }).catch(() => {});
        try {
          const parts = interaction.customId.split(":");
          const roleId = parts[1];
          const reason = parts.slice(2).join(":") || "No reason provided";

          const scriptId = interaction.values[0];
          const scriptInfo = await fetchScriptById(scriptId);

          if (!scriptInfo) {
            return interaction.editReply({ content: "❌ Script not found." }).catch(() => {});
          }

          const bl = readBlacklist();
          if (bl.some(b => b.type === "role" && String(b.roleId) === String(roleId))) {
            return interaction.editReply({ content: "❌ This role is already blacklisted!" }).catch(() => {});
          }

          bl.push({
            type: "role",
            roleId: String(roleId),
            scriptId: String(scriptId),
            reason,
            blacklistedBy: interaction.user.id,
            blacklistedAt: new Date().toISOString()
          });
          writeBlacklist(bl);

          return interaction.editReply({
            content: `🚫 **<@&${roleId}> has been blacklisted from script **${scriptInfo.name}**!**\nAll members with this role have been revoked from the script.`
          }).catch(() => {});
        } catch (err) {
          console.error("blacklistrole_select error:", err);
          return interaction.editReply({ content: "❌ Failed to blacklist role." }).catch(() => {});
        }
      }

      if (interaction.customId === "setuppanel_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          const tempData = panelTempData.get(interaction.user.id);
          if (!tempData) return interaction.editReply({ content: "❌ Session expired." }).catch(() => {});
          const { title, description } = tempData;
          panelTempData.delete(interaction.user.id);

          const myScripts = await getScriptsByOwner(interaction.user.id);
          const selectedScript = myScripts.find(s => s.id === scriptId);
          if (!selectedScript) return interaction.editReply({ content: "❌ Script not found or not yours!" }).catch(() => {});

          await sendPanelEmbed(interaction.channel, title, description, scriptId, selectedScript.name, interaction.user.id, interaction.guildId);
          return interaction.editReply({ content: `✅ Panel created with script: **${selectedScript.name}**!` }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to create panel." }).catch(() => {});
        }
      }

      if (interaction.customId === "setbuyerrole_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          const tempData = buyerRoleTempData.get(interaction.user.id);
          if (!tempData) return interaction.editReply({ content: "❌ Session expired." }).catch(() => {});
          const { roleId } = tempData;
          buyerRoleTempData.delete(interaction.user.id);

          const cfg = readConfig();
          if (!cfg[interaction.guildId]) cfg[interaction.guildId] = {};
          if (!cfg[interaction.guildId].buyerRoles) cfg[interaction.guildId].buyerRoles = {};
          cfg[interaction.guildId].buyerRoles[scriptId] = roleId;
          writeConfig(cfg);

          return interaction.editReply({ content: `✅ Buyer role <@&${roleId}> has been set!` }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to set buyer role." }).catch(() => {});
        }
      }

      if (interaction.customId === "setwebhook_select") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const scriptId = interaction.values[0];
          const tempData = webhookTempData.get(interaction.user.id);
          if (!tempData) return interaction.editReply({ content: "❌ Session expired. Run /setwebhook again." }).catch(() => {});
          webhookTempData.delete(interaction.user.id);

          const myScripts = await getScriptsByOwner(interaction.user.id);
          const selectedScript = myScripts.find(s => s.id === scriptId);
          if (!selectedScript) return interaction.editReply({ content: "❌ Script not found or not yours." }).catch(() => {});

          await axios.post(`${CONFIG.apiBase}/api/webhook/set`,
            { scriptId, url: tempData.url },
            { headers: internalHeaders, timeout: 8000 }
          );

          return interaction.editReply({
            content: `✅ Webhook set for script **${selectedScript.name}**!\nYou will receive a notification every time the script is executed.`
          }).catch(() => {});
        } catch (err) {
          console.error(`❌ setwebhook_select failed: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to set webhook." }).catch(() => {});
        }
      }

      if (interaction.customId.startsWith("whitelist_select:")) {
        await interaction.deferReply({ ephemeral: false }).catch(() => {});
        try {
          const parts = interaction.customId.split(":");
          const targetType = parts[1];
          const targetId = parts[2];
          const days = parseInt(parts[3]);
          const adminId = parts[4];
          const scriptId = parts[5];
          const scriptOwnerId = parts[6];

          const scriptInfo = await fetchScriptById(scriptId);
          if (!scriptInfo) {
            return interaction.editReply({
              content: "❌ The script registered in this guild no longer exists."
            }).catch(() => {});
          }

          if (!hasPermission(interaction.member, interaction.guildId)) {
            return interaction.editReply({ content: "❌ No permission." }).catch(() => {});
          }

          const keys = readKeys();
          const expiry = days === 0 ? null : new Date(Date.now() + days * 86400000).toISOString();
          const cfg = readConfig()[interaction.guildId] || {};
          const buyerRoleId = cfg.buyerRoles?.[scriptId] || cfg.buyerRole || null;

          if (targetType === "user") {
            const existingKey = keys.find(k =>
              String(k.userId) === String(targetId) &&
              k.scriptId === scriptId &&
              !(k.expiry && new Date(k.expiry) < new Date())
            );
            if (existingKey) {
              return interaction.editReply({
                content: `❌ <@${targetId}> already has access to **${scriptInfo.name}**.`
              }).catch(() => {});
            }

            const key = generateKey();
            keys.push({
              key, hwid: null,
              userId: String(targetId), username: null, scriptId,
              redeemedAt: new Date().toISOString(), expiry,
              createdAt: new Date().toISOString(), createdBy: adminId
            });
            writeKeys(keys);

            if (buyerRoleId) {
              try {
                const member = await interaction.guild.members.fetch(targetId);
                await member.roles.add(buyerRoleId);
              } catch {}
            }

            return interaction.editReply({
              content: `✅ <@${targetId}> has been whitelisted for script **${scriptInfo.name}**!\nPress the **Get Script** button on the panel to get their loader.`
            }).catch(() => {});
          }

          if (targetType === "role") {
            const role = await interaction.guild.roles.fetch(targetId);
            await interaction.guild.members.fetch();
            const members = role.members.filter(m => !m.user.bot);
            let addedCount = 0;

            for (const [, member] of members) {
              const existingKey = keys.find(k =>
                String(k.userId) === String(member.id) &&
                k.scriptId === scriptId &&
                !(k.expiry && new Date(k.expiry) < new Date())
              );
              if (existingKey) continue;

              const userKey = generateKey();
              keys.push({
                key: userKey, hwid: null,
                userId: String(member.id), username: member.user.username,
                scriptId, redeemedAt: new Date().toISOString(), expiry,
                createdAt: new Date().toISOString(), createdBy: adminId
              });
              addedCount++;

              if (buyerRoleId) {
                try { await member.roles.add(buyerRoleId); } catch {}
              }
            }
            writeKeys(keys);

            return interaction.editReply({
              content: `✅ <@&${targetId}> has been whitelisted for script **${scriptInfo.name}**! (${addedCount} members whitelisted)\nMembers can press the **Get Script** button on the panel to get their loader.`
            }).catch(() => {});
          }
        } catch (err) {
          console.error("whitelist_select error:", err);
          return interaction.editReply({ content: "❌ Failed to whitelist." }).catch(() => {});
        }
      }

      if (interaction.customId.startsWith("genkey_select:")) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const parts = interaction.customId.split(":");
          const days = parseInt(parts[1]);
          const amount = parseInt(parts[2]);
          const adminId = parts[3];
          const scriptId = interaction.values[0];

          const myScripts = await getScriptsByOwner(adminId);
          const owned = myScripts.find(s => s.id === scriptId);
          if (!owned) return interaction.editReply({ content: "❌ This script is not yours." }).catch(() => {});

          const keys = readKeys();
          const generated = [];
          const expiry = days === 0 ? null : new Date(Date.now() + days * 86400000).toISOString();

          for (let i = 0; i < amount; i++) {
            const key = generateKey();
            keys.push({
              key, hwid: null, userId: null, username: null, scriptId,
              redeemedAt: null, expiry,
              createdAt: new Date().toISOString(), createdBy: adminId
            });
            generated.push(key);
          }
          writeKeys(keys);

          const keyList = generated.map(k => `\`${k}\``).join("\n");
          return interaction.editReply({
            content: `✅ **${amount} key(s)** generated for script **${owned.name}**!\n\n${keyList}`
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to generate keys." }).catch(() => {});
        }
      }
    }

    // ==================== SLASH COMMANDS ====================
    if (interaction.isChatInputCommand()) {
      const commandName = interaction.commandName;

      // ==================== PREMIUMWHITELIST (OWNER ONLY) ====================
      if (commandName === "premiumwhitelist") {
        // HANYA owner ID yang bisa pakai
        if (interaction.user.id !== OWNER_ID) {
          return interaction.reply({
            content: "❌ This command is restricted to the bot owner only.",
            ephemeral: true
          }).catch(() => {});
        }

        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const sub = interaction.options.getSubcommand();

        try {
          // ============ ADD ============
          if (sub === "add") {
            const targetUser = interaction.options.getUser("user");
            const durationInput = interaction.options.getString("duration").trim().toLowerCase();

            let expiry = null;
            let durationLabel = "Lifetime";

            if (durationInput !== "lifetime" && durationInput !== "forever" && durationInput !== "0") {
              const ms = parseDuration(durationInput);
              if (!ms) {
                return interaction.editReply({
                  content: "❌ Invalid duration format. Use `7d`, `30d`, `1y`(not supported—use days), `12h`, or `lifetime`.\n\nSupported units: `m` (minutes), `h` (hours), `d` (days), `w` (weeks)."
                }).catch(() => {});
              }
              // Cek juga "y" untuk year
              const yearMatch = durationInput.match(/^(\d+)\s*y$/);
              if (yearMatch) {
                const years = parseInt(yearMatch[1]);
                expiry = new Date(Date.now() + years * 365 * 86400000).toISOString();
                durationLabel = `${years} year(s)`;
              } else {
                expiry = new Date(Date.now() + ms).toISOString();
                durationLabel = formatDuration(ms);
              }
            }

            const premium = readPremium();
            const isNew = !premium[String(targetUser.id)];
            premium[String(targetUser.id)] = {
              expiry,
              since: premium[String(targetUser.id)]?.since || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              grantedBy: interaction.user.id
            };
            writePremium(premium);

            // Sync ke server
            try {
              await axios.post(`${CONFIG.apiBase}/api/premium/set`, {
                userId: targetUser.id,
                expiry
              }, { headers: internalHeaders, timeout: 8000 });
            } catch (err) {
              console.error(`⚠️ Failed to sync premium to server: ${describeAxiosError(err)}`);
            }

            const embed = new EmbedBuilder()
              .setTitle("👑 Premium Granted")
              .setDescription(`<@${targetUser.id}> has been granted **Kingmor Premium**!`)
              .setColor(0xFFD700)
              .addFields(
                { name: "👤 User", value: `<@${targetUser.id}>`, inline: true },
                { name: "🆔 ID", value: targetUser.id, inline: true },
                { name: "⏱️ Duration", value: durationLabel, inline: true },
                { name: "📅 Expiry", value: expiry ? new Date(expiry).toLocaleString() : "♾️ Lifetime", inline: false },
                { name: "🔄 Status", value: isNew ? "🆕 New Premium" : "🔁 Extended", inline: true }
              )
              .setFooter({ text: "Kingmor 👑" })
              .setTimestamp();

            return interaction.editReply({ embeds: [embed] }).catch(() => {});
          }

          // ============ REMOVE ============
          if (sub === "remove") {
            const targetUser = interaction.options.getUser("user");
            const premium = readPremium();

            if (!premium[String(targetUser.id)]) {
              return interaction.editReply({
                content: `❌ <@${targetUser.id}> is not a Premium user.`
              }).catch(() => {});
            }

            delete premium[String(targetUser.id)];
            writePremium(premium);

            try {
              await axios.post(`${CONFIG.apiBase}/api/premium/set`, {
                userId: targetUser.id,
                remove: true
              }, { headers: internalHeaders, timeout: 8000 });
            } catch (err) {
              console.error(`⚠️ Failed to sync premium removal to server: ${describeAxiosError(err)}`);
            }

            const embed = new EmbedBuilder()
              .setTitle("🚫 Premium Revoked")
              .setDescription(`<@${targetUser.id}>'s Premium access has been **removed**.`)
              .setColor(0xFF4D4D)
              .setTimestamp();

            return interaction.editReply({ embeds: [embed] }).catch(() => {});
          }

          // ============ LIST ============
          if (sub === "list") {
            const premium = readPremium();
            const entries = Object.entries(premium);

            if (entries.length === 0) {
              return interaction.editReply({ content: "📭 No Premium users yet." }).catch(() => {});
            }

            let list = "👑 **PREMIUM USERS**\n\n";
            let activeCount = 0;
            let expiredCount = 0;

            const sorted = entries.sort((a, b) => {
              const aE = a[1].expiry ? new Date(a[1].expiry).getTime() : Infinity;
              const bE = b[1].expiry ? new Date(b[1].expiry).getTime() : Infinity;
              return aE - bE;
            });

            for (const [userId, data] of sorted.slice(0, 25)) {
              const isExpired = data.expiry && new Date(data.expiry) < new Date();
              if (isExpired) expiredCount++; else activeCount++;

              const statusIcon = isExpired ? "❌" : "✅";
              const expiryText = data.expiry
                ? (isExpired ? `Expired ${new Date(data.expiry).toLocaleDateString()}` : `Until ${new Date(data.expiry).toLocaleDateString()}`)
                : "♾️ Lifetime";

              list += `${statusIcon} <@${userId}>\n`;
              list += `   └ \`${userId}\` • ${expiryText}\n\n`;
            }

            list += `📊 **Total**: ${entries.length} | ✅ Active: ${activeCount} | ❌ Expired: ${expiredCount}`;
            if (entries.length > 25) list += `\n\n_Showing first 25 entries_`;
            if (list.length > 2000) list = list.slice(0, 1990) + "\n...";

            return interaction.editReply({ content: list }).catch(() => {});
          }

          // ============ CHECK ============
          if (sub === "check") {
            const targetUser = interaction.options.getUser("user");
            const premium = readPremium();
            const entry = premium[String(targetUser.id)];

            if (!entry) {
              return interaction.editReply({
                content: `🆓 <@${targetUser.id}> is **not** a Premium user.`
              }).catch(() => {});
            }

            const isExpired = entry.expiry && new Date(entry.expiry) < new Date();

            const embed = new EmbedBuilder()
              .setTitle("👑 Premium Status")
              .setColor(isExpired ? 0xFF4D4D : 0xFFD700)
              .addFields(
                { name: "👤 User", value: `<@${targetUser.id}>`, inline: true },
                { name: "🆔 ID", value: targetUser.id, inline: true },
                { name: "📊 Status", value: isExpired ? "❌ Expired" : "✅ Active", inline: true },
                { name: "📅 Since", value: entry.since ? new Date(entry.since).toLocaleString() : "Unknown", inline: false },
                { name: "⏱️ Expiry", value: entry.expiry ? new Date(entry.expiry).toLocaleString() : "♾️ Lifetime", inline: false }
              )
              .setFooter({ text: "Kingmor 👑" })
              .setTimestamp();

            return interaction.editReply({ embeds: [embed] }).catch(() => {});
          }

        } catch (err) {
          console.error("❌ premiumwhitelist error:", err);
          return interaction.editReply({ content: "❌ Failed to process command." }).catch(() => {});
        }
      }

      if (commandName === "premiuminfo") {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const premium = await checkPremium(interaction.user.id);
        const statusText = premium ? "✅ **You are Premium!**" : "🆓 You are currently on the Free plan.";

        const embed = new EmbedBuilder()
          .setTitle("👑 Kingmor Premium")
          .setDescription(
            `${statusText}\n\n` +
            `**Unlock Premium features:**\n` +
            `• 🚫 \`/blacklistrole\` — Blacklist roles from using your scripts\n` +
            `• 🔓 \`/unblacklist role\` — Unblacklist roles\n` +
            `• ⏱️ \`/cooldownhwid\` — Set custom HWID reset cooldown (default is 1 day)\n` +
            `• 🔄 \`/resethwiduser\` — Reset HWID for any user on any of your scripts\n` +
            `• ♾️ **Lifetime whitelist** — Free users are limited to 30 days max\n\n` +
            `**Price:**\n` +
            `🇮🇩 Indonesia: **${PREMIUM_INFO.priceIDR}**\n` +
            `🌍 International: **${PREMIUM_INFO.priceUSD}**\n\n` +
            `**How to buy:**\n` +
            `1. Join our Discord server (button below)\n` +
            `2. Open a **ticket** in the ticket channel\n` +
            `3. Go to the **purchasing** channel\n` +
            `4. Follow the instructions to complete your purchase`
          )
          .setColor(0xFFD700)
          .setFooter({ text: "Kingmor 👑" })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("💎 Join & Buy")
            .setStyle(ButtonStyle.Link)
            .setURL(PREMIUM_INFO.discord)
        );

        return interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
      }

      if (commandName === "clearcache") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Admin only.", ephemeral: true }).catch(() => {});
        }
        clearCache();
        return interaction.reply({ content: "✅ Cache cleared successfully!", ephemeral: true }).catch(() => {});
      }

      if (commandName === "checkconnection") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Admin only.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const start = Date.now();
          await axios.get(`${CONFIG.apiBase}/health`, { timeout: 8000 });
          const ms = Date.now() - start;

          let secretStatus = "❓ Not checked";
          try {
            await axios.get(`${CONFIG.apiBase}/api/scripts/internal`, {
              headers: internalHeaders, params: { ownerId: interaction.user.id }, timeout: 8000
            });
            secretStatus = "✅ API_SECRET matches";
          } catch (err) {
            secretStatus = err.response?.status === 403
              ? "❌ API_SECRET MISMATCH between bot and web"
              : `❌ Check failed: ${describeAxiosError(err)}`;
          }

          return interaction.editReply({
            content: `🔗 **Connection Check**\n\n• API_BASE: \`${CONFIG.apiBase}\`\n• Health check: ✅ OK (${ms}ms)\n• Secret check: ${secretStatus}`
          }).catch(() => {});
        } catch (err) {
          return interaction.editReply({
            content: `🔗 **Connection Check**\n\n• API_BASE: \`${CONFIG.apiBase}\`\n• Health check: ❌ FAILED — ${describeAxiosError(err)}`
          }).catch(() => {});
        }
      }

      if (commandName === "whitelistrole") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Admin only.", ephemeral: true }).catch(() => {});
        }
        const role = interaction.options.getRole("role");
        const cfg = readConfig();
        if (!cfg[interaction.guildId]) cfg[interaction.guildId] = {};
        cfg[interaction.guildId].whitelistRole = role.id;
        writeConfig(cfg);
        return interaction.reply({ content: `✅ Role <@&${role.id}> is now the bot admin role.`, ephemeral: true }).catch(() => {});
      }

      if (commandName === "setbuyerrole") {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Admin only.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const role = interaction.options.getRole("role");
          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          if (myScripts.length === 1) {
            const cfg = readConfig();
            if (!cfg[interaction.guildId]) cfg[interaction.guildId] = {};
            if (!cfg[interaction.guildId].buyerRoles) cfg[interaction.guildId].buyerRoles = {};
            cfg[interaction.guildId].buyerRoles[myScripts[0].id] = role.id;
            writeConfig(cfg);
            return interaction.editReply({ content: `✅ Buyer role <@&${role.id}> has been set for **${myScripts[0].name}**!` }).catch(() => {});
          }

          buyerRoleTempData.set(interaction.user.id, { roleId: role.id });
          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder().setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name).setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("setbuyerrole_select").setPlaceholder("Select a script...").addOptions(options);

          return interaction.editReply({
            content: `Select a script to assign buyer role <@&${role.id}>:`,
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to set buyer role." }).catch(() => {});
        }
      }

      if (commandName === "setuppanel") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const title = interaction.options.getString("title");
          const description = interaction.options.getString("description");
          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          if (myScripts.length === 1) {
            await sendPanelEmbed(interaction.channel, title, description, myScripts[0].id, myScripts[0].name, interaction.user.id, interaction.guildId);
            return interaction.editReply({ content: `✅ Panel created with script: **${myScripts[0].name}**!` }).catch(() => {});
          }

          panelTempData.set(interaction.user.id, { title, description });
          setTimeout(() => panelTempData.delete(interaction.user.id), 5 * 60 * 1000);

          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder().setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name).setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("setuppanel_select").setPlaceholder("Select a script for this panel...").addOptions(options);

          return interaction.editReply({
            content: "Select which script you want to use for this panel:",
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to create panel." }).catch(() => {});
        }
      }

      if (commandName === "deletescript") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder().setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name).setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("deletescript_select").setPlaceholder("Select a script to delete...").addOptions(options);

          return interaction.editReply({
            content: "Select the script to delete permanently:",
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to load scripts." }).catch(() => {});
        }
      }

      if (commandName === "freemode") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const options = [
            new StringSelectMenuOptionBuilder()
              .setLabel("Enable Free Mode").setDescription("Allow all users to use the script without a key")
              .setValue("enable").setEmoji("✅"),
            new StringSelectMenuOptionBuilder()
              .setLabel("Disable Free Mode").setDescription("Require a key to use the script")
              .setValue("disable").setEmoji("❌"),
          ];
          const select = new StringSelectMenuBuilder()
            .setCustomId("freemode_mode_select").setPlaceholder("Select mode...").addOptions(options);

          return interaction.editReply({
            content: "Select whether to enable or disable free mode:",
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to open free mode menu." }).catch(() => {});
        }
      }

      if (commandName === "setwebhook") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const url = interaction.options.getString("url");

          if (!url.startsWith("https://discord.com/api/webhooks/") && !url.startsWith("https://discordapp.com/api/webhooks/")) {
            return interaction.editReply({
              content: "❌ Invalid URL! Must be a Discord webhook URL.\nExample: `https://discord.com/api/webhooks/123456/token...`"
            }).catch(() => {});
          }

          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          if (myScripts.length === 1) {
            await axios.post(`${CONFIG.apiBase}/api/webhook/set`,
              { scriptId: myScripts[0].id, url },
              { headers: internalHeaders, timeout: 8000 }
            );
            return interaction.editReply({
              content: `✅ Webhook set for script **${myScripts[0].name}**!\nYou will receive a notification every time the script is executed.`
            }).catch(() => {});
          }

          webhookTempData.set(interaction.user.id, { url });
          setTimeout(() => webhookTempData.delete(interaction.user.id), 5 * 60 * 1000);

          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder()
              .setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name)
              .setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("setwebhook_select").setPlaceholder("Select a script...").addOptions(options);

          return interaction.editReply({
            content: "Select the script to attach this webhook to:",
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch (err) {
          console.error(`❌ setwebhook failed: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to set webhook." }).catch(() => {});
        }
      }

      if (commandName === "cooldownhwid") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        const premium = await checkPremium(interaction.user.id);
        if (!premium) {
          return interaction.reply(premiumRequiredReply("cooldownhwid")).catch(() => {});
        }

        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const input = interaction.options.getString("cooldown").trim().toLowerCase();
          const ms = parseDuration(input);
          if (!ms || ms < 60 * 1000) {
            return interaction.editReply({
              content: "❌ Invalid duration. Use format like `30m`, `1h`, `6h`, `1d`, `3d`, `1w`. Minimum 1 minute."
            }).catch(() => {});
          }

          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) {
            return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});
          }

          if (myScripts.length === 1) {
            await axios.post(`${CONFIG.apiBase}/api/cooldown/set`,
              { scriptId: myScripts[0].id, userId: interaction.user.id, cooldownMs: ms },
              { headers: internalHeaders, timeout: 8000 }
            );
            return interaction.editReply({
              content: `✅ HWID reset cooldown for **${myScripts[0].name}** set to **${formatDuration(ms)}**.`
            }).catch(() => {});
          }

          cooldownTempData.set(interaction.user.id, { ms });
          setTimeout(() => cooldownTempData.delete(interaction.user.id), 5 * 60 * 1000);

          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder()
              .setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name)
              .setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId("cooldownhwid_select").setPlaceholder("Select a script...").addOptions(options);

          return interaction.editReply({
            content: `Select a script to set cooldown **${formatDuration(ms)}**:`,
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch (err) {
          console.error(`❌ cooldownhwid failed: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to set cooldown." }).catch(() => {});
        }
      }

      if (commandName === "resethwiduser") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        const premium = await checkPremium(interaction.user.id);
        if (!premium) {
          return interaction.reply(premiumRequiredReply("resethwiduser")).catch(() => {});
        }

        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) {
            return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});
          }

          const keys = readKeys();
          const myScriptIds = myScripts.map(s => s.id);
          const targetKeys = keys.filter(k =>
            String(k.userId) === String(targetUser.id) &&
            myScriptIds.includes(k.scriptId) &&
            k.hwid
          );

          if (targetKeys.length === 0) {
            return interaction.editReply({
              content: `❌ <@${targetUser.id}> doesn't have any HWID-bound keys for your scripts.`
            }).catch(() => {});
          }

          if (targetKeys.length === 1) {
            const tk = targetKeys[0];
            const scriptName = myScripts.find(s => s.id === tk.scriptId)?.name || tk.scriptId;
            await axios.post(`${CONFIG.apiBase}/api/hwid/reset`,
              { userId: targetUser.id, scriptId: tk.scriptId },
              { headers: internalHeaders, timeout: 8000 }
            );
            return interaction.editReply({
              content: `✅ HWID reset for <@${targetUser.id}> on script **${scriptName}**.`
            }).catch(() => {});
          }

          resetHwidUserTempData.set(interaction.user.id, { targetUserId: targetUser.id });
          setTimeout(() => resetHwidUserTempData.delete(interaction.user.id), 5 * 60 * 1000);

          const options = targetKeys.slice(0, 25).map(k => {
            const scriptName = myScripts.find(s => s.id === k.scriptId)?.name || k.scriptId;
            return new StringSelectMenuOptionBuilder()
              .setLabel(scriptName.length > 50 ? scriptName.slice(0, 47) + "..." : scriptName)
              .setValue(k.scriptId);
          });
          const select = new StringSelectMenuBuilder()
            .setCustomId("resethwiduser_select").setPlaceholder("Select a script...").addOptions(options);

          return interaction.editReply({
            content: `Select which script's HWID to reset for <@${targetUser.id}>:`,
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch (err) {
          console.error(`❌ resethwiduser failed: ${describeAxiosError(err)}`);
          return interaction.editReply({ content: "❌ Failed to reset HWID." }).catch(() => {});
        }
      }

      if (commandName === "whitelist") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: false }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const targetRole = interaction.options.getRole("role");
          const days = interaction.options.getInteger("days");

          if (!targetUser && !targetRole) {
            return interaction.editReply({ content: "❌ Select a user or role!" }).catch(() => {});
          }

          const isPrem = await checkPremium(interaction.user.id);
          if (!isPrem && days === 0) {
            return interaction.editReply({
              content: "❌ **Lifetime whitelist** is a Premium feature.\nFree users can only whitelist up to **30 days**.",
              components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel("💎 Buy Premium").setStyle(ButtonStyle.Link).setURL(PREMIUM_INFO.discord)
              )]
            }).catch(() => {});
          }
          if (!isPrem && days > 30) {
            return interaction.editReply({
              content: "❌ Free users can only whitelist up to **30 days**.\nUpgrade to Premium for unlimited duration & lifetime.",
              components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel("💎 Buy Premium").setStyle(ButtonStyle.Link).setURL(PREMIUM_INFO.discord)
              )]
            }).catch(() => {});
          }

          const guildData = getGuildPanelScript(interaction.guildId);
          if (!guildData || !guildData.scriptId) {
            return interaction.editReply({
              content: "❌ No script panel found in this server!\nAsk the script owner to run `/setuppanel` in this server first."
            }).catch(() => {});
          }

          const { scriptId, ownerId: scriptOwnerId } = guildData;

          let resolvedOwnerId = scriptOwnerId;
          if (!resolvedOwnerId) {
            const scriptInfo = await fetchScriptById(scriptId);
            if (!scriptInfo) {
              return interaction.editReply({
                content: "❌ The script registered in this server no longer exists."
              }).catch(() => {});
            }
            resolvedOwnerId = scriptInfo.ownerId;
            const cfg = readConfig();
            if (cfg[interaction.guildId]) {
              cfg[interaction.guildId].panelOwnerId = resolvedOwnerId;
              writeConfig(cfg);
            }
          }

          const allScripts = await getScriptsByOwner(resolvedOwnerId);
          const script = allScripts.find(s => s.id === scriptId);
          if (!script) {
            return interaction.editReply({
              content: "❌ The script registered in this server no longer exists."
            }).catch(() => {});
          }

          const keys = readKeys();
          const expiry = days === 0 ? null : new Date(Date.now() + days * 86400000).toISOString();
          const cfg = readConfig()[interaction.guildId] || {};
          const buyerRoleId = cfg.buyerRoles?.[scriptId] || cfg.buyerRole || null;

          if (targetUser) {
            const existingKey = keys.find(k =>
              String(k.userId) === String(targetUser.id) &&
              k.scriptId === scriptId &&
              !(k.expiry && new Date(k.expiry) < new Date())
            );
            if (existingKey) {
              return interaction.editReply({
                content: `❌ <@${targetUser.id}> already has access to **${script.name}**.`
              }).catch(() => {});
            }

            const key = generateKey();
            keys.push({
              key, hwid: null,
              userId: String(targetUser.id), username: targetUser.username,
              scriptId, redeemedAt: new Date().toISOString(), expiry,
              createdAt: new Date().toISOString(), createdBy: interaction.user.id
            });
            writeKeys(keys);

            if (buyerRoleId) {
              try {
                const member = await interaction.guild.members.fetch(targetUser.id);
                await member.roles.add(buyerRoleId);
              } catch {}
            }

            return interaction.editReply({
              content: `✅ <@${targetUser.id}> has been whitelisted for script **${script.name}**!\nPress the **Get Script** button on the panel to get their loader.`
            }).catch(() => {});
          }

          if (targetRole) {
            const role = await interaction.guild.roles.fetch(targetRole.id);
            await interaction.guild.members.fetch();
            const members = role.members.filter(m => !m.user.bot);
            let addedCount = 0;
            let skippedCount = 0;

            for (const [, member] of members) {
              const existingKey = keys.find(k =>
                String(k.userId) === String(member.id) &&
                k.scriptId === scriptId &&
                !(k.expiry && new Date(k.expiry) < new Date())
              );
              if (existingKey) { skippedCount++; continue; }

              const userKey = generateKey();
              keys.push({
                key: userKey, hwid: null,
                userId: String(member.id), username: member.user.username,
                scriptId, redeemedAt: new Date().toISOString(), expiry,
                createdAt: new Date().toISOString(), createdBy: interaction.user.id
              });
              addedCount++;

              if (buyerRoleId) {
                try { await member.roles.add(buyerRoleId); } catch {}
              }
            }
            writeKeys(keys);

            const skippedNote = skippedCount > 0 ? ` (${skippedCount} already had access, skipped)` : "";
            return interaction.editReply({
              content: `✅ <@&${targetRole.id}> has been whitelisted for script **${script.name}**! (${addedCount} members whitelisted${skippedNote})\nMembers can press the **Get Script** button on the panel to get their loader.`
            }).catch(() => {});
          }

        } catch (err) {
          console.error("whitelist error:", err);
          return interaction.editReply({ content: "❌ Failed to whitelist." }).catch(() => {});
        }
      }

      if (commandName === "blacklist") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: false }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const reason = interaction.options.getString("reason") || "No reason provided";
          const bl = readBlacklist();
          if (bl.some(b => b.type !== "role" && String(b.userId) === String(targetUser.id))) {
            return interaction.editReply({ content: "❌ This user is already blacklisted!" }).catch(() => {});
          }
          bl.push({
            type: "user",
            userId: String(targetUser.id), username: targetUser.username, reason,
            blacklistedBy: interaction.user.id, blacklistedAt: new Date().toISOString()
          });
          writeBlacklist(bl);
          writeKeys(readKeys().filter(k => String(k.userId) !== String(targetUser.id)));
          return interaction.editReply({
            content: `🚫 **<@${targetUser.id}> has been blacklisted!**\nAll script access has been revoked.`
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to blacklist user." }).catch(() => {});
        }
      }

      if (commandName === "blacklistrole") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        const isPrem = await checkPremium(interaction.user.id);
        if (!isPrem) {
          return interaction.reply(premiumRequiredReply("blacklistrole")).catch(() => {});
        }

        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const role = interaction.options.getRole("role");
          const reason = interaction.options.getString("reason") || "No reason provided";

          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) {
            return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});
          }

          if (myScripts.length === 1) {
            const scriptId = myScripts[0].id;
            const bl = readBlacklist();
            if (bl.some(b => b.type === "role" && String(b.roleId) === String(role.id))) {
              return interaction.editReply({ content: "❌ This role is already blacklisted!" }).catch(() => {});
            }
            bl.push({
              type: "role",
              roleId: String(role.id),
              scriptId: String(scriptId),
              reason,
              blacklistedBy: interaction.user.id,
              blacklistedAt: new Date().toISOString()
            });
            writeBlacklist(bl);
            return interaction.editReply({
              content: `🚫 **<@&${role.id}> has been blacklisted from script **${myScripts[0].name}**!**\nAll members with this role have been revoked from the script.`
            }).catch(() => {});
          }

          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder()
              .setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name)
              .setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId(`blacklistrole_select:${role.id}:${reason}`)
            .setPlaceholder("Select a script...")
            .addOptions(options);

          return interaction.editReply({
            content: `Select a script to blacklist role <@&${role.id}> from:`,
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch (err) {
          console.error("blacklistrole error:", err);
          return interaction.editReply({ content: "❌ Failed to blacklist role." }).catch(() => {});
        }
      }

      if (commandName === "unblacklist") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: false }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const targetRole = interaction.options.getRole("role");

          if (!targetUser && !targetRole) {
            return interaction.editReply({ content: "❌ Select a user or role to unblacklist!" }).catch(() => {});
          }

          if (targetRole) {
            const isPrem = await checkPremium(interaction.user.id);
            if (!isPrem) {
              return interaction.editReply({
                content: "❌ Unblacklisting **roles** is a Premium feature.\nYou can still unblacklist users on the Free plan.",
                components: [new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setLabel("💎 Buy Premium").setStyle(ButtonStyle.Link).setURL(PREMIUM_INFO.discord)
                )]
              }).catch(() => {});
            }
          }

          const bl = readBlacklist();
          let removed = 0;

          if (targetUser) {
            const index = bl.findIndex(b => b.type !== "role" && String(b.userId) === String(targetUser.id));
            if (index !== -1) { bl.splice(index, 1); removed++; }
          }

          if (targetRole) {
            for (let i = bl.length - 1; i >= 0; i--) {
              if (bl[i].type === "role" && String(bl[i].roleId) === String(targetRole.id)) {
                bl.splice(i, 1);
                removed++;
              }
            }
          }

          if (removed === 0) {
            return interaction.editReply({ content: "❌ Nothing to unblacklist (user/role not found)." }).catch(() => {});
          }

          writeBlacklist(bl);

          const parts = [];
          if (targetUser) parts.push(`<@${targetUser.id}>`);
          if (targetRole) parts.push(`<@&${targetRole.id}>`);

          return interaction.editReply({
            content: `✅ ${parts.join(" & ")} has been unblacklisted!`
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to unblacklist." }).catch(() => {});
        }
      }

      if (commandName === "genkey") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const days = interaction.options.getInteger("days");
          const amount = interaction.options.getInteger("amount") || 1;
          if (amount > 50) return interaction.editReply({ content: "❌ Maximum 50 keys per generation." }).catch(() => {});

          const myScripts = await getScriptsByOwner(interaction.user.id);
          if (myScripts.length === 0) return interaction.editReply({ content: "❌ You don't have any scripts yet." }).catch(() => {});

          if (myScripts.length === 1) {
            const scriptId = myScripts[0].id;
            const keys = readKeys();
            const generated = [];
            const expiry = days === 0 ? null : new Date(Date.now() + days * 86400000).toISOString();
            for (let i = 0; i < amount; i++) {
              const key = generateKey();
              keys.push({ key, hwid: null, userId: null, username: null, scriptId, redeemedAt: null, expiry, createdAt: new Date().toISOString(), createdBy: interaction.user.id });
              generated.push(key);
            }
            writeKeys(keys);
            return interaction.editReply({
              content: `✅ **${amount} key(s)** generated for **${myScripts[0].name}**!\n\n${generated.map(k => `\`${k}\``).join("\n")}`
            }).catch(() => {});
          }

          const options = myScripts.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map(s =>
            new StringSelectMenuOptionBuilder().setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name).setValue(s.id)
          );
          const select = new StringSelectMenuBuilder()
            .setCustomId(`genkey_select:${days}:${amount}:${interaction.user.id}`)
            .setPlaceholder("Select a script...").addOptions(options);

          return interaction.editReply({
            content: `Select a script to generate ${amount} key(s) for:`,
            components: [new ActionRowBuilder().addComponents(select)]
          }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to generate keys." }).catch(() => {});
        }
      }

      if (commandName === "revoke") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const key = interaction.options.getString("key");
          const targetUser = interaction.options.getUser("user");
          if (!key && !targetUser) return interaction.editReply({ content: "❌ Provide a key or user to revoke!" }).catch(() => {});

          const keys = readKeys();
          let removed = 0;

          if (key) {
            const newKeys = keys.filter(k => k.key !== key.toLowerCase().trim());
            removed = keys.length - newKeys.length;
            if (removed === 0) return interaction.editReply({ content: "❌ Key not found." }).catch(() => {});
            writeKeys(newKeys);
          } else {
            const newKeys = keys.filter(k => String(k.userId) !== String(targetUser.id));
            removed = keys.length - newKeys.length;
            writeKeys(newKeys);
          }

          return interaction.editReply({ content: `✅ Successfully revoked ${removed} key(s)!` }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to revoke." }).catch(() => {});
        }
      }

      if (commandName === "resethwid") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const keys = readKeys();
          const userKeys = keys.filter(k => String(k.userId) === String(targetUser.id));
          if (userKeys.length === 0) return interaction.editReply({ content: "❌ User doesn't have any key!" }).catch(() => {});

          let resetCount = 0;
          const updatedKeys = keys.map(k => {
            if (String(k.userId) === String(targetUser.id) && k.hwid) {
              resetCount++;
              return { ...k, hwid: null, lastHwidReset: new Date().toISOString() };
            }
            return k;
          });

          if (resetCount === 0) return interaction.editReply({ content: "ℹ️ No HWID is registered for this user." }).catch(() => {});
          writeKeys(updatedKeys);
          return interaction.editReply({ content: `✅ HWID has been reset for <@${targetUser.id}>! (${resetCount} key(s))` }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to reset HWID." }).catch(() => {});
        }
      }

      if (commandName === "listkeys") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const keys = readKeys();
          const myScripts = await getScriptsByOwner(interaction.user.id);
          const scriptMap = {};
          myScripts.forEach(s => { scriptMap[s.id] = s.name; });

          const myKeys = keys.filter(k => k.createdBy === interaction.user.id);
          if (myKeys.length === 0) return interaction.editReply({ content: "📭 You haven't generated any keys yet." }).catch(() => {});

          let list = "🔑 **YOUR GENERATED KEYS**\n\n";
          let used = 0, unused = 0;

          myKeys.sort((a, b) => (scriptMap[a.scriptId] || "").localeCompare(scriptMap[b.scriptId] || ""))
            .slice(0, 25).forEach(k => {
              const scriptName = scriptMap[k.scriptId] || "❓ Script deleted";
              if (k.userId) used++; else unused++;
              list += `**${scriptName}**\n`;
              list += `  • Key: \`${k.key}\`\n`;
              list += `  • Status: ${k.userId ? `✅ Used by <@${k.userId}>` : "⏳ Unused"}\n`;
              list += `  • HWID: ${k.hwid ? "🔒 Bound" : "🔓 Free"}\n`;
              list += `  • Expiry: ${k.expiry ? new Date(k.expiry).toLocaleDateString() : "♾️ Lifetime"}\n\n`;
            });

          list += `📊 **Total**: ${myKeys.length} | Used: ${used} | Unused: ${unused}`;
          if (list.length > 2000) list = list.slice(0, 1990) + "\n... (truncated)";

          return interaction.editReply({ content: list }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to list keys." }).catch(() => {});
        }
      }

      if (commandName === "userinfo") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          return interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        try {
          const targetUser = interaction.options.getUser("user");
          const member = await interaction.guild.members.fetch(targetUser.id);
          const keys = readKeys();
          const userKeys = keys.filter(k => String(k.userId) === String(targetUser.id));
          const cfg = readConfig()[interaction.guildId] || {};
          const hasBuyerRole = member.roles.cache.some(r => {
            const buyerRoles = Object.values(cfg.buyerRoles || {});
            return buyerRoles.includes(r.id) || r.id === cfg.buyerRole;
          });

          const userIsPrem = await checkPremium(targetUser.id);

          const embed = new EmbedBuilder()
            .setTitle(`👤 User Info: ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .setColor(0xFFD700)
            .addFields(
              { name: "📛 User", value: `<@${targetUser.id}>`, inline: true },
              { name: "🆔 ID", value: targetUser.id, inline: true },
              { name: "🚫 Blacklist", value: isBlacklisted(targetUser.id) ? "❌ Yes" : "✅ No", inline: true },
              { name: "👑 Premium", value: userIsPrem ? "✅ Yes" : "🆓 Free", inline: true },
              { name: "🎭 Buyer Role", value: hasBuyerRole ? "✅ Has" : "❌ Doesn't have", inline: true },
              { name: "🔑 Key Count", value: String(userKeys.length), inline: true },
              { name: "🖥️ HWID", value: userKeys.some(k => k.hwid) ? "🔒 Bound" : "🔓 Not bound", inline: true }
            )
            .setFooter({ text: "Kingmor 👑" })
            .setTimestamp();

          return interaction.editReply({ embeds: [embed] }).catch(() => {});
        } catch {
          return interaction.editReply({ content: "❌ Failed to get user info." }).catch(() => {});
        }
      }
    }

  } catch (err) {
    console.error("❌ Unhandled interaction error:", err);
    try {
      if (interaction.deferred) await interaction.editReply({ content: "❌ An error occurred. Please try again later." });
      else if (!interaction.replied) await interaction.reply({ content: "❌ An error occurred. Please try again later.", ephemeral: true });
    } catch {}
  }
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled rejection:", error);
});

client.login(CONFIG.token);
