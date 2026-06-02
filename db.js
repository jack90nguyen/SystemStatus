const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'status.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS status_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    url         TEXT,
    status      TEXT    NOT NULL,
    time_ms     INTEGER NOT NULL,
    error       TEXT,
    checked_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_logs_name_time   ON status_logs(name, checked_at DESC);
  CREATE INDEX IF NOT EXISTS idx_logs_checked_at  ON status_logs(checked_at DESC);
`);

const insertStmt = db.prepare(`
  INSERT INTO status_logs (name, url, status, time_ms, error, checked_at)
  VALUES (@name, @url, @status, @time_ms, @error, @checked_at)
`);

const insertManyTx = db.transaction((rows) => {
  for (const row of rows) insertStmt.run(row);
});

function insertLogs(rows) {
  if (!rows || rows.length === 0) return;
  insertManyTx(rows);
}

const latestPerNameStmt = db.prepare(`
  SELECT l.name, l.url, l.status, l.time_ms, l.error, l.checked_at
  FROM status_logs l
  JOIN (
    SELECT name, MAX(checked_at) AS max_t
    FROM status_logs
    GROUP BY name
  ) m ON m.name = l.name AND m.max_t = l.checked_at
`);

function getLatestPerName() {
  return latestPerNameStmt.all();
}

const historyStmt = db.prepare(`
  SELECT status, time_ms, error, checked_at
  FROM status_logs
  WHERE name = ?
  ORDER BY checked_at DESC
  LIMIT ?
`);

function getHistory(name, limit) {
  return historyStmt.all(name, limit);
}

const historySinceStmt = db.prepare(`
  SELECT status, time_ms, error, checked_at
  FROM status_logs
  WHERE name = ? AND checked_at >= ?
  ORDER BY checked_at ASC
`);

function getHistorySince(name, sinceMs) {
  return historySinceStmt.all(name, sinceMs);
}

function queryLogs({ name, from, to, limit = 500, offset = 0 }) {
  const clauses = [];
  const params = [];
  if (name) { clauses.push('name = ?'); params.push(name); }
  if (from) { clauses.push('checked_at >= ?'); params.push(from); }
  if (to)   { clauses.push('checked_at <= ?'); params.push(to); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const sql = `
    SELECT id, name, url, status, time_ms, error, checked_at
    FROM status_logs
    ${where}
    ORDER BY checked_at DESC
    LIMIT ? OFFSET ?
  `;
  return db.prepare(sql).all(...params, limit, offset);
}

function statsForRange({ name, from, to }) {
  const clauses = [];
  const params = [];
  if (name) { clauses.push('name = ?'); params.push(name); }
  if (from) { clauses.push('checked_at >= ?'); params.push(from); }
  if (to)   { clauses.push('checked_at <= ?'); params.push(to); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const sql = `
    SELECT
      COUNT(*)                                              AS total,
      SUM(CASE WHEN status = 'ok'    THEN 1 ELSE 0 END)     AS ok_count,
      SUM(CASE WHEN status != 'ok'   THEN 1 ELSE 0 END)     AS error_count,
      AVG(time_ms)                                          AS avg_ms,
      MIN(time_ms)                                          AS min_ms,
      MAX(time_ms)                                          AS max_ms,
      MIN(checked_at)                                       AS first_at,
      MAX(checked_at)                                       AS last_at
    FROM status_logs
    ${where}
  `;
  return db.prepare(sql).get(...params);
}

function bucketsForRange({ name, from, to, buckets }) {
  if (!from || !to || to <= from) return [];
  const n = Math.max(1, Math.min(parseInt(buckets, 10) || 120, 500));
  const span = to - from;
  const clauses = ['checked_at >= ?', 'checked_at <= ?'];
  const params = [from, to];
  if (name) { clauses.push('name = ?'); params.push(name); }
  const sql = `
    SELECT
      CAST((checked_at - ?) * ? / ? AS INTEGER)         AS raw_idx,
      COUNT(*)                                          AS total,
      SUM(CASE WHEN status = 'ok'  THEN 1 ELSE 0 END)   AS ok_count,
      SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END)   AS error_count,
      AVG(time_ms)                                      AS avg_ms,
      MAX(time_ms)                                      AS max_ms,
      MIN(checked_at)                                   AS first_at,
      MAX(checked_at)                                   AS last_at
    FROM status_logs
    WHERE ${clauses.join(' AND ')}
    GROUP BY raw_idx
    ORDER BY raw_idx ASC
  `;
  const rawRows = db.prepare(sql).all(from, n, span, ...params);
  const rows = [];
  const lastByIdx = new Map();
  for (const r of rawRows) {
    const idx = Math.min(n - 1, Math.max(0, r.raw_idx));
    const prev = lastByIdx.get(idx);
    if (!prev) {
      lastByIdx.set(idx, {
        idx,
        total: r.total,
        ok_count: r.ok_count,
        error_count: r.error_count,
        avg_sum: (r.avg_ms || 0) * r.total,
        max_ms: r.max_ms,
        first_at: r.first_at,
        last_at: r.last_at,
      });
    } else {
      prev.total += r.total;
      prev.ok_count += r.ok_count;
      prev.error_count += r.error_count;
      prev.avg_sum += (r.avg_ms || 0) * r.total;
      prev.max_ms = Math.max(prev.max_ms || 0, r.max_ms || 0);
      prev.first_at = Math.min(prev.first_at, r.first_at);
      prev.last_at = Math.max(prev.last_at, r.last_at);
    }
  }
  for (const v of lastByIdx.values()) {
    rows.push({
      idx: v.idx,
      total: v.total,
      ok_count: v.ok_count,
      error_count: v.error_count,
      avg_ms: v.total > 0 ? v.avg_sum / v.total : null,
      max_ms: v.max_ms,
      first_at: v.first_at,
      last_at: v.last_at,
    });
  }
  const bucketSize = span / n;
  const map = new Map(rows.map(r => [r.idx, r]));
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = map.get(i);
    const bFrom = Math.round(from + i * bucketSize);
    const bTo   = Math.round(from + (i + 1) * bucketSize);
    if (r) {
      out.push({
        idx: i,
        from: bFrom,
        to: bTo,
        total:   r.total,
        ok:      r.ok_count,
        errors:  r.error_count,
        has_error: r.error_count > 0,
        avg_ms:  r.avg_ms !== null ? Math.round(r.avg_ms) : null,
        max_ms:  r.max_ms,
        first_at: r.first_at,
        last_at:  r.last_at,
      });
    } else {
      out.push({
        idx: i, from: bFrom, to: bTo,
        total: 0, ok: 0, errors: 0, has_error: false,
        avg_ms: null, max_ms: null, first_at: null, last_at: null,
      });
    }
  }
  return out;
}

function hourlyForRange({ name, from, to }) {
  if (!from || !to || to <= from) return [];
  const clauses = ['checked_at >= ?', 'checked_at <= ?'];
  const params = [from, to];
  if (name) { clauses.push('name = ?'); params.push(name); }
  const sql = `
    SELECT
      CAST(checked_at / 3600000 AS INTEGER) * 3600000   AS hour_ts,
      COUNT(*)                                          AS total,
      SUM(CASE WHEN status = 'ok'  THEN 1 ELSE 0 END)   AS ok_count,
      SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END)   AS error_count,
      AVG(time_ms)                                      AS avg_ms,
      MAX(time_ms)                                      AS max_ms
    FROM status_logs
    WHERE ${clauses.join(' AND ')}
    GROUP BY hour_ts
    ORDER BY hour_ts DESC
  `;
  return db.prepare(sql).all(...params).map(r => ({
    hour_ts:  r.hour_ts,
    total:    r.total,
    ok:       r.ok_count,
    error:    r.error_count,
    has_error: r.error_count > 0,
    avg_ms:   r.avg_ms !== null ? Math.round(r.avg_ms) : null,
    max_ms:   r.max_ms,
  }));
}

const deleteOldStmt = db.prepare(`DELETE FROM status_logs WHERE checked_at < ?`);

function purgeOlderThan(cutoffMs) {
  const info = deleteOldStmt.run(cutoffMs);
  return info.changes;
}

module.exports = {
  insertLogs,
  getLatestPerName,
  getHistory,
  getHistorySince,
  queryLogs,
  statsForRange,
  bucketsForRange,
  hourlyForRange,
  purgeOlderThan,
};
