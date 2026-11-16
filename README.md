# SystemStatus

Lightweight uptime monitor for HTTP endpoints. Periodically pings a configurable list of URLs, stores results in SQLite, and exposes a web UI + JSON API to inspect latency, errors, and historical buckets.

## Features

- Periodic background checks (HTTP `GET`, configurable interval and timeout).
- SQLite persistence with automatic retention purge.
- Status page with real-time refresh and quick history filter (`1h / 3h / 7h / 24h`).
- Per-endpoint logs popup:
  - Bucketed history chart (groups all logs in range — not just the latest N).
  - Logs grouped by hour; click a row to expand and view detailed checks.
- Installable PWA (manifest + service worker).

## Tech Stack

- Node.js + Express 5
- Built-in `node:sqlite` for storage (no native dependencies)
- Tailwind (CDN) for the UI
- PWA: `public/manifest.json` + `public/sw.js`

## Requirements

- Node.js 22.13+ (uses built-in `node:sqlite`, global `fetch` and `performance`). Production runs Node 24.
- npm.

## Installation

```bash
git clone <repo-url> system-status
cd system-status
npm install
```

## Configuration

Create a `.env` file in the project root:

```env
# HTTP port for the dashboard / API
PORT=3000

# How often to check each endpoint (milliseconds)
CHECK_INTERVAL_MS=30000

# How long to keep logs in the DB (days). Older rows are purged each cycle.
LOG_RETENTION_DAYS=30

# Per-request timeout (milliseconds)
REQUEST_TIMEOUT_MS=5000

# Comma-separated list of URLs to monitor
API_URLS=https://api.example.com/health,https://db.example.com/ping

# Comma-separated display names matching API_URLS order.
# If a name is missing, "API-<n>" is used.
API_NAMES=App-Hub,App-DB

# Lark custom bot webhook. An alert is sent once when an endpoint fails
# 2 consecutive checks, and a recovery notice when it comes back up
# (retries with backoff on rate limit). Optional.
LARK_WEBHOOK_LINK=https://open.larksuite.com/open-apis/bot/v2/hook/<token>

# Heartbeat (push) monitors for tools without a URL, e.g. cron workers.
# Comma-separated names, must not clash with API_NAMES. Optional.
HEARTBEAT_NAMES=Cron-Spy,Cron-Report
# Shared secret the tools send when pinging. Generate with: openssl rand -hex 32
HEARTBEAT_TOKEN=<random-hex>
```

The SQLite file is created at `data/status.db` on first run.

## Run Locally

```bash
npm start          # production
npm run dev        # nodemon (auto-reload)
```

Open <http://localhost:3000>.

## API

| Method | Path                | Query                                                   | Description                                                          |
| ------ | ------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/status`       | `window_hours` (`1 \| 3 \| 7 \| 24`)                    | Latest status + bucketed history for each endpoint.                  |
| GET    | `/api/logs`         | `name`, `from`, `to`, `limit` (≤5000), `offset`         | Raw log rows, newest first.                                          |
| GET    | `/api/logs/stats`   | `name`, `from`, `to`                                    | Aggregate stats (total, ok, error, uptime, avg/min/max latency).     |
| GET    | `/api/logs/buckets` | `name`, `from`, `to`, `buckets` (default 120, max 500)  | Time-bucketed series across the whole range. Used by the popup chart.|
| GET    | `/api/logs/hourly`  | `name`, `from`, `to`                                    | Per-hour aggregates. Used by the popup log list.                     |
| GET/POST | `/api/heartbeat/:name` | `token` (or `Authorization: Bearer <token>`)        | Heartbeat ping from a tool listed in `HEARTBEAT_NAMES`. See below.   |

`from` / `to` accept either a Unix millisecond timestamp or an ISO date string.

## Heartbeat Monitors

For tools that have no URL to poll (cron workers, background jobs), the tool pings the app instead:

```bash
curl -fsS "https://status.hbcommerce.co/api/heartbeat/Cron-Spy?token=<HEARTBEAT_TOKEN>"
```

- Ping every 30s. Each check cycle marks a heartbeat `error` when its last ping is older than 1.5 × `CHECK_INTERVAL_MS` (45s by default).
- Results go into the same logs as polled endpoints, so the dashboard, history, and Lark alerts (🔴 after 2 failed checks, 🟢 on recovery) work the same way. A dead tool is reported roughly 75–105s after its last ping.
- Responses: `200` ok, `403` bad or missing token, `404` name not in `HEARTBEAT_NAMES`.
- Last ping times are kept in memory. After a restart the boot time counts as the last ping, so heartbeats aren't flagged during the first 45s.
- A heartbeat only proves the process is alive. To catch stuck jobs, ping at the end of each successful job run instead of from a separate timer.

## Project Structure

```
.
├── index.js         # Express app + scheduler
├── db.js            # SQLite schema and queries
├── public/          # Static UI (index.html, manifest, service worker, icon)
├── data/            # SQLite database (created at runtime)
├── package.json
└── .env             # Local config (not committed)
```

## Deploy

Production runs on the `monitor` host (CentOS 7, glibc 2.17) behind the ALB at <https://status.hbcommerce.co>, path `/home/centos/system-status`, port `3435`.

The system Node on that host is v14 (used by another app), so this app runs on a separate Node 24 build for glibc 2.17 at `~/.local/node24` (from `unofficial-builds.nodejs.org`). Never upgrade the system Node there.

### 1. Sync code to the server

Push everything except local-only files. `.env` is sent separately so it doesn't override the server's config by accident.

```bash
rsync -avhrzu --exclude={.env,.git,node_modules,data} ./ monitor:/home/centos/system-status/
rsync -vh .env monitor:/home/centos/system-status/.env
```

Then install dependencies on the server with Node 24's npm:

```bash
ssh monitor 'cd /home/centos/system-status && PATH=~/.local/node24/bin:$PATH npm install --omit=dev'
```

### 2. Setup PM2

```bash
ssh monitor
cd /home/centos/system-status

# Start under PM2 with the Node 24 interpreter (cwd must be the app dir so .env is loaded)
pm2 start index.js --name system-status \
  --interpreter ~/.local/node24/bin/node \
  --node-args="--disable-warning=ExperimentalWarning"

# Apply latest .env changes / code updates
pm2 restart system-status --update-env

# Stop / start / inspect
pm2 stop system-status
pm2 logs system-status

# Remove the process from PM2
pm2 delete system-status

# Persist the current PM2 process list across reboots
pm2 save
```

A typical update flow after the initial setup is:

```bash
# from your machine
rsync -avhrzu --exclude={.env,.git,node_modules,data} ./ monitor:/home/centos/system-status/

# on the server
ssh monitor 'cd /home/centos/system-status && PATH=~/.local/node24/bin:$PATH npm install --omit=dev && pm2 restart system-status --update-env'
```
