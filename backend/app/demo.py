"""Synthetic demo dossier generator. Every document carries a visible DEMO DATA marking and every
simulated source response is labelled mock/synthetic. Nothing here refers to a real institution."""
import hashlib, io, random, uuid
from datetime import date
from pathlib import Path
import pymupdf
from PIL import Image, ImageDraw, ImageFilter

from . import db, audit, supervisor
from .config import UPLOAD_DIR

HEADER = "DEMO DATA - SYNTHETIC DOCUMENT (not a real certificate)"

def make_pdf(path: Path, title: str, lines: list, drawings=None, created="D:20260601000000Z", incremental=False):
    doc = pymupdf.open(); page = doc.new_page()
    page.insert_text((40, 40), HEADER, fontsize=8, color=(0.7, 0.1, 0.1))
    page.insert_text((40, 70), title, fontsize=15)
    y = 100
    for ln in lines:
        page.insert_text((40, y), ln, fontsize=11); y += 20
    for kind, args in (drawings or []):
        if kind == "rect": page.draw_rect(pymupdf.Rect(*args), color=(0, 0, 0), width=1.5)
    doc.set_metadata({"producer": "DemoGenerator", "creator": "DemoGenerator", "creationDate": created, "modDate": created})
    doc.save(str(path))
    if incremental:
        d2 = pymupdf.open(str(path)); d2.set_metadata({"producer": "EditorX 3.1", "modDate": "D:20260820101500Z"}); d2.saveIncr(); d2.close()
    return path.read_bytes()

def _photo(path: Path, gps=True, noise=True):
    rnd = random.Random(7)
    img = Image.new("RGB", (900, 700), (120, 150, 110)); d = ImageDraw.Draw(img)
    for _ in range(260):
        x, y = rnd.randint(0, 880), rnd.randint(0, 680)
        d.rectangle([x, y, x + rnd.randint(8, 70), y + rnd.randint(8, 70)], fill=(rnd.randint(0, 255), rnd.randint(0, 255), rnd.randint(0, 255)))
    ex = Image.Exif()
    ex[0x0132] = "2026:08:12 10:15:00"
    if gps:
        ex[0x8825] = {1: "N", 2: (18.0, 31.0, 13.0), 3: "E", 4: (73.0, 51.0, 24.0)}
    img.save(path, "JPEG", exif=ex, quality=92)
    return path.read_bytes()

def _add_doc(app_id, filename, data: bytes, actor, replaces=None):
    ext = Path(filename).suffix.lower(); doc_id = "DOC-" + uuid.uuid4().hex[:8].upper()
    path = UPLOAD_DIR / f"{doc_id}{ext}"; path.write_bytes(data); path.chmod(0o444)
    sha = hashlib.sha256(data).hexdigest(); group, version = doc_id, 1
    if replaces:
        old = db.one("SELECT * FROM documents WHERE id=?", (replaces,)); group, version = old["group_id"], old["version"] + 1
        db.run("UPDATE documents SET superseded_by=? WHERE id=?", (doc_id, replaces))
    mime = {"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png"}[ext[1:]]
    db.run("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (doc_id, app_id, group, version, filename, sha, len(data), mime, str(path),
           "unknown", 0.0, audit.now(), actor, None, None, db.jd({}), db.jd({})))
    audit.append("document_uploaded" if not replaces else "document_replaced", actor, "applicant", app_id, doc_id, refs={"sha256": sha, "filename": filename, "version": version, "demo": True})
    return doc_id

def _new_app(name, category, declared, actor):
    aid = "APP-DEMO-" + uuid.uuid4().hex[:5].upper()
    db.run("INSERT INTO applications VALUES(?,?,?,?,?,?,?,?,?,?)", (aid, name, category, "draft", actor, db.jd(declared), audit.now(), None, db.jd([]), 1))
    audit.append("application_created", actor, "applicant", aid, refs={"category": category, "demo": True})
    return aid

def seed_demo(actor="applicant.demo"):
    work = Path(UPLOAD_DIR.parent / "demo_tmp"); work.mkdir(exist_ok=True)
    NAME, REG = "Sahyadri Institute of Technology", "MH/DEMO/1001/2005"
    aid = _new_app(NAME, "eoa_self_disclosure",
                   {"registration_number": REG, "latitude": 18.5204, "longitude": 73.8567, "application_period": ["2026-01-01", "2026-12-31"]}, actor)
    fire = make_pdf(work / "fire.pdf", "Fire No Objection Certificate", [
        f"Name of Institution: {NAME}", "Issued by: Fire Services Department (synthetic)", "Certificate No: FS/DEMO/2025/0417",
        "Date of Issue: 10 March 2025", "Valid Upto: 09 March 2030"], created="D:20240101000000Z")   # created BEFORE its stated issue date
    occ = make_pdf(work / "occ.pdf", "Occupancy Certificate", [
        f"Name of Institution: {NAME}", "Issued by: Municipal Corporation Building Dept (synthetic)", "Certificate No: OC/DEMO/2019/221",
        "Date of Issue: 01/07/2019", "Valid Upto: 30/06/2024"])  # expired
    stab = make_pdf(work / "stab.pdf", "Structural Stability Certificate", [
        f"Name of Institution: {NAME}", "Registration No: MH/DEMO/1011/2005", "Issued by: Licensed Structural Engineer (synthetic)", "Certificate No: SS/DEMO/88",
        "Date of Issue: 2025-05-14", "Valid Upto: 2030-05-13"], incremental=True)   # reg no mismatch + incremental update
    aff = make_pdf(work / "aff.pdf", "Affidavit 2", [
        f"Name of Institution: {NAME}", f"Registration No: {REG}", "Date of Issue: 04/05/2026", "Solemnly affirm that the above particulars are true (demo text)."])  # ambiguous date
    acc_bad = make_pdf(work / "acc.pdf", "Audited Accounts - Balance Sheet", [
        "Name of Institution: Sahyadri Institute of Technolgy", "Issued by: Chartered Accountant (synthetic)", "Date of Issue: 2027-02-01", "Statement of income and balance sheet (demo)."])  # future-dated + typo
    plan = make_pdf(work / "plan.pdf", "Floor Plan - Sanctioned Plan", [
        "Scale 1:100", "Declared Built-up Area: 90 sq.m", f"Name of Institution: {NAME}"],
        drawings=[("rect", (60, 160, 460, 460)), ("rect", (80, 180, 260, 320)), ("rect", (280, 180, 440, 320))])
    ids = {}
    for key, fn, data in (("fire", "fire_noc.pdf", fire), ("occ", "occupancy_certificate.pdf", occ), ("stab", "structural_stability_certificate.pdf", stab),
                          ("aff", "affidavit_2.pdf", aff), ("acc", "audited_accounts.pdf", acc_bad), ("plan", "floor_plan.pdf", plan)):
        ids[key] = _add_doc(aid, fn, data, actor)
    ids["photo"] = _add_doc(aid, "campus_photo.jpg", _photo(work / "p.jpg"), actor)
    # applicant runs the advisory pre-submission check, fixes the audited accounts, then submits
    pre = supervisor.run_case(aid, "presubmission", actor, "applicant")
    acc_ok = make_pdf(work / "acc2.pdf", "Audited Accounts - Balance Sheet", [
        f"Name of Institution: {NAME}", "Issued by: Chartered Accountant (synthetic)", "Date of Issue: 2026-03-31", "Statement of income and balance sheet (demo)."])
    ids["acc2"] = _add_doc(aid, "audited_accounts_corrected.pdf", acc_ok, actor, replaces=ids["acc"])

    # second application: increase in intake; reuses the SAME fire NOC bytes (cross-case exact duplicate) and has a pending inquiry on record
    NAME2 = "Narmada College of Engineering"
    bid = _new_app(NAME2, "eoa_increase_intake", {"proposed_intake": 180, "total_students": 720, "faculty_count": 30, "registration_number": "MP/DEMO/2002/2011"}, actor)
    _add_doc(bid, "fire_noc_copy.pdf", fire, actor)
    _add_doc(bid, "affidavit.pdf", make_pdf(work / "a2.pdf", "Affidavit", [f"Name of Institution: {NAME2}", "Registration No: MP/DEMO/2002/2011", "Date of Issue: 2026-05-30"]), actor)
    _add_doc(bid, "faculty_list.pdf", make_pdf(work / "f2.pdf", "Faculty List", [f"Name of Institution: {NAME2}", "Total Faculty: 30", "Date of Issue: 2026-05-31"]), actor)
    db.run("UPDATE applications SET status='submitted', submitted_at=? WHERE id=?", (audit.now(), bid))
    supervisor.run_case(bid, "full", "officer.demo", "scrutiny_officer")
    return {"application_ids": [aid, bid], "primary": aid, "second": bid, "presubmission_summary": pre["summary"]["by_status"],
            "next": ["POST /applications/{id}/submit (as applicant)", "review findings as scrutiny_officer"]}
