# Telegram Auto Join Bot

A single-file Telegram bot for managing multiple Telegram accounts and automating channel or group joining. Sessions are created and managed entirely from within the bot — no external scripts required.

---

## Features

- **In-bot session creation** — add Telegram accounts directly through the bot with OTP and optional 2FA support
- **Continuous account onboarding** — after adding one account the bot immediately prompts for the next without returning to the menu
- **Auto phone detection** — send a phone number at any time and the bot starts the session creation flow automatically
- **Multi-session joining** — join any channel or group across all sessions simultaneously with a single command
- **Confirmation before joining** — the bot shows a preview with session count before executing any join
- **Duplicate link filtering** — sending the same link multiple times in one message is deduplicated automatically
- **Leave all channels** — leave every tracked channel and group across all sessions with one button
- **Join delay** — configurable delay between each account action to reduce the risk of account restrictions
- **Leave delay** — 2-second pause between each channel leave within a session
- **Paginated session list** — sessions displayed 5 per page with Back and Next navigation
- **Paginated joined list** — joined channels displayed 10 per page with Back and Next navigation
- **Persistent storage** — all session data, joined channel records, and session metadata stored in flat JSON files under `/data`
- **Error logging** — background errors written to `/data/logs/error_log.txt` with deduplication, never printed to the terminal
- **Clean terminal output** — timestamped log lines with consistent level labels, no noise from internal library logs

---

## Project Structure

```
project/
├── index.js
└── data/
    ├── .env
    ├── sessions/
    │   └── *.session
    ├── joined_channels.json
    ├── sessions_info.json
    └── logs/
        └── error_log.txt
```

The `data/` directory and all subdirectories are created automatically on first run.

---

## Requirements

- Node.js 18 or higher
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A Telegram API ID and API Hash from [my.telegram.org](https://my.telegram.org)
- Your Telegram user ID (available from [@userinfobot](https://t.me/userinfobot))

---

## Installation

**1. Clone or download the project**

```bash
git clone <repository-url>
cd <project-directory>
```

**2. Install dependencies**

```bash
npm install
```

**3. Create the data directory and environment file**

```bash
mkdir data
```

Create `data/.env` with the following content:

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

For development with auto-restart on file changes:

```bash
npm run dev
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `BOT_TOKEN` | Yes | — | Telegram bot token from @BotFather |
| `AUTHORIZED_USER_ID` | Yes | — | Your Telegram user ID — only this user can operate the bot |
| `API_ID` | Yes | — | API ID from my.telegram.org |
| `API_HASH` | Yes | — | API Hash from my.telegram.org |
| `JOIN_DELAY_SECONDS` | No | `3` | Seconds to wait between each account when joining a channel |

---

## Usage

### Starting the bot

Send `/start` to your bot in Telegram. The main menu will appear with the following options.

---

### Adding a session

Press **Add Session** or simply send a phone number directly to the bot.

The bot will:
1. Ask for the phone number (with or without `+`, e.g. `+8801234567890` or `8801234567890`)
2. Send a verification code to that Telegram account
3. Ask you to forward the code
4. Ask for the 2FA password if enabled on the account
5. Save the session using the account's display name as the session name — accounts without a display name are saved as `Account 1`, `Account 2`, and so on

After each session is saved the bot immediately asks whether to add another account. Send the next phone number or press **Done** to return to the menu.

---

### Joining a channel or group

Send any channel or group link directly to the bot:

```
https://t.me/channelname
@channelname
```

You can also send multiple links in one message, one per line. Duplicates are filtered automatically. The bot will show a confirmation for each unique link showing how many sessions are available, then join with all sessions once you confirm.

If a channel was already joined by one or more sessions, the bot will indicate which sessions joined it and ask whether to force join with all sessions.

---

### Viewing sessions

Press **Sessions** to see a paginated list of all saved sessions. Each entry shows:

- Session name
- Phone number
- Display name
- Username
- Date created
- Number of channels joined

Use **Next** and **Back** to navigate. 5 sessions are shown per page.

---

### Viewing joined channels

Press **Joined List** to see all channels and groups that have been joined, displayed as `[SessionName] link`. Use **Next** and **Back** to navigate. 10 entries are shown per page.

---

### Leaving all channels

Press **Leave All** to see a summary of how many tracked channels exist across how many sessions. Confirm to proceed. Each session will leave all its tracked channels with a 2-second delay between each one.

---

### Deleting a session

Press **Delete Session** and select the session to remove. The session file, its entry in the sessions info file, and its joined channel records are all deleted.

---

## Session Naming

Session file names are derived automatically from the Telegram account's display name:

| Situation | Session name |
|---|---|
| Account has first and/or last name | `First Last` |
| Account has no display name | `Account 1`, `Account 2`, ... |
| A session with that name already exists | `First Last (last 4 digits of phone)` |

Invalid filename characters are replaced with `-`.

---

## Data Files

### `data/sessions/*.session`

Raw Telegram session strings. Each file represents one authenticated Telegram account. These files are sensitive — do not share them.

### `data/sessions_info.json`

Metadata for each session including phone number, display name, username, Telegram user ID, and creation timestamp.

### `data/joined_channels.json`

A record of every channel and group joined through the bot, grouped by session name. Used to track what to leave when using Leave All.

### `data/logs/error_log.txt`

Background and library-level errors are written here rather than printed to the terminal. Repeated identical errors are deduplicated with a counter.

---

## Security Notes

- Only the user whose ID matches `AUTHORIZED_USER_ID` can interact with the bot. All other users receive an unauthorized response.
- Session files in `data/sessions/` contain full authentication credentials for each Telegram account. Treat them with the same care as passwords.
- Do not commit the `data/` directory to version control. Add it to `.gitignore`.

```gitignore
data/
node_modules/
```

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `telegraf` | ^4.16.3 | Telegram Bot API framework |
| `telegram` | ^2.26.21 | MTProto client for user account operations |
| `dotenv` | ^17.3.1 | Environment variable loading |
| `nodemon` | ^3.1.4 | Dev dependency for auto-restart |
