"""Document-wise Proof Cards and the overall case roll-up (solution deck: 'Verification Passport & Dashboard').

A card is a *view* over already-validated findings and source checks. It never creates a verdict of its own and
never says approved / rejected. 'verified' is reserved for documents whose rule checks pass AND whose issuer/source
check actually returned verified - a passed rule check with an unconfirmed source stays 'pending'
(honesty policy: never show verified for an unreachable source)."""
from . import db

CARD_STATUSES = ("verified", "partially_compliant", "needs_review", "mismatch", "pending")
SOURCE_OPEN = {"verification_pending", "source_unavailable", "manual_review_required"}
MISMATCH_FAMILIES = {"consistency", "record"}

CARD_LABEL = {"verified": "Verified", "partially_compliant": "Partially compliant", "needs_review": "Needs review",
              "mismatch": "Mismatch", "pending": "Pending"}
OVERALL_LABEL = {"not_evaluated": "Not evaluated yet", "all_verified": "All documents verified",
                 "awaiting_source": "Rule checks passed - source confirmation outstanding", "needs_review": "Needs officer review",
                 "partially_compliant": "Partially compliant", "deficiencies_found": "Deficiencies found"}


def _doc_ids(f):
    return {e["doc_id"] for e in (f.get("evidence") or []) if e.get("doc_id")}


def _latest_source(app_id):
    out = {}
    for r in db.many("SELECT document_id, data, created_at FROM source_checks WHERE application_id=? ORDER BY created_at", (app_id,)):
        out[r["document_id"]] = db.jl(r["data"], {})
    return out


def _short(f, n=120):
    m = (f.get("message") or "").strip()
    return m if len(m) <= n else m[: n - 1].rstrip() + "…"


def build(app_id, docs, findings):
    """docs: current (non-superseded) document rows. findings: findings already filtered for the caller's role."""
    src = _latest_source(app_id)
    cards = []
    for d in docs:
        mine = [f for f in findings if d["id"] in _doc_ids(f)]
        s = src.get(d["id"]) or {}
        s_status = s.get("status")
        deficiencies = [f for f in mine if f["status"] == "deficiency"]
        mismatches = [f for f in deficiencies if f["family"] in MISMATCH_FAMILIES] + \
                     ([f for f in mine if f["family"] == "source" and f["status"] != "pass"] if s_status in ("mismatch_detected", "expired") else [])
        reviews = [f for f in mine if f["status"] in ("needs_review", "indicator", "processing")]
        passes = [f for f in mine if f["status"] == "pass"]
        other_def = [f for f in deficiencies if f not in mismatches]

        if s_status in ("mismatch_detected", "expired") or mismatches:
            lead = (mismatches or deficiencies or [None])[0]
            status, why = "mismatch", (_short(lead) if lead else "The issuer response does not match the extracted values.")
        elif other_def and passes:
            status, why = "partially_compliant", f"{len(passes)} check(s) pass; open: {_short(other_def[0], 90)}"
        elif other_def:
            status, why = "partially_compliant", _short(other_def[0])
        elif reviews:
            status, why = "needs_review", (f"{len(reviews)} items waiting for a reviewer: " if len(reviews) > 1 else "Waiting for a reviewer: ") + _short(reviews[0], 80)
        elif passes and s_status == "verified":
            status, why = "verified", "Rule checks pass and the source confirmed the document."
        elif passes:
            status, why = "pending", "Rule checks pass; source confirmation is outstanding" + (f" ({s_status.replace('_', ' ')})." if s_status else ".")
        else:
            status, why = "pending", "No checks have been run on this document yet."

        actions = []
        for f in deficiencies + reviews:
            if f.get("next_action") and f["next_action"] not in actions:
                actions.append(f["next_action"])
        cards.append({
            "document_id": d["id"], "filename": d["filename"], "doc_type": d["doc_type"], "version": d["version"],
            "status": status, "label": CARD_LABEL[status], "why": why,
            "source_status": s_status, "source_provenance": s.get("provenance"), "source_name": s.get("source_name"),
            "counts": {"pass": len(passes), "deficiency": len(deficiencies), "needs_review": len(reviews)},
            "top_findings": [{"id": f["id"], "status": f["status"], "title": f["title"], "message": f["message"],
                              "rule_id": f.get("rule_id"), "aph_clause": f.get("aph_clause")} for f in (deficiencies + reviews)[:3]],
            "next_actions": actions[:3],
        })

    counts = {k: sum(1 for c in cards if c["status"] == k) for k in CARD_STATUSES}
    if not findings and not src:
        overall = "not_evaluated"
    elif counts["mismatch"] or counts["partially_compliant"]:
        overall = "partially_compliant" if (counts["verified"] or any(c["counts"]["pass"] for c in cards)) else "deficiencies_found"
    elif counts["needs_review"]:
        overall = "needs_review"
    elif counts["pending"]:
        overall = "awaiting_source"
    else:
        overall = "all_verified" if cards else "not_evaluated"

    # case-level findings that no single document owns (e.g. missing required document)
    unowned = [f for f in findings if not _doc_ids(f) and f["status"] in ("deficiency", "needs_review", "indicator")]
    return {"application_id": app_id, "overall": overall, "overall_label": OVERALL_LABEL[overall], "counts": counts,
            "cards": cards,
            "case_level": [{"id": f["id"], "status": f["status"], "title": f["title"], "message": f["message"],
                            "next_action": f.get("next_action")} for f in unowned],
            "notice": "Decision support only. Cards summarise validated findings; they are not an approval, rejection or accusation."}
