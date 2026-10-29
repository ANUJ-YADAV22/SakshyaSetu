import os, tempfile, io
os.environ["SAKSHYA_DATA_DIR"] = tempfile.mkdtemp()
import pymupdf, pytest
from fastapi.testclient import TestClient
from main import app
from app import lab
from app.rules import engine

O = {"X-Role": "scrutiny_officer", "X-Actor": "officer.demo"}
A = {"X-Role": "applicant", "X-Actor": "applicant.demo"}

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c

def _pdf(lines):
    d = pymupdf.open(); p = d.new_page(); y = 70
    for l in lines: p.insert_text((40, y), l, fontsize=11); y += 18
    return d.tobytes()

def _app(c, name, lines):
    a = c.post("/api/v1/applications", json={"institution_name": name, "category": "eoa_increase_intake"}, headers=O).json()["id"]
    c.post(f"/api/v1/applications/{a}/documents", files={"file": ("faculty.pdf", _pdf(lines), "application/pdf")}, headers=O)
    return a

def test_roster_parser_reads_names_ids_and_designations():
    ppl = lab.parse_roster("Faculty List\nName of Institution: X\n1. Dr. Anita Rao | Professor | UAN 100200300400 | PAN ABCPS1234K\n2. Rao Anita | no id")
    assert ppl[0]["uan"] == "100200300400" and ppl[0]["pan"] == "ABCPS1234K" and len(ppl) == 2
    assert ppl[0]["norm"] == ppl[1]["norm"]            # same person, different word order

def test_cross_check_finds_strong_match_and_masks_ids(client):
    _app(client, "Alpha", ["Faculty List", "1. Dr. Anita Rao | UAN 100200300400"])
    _app(client, "Beta", ["Faculty List", "1. Dr. Anita Rao | UAN 100200300400"])
    r = client.get("/api/v1/lab/faculty-cross-check", headers=O).json()
    assert any(p["level"] == "strong" for p in r["pairs"])
    assert "100200300400" not in str(r)

def test_roster_requirement_arithmetic_and_role_guard(client):
    a = _app(client, "Gamma", ["Faculty List", "1. Dr. A Kumar | Professor | UAN 111111111111", "2. Mr. B Sen | Assistant Professor | UAN 222222222222"])
    r = client.get(f"/api/v1/lab/faculty-roster/{a}?intake=120&years=4&ratio=20", headers=O).json()
    assert r["listed"] == 2 and r["requirement"]["required"] == 24 and r["requirement"]["shortfall"] == 22
    assert client.get(f"/api/v1/lab/faculty-roster/{a}", headers=A).status_code == 403

def test_faculty_required_rule_boundaries():
    rule = {"rule_id": "T", "message_template": "{listed}/{need}", "severity": "major"}
    p = {"program_years": 4, "faculty_ratio": 20}
    mk = lambda n, f: engine.CaseContext({"declared": {"proposed_intake": n, "faculty_count": f}}, None, [])
    assert engine.chk_faculty_required(rule, p, mk(120, 24))[0].status == "pass"
    assert engine.chk_faculty_required(rule, p, mk(120, 23))[0].status == "deficiency"
    assert engine.chk_faculty_required(rule, p, mk(121, 25))[0].status == "pass"     # ceil(24.2) = 25
    assert engine.chk_faculty_required(rule, p, engine.CaseContext({"declared": {}}, None, []))[0].status == "not_checked"

def test_reports_summary_shape_and_access(client):
    client.post("/api/v1/demo/seed", headers=A)
    r = client.get("/api/v1/reports/summary?days=7", headers=O).json()
    assert len(r["series"]) == 7 and r["totals"]["applications"] >= 1 and 0 <= r["rates"]["clearance_pct"] <= 100
    assert client.get("/api/v1/reports/summary", headers=A).status_code == 403

def test_studio_and_reconciliation_endpoints(client):
    ids = client.post("/api/v1/demo/seed", headers=A).json()["application_ids"]
    docs = [d for a in ids for d in client.get(f"/api/v1/applications/{a}/documents", headers=O).json()]
    d = next(x for x in docs if x["filename"] == "structural_stability_certificate.pdf")
    s = client.get(f"/api/v1/lab/documents/{d['id']}/studio", headers=O).json()
    assert len(s["sha256"]) == 64 and s["size"] > 0 and "metadata" in s
    r = client.get(f"/api/v1/lab/documents/{d['id']}/reconciliation", headers=O).json()
    assert any(x["state"] == "mismatch" and x["name"] == "registration_number" for x in r["rows"])
    assert r["record"]["provenance"] == "synthetic fixture"
    assert client.get(f"/api/v1/lab/documents/{d['id']}/studio", headers=A).status_code == 403
