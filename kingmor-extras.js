const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");
const axios = require("axios");

// Dipanggil dari bot.js: require("./kingmor-extras")({ ...helpers })
module.exports = function createExtras(ctx) {
  const {
    CONFIG, OWNER_ID, internalHeaders,
    readKeys, writeKeys, readConfig,
    hasPermission, getScriptsByOwner, fetchScriptById, getGuildPanelScript,
    generateKey, parseDuration, formatDuration, describeAxiosError
  } = ctx;

  // ==================== COMMAND DEFINITIONS ====================
  const commands = [
    new SlashCommandBuilder()
      .setName("keypremium")
      .setDescription("[OWNER ONLY] Create Premium key(s) that users redeem on the website")
      .addStringOption(o =>
        o.setName("duration")
          .setDescription("Premium duration, e.g. 7d, 30d, 12h, 1y, lifetime")
          .setRequired(true))
      .addIntegerOption(o =>
        o.setName("amount")
          .setDescription("Number of keys (1-20, default 1)")
          .setMinValue(1).setMaxValue(20)
          .setRequired(false))
      .toJSON()
  ];

  // ==================== HELPERS ====================
  // Returns { ms: number|null, label } or null if invalid. ms=null means lifetime.
  function parsePremiumDuration(input) {
    const s = String(input).trim().toLowerCase();
    if (["lifetime", "forever", "perm", "permanent", "0"].includes(s)) {
      return { ms: null, label: "Lifetime" };
    }
    if (/^\d+$/.test(s)) {
      const days = parseInt(s, 10);
      return { ms: days * 86400000, label: formatDuration(days * 86400000) };
    }
    const y = s.match(/^(\d+)\s*y$/);
    if (y) {
      const years = parseInt(y[1], 10);
      return { ms: years * 365 * 86400000, label: `${years} year(s)` };
    }
    const ms = parseDuration(s);
    if (!ms || ms < 60000) return null;
    return { ms, label: formatDuration(ms) };
  }

  function scriptOptions(scripts) {
    return [...scripts]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 25)
      .map(s =>
        new StringSelectMenuOptionBuilder()
          .setLabel(s.name.length > 50 ? s.name.slice(0, 47) + "..." : s.name)
          .setValue(s.id)
      );
  }

  // Core whitelist logic. Returns a message string.
  async function doWhitelist(interaction, { targetType, targetId, days, scriptId }) {
    const scriptInfo = await fetchScriptById(scriptId);
    if (!scriptInfo) return "❌ That script no longer exists.";

    // Script harus milik pengguna ini, atau script panel di server ini
    const panel = getGuildPanelScript(interaction.guildId);
    const allowed =
      String(scriptInfo.ownerId) === String(interaction.user.id) ||
      (panel && panel.scriptId === scriptId);
    if (!allowed) return "❌ You can only whitelist for your own scripts.";

    const keys = readKeys();
    const expiry = days === 0 ? null : new Date(Date.now() + days * 86400000).toISOString();
    const cfg = readConfig()[interaction.guildId] || {};
    const buyerRoleId = cfg.buyerRoles?.[scriptId] || cfg.buyerRole || null;
    const hasActive = (uid) => keys.find(k =>
      String(k.userId) === String(uid) &&
      k.scriptId === scriptId &&
      !(k.expiry && new Date(k.expiry) < new Date())
    );
    const durationText = days === 0 ? "lifetime" : `${days} day(s)`;

    if (targetType === "user") {
      if (hasActive(targetId)) return `❌ <@${targetId}> already has access to **${scriptInfo.name}**.`;

      let username = null;
      try { username = (await interaction.client.users.fetch(targetId)).username; } catch {}

      keys.push({
        key: generateKey(), hwid: null,
        userId: String(targetId), username, scriptId,
        redeemedAt: new Date().toISOString(), expiry,
        createdAt: new Date().toISOString(), createdBy: interaction.user.id
      });
      writeKeys(keys);

      if (buyerRoleId) {
        try {
          const member = await interaction.guild.members.fetch(targetId);
          await member.roles.add(buyerRoleId);
        } catch {}
      }
      return `✅ <@${targetId}> has been whitelisted for **${scriptInfo.name}** (${durationText}).\nThey can press **Get Script** on the panel to get their loader.`;
    }

    // role
    const role = await interaction.guild.roles.fetch(targetId);
    if (!role) return "❌ Role not found.";
    await interaction.guild.members.fetch();
    const members = role.members.filter(m => !m.user.bot);
    let added = 0, skipped = 0;

    for (const [, member] of members) {
      if (hasActive(member.id)) { skipped++; continue; }
      keys.push({
        key: generateKey(), hwid: null,
        userId: String(member.id), username: member.user.username, scriptId,
        redeemedAt: new Date().toISOString(), expiry,
        createdAt: new Date().toISOString(), createdBy: interaction.user.id
      });
      added++;
      if (buyerRoleId) {
        try { await member.roles.add(buyerRoleId); } catch {}
      }
    }
    writeKeys(keys);
    const note = skipped > 0 ? `, ${skipped} already had access` : "";
    return `✅ <@&${targetId}> has been whitelisted for **${scriptInfo.name}** (${durationText}).\n${added} member(s) added${note}.`;
  }

  // ==================== HANDLER ====================
  // Return true kalau interaksi sudah ditangani di sini.
  async function handle(interaction) {
    try {
      // ---------- /keypremium ----------
      if (interaction.isChatInputCommand() && interaction.commandName === "keypremium") {
        if (interaction.user.id !== OWNER_ID) {
          await interaction.reply({ content: "❌ This command is restricted to the bot owner only.", ephemeral: true }).catch(() => {});
          return true;
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        const parsed = parsePremiumDuration(interaction.options.getString("duration"));
        if (!parsed) {
          await interaction.editReply({
            content: "❌ Invalid duration. Examples: `7d`, `30d`, `12h`, `1w`, `1y`, `lifetime`.\nA plain number is read as days."
          }).catch(() => {});
          return true;
        }
        const amount = interaction.options.getInteger("amount") || 1;

        let data;
        try {
          const res = await axios.post(`${CONFIG.apiBase}/api/premiumkey/create`,
            { durationMs: parsed.ms, amount, createdBy: interaction.user.id },
            { headers: internalHeaders, timeout: 8000 });
          data = res.data;
        } catch (err) {
          console.error(`❌ keypremium failed: ${describeAxiosError(err)}`);
          await interaction.editReply({ content: "❌ Failed to create key(s). Check that the web server is online and API_SECRET matches." }).catch(() => {});
          return true;
        }

        const embed = new EmbedBuilder()
          .setTitle("👑 Premium Key(s) Created")
          .setColor(0xFFD700)
          .setDescription(data.keys.map(k => `\`${k}\``).join("\n"))
          .addFields(
            { name: "⏱️ Duration", value: parsed.label, inline: true },
            { name: "🔑 Amount", value: String(data.keys.length), inline: true },
            { name: "🌐 Redeem at", value: `${CONFIG.apiBase}/redeem`, inline: false }
          )
          .setFooter({ text: "Each key can be redeemed once • Kingmor 👑" })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] }).catch(() => {});
        return true;
      }

      // ---------- /whitelist ----------
      if (interaction.isChatInputCommand() && interaction.commandName === "whitelist") {
        if (!hasPermission(interaction.member, interaction.guildId)) {
          await interaction.reply({ content: "❌ No permission.", ephemeral: true }).catch(() => {});
          return true;
        }
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        const targetUser = interaction.options.getUser("user");
        const targetRole = interaction.options.getRole("role");
        const days = interaction.options.getInteger("days");

        if (!targetUser && !targetRole) {
          await interaction.editReply({ content: "❌ Select a user or role!" }).catch(() => {});
          return true;
        }
        if (days < 0) {
          await interaction.editReply({ content: "❌ Days must be 0 (lifetime) or more." }).catch(() => {});
          return true;
        }

        const targetType = targetUser ? "user" : "role";
        const targetId = targetUser ? targetUser.id : targetRole.id;

        // Script milik pengguna; kalau tidak punya, pakai script panel server ini
        let candidates = await getScriptsByOwner(interaction.user.id);
        if (candidates.length === 0) {
          const panel = getGuildPanelScript(interaction.guildId);
          if (panel) {
            const info = await fetchScriptById(panel.scriptId);
            if (info) candidates = [info];
          }
        }
        if (candidates.length === 0) {
          await interaction.editReply({
            content: "❌ You don't have any scripts, and this server has no script panel.\nUpload a script on the website, then run `/setuppanel`."
          }).catch(() => {});
          return true;
        }

        if (candidates.length === 1) {
          const msg = await doWhitelist(interaction, { targetType, targetId, days, scriptId: candidates[0].id });
          await interaction.editReply({ content: msg }).catch(() => {});
          return true;
        }

        const select = new StringSelectMenuBuilder()
          .setCustomId(`whitelist_pick:${targetType}:${targetId}:${days}`)
          .setPlaceholder("Select a script...")
          .addOptions(scriptOptions(candidates));

        await interaction.editReply({
          content: `Select the script to whitelist ${targetType === "user" ? `<@${targetId}>` : `<@&${targetId}>`} for (${days === 0 ? "lifetime" : days + " day(s)"}):`,
          components: [new ActionRowBuilder().addComponents(select)]
        }).catch(() => {});
        return true;
      }

      // ---------- dropdown pilih script untuk /whitelist ----------
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith("whitelist_pick:")) {
        await interaction.deferUpdate().catch(() => {});

        if (!interaction.guild || !hasPermission(interaction.member, interaction.guildId)) {
          await interaction.editReply({ content: "❌ No permission.", components: [] }).catch(() => {});
          return true;
        }

        const [, targetType, targetId, daysStr] = interaction.customId.split(":");
        const days = parseInt(daysStr, 10);
        const scriptId = interaction.values[0];

        const msg = await doWhitelist(interaction, { targetType, targetId, days, scriptId });
        await interaction.editReply({ content: msg, components: [] }).catch(() => {});
        return true;
      }
    } catch (err) {
      console.error("❌ kingmor-extras error:", err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: "❌ Something went wrong. Please try again.", components: [] });
        } else {
          await interaction.reply({ content: "❌ Something went wrong. Please try again.", ephemeral: true });
        }
      } catch {}
      return true;
    }
    return false;
  }

  return { commands, handle };
};
