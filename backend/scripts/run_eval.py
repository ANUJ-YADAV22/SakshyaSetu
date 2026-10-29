"""Evaluation harness (solution doc section 15). Metrics are computed on the documented SYNTHETIC test set
(the seeded demo dossiers + embedded rule-pack golden tests). They measure the prototype on synthetic data only;
no accuracy or time-saving claim about real AICTE documents is made."""
import glob, json, os, sys, tempfile, time
os.environ.setdefault("SAKSHYA_DATA_DIR", tempfile.mkdtemp())
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from fastapi.testclient import TestClient
from main import app
from app.rules.engine import run_pack_tests
from app.findings import validate

A = {"X-Role": "applicant", "X-Actor": "applicant.demo"}; O = {"X-Role": "scrutiny_officer", "X-Actor": "officer.demo"}
rep = {"test_set": "synthetic demo dossiers (2 cases, 11 documents) + rule-pack golden tests", "date": time.strftime("%Y-%m-%d")}

tot = ok = 0
for f in glob.glob(os.path.join(os.path.dirname(__file__), "..", "app", "rules", "packs", "*.json")):
    r = run_pack_tests(json.load(open(f))); tot += r["total"]; ok += r["passed"]
rep["rule_correctness"] = {"golden_tests": tot, "passed": ok, "pass_rate": round(ok / tot, 4)}

with TestClient(app) as c:
    ids = c.post("/api/v1/demo/seed", headers=A).json()["application_ids"]
    t0 = time.time(); c.post(f"/api/v1/applications/{ids[0]}/submit", headers=A); dt = time.time() - t0
    fs = [f for i in ids for f in c.get(f"/api/v1/applications/{i}/findings", headers=O).json()["items"]]
    valid = sum(1 for f in fs if validate(f)[0])
    rep["evidence_coverage"] = {"findings": len(fs), "with_valid_evidence_and_basis": valid, "coverage": round(valid / len(fs), 4), "target": 1.0}
    rep["verification_time_s"] = {"case": ids[0], "seconds_submission_to_report": round(dt, 2), "note": "single synthetic case on this machine; not a pilot measurement"}
    # expected-finding checks on seeded ground truth
    truth = {"APH-2.5-VAL-002": "deficiency", "APH-2.5-DOC-004": "deficiency", "APH-GEN-ID-002": "deficiency", "APH-GEN-REC-002": "deficiency", "INFRA-AREA-001": "needs_review", "FOR-DUP-001": "needs_review"}
    got = {f["rule_id"]: f["status"] for f in c.get(f"/api/v1/applications/{ids[0]}/findings", headers=O).json()["items"]}
    rep["seeded_ground_truth"] = {k: {"expected": v, "got": got.get(k), "ok": got.get(k) == v} for k, v in truth.items()}
    rep["audit_chain"] = c.get("/api/v1/audit/verify", headers=O).json()["valid"]
    a = c.get("/api/v1/dashboard/summary", headers=O).json(); rep["alert_timeliness"] = a["alert_timeliness"]
    rep["not_measured"] = ["OCR accuracy on scanned documents (no labelled corpus; OCR engine optional)", "forensic true/false-positive rates", "reviewer efficiency vs baseline (needs a controlled pilot)"]
print(json.dumps(rep, indent=2))
