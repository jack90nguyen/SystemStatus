require('dotenv').config();
const express = require('express');
const path = require('path');
const {
  insertLogs,
  getLatestPerName,
  getHistorySince,
  queryLogs,
  statsForRange,
  purgeOlderThan,
} = require('./db');

const app = express();
const port = process.env.PORT || 3000;

const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS, 10) || 30_000;
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS, 10) || 30;
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 5_000;

function getEndpoints() {
  const urls = (process.env.API_URLS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const names = (process.env.API_NAMES || '')
    .split(',').map(s => s.trim());
  return urls.map((url, i) => ({ name: names[i] || `API-${i + 1}`, url }));
}

async function checkOne(endpoint) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.url, { method: 'GET', signal: controller.signal });
    const time_ms = Math.round(performance.now() - startedAt);
    return {
      name: endpoint.name,
      url: endpoint.url,
      status: response.status === 200 ? 'ok' : 'error',
      time_ms,
      error: response.status === 200 ? null : `HTTP ${response.status}`,
      checked_at: Date.now(),
    };
  } catch (err) {
    const time_ms = Math.round(performance.now() - startedAt);
    return {
      name: endpoint.name,
      url: endpoint.url,
      status: 'error',
      time_ms,
      error: err.message,
      checked_at: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runCheckCycle() {
  const endpoints = getEndpoints();
  if (endpoints.length === 0) return;
  const results = await Promise.all(endpoints.map(checkOne));
  insertLogs(results);
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  purgeOlderThan(cutoff);
}

function startScheduler() {
  runCheckCycle().catch(err => console.error('Initial check failed:', err));
  setInterval(() => {
    runCheckCycle().catch(err => console.error('Scheduled check failed:', err));
  }, CHECK_INTERVAL_MS);
}

app.use(express.static(path.join(__dirname, 'public')));

const HISTORY_WINDOW_HOURS = new Set([1, 3, 7]);

app.get('/api/status', (req, res) => {
  let hours = parseInt(req.query.window_hours, 10);
  if (!HISTORY_WINDOW_HOURS.has(hours)) hours = 1;
  const sinceMs = Date.now() - hours * 60 * 60 * 1000;

  const endpoints = getEndpoints();
  const latestMap = new Map(getLatestPerName().map(r => [r.name, r]));

  const data = endpoints.map(ep => {
    const latest = latestMap.get(ep.name);
    const history = getHistorySince(ep.name, sinceMs);
    return {
      name: ep.name,
      status: latest ? latest.status : 'unknown',
      time: latest ? `${latest.time_ms}ms` : '-',
      checked_at: latest ? latest.checked_at : null,
      history: history.map(h => ({
        status: h.status,
        time: `${h.time_ms}ms`,
        timestamp: new Date(h.checked_at).toISOString(),
      })),
    };
  });

  res.json({
    interval_ms: CHECK_INTERVAL_MS,
    retention_days: LOG_RETENTION_DAYS,
    window_hours: hours,
    items: data,
  });
});

const parseTimeParam = (v) => {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isNaN(n) && n > 0) return n;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
};

app.get('/api/logs/stats', (req, res) => {
  const { name, from, to } = req.query;
  const row = statsForRange({
    name: name || undefined,
    from: parseTimeParam(from),
    to:   parseTimeParam(to),
  });
  const total = row.total || 0;
  res.json({
    total,
    ok:       row.ok_count    || 0,
    error:    row.error_count || 0,
    uptime:   total > 0 ? (row.ok_count / total) : null,
    avg_ms:   row.avg_ms !== null ? Math.round(row.avg_ms) : null,
    min_ms:   row.min_ms,
    max_ms:   row.max_ms,
    first_at: row.first_at,
    last_at:  row.last_at,
  });
});

app.get('/api/logs', (req, res) => {
  const { name, from, to } = req.query;
  const limit  = Math.min(parseInt(req.query.limit, 10)  || 200, 5000);
  const offset = parseInt(req.query.offset, 10) || 0;

  const rows = queryLogs({
    name: name || undefined,
    from: parseTimeParam(from),
    to:   parseTimeParam(to),
    limit,
    offset,
  });

  res.json({
    count: rows.length,
    limit,
    offset,
    items: rows.map(r => ({
      id: r.id,
      name: r.name,
      status: r.status,
      time: `${r.time_ms}ms`,
      time_ms: r.time_ms,
      error: r.error,
      checked_at: r.checked_at,
      timestamp: new Date(r.checked_at).toISOString(),
    })),
  });
});

app.listen(port, () => {
  console.log(`SystemStatus running on http://localhost:${port}`);
  console.log(`Check interval: ${CHECK_INTERVAL_MS}ms | Retention: ${LOG_RETENTION_DAYS} days`);
  startScheduler();
});
