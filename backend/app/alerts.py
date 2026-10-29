"""Alert service: in-app queue + email/SMS via a MOCK gateway. Merges repeats, escalates unacknowledged alerts,
logs delivery in the audit trail and measures event->delivery time."""
import uuid
from datetime import datetime, timezone, timedelta
from . import db, audit
from .config import ALERT_ESCALATION_HOURS

GATEWAY = "MOCK-GATEWAY (prototype; no real email/SMS is sent)"
APPLICANT_TYPES = {"required_document_missing", "document_unreadable", "certificate_expired", "certificate_nearing_expiry"}

def raise_alert(application_id, atype, message, subject, severity="medium", finding_id=None, roles=("scrutiny_officer",),
                channels=("in_app", "email")):
    dedupe = f"{atype}|{application_id}|{subject}"
    ex = db.one("SELECT * FROM alerts WHERE dedupe_key=? AND acked_at IS NULL", (dedupe,))
    if ex:
        db.run("UPDATE alerts SET count=count+1 WHERE id=?", (ex["id"],))
        return ex["id"]
    targets = list(roles)
    if atype in APPLICANT_TYPES and "applicant" not in targets:
        targets.append("applicant")
    aid = "AL-" + uuid.uuid4().hex[:8].upper()
    t0 = audit.now()
    deliveries = [{"channel": c, "provider": GATEWAY if c != "in_app" else "in-app queue", "delivered": True} for c in channels]
    t1 = audit.now()
    db.run("INSERT INTO alerts(id,application_id,finding_id,type,severity,role_target,dedupe_key,message,event_at,delivered_at,channels,count)"
           " VALUES(?,?,?,?,?,?,?,?,?,?,?,1)", (aid, application_id, finding_id, atype, severity, ",".join(targets), dedupe,
                                                 message, t0, t1, db.jd(deliveries)))
    audit.append("alert_delivered", application_id=application_id, refs={"alert_id": aid, "type": atype, "channels": deliveries,
                                                                           "event_at": t0, "delivered_at": t1})
    return aid

def ack(alert_id, actor, role):
    db.run("UPDATE alerts SET acked_at=?, acked_by=? WHERE id=? AND acked_at IS NULL", (audit.now(), actor, alert_id))
    a = db.one("SELECT application_id FROM alerts WHERE id=?", (alert_id,))
    audit.append("alert_acknowledged", actor, role, a and a["application_id"], refs={"alert_id": alert_id})

def escalate_overdue(hours=ALERT_ESCALATION_HOURS, now_dt=None):
    now_dt = now_dt or datetime.now(timezone.utc)
    cutoff = (now_dt - timedelta(hours=hours)).isoformat(timespec="seconds")
    rows = db.many("SELECT * FROM alerts WHERE acked_at IS NULL AND escalated_at IS NULL AND event_at < ?", (cutoff,))
    for r in rows:
        db.run("UPDATE alerts SET escalated_at=?, role_target=role_target||',reviewer_lead' WHERE id=?", (audit.now(), r["id"]))
        audit.append("alert_escalated", application_id=r["application_id"], refs={"alert_id": r["id"], "after_hours": hours})
    return [r["id"] for r in rows]

def timeliness():
    rows = db.many("SELECT event_at, delivered_at FROM alerts WHERE delivered_at IS NOT NULL")
    ds = sorted((datetime.fromisoformat(r["delivered_at"]) - datetime.fromisoformat(r["event_at"])).total_seconds() for r in rows)
    if not ds: return {"n": 0}
    return {"n": len(ds), "median_s": ds[len(ds) // 2], "worst_s": ds[-1], "note": "Mock gateway: reflects internal queueing only."}
