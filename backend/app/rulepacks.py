"""Executable Handbook: versioned, effective-dated rule packs stored as data, with maker-checker activation."""
import json, uuid
from pathlib import Path
from . import db, audit
from .rules.engine import run_pack_tests

PACK_DIR = Path(__file__).parent / "rules" / "packs"
SEED_NOTE = "SYNTHETIC_DEMO_SEED - prototype pack, not a real regulatory approval"

def seed_packs():
    for f in sorted(PACK_DIR.glob("*.json")):
        p = json.loads(f.read_text())
        pid = f"{p['id']}@{p['version']}"
        if db.one("SELECT id FROM rulepacks WHERE id=?", (pid,)):
            continue
        tr = run_pack_tests(p)
        db.run("INSERT INTO rulepacks(id,name,scope,version,status,authored_by,approved_by,effective_date,source_handbook,data,test_results,created_at,changelog)"
               " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (pid, p["name"], p["scope"], p["version"], "active", "seed", SEED_NOTE, p["effective_date"], p["source_handbook"],
                db.jd(p), db.jd({k: tr[k] for k in ("total", "passed", "failed")}), audit.now(), "Initial starter pack"))
    audit.append("rulepacks_seeded", "system", "system", refs={"note": SEED_NOTE})

def list_packs():
    rows = db.many("SELECT id,name,scope,version,status,authored_by,approved_by,effective_date,source_handbook,test_results,created_at,changelog FROM rulepacks ORDER BY id")
    for r in rows: r["test_results"] = db.jl(r["test_results"], {})
    return rows

def get_pack(pid):
    r = db.one("SELECT * FROM rulepacks WHERE id=?", (pid,))
    if r: r["data"] = db.jl(r["data"]); r["test_results"] = db.jl(r["test_results"], {})
    return r

def active_packs(category):
    out = []
    for r in db.many("SELECT * FROM rulepacks WHERE status='active' AND (scope='*' OR scope=?) ORDER BY scope", (category,)):
        d = db.jl(r["data"]); d["id"] = d["id"]; out.append(d)
    return out

def checklist_for(category):
    for p in active_packs(category):
        if p["scope"] == category: return p.get("checklist", [])
    return []

def create_draft(data: dict, author: str, changelog: str = ""):
    for k in ("id", "name", "scope", "version", "effective_date", "rules"):
        if k not in data: raise ValueError(f"pack missing '{k}'")
    pid = f"{data['id']}@{data['version']}"
    if db.one("SELECT id FROM rulepacks WHERE id=?", (pid,)): raise ValueError("pack id@version already exists")
    for r in data["rules"]: r["approval"] = "draft" if r.get("approval") != "approved" else "draft"
    tr = run_pack_tests(data)
    db.run("INSERT INTO rulepacks(id,name,scope,version,status,authored_by,approved_by,effective_date,source_handbook,data,test_results,created_at,changelog)"
           " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
           (pid, data["name"], data["scope"], data["version"], "draft", author, None, data["effective_date"],
            data.get("source_handbook", ""), db.jd(data), db.jd(tr), audit.now(), changelog))
    audit.append("rulepack_draft_created", author, "rule_author", refs={"pack": pid, "tests": {k: tr[k] for k in ("total", "passed", "failed")}})
    return pid, tr

def retest(pid):
    p = get_pack(pid)
    tr = run_pack_tests(p["data"])
    db.run("UPDATE rulepacks SET test_results=? WHERE id=?", (db.jd(tr), pid))
    return tr

def activate(pid, approver: str):
    """Maker-checker: approver must differ from author; all tests must pass. Never automatic."""
    p = get_pack(pid)
    if not p: raise LookupError("pack not found")
    if p["status"] != "draft": raise ValueError(f"pack is '{p['status']}', not draft")
    if p["authored_by"] == approver: raise PermissionError("maker-checker: approver must differ from author")
    tr = run_pack_tests(p["data"])
    if tr["failed"] or tr["total"] == 0: raise ValueError(f"tests must all pass (and exist): {tr['passed']}/{tr['total']}")
    data = p["data"]
    for r in data["rules"]: r["approval"] = "approved"
    db.run("UPDATE rulepacks SET status='retired' WHERE status='active' AND scope=? AND id!=?", (p["scope"], pid))
    db.run("UPDATE rulepacks SET status='active', approved_by=?, data=?, test_results=? WHERE id=?",
           (approver, db.jd(data), db.jd({k: tr[k] for k in ("total", "passed", "failed")}), pid))
    audit.append("rulepack_activated", approver, "regulatory_expert", refs={"pack": pid, "author": p["authored_by"], "effective_date": p["effective_date"]},
                 rule_pack_version=pid)
    return pid
