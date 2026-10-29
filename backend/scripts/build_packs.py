"""Generates the starter rule packs as JSON data files. After generation the JSON files are the source of truth:
edit them (or create new packs via the API) - no application code change is needed for a new category.
Clause references come from the solution document and MUST be confirmed against the current authorised APH."""
import json, pathlib
OUT = pathlib.Path(__file__).resolve().parent.parent / "app" / "rules" / "packs"
SRC = "AICTE Approval Process Handbook (edition/year to be confirmed by regulatory expert)"
EFFECTIVE = "2024-01-01"

def T(name, expect, ctx): return {"name": name, "expect": expect, "ctx": ctx}
def C(sub="2026-10-23", docs=None, **kw): return {"submission_date": sub, "docs": docs or [], **kw}

def doc_present(rid, clause, dtype, label, cats=None):
    return {"rule_id": rid, "clause": clause, "clause_confirmed": False, "title": f"{label} submitted",
            "family": "completeness", "approval": "approved", "severity": "major", "tier": "A",
            "message_template": "Required document missing: {label}.",
            "check": {"type": "document_present", "params": {"doc_type": dtype, "label": label}},
            "tests": [T("absent -> deficiency", "deficiency", C()),
                      T("present -> pass", "pass", C(docs=[{"type": dtype, "fields": {}}]))]}

def validity(rid, clause, dtype, label):
    return {"rule_id": rid, "clause": clause, "clause_confirmed": False, "title": f"{label} validity",
            "family": "validity", "approval": "approved", "severity": "major", "tier": "A",
            "message_template": "{label} expired: validity ended {date}, before submission date {submission}.",
            "check": {"type": "validity", "params": {"doc_type": dtype, "label": label, "warn_days": 60}},
            "tests": [T("expired -> deficiency", "deficiency", C(docs=[{"type": dtype, "fields": {"validity_end": "30/06/2024"}}])),
                      T("valid -> pass", "pass", C(docs=[{"type": dtype, "fields": {"validity_end": "30/06/2030"}}])),
                      T("nearing expiry -> needs_review", "needs_review", C(docs=[{"type": dtype, "fields": {"validity_end": "2026-11-20"}}])),
                      T("ambiguous with differing outcome -> needs_review", "needs_review",
                        C(sub="2026-10-23", docs=[{"type": dtype, "fields": {"validity_end": "05/12/2026"}}])),
                      T("low confidence -> needs_review", "needs_review",
                        C(docs=[{"type": dtype, "confidence": 0.4, "fields": {"validity_end": "30/06/2030"}}]))]}

def fields(rid, clause, dtype, label, flds):
    return {"rule_id": rid, "clause": clause, "clause_confirmed": False, "title": f"{label}: required fields",
            "family": "completeness", "approval": "approved", "severity": "major", "tier": "A",
            "message_template": "{label}: required field(s) not found: {missing}.",
            "check": {"type": "field_present", "params": {"doc_type": dtype, "fields": flds}},
            "tests": [T("missing field -> deficiency", "deficiency", C(docs=[{"type": dtype, "fields": {flds[0]: "X"}}])),
                      T("all present -> pass", "pass", C(docs=[{"type": dtype, "fields": {f: "30/06/2030" if "date" in f or "validity" in f else "X-1" for f in flds}}]))]}

common = {
 "id": "common", "name": "Common integrity & consistency rules", "scope": "*", "version": "1.0.0",
 "effective_date": EFFECTIVE, "source_handbook": SRC, "approval": "approved",
 "ambiguities": [
   "Whether a registrar approval dated before the application is a deficiency depends on category process; not hard-coded - needs regulatory expert ruling.",
   "Fuzzy institution-name tolerance (0.92 match / 0.70 review) is an engineering default, not an APH value."],
 "rules": [
  {"rule_id": "APH-GEN-DATE-001", "clause": "General document-validity principles (clause ref to be confirmed)", "clause_confirmed": False,
   "title": "Irregular date checks on every dated document", "family": "validity", "approval": "approved", "severity": "major", "tier": "A",
   "message_template": "{detail}",
   "check": {"type": "date_irregularities", "params": {"must_predate_application": ["fire_noc", "occupancy_certificate", "structural_stability_certificate", "audited_accounts"]}},
   "tests": [T("issue after validity -> deficiency", "deficiency", C(docs=[{"type": "fire_noc", "fields": {"issue_date": "2025-06-01", "validity_end": "2024-06-01"}}])),
             T("future issue date -> deficiency", "deficiency", C(docs=[{"type": "fire_noc", "uploaded_date": "2026-10-23", "fields": {"issue_date": "2027-01-15", "validity_end": "2030-01-15"}}])),
             T("unparseable -> needs_review", "needs_review", C(docs=[{"type": "fire_noc", "fields": {"issue_date": "sometime last year"}}])),
             T("clean -> pass", "pass", C(docs=[{"type": "fire_noc", "fields": {"issue_date": "2025-06-01", "validity_end": "2030-06-01"}}]))]},
  {"rule_id": "APH-GEN-ID-001", "clause": "Consistency of institution identity (clause ref to be confirmed)", "clause_confirmed": False,
   "title": "Institution name consistent across documents", "family": "consistency", "approval": "approved", "severity": "major", "tier": "A",
   "message_template": "Institution name inconsistent across documents: {detail}.",
   "check": {"type": "cross_doc_match", "params": {"field": "institution_name", "kind": "name", "label": "institution name"}},
   "tests": [T("different names -> deficiency", "deficiency", C(docs=[{"type": "fire_noc", "fields": {"institution_name": "Alpha Engineering College"}}, {"type": "affidavit", "fields": {"institution_name": "Zenith Polytechnic"}}])),
             T("same names -> pass", "pass", C(docs=[{"type": "fire_noc", "fields": {"institution_name": "Alpha Engineering College"}}, {"type": "affidavit", "fields": {"institution_name": "Alpha Engineering College"}}]))]},
  {"rule_id": "APH-GEN-ID-002", "clause": "Consistency of legal-entity identifiers (clause ref to be confirmed)", "clause_confirmed": False,
   "title": "Registration number consistent across documents", "family": "consistency", "approval": "approved", "severity": "major", "tier": "A",
   "message_template": "Registration number inconsistent: {detail}.",
   "check": {"type": "cross_doc_match", "params": {"field": "registration_number", "kind": "id", "label": "registration number"}},
   "tests": [T("different ids -> deficiency", "deficiency", C(docs=[{"type": "affidavit", "fields": {"registration_number": "MH/123/2005"}}, {"type": "trust_deed", "fields": {"registration_number": "MH/999/2005"}}])),
             T("formatting differences -> pass", "pass", C(docs=[{"type": "affidavit", "fields": {"registration_number": "MH/123/2005"}}, {"type": "trust_deed", "fields": {"registration_number": "mh 123 2005"}}]))]},
  {"rule_id": "APH-GEN-REC-001", "clause": "Validation against institutional records (clause ref to be confirmed)", "clause_confirmed": False,
   "title": "Institution name matches AICTE record", "family": "record", "approval": "approved", "severity": "major", "tier": "A",
   "message_template": "Institution name '{submitted}' differs from record '{record}'.",
   "check": {"type": "record_match", "params": {"field": "institution_name", "record_key": "institution_name", "kind": "name", "label": "institution name"}},
   "tests": [T("record differs -> deficiency", "deficiency", C(docs=[{"type": "fire_noc", "fields": {"institution_name": "Alpha Engineering College"}}], records={"institution_name": "Zenith Polytechnic"})),
             T("record unavailable -> not_checked", "not_checked", C(docs=[{"type": "fire_noc", "fields": {"institution_name": "Alpha Engineering College"}}]))]},
  {"rule_id": "APH-GEN-REC-002", "clause": "Validation against institutional records (clause ref to be confirmed)", "clause_confirmed": False,
   "title": "Registration number matches AICTE record", "family": "record", "approval": "approved", "severity": "major", "tier": "A",
   "message_template": "Registration number '{submitted}' differs from record '{record}'.",
   "check": {"type": "record_match", "params": {"field": "registration_number", "record_key": "registration_number", "kind": "id", "label": "registration number"}},
   "tests": [T("record differs -> deficiency", "deficiency", C(docs=[{"type": "affidavit", "fields": {"registration_number": "MH/123/2005"}}], records={"registration_number": "MH/777/2005"}))]},
 ]}

def pack(cat, name, clause, rules, checklist, ambiguities=None):
    return {"id": cat, "name": name, "scope": cat, "version": "1.0.0", "effective_date": EFFECTIVE, "source_handbook": SRC,
            "approval": "approved", "clause": clause, "checklist": checklist, "ambiguities": ambiguities or [], "rules": rules}

def cl(dtype, label, required=True): return {"doc_type": dtype, "label": label, "required": required}

CERT_FIELDS = ["issuer", "certificate_number", "issue_date", "validity_end"]

selfd = pack("eoa_self_disclosure", "EoA based on Self-Disclosure", "Cl. 2.5; Annexure 2.1", [
  doc_present("APH-2.5-DOC-001", "Cl. 2.5 / Annexure 2.1", "occupancy_certificate", "Occupancy certificate"),
  doc_present("APH-2.5-DOC-002", "Cl. 2.5 / Annexure 2.1", "structural_stability_certificate", "Structural stability certificate"),
  doc_present("APH-2.5-DOC-003", "Cl. 2.5 / Annexure 2.1", "fire_noc", "Fire certificate / NOC"),
  doc_present("APH-2.5-DOC-004", "Cl. 2.5 / Annexure 2.1", "satellite_map_evidence", "Satellite / map evidence"),
  doc_present("APH-2.5-DOC-005", "Cl. 2.5 / Annexure 2.1", "audited_accounts", "Audited accounts"),
  doc_present("APH-2.5-DOC-006", "Cl. 2.5 / Annexure 2.1", "affidavit", "Affidavit 2"),
  fields("APH-2.5-FLD-001", "Cl. 2.5", "fire_noc", "Fire certificate", CERT_FIELDS),
  fields("APH-2.5-FLD-002", "Cl. 2.5", "occupancy_certificate", "Occupancy certificate", CERT_FIELDS),
  fields("APH-2.5-FLD-003", "Cl. 2.5", "structural_stability_certificate", "Structural stability certificate", CERT_FIELDS),
  validity("APH-2.5-VAL-001", "Cl. 2.5", "fire_noc", "Fire certificate"),
  validity("APH-2.5-VAL-002", "Cl. 2.5", "occupancy_certificate", "Occupancy certificate"),
  validity("APH-2.5-VAL-003", "Cl. 2.5", "structural_stability_certificate", "Structural stability certificate"),
], [cl("occupancy_certificate", "Occupancy certificate"), cl("structural_stability_certificate", "Structural stability certificate"),
    cl("fire_noc", "Fire certificate / NOC"), cl("satellite_map_evidence", "Satellite / map evidence"),
    cl("audited_accounts", "Audited accounts"), cl("affidavit", "Affidavit 2"), cl("floor_plan", "Floor plan", False)])

intake = pack("eoa_increase_intake", "Increase in Intake / Additional Course", "Cl. 2.6; Annexure 2.6", [
  doc_present("APH-2.6-DOC-001", "Cl. 2.6 / Annexure 2.6", "affidavit", "Affidavit"),
  doc_present("APH-2.6-DOC-002", "Cl. 2.6 / Annexure 2.6", "faculty_list", "Faculty list"),
  doc_present("APH-2.6-DOC-003", "Cl. 2.6 / Annexure 2.6", "floor_plan", "Floor plan / built-up area statement"),
  doc_present("APH-2.6-DOC-004", "Cl. 2.6 / Annexure 2.6", "fire_noc", "Fire certificate / NOC"),
  validity("APH-2.6-VAL-001", "Cl. 2.6", "fire_noc", "Fire certificate"),
  {"rule_id": "APH-2.6-REC-001", "clause": "Cl. 2.6 (comparison with approved intake)", "clause_confirmed": False,
   "title": "Proposed intake compared with approved intake", "family": "record", "approval": "approved", "severity": "info", "tier": "A",
   "message_template": "Intake change recorded for reviewer.",
   "check": {"type": "declared_vs_record", "params": {"declared_key": "proposed_intake", "record_key": "approved_intake", "op": "diff", "label": "intake"}},
   "tests": [T("recorded -> pass", "pass", C(declared={"proposed_intake": 120}, records={"approved_intake": 60}))]},
  {"rule_id": "APH-2.6-REC-002", "clause": "Cl. 2.6 (pending-inquiry check)", "clause_confirmed": False,
   "title": "No pending inquiry on institution record", "family": "record", "approval": "approved", "severity": "major", "tier": "B",
   "message_template": "Institution record shows a pending inquiry ({label}); reviewer must confirm before proceeding.",
   "check": {"type": "declared_vs_record", "params": {"declared_key": "proposed_intake", "record_key": "pending_inquiry", "op": "flag_true", "label": "pending inquiry"}},
   "tests": [T("pending -> needs_review", "needs_review", C(declared={"proposed_intake": 120}, records={"pending_inquiry": True})),
             T("none -> pass", "pass", C(declared={"proposed_intake": 120}, records={"pending_inquiry": False}))]},
  {"rule_id": "APH-2.6-RATIO-001", "clause": "Cl. 2.6 (faculty ratio)", "clause_confirmed": False,
   "title": "Student-faculty ratio within configured maximum", "family": "quantitative", "approval": "draft", "severity": "major", "tier": "B",
   "message_template": "Students per faculty {ratio} exceeds configured maximum {max}.",
   "check": {"type": "ratio_max", "params": {"students_key": "total_students", "faculty_key": "faculty_count", "max_ratio": 20, "parameters_verified": False}},
   "notes": "DRAFT: numeric threshold NOT yet confirmed against the authorised APH. Engine skips draft rules and reports them as not checked.",
   "tests": [T("above max -> deficiency", "deficiency", C(declared={"total_students": 600, "faculty_count": 20}))]},
], [cl("affidavit", "Affidavit"), cl("faculty_list", "Faculty list"), cl("floor_plan", "Floor plan"), cl("fire_noc", "Fire certificate / NOC")],
 ["Faculty ratio and built-up area thresholds are intentionally NOT hard-coded; add them as approved parameters after regulatory-expert confirmation."])

site = pack("eoa_change_of_site", "Change of Site / Location", "Cl. 2.17; Annexures-1 and 2.3", [
  doc_present("APH-2.17-DOC-001", "Cl. 2.17 / Annexure 2.3", "land_document", "Land / building documents"),
  doc_present("APH-2.17-DOC-002", "Cl. 2.17 / Annexure 2.3", "floor_plan", "Floor plans"),
  doc_present("APH-2.17-DOC-003", "Cl. 2.17 / Annexure-1", "evc_video", "EVC video with GPS"),
  doc_present("APH-2.17-DOC-004", "Cl. 2.17", "satellite_map_evidence", "Satellite / map evidence"),
  validity("APH-2.17-VAL-001", "Cl. 2.17", "fire_noc", "Fire certificate"),
], [cl("land_document", "Land / building documents"), cl("floor_plan", "Floor plans"), cl("evc_video", "EVC video with GPS"),
    cl("satellite_map_evidence", "Satellite / map evidence"), cl("fire_noc", "Fire certificate", False)])

name = pack("eoa_change_name_address", "Change in Name/Address of Trust/Society/Company", "Cl. 2.20; Annexure-2.13", [
  doc_present("APH-2.20-DOC-001", "Cl. 2.20 / Annexure-2.13", "registration_certificate", "Registration records"),
  doc_present("APH-2.20-DOC-002", "Cl. 2.20 / Annexure-2.13", "registrar_approval", "Registrar approval"),
  doc_present("APH-2.20-DOC-003", "Cl. 2.20 / Annexure-2.13", "land_document", "Land transfer documents"),
  doc_present("APH-2.20-DOC-004", "Cl. 2.20 / Annexure-2.13", "bank_proof", "Bank proof"),
  {"rule_id": "APH-2.20-ID-001", "clause": "Cl. 2.20 (consistent legal-entity identifiers)", "clause_confirmed": False,
   "title": "Legal-entity name consistent", "family": "consistency", "approval": "approved", "severity": "major", "tier": "A",
   "message_template": "Legal-entity name inconsistent: {detail}.",
   "check": {"type": "cross_doc_match", "params": {"field": "legal_entity_name", "kind": "name", "label": "legal-entity name"}},
   "tests": [T("different -> deficiency", "deficiency", C(docs=[{"type": "registration_certificate", "fields": {"legal_entity_name": "Shree Vidya Education Society"}}, {"type": "bank_proof", "fields": {"legal_entity_name": "Om Sai Charitable Trust"}}]))]},
  {"rule_id": "APH-2.20-ORD-001", "clause": "Cl. 2.20 (date order)", "clause_confirmed": False,
   "title": "Trust deed predates registration", "family": "validity", "approval": "approved", "severity": "major", "tier": "A",
   "message_template": "Date order broken: {earlier} ({d1}) must not be later than {later} ({d2}).",
   "check": {"type": "date_order", "params": {"earlier": "trust_deed.issue_date", "later": "registration_certificate.issue_date",
                                              "earlier_label": "trust deed", "later_label": "registration certificate"}},
   "tests": [T("registration before deed -> deficiency", "deficiency", C(docs=[{"type": "trust_deed", "fields": {"issue_date": "2010-05-20"}}, {"type": "registration_certificate", "fields": {"issue_date": "2009-01-15"}}])),
             T("ordered -> pass", "pass", C(docs=[{"type": "trust_deed", "fields": {"issue_date": "2008-05-20"}}, {"type": "registration_certificate", "fields": {"issue_date": "2009-01-15"}}]))]},
], [cl("registration_certificate", "Registration records"), cl("registrar_approval", "Registrar approval"),
    cl("trust_deed", "Trust deed", False), cl("land_document", "Land transfer documents"), cl("bank_proof", "Bank proof")])

for p in (common, selfd, intake, site, name):
    (OUT / f"{p['id']}.json").write_text(json.dumps(p, indent=2, ensure_ascii=False))
print("wrote", [p["id"] for p in (common, selfd, intake, site, name)])
