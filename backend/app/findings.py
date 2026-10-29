"""Findings: construction, 'no evidence, no flag' validation, routing, tiers, Verification Passport."""
import hashlib
from . import db
from .audit import now
from .config import TOOL_VERSION

FAMILY_VISIBILITY = {"completeness": "applicant", "validity": "applicant", "consistency": "applicant", "processing": "applicant",
                     "record": "officer", "integrity": "officer", "infrastructure": "officer", "source": "officer", "quantitative": "officer"}
LEGAL_TYPES = {"registration_certificate", "trust_deed", "registrar_approval", "land_document"}
FLAGGED = {"deficiency", "needs_review", "indicator"}
VALID_STATUS = {"pass", "deficiency", "needs_review", "not_checked", "indicator", "processing"}

def stable_id(app_id, check_id, rule_id, subject, evidence):
    key = "|".join([app_id, check_id, rule_id, str(subject), ",".join(sorted({str(e.get("sha256") or e.get("manifest_sha256") or "") for e in evidence}))])
    return "F-" + hashlib.sha1(key.encode()).hexdigest()[:12].upper()

def make_finding(app_id, *, check_id, rule_id, rule_version, pack_version, clause, clause_confirmed, title, family, status,
                 severity, tier, message, evidence, inputs=None, outputs=None, method="deterministic rule engine",
                 confidence=None, limitations="", source_check_status=None, next_action="", subject="", gate="",
                 review_basis="", queue=None, review_reason="", provenance=None, doc_types=None):
    f = {"id": stable_id(app_id, check_id, rule_id, subject, evidence), "application_id": app_id, "check_id": check_id,
         "rule_id": rule_id, "rule_version": rule_version, "pack_version": pack_version, "aph_clause": clause,
         "clause_confirmed": clause_confirmed, "title": title, "family": family, "status": status, "severity": severity,
         "tier": tier, "message": message, "evidence": evidence, "inputs": inputs or {}, "outputs": outputs or {},
         "method": method, "tool_version": TOOL_VERSION, "confidence": confidence, "limitations": limitations,
         "source_check_status": source_check_status, "next_action": next_action, "subject": subject, "gate": gate,
         "review_basis": review_basis, "review_reason": review_reason, "provenance": provenance, "timestamp": now()}
    f["queue"] = queue or route(f, doc_types or [])
    f["visibility"] = FAMILY_VISIBILITY.get(family, "officer")
    if not f["next_action"]:
        f["next_action"] = default_next_action(f)
    f["explanation"] = explain(f)
    return f

def route(f, doc_types):
    fam, st = f["family"], f["status"]
    if fam == "integrity": return "document_integrity_reviewer"
    if fam == "infrastructure": return "infrastructure_reviewer"
    if fam == "source": return "manual_source_confirmation"
    if f.get("review_reason") in ("rule_ambiguity",): return "regulatory_expert"
    if st in FLAGGED and set(doc_types) & LEGAL_TYPES and fam in ("consistency", "validity", "completeness"):
        return "legal_document_reviewer"
    return "scrutiny_officer"

def default_next_action(f):
    st = f["status"]
    return {"deficiency": "Officer to confirm; applicant may rectify where the process permits.",
            "needs_review": "Reviewer to examine the evidence and confirm, dismiss with reason, or request clarification.",
            "indicator": "Reviewer to examine indicator output; this is not proof of anything.",
            "not_checked": "Check not completed; see limitations.", "processing": "Resolve processing issue (resubmit or manual handling).",
            "pass": "None."}.get(st, "")

def explain(f):
    """Plain-language explanation built ONLY from validated finding fields (no free-form model output)."""
    ev = f["evidence"][0] if f["evidence"] else {}
    where = (f"{ev.get('filename') or ev.get('checklist_item') or 'dossier'}"
             + (f", page {ev['page']}" if ev.get("page") else ""))
    return (f"{f['title']}: {f['message']} [Result: {f['status']}; basis: {f['rule_id']}"
            f"{' ' + f['aph_clause'] if f.get('aph_clause') else ''}; evidence: {where}.]")

def validate(f):
    """No evidence, no flag. Returns (ok, reasons)."""
    reasons = []
    for k in ("id", "application_id", "check_id", "status", "title", "message", "timestamp"):
        if not f.get(k): reasons.append(f"missing {k}")
    if f.get("status") not in VALID_STATUS: reasons.append("invalid status")
    if f["status"] in FLAGGED:
        if not (f.get("rule_id") or f.get("review_basis")): reasons.append("flag lacks rule or review basis")
        locs = [e for e in f.get("evidence", []) if (e.get("doc_id") and e.get("page")) or e.get("kind") == "dossier_manifest" and e.get("manifest_sha256")]
        if not locs: reasons.append("flag lacks evidence location")
    if f["status"] == "processing" and not f.get("evidence"):
        reasons.append("processing item lacks document reference")
    return (not reasons), reasons

def from_rule_result(app_id, r, doc_types_by_id):
    m = r._meta
    ev_doc_types = [doc_types_by_id.get(e.get("doc_id")) for e in r.evidence]
    status = r.status
    if status in ("deficiency", "needs_review") and m.get("tier") == "B" and status == "needs_review":
        pass
    return make_finding(app_id, check_id=f"RULE:{r.rule_id}", rule_id=r.rule_id, rule_version=m["pack_version"],
                        pack_version=f"{m['pack_id']}@{m['pack_version']}", clause=m.get("clause"),
                        clause_confirmed=m.get("clause_confirmed", False), title=m.get("title") or r.rule_id,
                        family=m.get("family") or "completeness", status=status, severity=r.severity,
                        tier="A" if status in ("pass", "deficiency") and m.get("tier", "A") == "A" else "B",
                        message=r.message, evidence=r.evidence, inputs=r.inputs, outputs=r.outputs,
                        confidence=r.confidence, limitations=r.limitations, subject=r.subject, gate=r.gate,
                        review_reason=r.review_reason, doc_types=ev_doc_types,
                        provenance="synthetic" if "record" in (m.get("family") or "") else None)

def passport(f, app, docs_by_id):
    """Verification Passport - portable, structured, per-finding record (solution doc 6.2)."""
    ev = f["evidence"]
    return {
        "passport_version": "1.0", "finding_id": f["id"], "case_id": app["id"],
        "claim_or_field": f.get("subject") or f["title"],
        "evidence_source": [{"doc_id": e.get("doc_id"), "filename": e.get("filename"), "sha256": e.get("sha256") or e.get("manifest_sha256"),
                             "kind": e.get("kind")} for e in ev],
        "page_and_region": [{"page": e.get("page"), "bbox_norm": e.get("bbox")} for e in ev],
        "aph_clause": f.get("aph_clause"), "clause_confirmed_against_authorised_aph": f.get("clause_confirmed", False),
        "rule_pack_version": f.get("pack_version"), "rule_id": f.get("rule_id"), "inputs": f.get("inputs"),
        "method_and_tool_version": {"method": f.get("method"), "tool_version": f.get("tool_version")},
        "result": f["status"], "confidence_or_limitations": {"confidence": f.get("confidence"), "limitations": f.get("limitations")},
        "source_check_status": f.get("source_check_status"), "provenance": f.get("provenance"),
        "timestamp": f["timestamp"], "next_action": f["next_action"], "reviewer_outcome": f.get("review"),
        "explanation": f["explanation"],
        "notice": "Decision-support record. Not an approval, rejection or accusation. Hash proves integrity of recorded bytes, not truth of contents.",
    }
