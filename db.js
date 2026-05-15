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

const deleteOldStmt = db.prepare(`DELETE FROM status_logs WHERE checked_at < ?`);

function purgeOlderThan(cutoffMs) {
  const info = deleteOldStmt.run(cutoffMs);
  return info.changes;
}

module.exports = {
  insertLogs,
  getLatestPerName,
  getHistory,
  queryLogs,
  statsForRange,
  purgeOlderThan,
};
