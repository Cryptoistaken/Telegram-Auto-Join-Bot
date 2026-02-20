const { Telegraf, Markup, session } = require("telegraf");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Api } = require("telegram/tl");
const fs = require("fs").promises;
const path = require("path");

const _origLog = console.log;
console.log = () => {};
require("dotenv").config({ path: path.join(__dirname, "data", ".env") });
console.log = _origLog;

const BOT_TOKEN = process.env.BOT_TOKEN;
const AUTHORIZED_USER_ID = parseInt(process.env.AUTHORIZED_USER_ID);
const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;

const DATA_DIR = path.join(__dirname, "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const LOGS_DIR = path.join(DATA_DIR, "logs");
const JOINED_CHANNELS_FILE = path.join(DATA_DIR, "joined_channels.json");
const SESSIONS_INFO_FILE = path.join(DATA_DIR, "sessions_info.json");
const ERROR_LOG_FILE = path.join(LOGS_DIR, "error_log.txt");

const JOIN_DELAY_MS = parseInt(process.env.JOIN_DELAY_SECONDS || "3") * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const _lastErrorMsg = { text: "", count: 0 };

async function writeErrorLog(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const line = `${ts}  ${msg}\n`;
  await fs.appendFile(ERROR_LOG_FILE, line).catch(() => {});
}

function suppressOrLog(err) {
  const msg = err && err.message ? err.message : String(err);
  if (_lastErrorMsg.text === msg) {
    _lastErrorMsg.count++;
    writeErrorLog(`[x${_lastErrorMsg.count}] ${msg}`).catch(() => {});
    return;
  }
  _lastErrorMsg.text = msg;
  _lastErrorMsg.count = 1;
  writeErrorLog(msg).catch(() => {});
}

const pad = (s, n) => String(s).padEnd(n);

function log(level, msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const label = pad(`[${level}]`, 9);
  process.stdout.write(`${ts}  ${label}  ${msg}\n`);
}

const logger = {
  info: (msg) => log("INFO", msg),
  ok: (msg) => log("OK", msg),
  warn: (msg) => log("WARN", msg),
  error: (msg) => log("ERROR", msg),
  step: (msg) => log("STEP", msg),
};

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

let joinedChannels = {};
let sessionsInfo = {};
const pendingFlows = new Map();

async function ensureDirectories() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true }).catch(() => {});
  await fs.mkdir(LOGS_DIR, { recursive: true }).catch(() => {});
  logger.info("Data directories verified");
}

async function loadData() {
  try {
    joinedChannels = JSON.parse(
      await fs.readFile(JOINED_CHANNELS_FILE, "utf8"),
    );
    logger.info(
      `Joined channels loaded — ${Object.keys(joinedChannels).length} session record`,
    );
  } catch {
    joinedChannels = {};
    logger.warn("No joined_channels.json found — starting fresh");
  }
  try {
    sessionsInfo = JSON.parse(await fs.readFile(SESSIONS_INFO_FILE, "utf8"));
    logger.info(
      `Sessions info loaded — ${Object.keys(sessionsInfo).length} entry`,
    );
  } catch {
    sessionsInfo = {};
    logger.warn("No sessions_info.json found — starting fresh");
  }
}

async function saveJoinedChannels() {
  await fs.writeFile(
    JOINED_CHANNELS_FILE,
    JSON.stringify(joinedChannels, null, 2),
  );
}

async function saveSessionsInfo() {
  await fs.writeFile(SESSIONS_INFO_FILE, JSON.stringify(sessionsInfo, null, 2));
}

async function getAvailableSessions() {
  try {
    const files = await fs.readdir(SESSIONS_DIR);
    return files.filter((f) => f.endsWith(".session"));
  } catch {
    return [];
  }
}

function authorize(ctx, next) {
  if (ctx.from.id !== AUTHORIZED_USER_ID) {
    logger.warn(`Unauthorized access — user ID: ${ctx.from.id}`);
    return ctx.reply("Unauthorized.");
  }
  return next();
}

function mainMenu() {
  return {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback("Sessions", "view_sessions"),
        Markup.button.callback("Add Session", "add_session"),
      ],
      [
        Markup.button.callback("Join Channel", "join_channel"),
        Markup.button.callback("Joined List", "view_joined"),
      ],
      [
        Markup.button.callback("Leave All", "leave_all"),
        Markup.button.callback("Delete Session", "delete_session"),
      ],
    ]),
  };
}

function backButton() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Back", "back_to_menu")],
  ]);
}

bot.start(authorize, (ctx) => {
  logger.info(
    `/start — user ${ctx.from.id} (${ctx.from.username || "no username"})`,
  );
  ctx.reply("*Telegram Auto Join Bot*\n\nChoose an option:", mainMenu());
});

bot.action("back_to_menu", authorize, (ctx) => {
  pendingFlows.delete(ctx.from.id);
  ctx.editMessageText("*Menu*", mainMenu());
});

const SESSIONS_PAGE_SIZE = 5;
const JOINED_PAGE_SIZE = 10;

function buildSessionsPage(sessions, page) {
  const total = sessions.length;
  const totalPages = Math.ceil(total / SESSIONS_PAGE_SIZE);
  const start = page * SESSIONS_PAGE_SIZE;
  const slice = sessions.slice(start, start + SESSIONS_PAGE_SIZE);

  let text = `*Sessions (${total}) — Page ${page + 1}/${totalPages}*\n\n`;
  for (let i = 0; i < slice.length; i++) {
    const name = slice[i].replace(".session", "");
    const joinedCount = joinedChannels[name]?.length || 0;
    const info = sessionsInfo[name];
    text += `${start + i + 1}. *${name}*\n`;
    if (info) {
      text += `   Phone: ${info.phone}\n`;
      text += `   Name: ${(info.firstName + " " + (info.lastName || "")).trimEnd()}\n`;
      text += `   Username: @${info.username}\n`;
      text += `   Created: ${new Date(info.createdAt).toLocaleString()}\n`;
    }
    text += `   Joined channels: ${joinedCount}\n\n`;
  }

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback("Back", `sess_p_${page - 1}`));
  if (page < totalPages - 1)
    nav.push(Markup.button.callback("Next", `sess_p_${page + 1}`));
  const buttons = [];
  if (nav.length > 0) buttons.push(nav);
  buttons.push([Markup.button.callback("Menu", "back_to_menu")]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

function buildJoinedPage(page) {
  const allEntries = [];
  for (const [name, channels] of Object.entries(joinedChannels)) {
    for (const ch of channels) {
      allEntries.push({ session: name, channel: ch });
    }
  }

  const total = allEntries.length;
  const totalPages = Math.ceil(total / JOINED_PAGE_SIZE);
  const start = page * JOINED_PAGE_SIZE;
  const slice = allEntries.slice(start, start + JOINED_PAGE_SIZE);

  let text = `*Joined Channels (${total}) — Page ${page + 1}/${totalPages}*\n\n`;
  for (const entry of slice) {
    text += `[${entry.session}] ${entry.channel}\n`;
  }

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback("Back", `join_p_${page - 1}`));
  if (page < totalPages - 1)
    nav.push(Markup.button.callback("Next", `join_p_${page + 1}`));
  const buttons = [];
  if (nav.length > 0) buttons.push(nav);
  buttons.push([Markup.button.callback("Menu", "back_to_menu")]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

bot.action("view_sessions", authorize, async (ctx) => {
  logger.info(`View sessions page 0 — user ${ctx.from.id}`);
  const sessions = await getAvailableSessions();

  if (sessions.length === 0) {
    return ctx.editMessageText(
      "No sessions found.\n\nUse *Add Session* to create one.",
      { parse_mode: "Markdown", ...backButton() },
    );
  }

  const { text, keyboard } = buildSessionsPage(sessions, 0);
  ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
});

bot.action(/^sess_p_(\d+)$/, authorize, async (ctx) => {
  const page = parseInt(ctx.match[1]);
  logger.info(`View sessions page ${page} — user ${ctx.from.id}`);
  const sessions = await getAvailableSessions();
  const { text, keyboard } = buildSessionsPage(sessions, page);
  ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
});

bot.action("add_session", authorize, (ctx) => {
  const userId = ctx.from.id;
  pendingFlows.set(userId, { step: "phone", chatId: ctx.chat.id });
  logger.step(`Session creation started — user ${userId}`);

  ctx.editMessageText(
    "*Add Session — Step 1 of 2*\n\nEnter the phone number with country code:\n\nExample: `+8801234567890` or `8801234567890`",
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Cancel", "back_to_menu")],
      ]),
    },
  );
});

bot.action("join_channel", authorize, async (ctx) => {
  const sessions = await getAvailableSessions();
  if (sessions.length === 0) {
    return ctx.editMessageText("No sessions found. Add a session first.", {
      parse_mode: "Markdown",
      ...backButton(),
    });
  }

  const userId = ctx.from.id;
  pendingFlows.set(userId, { step: "join_link", chatId: ctx.chat.id });
  logger.step(`Join channel flow started — user ${userId}`);

  ctx.editMessageText(
    "*Join Channel*\n\nSend the channel link or username:\n\n`https://t.me/channel`\n`@channel`",
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Cancel", "back_to_menu")],
      ]),
    },
  );
});

bot.action("view_joined", authorize, (ctx) => {
  logger.info(`View joined page 0 — user ${ctx.from.id}`);
  const hasAny = Object.values(joinedChannels).some((arr) => arr.length > 0);

  if (!hasAny) {
    return ctx.editMessageText("No channels joined yet.", { ...backButton() });
  }

  const { text, keyboard } = buildJoinedPage(0);
  ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
});

bot.action(/^join_p_(\d+)$/, authorize, (ctx) => {
  const page = parseInt(ctx.match[1]);
  logger.info(`View joined page ${page} — user ${ctx.from.id}`);
  const { text, keyboard } = buildJoinedPage(page);
  ctx.editMessageText(text, { parse_mode: "Markdown", ...keyboard });
});

bot.action("leave_all", authorize, async (ctx) => {
  logger.info(`Leave all initiated — user ${ctx.from.id}`);
  const totalChannels = Object.values(joinedChannels).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );

  if (totalChannels === 0) {
    return ctx.editMessageText("No tracked channels to leave.", {
      ...backButton(),
    });
  }

  const sessionCount = Object.keys(joinedChannels).filter(
    (k) => joinedChannels[k].length > 0,
  ).length;

  ctx.editMessageText(
    `*Leave All Channels*\n\nThis will leave *${totalChannels}* tracked channel(s) across *${sessionCount}* session(s).\n\nThis action cannot be undone. Confirm?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Confirm — Leave All", "confirm_leave_all")],
        [Markup.button.callback("Cancel", "back_to_menu")],
      ]),
    },
  );
});

bot.action("confirm_leave_all", authorize, async (ctx) => {
  logger.warn(`Confirmed leave all — user ${ctx.from.id}`);
  await ctx.editMessageText("Leaving all tracked channels... Please wait.", {
    parse_mode: "Markdown",
  });

  const sessions = await getAvailableSessions();
  const results = [];
  let totalSuccess = 0;
  let totalFail = 0;

  for (const sessionFile of sessions) {
    const name = sessionFile.replace(".session", "");
    const channels = [...(joinedChannels[name] || [])];

    if (channels.length === 0) continue;

    logger.info(
      `Processing leave for session: ${name} — ${channels.length} channel(s)`,
    );
    let sessionSuccess = 0;
    let sessionFail = 0;

    try {
      const sessionPath = path.join(SESSIONS_DIR, `${name}.session`);
      const sessionData = await fs.readFile(sessionPath, "utf8");
      const client = new TelegramClient(
        new StringSession(sessionData),
        API_ID,
        API_HASH,
        {
          connectionRetries: 3,
          retryDelay: 1000,
          timeout: 30000,
        },
      );

      client.setLogLevel("none");
      await client.connect();
      logger.info(`Connected — session: ${name}`);

      for (let li = 0; li < channels.length; li++) {
        const link = channels[li];
        if (li > 0) await sleep(2000);
        try {
          let username = link;
          if (link.includes("t.me/")) {
            username = link.split("t.me/")[1].split("?")[0].split("/")[0];
          } else if (link.startsWith("@")) {
            username = link.substring(1);
          }

          try {
            await client.invoke(
              new Api.channels.LeaveChannel({ channel: username }),
            );
          } catch {
            const me = await client.getMe();
            const entity = await client.getEntity(username);
            await client.invoke(
              new Api.messages.DeleteChatUser({
                chatId: entity.id,
                userId: me.id,
              }),
            );
          }

          joinedChannels[name] = joinedChannels[name].filter(
            (ch) => ch !== link,
          );
          sessionSuccess++;
          totalSuccess++;
          logger.ok(`Left: ${link} — session: ${name}`);
        } catch (err) {
          sessionFail++;
          totalFail++;
          logger.error(
            `Failed to leave: ${link} — session: ${name} — ${err.message}`,
          );
        }
      }

      await client.disconnect();
      logger.info(`Disconnected — session: ${name}`);
    } catch (err) {
      logger.error(`Connection failed for session ${name}: ${err.message}`);
      sessionFail += channels.length;
      totalFail += channels.length;
    }

    results.push(`*${name}*: ${sessionSuccess} left, ${sessionFail} failed`);
  }

  await saveJoinedChannels();
  logger.ok(
    `Leave all complete — success: ${totalSuccess}, failed: ${totalFail}`,
  );

  const resultText =
    `*Leave All — Complete*\n\n${results.join("\n")}\n\n` +
    `Total: ${totalSuccess} left, ${totalFail} failed`;

  ctx.editMessageText(resultText, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("Back to Menu", "back_to_menu")],
    ]),
  });
});

bot.action("delete_session", authorize, async (ctx) => {
  const sessions = await getAvailableSessions();

  if (sessions.length === 0) {
    return ctx.editMessageText("No sessions to delete.", { ...backButton() });
  }

  const buttons = sessions.map((s) => {
    const name = s.replace(".session", "");
    return [Markup.button.callback(name, `del_${name}`)];
  });
  buttons.push([Markup.button.callback("Cancel", "back_to_menu")]);

  ctx.editMessageText("*Delete Session*\n\nSelect session to delete:", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
});

bot.action(/^del_(.+)$/, authorize, async (ctx) => {
  const name = ctx.match[1];
  logger.warn(`Delete session requested: ${name} — user ${ctx.from.id}`);

  try {
    await fs.unlink(path.join(SESSIONS_DIR, `${name}.session`));

    if (joinedChannels[name]) {
      delete joinedChannels[name];
      await saveJoinedChannels();
    }
    if (sessionsInfo[name]) {
      delete sessionsInfo[name];
      await saveSessionsInfo();
    }

    logger.ok(`Session deleted: ${name}`);
    ctx.editMessageText(`Session *${name}* deleted.`, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Back to Menu", "back_to_menu")],
      ]),
    });
  } catch (err) {
    logger.error(`Failed to delete session ${name}: ${err.message}`);
    ctx.editMessageText(`Failed to delete session: ${err.message}`, {
      ...backButton(),
    });
  }
});

bot.action(/^force_join_(.+)$/, authorize, async (ctx) => {
  const link = decodeURIComponent(ctx.match[1]);
  logger.info(`Force join: ${link} — user ${ctx.from.id}`);
  await processJoinRequest(ctx, link, true);
});

bot.on("text", authorize, async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();
  const flow = pendingFlows.get(userId);

  logger.info(
    `Text received — user ${userId} — step: ${flow ? flow.step : "none"}`,
  );

  if (flow) {
    await handleFlow(ctx, userId, text, flow);
    return;
  }

  const lines = text
    .split(/\s+|\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const links = [
    ...new Set(lines.filter((l) => l.includes("t.me/") || l.startsWith("@"))),
  ];

  if (links.length > 0) {
    for (const link of links) {
      await handleChannelJoinRequest(ctx, link);
    }
    return;
  }

  const looksLikePhone = /^\+?\d{10,15}$/.test(text.replace(/[\s\-().]/g, ""));
  if (looksLikePhone) {
    logger.step(
      `Phone number detected — user ${userId} — starting session creation`,
    );
    const autoFlow = { step: "phone", chatId: ctx.chat.id };
    pendingFlows.set(userId, autoFlow);
    await handleFlow(ctx, userId, text, autoFlow);
    return;
  }

  ctx.reply(
    "Send a channel link to join, or use /start to open the menu.\n\nExamples:\n- https://t.me/channel\n- @channel",
  );
});

async function handleFlow(ctx, userId, text, flow) {
  if (flow.step === "join_link") {
    if (!text.includes("t.me/") && !text.startsWith("@")) {
      logger.warn(`Invalid join link from user ${userId}: ${text}`);
      return ctx.reply(
        "Invalid format. Send a channel link:\n\n`https://t.me/channel`\n`@channel`",
        { parse_mode: "Markdown" },
      );
    }
    pendingFlows.delete(userId);
    await handleChannelJoinRequest(ctx, text);
    return;
  }

  if (flow.step === "phone") {
    let phone = text.replace(/[^\d+]/g, "");
    if (!phone.startsWith("+")) phone = "+" + phone;
    if (!/^\+\d{10,15}$/.test(phone)) {
      logger.warn(`Invalid phone format from user ${userId}: ${text}`);
      return ctx.reply(
        "Invalid format. Enter your number with or without `+` (example: `+8801234567890`):",
        {
          parse_mode: "Markdown",
        },
      );
    }

    flow.phone = phone;
    flow.step = "connecting";
    pendingFlows.set(userId, flow);

    logger.step(`Phone set: ${phone} — initiating Telegram auth`);
    ctx.reply(
      `*Add Session — Step 2 of 2*\n\nConnecting to Telegram for \`${phone}\`...\n\nA verification code will be sent to this number.`,
      { parse_mode: "Markdown" },
    );

    initiateSessionCreation(userId, flow).catch((err) => {
      logger.error(`Session creation failed for ${flow.phone}: ${err.message}`);
      pendingFlows.delete(userId);
      bot.telegram.sendMessage(
        flow.chatId,
        `Session creation failed:\n\n${err.message}\n\nUse /start to try again.`,
      );
    });

    return;
  }

  if (flow.step === "code" || flow.step === "password") {
    if (flow.resolver) {
      const resolver = flow.resolver;
      flow.resolver = null;
      pendingFlows.set(userId, flow);
      logger.step(`${flow.step} input received — phone: ${flow.phone}`);
      resolver(text);
    }
    return;
  }
}

async function initiateSessionCreation(userId, flow) {
  const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
    connectionRetries: 5,
    retryDelay: 1000,
    timeout: 60000,
    requestRetries: 3,
  });

  client.setLogLevel("none");
  flow.client = client;

  logger.info(`TelegramClient created — phone: ${flow.phone}`);

  await client.start({
    phoneNumber: async () => {
      logger.step(`Providing phone number: ${flow.phone}`);
      return flow.phone;
    },

    phoneCode: async () => {
      return new Promise((resolve) => {
        flow.step = "code";
        flow.resolver = resolve;
        pendingFlows.set(userId, flow);
        logger.step(`Waiting for verification code — phone: ${flow.phone}`);
        bot.telegram.sendMessage(
          flow.chatId,
          `Verification code sent to \`${flow.phone}\`.\n\nEnter the code:`,
          { parse_mode: "Markdown" },
        );
      });
    },

    password: async (hint) => {
      return new Promise((resolve) => {
        flow.step = "password";
        flow.resolver = resolve;
        pendingFlows.set(userId, flow);
        const hintText = hint ? ` (hint: ${hint})` : "";
        logger.step(`2FA required${hintText} — phone: ${flow.phone}`);
        bot.telegram.sendMessage(
          flow.chatId,
          `Two-factor authentication is enabled${hintText}.\n\nEnter your 2FA password:`,
          { parse_mode: "Markdown" },
        );
      });
    },

    onError: (err) => {
      logger.error(`Auth error for ${flow.phone}: ${err.message}`);
    },
  });

  logger.info(`Auth complete — fetching user info for phone: ${flow.phone}`);
  const userInfo = await client.getMe();

  const rawName =
    `${userInfo.firstName || ""} ${userInfo.lastName || ""}`.trim();
  let sessionName = rawName || null;

  if (!sessionName) {
    const existing = await getAvailableSessions();
    sessionName = `Account ${existing.length + 1}`;
  } else {
    const sanitized = sessionName.replace(/[/\\?%*:|"<>]/g, "-");
    const sessionPath = path.join(SESSIONS_DIR, `${sanitized}.session`);
    const exists = await fs
      .access(sessionPath)
      .then(() => true)
      .catch(() => false);
    sessionName = exists ? `${sanitized} (${flow.phone.slice(-4)})` : sanitized;
  }

  flow.sessionName = sessionName;

  const sessionString = client.session.save();
  const sessionPath = path.join(SESSIONS_DIR, `${sessionName}.session`);

  await fs.writeFile(sessionPath, sessionString);
  logger.ok(`Session file written: ${sessionName}.session`);

  sessionsInfo[sessionName] = {
    phone: flow.phone,
    userId: userInfo.id.toString(),
    username: userInfo.username || "N/A",
    firstName: userInfo.firstName || "N/A",
    lastName: userInfo.lastName || "",
    createdAt: new Date().toISOString(),
  };
  await saveSessionsInfo();

  await client.disconnect();
  pendingFlows.delete(userId);

  logger.ok(
    `Session created: ${sessionName} — ${rawName || "N/A"} (@${userInfo.username || "no username"})`,
  );

  const displayName = rawName || "N/A";
  await bot.telegram.sendMessage(
    flow.chatId,
    `*Session Created*\n\nSession: ${sessionName}\nPhone: ${flow.phone}\nUser: ${displayName}\nUsername: @${userInfo.username || "None"}`,
    { parse_mode: "Markdown" },
  );

  pendingFlows.set(userId, { step: "phone", chatId: flow.chatId });
  logger.step(`Asking for next account — user ${userId}`);

  bot.telegram.sendMessage(
    flow.chatId,
    `Add another account? Send the next phone number, or press Done to return to the menu.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Done", "back_to_menu")],
      ]),
    },
  );
}

async function handleChannelJoinRequest(ctx, link) {
  const sessions = await getAvailableSessions();

  if (sessions.length === 0) {
    logger.warn(`Join requested but no sessions available`);
    return ctx.reply("No sessions available. Add a session first.");
  }

  const alreadyJoined = [];
  for (const [name, channels] of Object.entries(joinedChannels)) {
    if (channels.some((ch) => ch.toLowerCase() === link.toLowerCase())) {
      alreadyJoined.push(name);
    }
  }

  const encodedLink = encodeURIComponent(link);

  let username = link;
  if (link.includes("t.me/")) {
    username = "@" + link.split("t.me/")[1].split("?")[0].split("/")[0];
  } else if (!link.startsWith("@")) {
    username = "@" + link;
  }

  if (alreadyJoined.length > 0) {
    logger.warn(`Already joined by ${alreadyJoined.length} session: ${link}`);
    const sessionList = alreadyJoined.map((s) => `- ${s}`).join("\n");
    return ctx.reply(
      `*Already Joined*\n\nChannel: \`${username}\`\n\nAlready joined by:\n${sessionList}\n\nForce join with all ${sessions.length} session?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              `Proceed — ${sessions.length} session`,
              `force_join_${encodedLink}`,
            ),
          ],
          [Markup.button.callback("Cancel", "back_to_menu")],
        ]),
      },
    );
  }

  logger.info(
    `Join confirmation shown — ${link} — ${sessions.length} session available`,
  );
  ctx.reply(
    `*Confirm Join*\n\nChannel: \`${username}\`\nSessions available: *${sessions.length}*\n\nProceed to join with all sessions?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            `Proceed — ${sessions.length} session`,
            `force_join_${encodedLink}`,
          ),
        ],
        [Markup.button.callback("Cancel", "back_to_menu")],
      ]),
    },
  );
}

async function processJoinRequest(ctx, link, isCallback) {
  const sessions = await getAvailableSessions();

  let msg;
  if (isCallback) {
    msg = await ctx.editMessageText(`Joining: \`${link}\`\n\nPlease wait...`, {
      parse_mode: "Markdown",
    });
  } else {
    msg = await ctx.replyWithMarkdown(`Joining: \`${link}\`\n\nPlease wait...`);
  }

  logger.info(
    `Join request — ${link} — ${sessions.length} session(s) — delay: ${JOIN_DELAY_MS / 1000}s`,
  );

  const results = [];
  let successCount = 0;

  for (let i = 0; i < sessions.length; i++) {
    const name = sessions[i].replace(".session", "");
    if (i > 0) {
      logger.info(`Waiting ${JOIN_DELAY_MS / 1000}s before next session...`);
      await sleep(JOIN_DELAY_MS);
    }
    try {
      const result = await joinChannelWithSession(name, link);
      if (result.success) {
        results.push(`+ ${name}`);
        successCount++;
        logger.ok(`Joined: ${link} — session: ${name}`);
      } else {
        results.push(`- ${name}: ${result.error}`);
        logger.warn(
          `Join failed — session: ${name} — ${link}: ${result.error}`,
        );
      }
    } catch (err) {
      results.push(`- ${name}: ${err.message}`);
      logger.error(`Join error — session: ${name} — ${link}: ${err.message}`);
    }
  }

  logger.info(
    `Join complete — ${link} — success: ${successCount}/${sessions.length}`,
  );

  const resultText =
    `*Join Results*\n\`${link}\`\n\n${results.join("\n")}\n\n` +
    `Success: ${successCount}/${sessions.length}`;

  if (isCallback) {
    ctx.editMessageText(resultText, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Back to Menu", "back_to_menu")],
      ]),
    });
  } else {
    bot.telegram.editMessageText(
      ctx.chat.id,
      msg.message_id,
      undefined,
      resultText,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("Back to Menu", "back_to_menu")],
        ]),
      },
    );
  }
}

async function joinChannelWithSession(sessionName, link) {
  try {
    const sessionPath = path.join(SESSIONS_DIR, `${sessionName}.session`);
    const sessionData = await fs.readFile(sessionPath, "utf8");

    const client = new TelegramClient(
      new StringSession(sessionData),
      API_ID,
      API_HASH,
      {
        connectionRetries: 3,
        retryDelay: 1000,
        timeout: 30000,
      },
    );

    client.setLogLevel("none");
    await client.connect();

    let username = link;
    if (link.includes("t.me/")) {
      username = link.split("t.me/")[1].split("?")[0].split("/")[0];
    } else if (link.startsWith("@")) {
      username = link.substring(1);
    }

    try {
      await client.invoke(new Api.channels.JoinChannel({ channel: username }));
    } catch {
      await client.invoke(
        new Api.messages.ImportChatInvite({ hash: username }),
      );
    }

    if (!joinedChannels[sessionName]) joinedChannels[sessionName] = [];
    if (
      !joinedChannels[sessionName].some(
        (ch) => ch.toLowerCase() === link.toLowerCase(),
      )
    ) {
      joinedChannels[sessionName].push(link);
      await saveJoinedChannels();
    }

    await client.disconnect();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

bot.catch((err, ctx) => {
  logger.error(`Unhandled bot error: ${err.message}`);
  if (ctx) ctx.reply("An error occurred. Please try again.").catch(() => {});
});

async function start() {
  logger.info("Initializing bot...");

  if (!BOT_TOKEN || !AUTHORIZED_USER_ID || !API_ID || !API_HASH) {
    logger.error("Missing required environment variables in data/.env");
    logger.error("Required: BOT_TOKEN, AUTHORIZED_USER_ID, API_ID, API_HASH");
    process.exit(1);
  }

  await ensureDirectories();
  await loadData();

  logger.info("Launching Telegram bot...");
  await bot.launch();
  logger.ok("Bot is live and polling for updates");
  logger.info(`Authorized user ID: ${AUTHORIZED_USER_ID}`);
}

start().catch((err) => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});

process.once("SIGINT", () => {
  logger.warn("SIGINT received — shutting down");
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  logger.warn("SIGTERM received — shutting down");
  bot.stop("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  suppressOrLog(reason);
});

process.on("uncaughtException", (err) => {
  suppressOrLog(err);
});
