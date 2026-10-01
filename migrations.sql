CREATE TABLE IF NOT EXISTS daemon(
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL,
  version TEXT NOT NULL,
  data_dir TEXT NOT NULL,
  state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_run(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  last_heartbeat INTEGER NOT NULL,
  owner_device_id TEXT
);
CREATE TABLE IF NOT EXISTS tool_lease(
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  released_at INTEGER,
  UNIQUE(run_id, args_hash)
);
CREATE TABLE IF NOT EXISTS memory_item(
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES agent_run(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_key ON memory_item(key);
CREATE TABLE IF NOT EXISTS device_session(
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS scheduler_job(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_id TEXT
);
CREATE TABLE IF NOT EXISTS tool_event(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  result_ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_event_run ON tool_event(run_id);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(key, value);
CREATE TRIGGER IF NOT EXISTS memory_item_ai AFTER INSERT ON memory_item BEGIN
  INSERT INTO memory_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
END;
CREATE TRIGGER IF NOT EXISTS memory_item_ad AFTER DELETE ON memory_item BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, key, value) VALUES ('delete', old.rowid, old.key, old.value);
END;
CREATE TRIGGER IF NOT EXISTS memory_item_au AFTER UPDATE ON memory_item BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, key, value) VALUES ('delete', old.rowid, old.key, old.value);
  INSERT INTO memory_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
END;
INSERT INTO memory_fts(rowid, key, value) SELECT rowid, key, value FROM memory_item WHERE rowid NOT IN (SELECT rowid FROM memory_fts);
