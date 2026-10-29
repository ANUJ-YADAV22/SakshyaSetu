"""Aggregate reporting read straight from the database (no stored or hard-coded figures)."""
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from . import db
from .api import actor, need, OFFICER, Actor

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])

@router.get("/summary")
def summary(days: int = 14, a: Actor = Depends(actor)):
    need(a, *OFFICER, "administrator", "competent_authority")
    apps = db.many("SELECT id, category, status, created_at, is_demo FROM applications")
    docs = db.many("SELECT id, application_id, doc_type FROM documents WHERE superseded_by IS NULL")
    fnd = db.many("SELECT application_id, data, status, review, active FROM findings")
    audit_rows = db.many("SELECT ts, event_type FROM audit")
    checks = db.many("SELECT data FROM source_checks")
    per_app = defaultdict(lambda: Counter())
    rules = Counter(); outcomes = Counter(); tiers = Counter()
    for f in fnd:
        d = db.jl(f["data"]) or {}
        if f["active"]:
            st = d.get("status") or f["status"]; per_app[f["application_id"]][st] += 1
            if st in ("deficiency", "needs_review"): rules[d.get("rule_id") or d.get("check_id") or "unknown"] += 1
            tiers[d.get("tier") or "-"] += 1
        rv = db.jl(f["review"]) or {}
        if rv.get("outcome"): outcomes[rv["outcome"]] += 1
    evaluated = [x for x in apps if x["id"] in per_app]
    clear = [x for x in evaluated if per_app[x["id"]].get("deficiency", 0) == 0 and per_app[x["id"]].get("needs_review", 0) == 0]
    with_def = [x for x in evaluated if per_app[x["id"]].get("deficiency", 0) > 0]
    today = datetime.now(timezone.utc).date(); series = []
    by_day = defaultdict(Counter)
    for r in audit_rows:
        by_day[(r["ts"] or "")[:10]][r["event_type"]] += 1
    ACTION = {"finding_reviewed", "gate_resolved", "final_decision_recorded", "deficiency_notice_approved"}
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat(); c = by_day.get(d, Counter())
        series.append({"date": d, "events": sum(c.values()), "uploads": c.get("document_uploaded", 0), "officer_actions": sum(v for k, v in c.items() if k in ACTION)})
    sc = Counter((json.loads(c["data"]) if c["data"] else {}).get("status", "unknown") for c in checks)
    pct = lambda n, d: round(100 * n / d, 1) if d else 0.0
    return {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "totals": {"applications": len(apps), "documents": len(docs), "evaluated": len(evaluated), "findings_active": sum(sum(c.values()) for c in per_app.values())},
            "rates": {"clearance_pct": pct(len(clear), len(evaluated)), "clear": len(clear), "deficiency_pct": pct(len(with_def), len(evaluated)), "with_deficiency": len(with_def)},
            "by_category": Counter(x["category"] for x in apps), "by_status": Counter(x["status"] for x in apps),
            "top_rules": [{"rule": k, "n": v} for k, v in rules.most_common(6)], "officer_outcomes": dict(outcomes), "tiers": dict(tiers),
            "source_checks": dict(sc), "audit_events": len(audit_rows), "series": series,
            "note": "Computed live from the database at request time. Demo dossiers are included when loaded."}
