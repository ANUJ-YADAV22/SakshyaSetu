import os, tempfile, json, glob
os.environ["SAKSHYA_DATA_DIR"] = tempfile.mkdtemp()
import pytest
from fastapi.testclient import TestClient
from main import app
from app.rules.engine import run_pack_tests
from app.dates import parse_date
from app.findings import validate
from app import audit, db

A = {"X-Role": "applicant", "X-Actor": "applicant.demo"}
O = {"X-Role": "scrutiny_officer", "X-Actor": "officer.demo"}

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture(scope="module")
def seeded(client):
    ids = client.post("/api/v1/demo/seed", headers=A).json()["application_ids"]
    client.post(f"/api/v1/applications/{ids[0]}/submit", headers=A)
    return ids

def test_all_rule_pack_embedded_tests_pass():
    for f in glob.glob(os.path.join(os.path.dirname(__file__), "..", "app", "rules", "packs", "*.json")):
        r = run_pack_tests(json.load(open(f)))
        assert r["failed"] == 0 and r["total"] > 0, (f, [x for x in r["results"] if not x["ok"]])

def test_date_ambiguity_and_unparseable():
    assert parse_date("04/05/2026").ambiguous
    assert not parse_date("13/05/2026").ambiguous
    assert not parse_date("gibberish").parsed

def test_no_evidence_no_flag_validator():
    bad = {"id": "F-1", "application_id": "A", "check_id": "c", "status": "deficiency", "title": "t", "message": "m",
           "timestamp": "x", "rule_id": "R", "evidence": []}
    ok, why = validate(bad)
    assert not ok and any("evidence" in w for w in why)

def test_flags_have_evidence_and_basis(client, seeded):
    for i in seeded:
        for f in client.get(f"/api/v1/applications/{i}/findings", headers=O).json()["items"]:
            ok, why = validate(f)
            assert ok, (f["id"], why)

def test_no_fraud_wording_anywhere(client, seeded):
    blob = json.dumps(client.get(f"/api/v1/applications/{seeded[0]}/findings", headers=O).json()).lower()
    for banned in ("fatal", "forged", "fraud detected", "tamper_detected", "confirmed forgery"):
        assert banned not in blob

def test_expected_findings(client, seeded):
    fs = {f["rule_id"]: f for f in client.get(f"/api/v1/applications/{seeded[0]}/findings", headers=O).json()["items"]}
    assert fs["APH-2.5-VAL-002"]["status"] == "deficiency"       # expired occupancy certificate
    assert fs["APH-2.5-DOC-004"]["status"] == "deficiency"       # satellite evidence missing
    assert fs["APH-GEN-ID-002"]["status"] == "deficiency"        # registration number mismatch
    assert fs["INFRA-AREA-001"]["status"] == "needs_review"      # advisory only, never deficiency

def test_applicant_cannot_see_forensics(client, seeded):
    items = client.get(f"/api/v1/applications/{seeded[0]}/findings", headers=A).json()["items"]
    assert items and all(f["family"] not in ("integrity", "infrastructure", "source") for f in items)

def test_applicant_cannot_decide_or_approve(client, seeded):
    assert client.post(f"/api/v1/applications/{seeded[0]}/decision", headers=A, json={"decision": "x", "rationale": "y"}).status_code == 403
    assert client.post(f"/api/v1/applications/{seeded[0]}/decision", headers=O, json={"decision": "x", "rationale": "y"}).status_code == 403

def test_correction_triggers_targeted_recheck_and_keeps_original(client, seeded):
    f = next(x for x in client.get(f"/api/v1/applications/{seeded[0]}/findings", headers=O).json()["items"] if x["rule_id"] == "APH-GEN-ID-002")
    fld = f["evidence"][0]["field_id"]
    r = client.post(f"/api/v1/findings/{f['id']}/review", headers=O, json={"action": "correct_field", "field_id": fld, "new_value": "MH/DEMO/1001/2005", "reason": "typo"})
    assert r.status_code == 200 and r.json()["targeted_recheck"]["rules_rerun"] > 0
    row = db.one("SELECT raw_value, corrected_value FROM fields WHERE id=?", (fld,))
    assert row["raw_value"] != row["corrected_value"]            # original preserved

def test_dismiss_requires_reason(client, seeded):
    f = client.get(f"/api/v1/applications/{seeded[0]}/findings", headers=O).json()["items"][0]
    assert client.post(f"/api/v1/findings/{f['id']}/review", headers=O, json={"action": "dismiss", "reason": ""}).status_code == 422

def test_audit_chain_valid_and_tamper_evident(client, seeded):
    assert audit.verify_chain()["valid"]
    db.run("UPDATE audit SET actor='mallory' WHERE seq=(SELECT MIN(seq) FROM audit WHERE seq>3)")
    assert not audit.verify_chain()["valid"]

def test_rulepack_maker_checker(client):
    pack = json.load(open(os.path.join(os.path.dirname(__file__), "..", "app", "rules", "packs", "common.json")))
    pack["version"] = "2.0.0"
    R = {"X-Role": "rule_author", "X-Actor": "author.a"}
    assert client.post("/api/v1/rulepacks", headers=R, json={"pack": pack}).status_code == 200
    E_same = {"X-Role": "regulatory_expert", "X-Actor": "author.a"}
    assert client.post("/api/v1/rulepack-activate/common@2.0.0", headers=E_same).status_code == 403   # same person
    E = {"X-Role": "regulatory_expert", "X-Actor": "expert.b"}
    assert client.post("/api/v1/rulepack-activate/common@2.0.0", headers=E).status_code == 200

def test_upload_rejects_bad_files(client):
    aid = client.post("/api/v1/applications", headers=A, json={"institution_name": "X", "category": "eoa_self_disclosure"}).json()["id"]
    assert client.post(f"/api/v1/applications/{aid}/documents", headers=A, files={"file": ("a.exe", b"MZ", "application/octet-stream")}).status_code == 415
    assert client.post(f"/api/v1/applications/{aid}/documents", headers=A, files={"file": ("a.pdf", b"not a pdf", "application/pdf")}).status_code == 422

def test_unreadable_pdf_is_processing_status_not_violation(client):
    aid = client.post("/api/v1/applications", headers=O, json={"institution_name": "X", "category": "eoa_self_disclosure"}).json()["id"]
    client.post(f"/api/v1/applications/{aid}/documents", headers=O, files={"file": ("broken.pdf", b"%PDF-1.4 garbage", "application/pdf")})
    client.post(f"/api/v1/applications/{aid}/evaluate-rules", headers=O)
    fs = client.get(f"/api/v1/applications/{aid}/findings", headers=O).json()["items"]
    assert any(f["family"] == "processing" and f["status"] == "processing" for f in fs)

def test_officer_queue_and_artifact_endpoints(client, seeded):
    assert client.get("/api/v1/findings?family=integrity&status=needs_review", headers=O).json()["total"] > 0
    assert client.get("/api/v1/findings?family=integrity", headers=A).status_code == 403
    sc = client.get("/api/v1/source-checks", headers=O).json()
    assert sc and all(s["status"] in ("verified","mismatch_detected","expired","verification_pending","source_unavailable","manual_review_required") for s in sc)
    assert all(s["provenance"] in ("live","mock","cached","synthetic") for s in sc)
    docs = client.get(f"/api/v1/applications/{seeded[0]}/documents", headers=O).json()
    pdf = next(d for d in docs if d["filename"] == "fire_noc.pdf")
    r = client.get(f"/api/v1/documents/{pdf['id']}/page/1.png", headers=O)
    assert r.status_code == 200 and r.content[:4] == b"\x89PNG"
    plan = next(d for d in docs if d["filename"] == "floor_plan.pdf")
    g = client.post(f"/api/v1/infrastructure/geometry?doc_id={plan['id']}&declared_area_sqm=59", headers=O).json()
    assert g["status"] == "pass" and abs(g["measured_sqm"] - 59.2) < 0.5      # deterministic, reproducible
    g2 = client.post(f"/api/v1/infrastructure/geometry?doc_id={plan['id']}&declared_area_sqm=59", headers=O).json()
    assert g2["measured_sqm"] == g["measured_sqm"]
    assert client.get(f"/api/v1/applications/{seeded[0]}/diff", headers=O).json()["replaced"]

def test_notice_needs_officer_approval_and_decision_gate(client, seeded):
    d = client.post(f"/api/v1/applications/{seeded[0]}/deficiency-draft", headers=O).json()
    assert d["status"] == "draft"
    assert client.post(f"/api/v1/notices/{d['id']}/approve", headers=A, json={"due_date": "2026-12-01"}).status_code == 403
    assert client.get(f"/api/v1/applications/{seeded[0]}/notices", headers=A).json() == []   # applicant sees nothing until issued
    assert client.post(f"/api/v1/notices/{d['id']}/approve", headers=O, json={"due_date": "2026-12-01"}).status_code == 200
    C = {"X-Role": "competent_authority", "X-Actor": "authority.demo"}
    r = client.post(f"/api/v1/applications/{seeded[1]}/decision", headers=C, json={"decision": "recorded by authority", "rationale": "test"})
    assert r.status_code in (200, 409)   # 409 if human gates still open - never auto-decided


# ---------------------------------------------------------------- v1.1: proof cards + explanation layer
def test_proof_cards_roll_up_and_never_overclaim_verified(client, seeded):
    cid = seeded[0]
    client.post(f"/api/v1/applications/{cid}/evaluate-rules", headers=O)
    pc = client.get(f"/api/v1/applications/{cid}/proof-cards", headers=O).json()
    assert pc["cards"] and set(pc["counts"]) == {"verified", "partially_compliant", "needs_review", "mismatch", "pending"}
    assert sum(pc["counts"].values()) == len(pc["cards"])
    for c in pc["cards"]:
        # a card may only be 'verified' when the source check itself says verified
        if c["status"] == "verified":
            assert c["source_status"] == "verified"
    assert "approv" not in pc["overall_label"].lower() and "reject" not in pc["overall_label"].lower()


def test_proof_cards_applicant_view_hides_officer_only_fields(client, seeded):
    pc = client.get(f"/api/v1/applications/{seeded[0]}/proof-cards", headers=A).json()
    assert all("source_provenance" not in c for c in pc["cards"])


def test_explanation_is_template_by_default_and_keeps_verdict(client, seeded):
    items = client.get(f"/api/v1/applications/{seeded[0]}/findings", headers=O).json()["items"]
    f = items[0]
    ex = client.get(f"/api/v1/findings/{f['id']}/explain", headers=O).json()
    assert ex["provider"] == "template" and ex["status"] == f["status"] and ex["text"]


def test_explanation_guard_rejects_accusatory_wording():
    from app import explain
    assert explain.FORBIDDEN.search("This certificate is forged and the college is rejected")
    assert not explain.FORBIDDEN.search("The expiry date is before the submission date.")
