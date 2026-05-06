CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  force_password_change INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  safe_name TEXT UNIQUE NOT NULL,
  repo_url TEXT NOT NULL,
  branch TEXT DEFAULT 'main',
  local_path TEXT,
  port INTEGER,
  container_port INTEGER DEFAULT 3000,
  container_name TEXT,
  image_name TEXT,
  build_command TEXT,
  start_command TEXT,
  env_vars TEXT,
  status TEXT DEFAULT 'creating',
  description TEXT,
  group_id INTEGER,
  public_hostname TEXT,
  service_type TEXT DEFAULT 'auto',
  detected_frameworks TEXT,
  last_health_check DATETIME,
  health_status TEXT,
  cpu_limit TEXT,
  memory_limit TEXT,
  tags TEXT,
  webhook_url TEXT,
  restart_schedule TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_deployed_at DATETIME,
  FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER,
  level TEXT DEFAULT 'info',
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT DEFAULT 'info',
  source TEXT,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  cpu_percent REAL,
  mem_used_mb REAL,
  mem_total_mb REAL,
  disk_used_gb REAL,
  disk_total_gb REAL,
  app_id INTEGER
);

CREATE TABLE IF NOT EXISTS traffic_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER,
  path TEXT,
  method TEXT,
  status_code INTEGER,
  response_time_ms INTEGER,
  ip_hash TEXT,
  user_agent_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
