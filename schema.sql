CREATE TABLE IF NOT EXISTS oauth_tokens (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER,
 company_name TEXT,
 company_domain TEXT,
 api_domain TEXT,
 user_id INTEGER,
 user_name TEXT,
 access_token TEXT NOT NULL,
 refresh_token TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_capacities (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL,
 pipedrive_user_id INTEGER NOT NULL,
 user_name TEXT,
 daily_capacity INTEGER NOT NULL,
 sort_order INTEGER DEFAULT 0,
 active INTEGER DEFAULT 1,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(company_id, pipedrive_user_id)
);

CREATE TABLE IF NOT EXISTS assignment_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL,
 deal_id INTEGER NOT NULL,
 assigned_user_id INTEGER NOT NULL,
 assigned_user_name TEXT,
 score INTEGER,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignment_state (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL UNIQUE,
 last_assigned_user_id INTEGER,
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limits (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 company_id INTEGER NOT NULL,
 route_key TEXT NOT NULL,
 window_start INTEGER NOT NULL,
 request_count INTEGER NOT NULL DEFAULT 0,
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(company_id, route_key, window_start)
);
