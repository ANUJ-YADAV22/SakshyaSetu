import json, sqlite3, threading
from contextlib import contextmanager
from .config import DB_PATH

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS applications(
  id TEXT PRIMARY KEY, institution_name TEXT, category TEXT, status TEXT, applicant_ref TEXT,
  declared TEXT, created_at TEXT, submitted_at TEXT, pack_ids TEXT, is_demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY, application_id TEXT, group_id TEXT, version INTEGER, filename TEXT, sha256 TEXT,
  size INTEGER, mime TEXT, path TEXT, doc_type TEXT, doc_type_conf REAL, uploaded_at TEXT, uploaded_by TEXT,
  superseded_by TEXT, page_count INTEGER, processing TEXT, meta TEXT);
CREATE INDEX IF NOT EXISTS ix_doc_app ON documents(application_id);
CREATE INDEX IF NOT EXISTS ix_doc_sha ON documents(sha256);
CREATE TABLE IF NOT EXISTS fields(
  id TEXT PRIMARY KEY, document_id TEXT, name TEXT, raw_value TEXT, normalized TEXT, confidence REAL,
  page INTEGER, bbox TEXT, method TEXT, corrected_value TEXT, corrected_by TEXT, corrected_at TEXT);
CREATE INDEX IF NOT EXISTS ix_field_doc ON fields(document_id);
CREATE TABLE IF NOT EXISTS findings(
  id TEXT PRIMARY KEY, application_id TEXT, data TEXT, status TEXT, queue TEXT, visibility TEXT,
  review TEXT, created_at TEXT, updated_at TEXT, run_id TEXT, active INTEGER DEFAULT 1);
CREATE INDEX IF NOT EXISTS ix_find_app ON findings(application_id);
CREATE TABLE IF NOT EXISTS tasks(
  id TEXT PRIMARY KEY, application_id TEXT, run_id TEXT, name TEXT, status TEXT, attempts INTEGER,
  idem_key TEXT, result TEXT, error TEXT, started_at TEXT, finished_at TEXT);
CREATE INDEX IF NOT EXISTS ix_task_idem ON tasks(idem_key);
CREATE TABLE IF NOT EXISTS audit(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT, role TEXT, application_id TEXT, document_id TEXT,
  event_type TEXT, rule_pack_version TEXT, refs TEXT, prev_hash TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, application_id TEXT, kind TEXT, created_at TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS gates(
  id TEXT PRIMARY KEY, application_id TEXT, gate_type TEXT, finding_id TEXT, status TEXT, opened_at TEXT,
  resolved_at TEXT, resolved_by TEXT, outcome TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS alerts(
  id TEXT PRIMARY KEY, application_id TEXT, finding_id TEXT, type TEXT, severity TEXT, role_target TEXT,
  dedupe_key TEXT, message TEXT, event_at TEXT, delivered_at TEXT, channels TEXT, acked_at TEXT,
  acked_by TEXT, escalated_at TEXT, count INTEGER DEFAULT 1);
CREATE INDEX IF NOT EXISTS ix_alert_dedupe ON alerts(dedupe_key);
CREATE TABLE IF NOT EXISTS rulepacks(
  id TEXT PRIMARY KEY, name TEXT, scope TEXT, version TEXT, status TEXT, authored_by TEXT, approved_by TEXT,
  effective_date TEXT, source_handbook TEXT, data TEXT, test_results TEXT, created_at TEXT, changelog TEXT);
CREATE TABLE IF NOT EXISTS notices(
  id TEXT PRIMARY KEY, application_id TEXT, version INTEGER, status TEXT, body TEXT, created_by TEXT,
  approved_by TEXT, created_at TEXT, approved_at TEXT, due_date TEXT);
CREATE TABLE IF NOT EXISTS decisions(
  id TEXT PRIMARY KEY, application_id TEXT, decision TEXT, rationale TEXT, decided_by TEXT, decided_at TEXT);
CREATE TABLE IF NOT EXISTS source_checks(
  id TEXT PRIMARY KEY, application_id TEXT, document_id TEXT, data TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS infra_inputs(
  id TEXT PRIMARY KEY, application_id TEXT, data TEXT, updated_at TEXT, updated_by TEXT);
"""

def _connect():
    c = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=30, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    return c

@contextmanager
def conn():
    with _lock:
        c = _connect()
        try:
            yield c
        finally:
            c.close()

def init_db():
    with conn() as c:
        c.executescript(SCHEMA)

def jd(v):  # dump
    return json.dumps(v, default=str, ensure_ascii=False, sort_keys=True)

def jl(v, default=None):  # load
    if v is None or v == "":
        return default
    try:
        return json.loads(v)
    except Exception:
        return default

def row(r):
    return dict(r) if r is not None else None

def one(sql, args=()):
    with conn() as c:
        return row(c.execute(sql, args).fetchone())

def many(sql, args=()):
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]

def run(sql, args=()):
    with conn() as c:
        c.execute(sql, args)
