<div align="center">

# Telegram Auto Join Bot

**Manage multiple Telegram accounts and automate channel joining — entirely from within your bot.**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Telegraf](https://img.shields.io/badge/Telegraf-4.16-26A5E4?style=flat-square&logo=telegram&logoColor=white)](https://telegraf.js.org)
[![GramJS](https://img.shields.io/badge/GramJS-2.26-26A5E4?style=flat-square&logo=telegram&logoColor=white)](https://gram.js.org)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

[Installation](#installation) · [Configuration](#configuration) · [Usage](#usage) · [Data Files](#data-files) · [Security](#security)

</div>

---

## Overview

Telegram Auto Join Bot is a self-contained, single-file Node.js bot that lets you manage any number of Telegram user accounts and mass-join channels or groups across all of them simultaneously. Everything — account creation, OTP verification, 2FA, joining, leaving — happens inside the Telegram bot interface. No external scripts, no command line input.

---

## Features

|                         |                                                                                |
| ----------------------- | ------------------------------------------------------------------------------ |
| In-bot session creation | Add Telegram accounts through the bot with full OTP and 2FA support            |
| Continuous onboarding   | After saving one account the bot immediately asks for the next                 |
| Auto phone detection    | Send a phone number at any time — the bot starts the flow automatically        |
| Multi-session joining   | Join any channel or group across all accounts with one confirmation            |
| Pre-join confirmation   | Preview the channel and session count before any action is taken               |
| Duplicate filtering     | Multiple identical links in one message are deduplicated automatically         |
| Leave all               | Leave every tracked channel across all sessions with one button                |
| Configurable delays     | Adjustable join delay per account and fixed leave delay to reduce restrictions |
| Paginated lists         | Sessions (5 per page) and joined channels (10 per page) with Back / Next       |
| Persistent storage      | JSON-based storage under `/data` — no database required                        |
| Error logging           | Background errors written to a log file, never printed to the terminal         |
| Clean terminal output   | Timestamped, level-labelled log lines — zero noise from internal libraries     |

---

## Project Structure

```
project/
├── index.js                   # Entire application — single file
└── data/
    ├── .env                   # Environment variables (create from .env.example)
    ├── .env.example           # Template for environment variables
    ├── sessions/              # Auto-created — stores .session files per account
    ├── joined_channels.json   # Auto-created — tracks joined channels per session
    ├── sessions_info.json     # Auto-created — stores account metadata
    └── logs/
        └── error_log.txt      # Auto-created — background error output
```

> All directories and JSON files are created automatically on first run. Only `data/.env` needs to be created manually.

---

## Requirements

- **Node.js** 18 or higher — [nodejs.org](https://nodejs.org)
- **Bot token** — create a bot via [@BotFather](https://t.me/BotFather)
- **API credentials** — obtain `API_ID` and `API_HASH` from [my.telegram.org](https://my.telegram.org)
- **Your user ID** — get it from [@userinfobot](https://t.me/userinfobot)

---

## Installation

**1. Clone the repository**

```bash
git clone https://github.com/Cryptoistaken/Telegram-Auto-Join-Bot.git
cd Telegram-Auto-Join-Bot
```

**2. Install dependencies**

```bash
npm install
```

**3. Set up your environment**

```bash
mkdir data
cp data/.env.example data/.env
```

Then open `data/.env` and fill in your values:

```env
BOT_TOKEN=your_bot_token_here
AUTHORIZED_USER_ID=your_telegram_user_id
API_ID=your_api_id
API_HASH=your_api_hash
JOIN_DELAY_SECONDS=3
```

**4. Start the bot**

```bash
npm start
```

```bash
npm run dev      # auto-restarts on file changes (uses nodemon)
```

---

## Configuration

| Variable             | Required | Default | Description                                               |
| -------------------- | :------: | :-----: | --------------------------------------------------------- |
| `BOT_TOKEN`          |   Yes    |    —    | Bot token from @BotFather                                 |
| `AUTHORIZED_USER_ID` |   Yes    |    —    | Your Telegram user ID — only this account can use the bot |
| `API_ID`             |   Yes    |    —    | API ID from my.telegram.org                               |
| `API_HASH`           |   Yes    |    —    | API Hash from my.telegram.org                             |
| `JOIN_DELAY_SECONDS` |    No    |   `3`   | Delay in seconds between each account when joining        |

---

## Usage

Send `/start` to open the main menu.

```
Sessions      Add Session
Join Channel  Joined List
Leave All     Delete Session
```

---

### Adding an Account

Press **Add Session** or send a phone number directly — the bot detects it automatically.

```
Step 1 — Phone number    +8801234567890  or  8801234567890
Step 2 — Verification    Enter the code Telegram sends to the account
Step 3 — 2FA (if set)    Enter the account password if prompted
```

The session is named after the account's Telegram display name. If the account has no name it is saved as `Account 1`, `Account 2`, etc. If a session with that name already exists, the last 4 digits of the phone number are appended.

After saving, the bot immediately asks for the next phone number. Send one to continue or press **Done** to return to the menu.

---

### Joining a Channel or Group

Send one or more links directly to the bot:

```
https://t.me/channelname
@channelname
```

Multiple links work — send them in one message, one per line. Duplicates are stripped. The bot shows a confirmation for each unique link before joining.

If a link was already joined by some sessions, the bot shows which ones and asks to force join with all sessions.

---

### Viewing Sessions

Press **Sessions** for a paginated list. Each entry includes phone number, display name, username, creation date, and joined channel count. Navigate with **Next** and **Back** — 5 per page.

---

### Viewing Joined Channels

Press **Joined List** for a flat paginated list in `[Session] link` format. 10 entries per page with **Next** and **Back** navigation.

---

### Leaving All Channels

Press **Leave All** for a summary of tracked channels across all sessions. Confirm to proceed. A 2-second delay is applied between each channel leave per session.

---

### Deleting a Session

Press **Delete Session** and select the account to remove. The session file, metadata, and joined channel records for that session are all permanently deleted.

---

## Session Naming

| Condition                   | Name assigned                         |
| --------------------------- | ------------------------------------- |
| Account has a display name  | `First Last`                          |
| Account has no display name | `Account 1`, `Account 2`, …           |
| Name already taken          | `First Last (last 4 digits of phone)` |

Characters invalid in filenames are replaced with `-`.

---

## Data Files

#### `data/sessions/*.session`

Serialized MTProto session strings. One file per account. These are authentication credentials — handle them accordingly.

#### `data/sessions_info.json`

Metadata per session: phone number, Telegram user ID, display name, username, and creation timestamp.

#### `data/joined_channels.json`

All channels and groups joined through the bot, grouped by session name. This is the source of truth for the Leave All feature.

#### `data/logs/error_log.txt`

Library-level and background errors routed here instead of the terminal. Consecutive identical errors are collapsed with a repeat counter.

---

## Security

- Only the user matching `AUTHORIZED_USER_ID` can interact with the bot. Everyone else is silently rejected.
- Session files are equivalent to logged-in credentials. Never share or commit them.
- Add the following to `.gitignore` before pushing:

```gitignore
data/
node_modules/
```

---

## Dependencies

| Package    | Version  | Role                                       |
| ---------- | -------- | ------------------------------------------ |
| `telegraf` | ^4.16.3  | Telegram Bot API framework                 |
| `telegram` | ^2.26.21 | MTProto client for user account operations |
| `dotenv`   | ^17.3.1  | Environment variable loading               |
| `nodemon`  | ^3.1.4   | Dev — auto-restart on change               |

---

<div align="center">

Made by [Cryptoistaken](https://github.com/Cryptoistaken)

</div>
