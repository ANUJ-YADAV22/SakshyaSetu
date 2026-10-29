"""Source Checker: authorised channels only. No scraping, no auth bypass, no assumed database access.
If no authorised channel exists, a manual-confirmation task is created with extracted fields prefilled.
Provenance is always one of live | mock | cached | synthetic."""
import json, re
from datetime import datetime, timezone
from pathlib import Path
from .config import BASE_DIR
from .dates import parse_date, to_date

STATUSES = ("verified", "mismatch_detected", "expired", "verification_pending", "source_unavailable", "manual_review_required")
FIXTURES = json.loads((BASE_DIR / "app" / "fixtures" / "institutions.json").read_text())

def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def _result(status, source, provenance, doc, **kw):
    assert status in STATUSES
    return {"status": status, "source_name": source, "checked_at": _now(), "matched_fields": kw.get("matched", []),
            "mismatched_fields": kw.get("mismatched", []), "response_reference": kw.get("ref"), "provenance": provenance,
            "limitations": kw.get("limitations", ""), "next_action": kw.get("next_action", ""), "applicability": "applicable",
            "document_id": doc["id"], "doc_type": doc["doc_type"], "prefilled_request": kw.get("prefill")}

def lookup_institution(reg_no=None, name=None):
    """Read-only AICTE record adapter - LABELLED SYNTHETIC FIXTURE (no real AICTE access is claimed)."""
    from .docintel import normalize_id, normalize_name
    for rec in FIXTURES["institutions"]:
        if reg_no and normalize_id(reg_no) == normalize_id(rec["registration_number"]):
            return rec
    for rec in FIXTURES["institutions"]:
        if name and normalize_name(name) == normalize_name(rec["institution_name"]):
            return rec
    return None

def adapter_registry():
    return [
        {"document_or_record": "Digitally signed PDF", "channel": "Signature and certificate-chain validation (pyHanko)",
         "fallback": "Manual review", "provenance": "live (local cryptographic validation)", "implemented": "implemented"},
        {"document_or_record": "QR or reference-number document", "channel": "Decode and compare with issuer's official mechanism",
         "fallback": "Manual confirmation", "provenance": "n/a", "implemented": "designed (reference captured; no issuer API configured)"},
        {"document_or_record": "Building, occupancy, fire, land-use documents", "channel": "Competent-authority service where officially available",
         "fallback": "Prefilled manual request", "provenance": "n/a", "implemented": "designed (manual confirmation task created)"},
        {"document_or_record": "Architect and advocate certificates", "channel": "Authorised professional-registration lookup where available",
         "fallback": "Manual confirmation", "provenance": "n/a", "implemented": "designed"},
        {"document_or_record": "Bank certificate", "channel": "Bank-provided confirmation channel where authorised",
         "fallback": "Manual confirmation", "provenance": "n/a", "implemented": "designed"},
        {"document_or_record": "Accreditation, ranking, status", "channel": "Official published lists or authorised AICTE records",
         "fallback": "Manual review", "provenance": "n/a", "implemented": "designed"},
        {"document_or_record": "Previous approvals and institutional records", "channel": "Authorised read-only AICTE adapter",
         "fallback": "Labelled synthetic fixture in demo", "provenance": "synthetic", "implemented": "mocked (synthetic fixture)"},
    ]

def verify(document: dict, fields: dict, case_context: dict) -> dict:
    """verify(document, extracted_fields, case_context) -> status, source_name, checked_at, matched_fields,
    mismatched_fields, response_reference, provenance, limitations, next_action"""
    dtype = document["doc_type"]
    sig = (document.get("integrity") or {}).get("signature") or {}
    prefill = {k: v for k, v in fields.items() if k in ("issuer", "certificate_number", "issue_date", "validity_end",
                                                          "institution_name", "registration_number")}
    # 1) Cryptographic signature (live, local)
    if sig.get("status") == "valid":
        return _result("verified", "PDF digital signature (cryptographic)", "live", document, matched=["signature"],
                       limitations="Signature validated against configured trust roots.",
                       next_action="None; signer identity shown in passport.")
    if sig.get("status") == "invalid":
        return _result("mismatch_detected", "PDF digital signature (cryptographic)", "live", document, mismatched=["signature"],
                       limitations="Signature cryptographically invalid - may indicate post-signing change or corruption.",
                       next_action="Route to document-integrity reviewer.")
    # 2) Expired per document
    ve = fields.get("validity_end")
    if ve:
        pd = parse_date(ve)
        sub = to_date(case_context.get("submission_date"))
        if pd.parsed and not pd.ambiguous and sub and to_date(pd.iso) < sub:
            return _result("expired", "Document validity field", "live", document, mismatched=["validity_end"],
                           limitations="Derived from the document's own stated validity, not from an issuer response.",
                           next_action=f"Request renewed certificate (expired {pd.iso}).")
    # 3) AICTE record adapter (synthetic fixture) for institutional identity documents
    reg = fields.get("registration_number")
    if dtype in ("affidavit", "registration_certificate", "trust_deed", "faculty_list") and (reg or fields.get("institution_name")):
        rec = lookup_institution(reg, fields.get("institution_name"))
        if rec and rec.get("adapter_state") == "unavailable":
            return _result("source_unavailable", "AICTE record adapter (synthetic fixture)", "synthetic", document,
                           limitations="Adapter simulated as unreachable. Never shown as verified.",
                           next_action="Retry later or use manual confirmation.", prefill=prefill)
        if rec and rec.get("adapter_state") == "pending":
            return _result("verification_pending", "AICTE record adapter (synthetic fixture)", "synthetic", document,
                           ref=f"REQ-{rec['aicte_id']}-0001", limitations="Simulated pending response.",
                           next_action="Awaiting response; pending age shown in UI.", prefill=prefill)
        if rec:
            matched, mism = [], []
            for fk, rk in (("registration_number", "registration_number"), ("institution_name", "institution_name")):
                if fields.get(fk):
                    from .docintel import normalize_id, normalize_name
                    n = normalize_id if fk == "registration_number" else normalize_name
                    (matched if n(fields[fk]) == n(rec[rk]) else mism).append(fk)
            return _result("verified" if not mism else "mismatch_detected", "AICTE record adapter (synthetic fixture)",
                           "synthetic", document, matched=matched, mismatched=mism, ref=rec["aicte_id"],
                           limitations="SYNTHETIC FIXTURE - no live AICTE access is claimed.",
                           next_action="" if not mism else "Route mismatch to scrutiny officer.")
    # 4) QR / reference-number: capture, but no issuer API is configured
    ref = fields.get("certificate_number")
    if ref:
        return _result("manual_review_required", "Issuer reference-number service (none configured)", "mock", document,
                       ref=ref, limitations="No authorised automated issuer channel configured; reference captured for manual confirmation.",
                       next_action="Create manual-confirmation task with prefilled fields.", prefill=prefill)
    return _result("manual_review_required", "No authorised channel", "mock", document,
                   limitations="No authorised automated verification channel exists for this document.",
                   next_action="Create manual-confirmation task.", prefill=prefill)
