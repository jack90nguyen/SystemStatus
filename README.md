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
- `better-sqlite3` for storage
- Tailwind (CDN) for the UI
- PWA: `public/manifest.json` + `public/sw.js`

## Requirements

- Node.js 18+ (uses global `fetch` and `performance`).
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

`from` / `to` accept either a Unix millisecond timestamp or an ISO date string.

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

### 1. Sync code to the server

Push everything except local-only files. `.env` is sent separately so it doesn't override the server's config by accident.

```bash
rsync -avhrzu --exclude={.env,.git,node_modules,data} ./ sandbox:/home/ec2-user/system-status/
rsync -vh .env sandbox:/home/ec2-user/system-status/.env
```

Then install dependencies on the server:

```bash
ssh sandbox
cd /home/ec2-user/system-status
npm install --production
```

### 2. Setup PM2

```bash
ssh sandbox

# Start under PM2 (uses "npm start" → node index.js)
pm2 start npm --name "system-status" -- start

# Apply latest .env changes
pm2 restart system-status --update-env

# Zero-downtime reload after a code update
pm2 reload system-status

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
rsync -avhrzu --exclude={.env,.git,node_modules,data} ./ sandbox:/home/ec2-user/system-status/

# on the server
ssh sandbox 'cd /home/ec2-user/system-status && npm install --production && pm2 reload system-status'
```
