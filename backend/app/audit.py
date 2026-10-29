"""Hash-chained audit ledger. Proves integrity of recorded events only,
not the truth of any document's contents."""
import hashlib, json
from datetime import datetime, timezone
from . import db

GENESIS = "0" * 64

def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def _digest(prev: str, payload: dict) -> str:
    blob = prev + json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()

def append(event_type, actor="system", role="system", application_id=None, document_id=None,
           refs=None, rule_pack_version=None):
    with db.conn() as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            last = c.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
            prev = last["hash"] if last else GENESIS
            ts = now()
            payload = dict(ts=ts, actor=actor, role=role, application_id=application_id, document_id=document_id,
                           event_type=event_type, rule_pack_version=rule_pack_version, refs=refs or {})
            h = _digest(prev, payload)
            c.execute("INSERT INTO audit(ts,actor,role,application_id,document_id,event_type,rule_pack_version,refs,prev_hash,hash)"
                      " VALUES(?,?,?,?,?,?,?,?,?,?)",
                      (ts, actor, role, application_id, document_id, event_type, rule_pack_version,
                       db.jd(refs or {}), prev, h))
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise
    return h

def list_events(application_id=None, limit=500):
    if application_id:
        rows = db.many("SELECT * FROM audit WHERE application_id=? ORDER BY seq DESC LIMIT ?", (application_id, limit))
    else:
        rows = db.many("SELECT * FROM audit ORDER BY seq DESC LIMIT ?", (limit,))
    for r in rows:
        r["refs"] = db.jl(r["refs"], {})
    return rows

def verify_chain():
    rows = db.many("SELECT * FROM audit ORDER BY seq ASC")
    prev = GENESIS
    for r in rows:
        payload = dict(ts=r["ts"], actor=r["actor"], role=r["role"], application_id=r["application_id"],
                       document_id=r["document_id"], event_type=r["event_type"],
                       rule_pack_version=r["rule_pack_version"], refs=db.jl(r["refs"], {}))
        if r["prev_hash"] != prev or _digest(prev, payload) != r["hash"]:
            return {"valid": False, "broken_at_seq": r["seq"], "events": len(rows),
                    "note": "Chain proves integrity of recorded events only, not the truth of document contents."}
        prev = r["hash"]
    return {"valid": True, "events": len(rows), "last_hash": prev,
            "note": "Chain proves integrity of recorded events only, not the truth of document contents."}
