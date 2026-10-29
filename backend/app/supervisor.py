"""Thin Supervisor: builds a per-case plan, runs independent checks in parallel through narrow tools,
validates every output, retries recoverable failures (bounded), records permanent failures honestly,
pauses at human gates, and never approves/rejects anything."""
import hashlib, json, uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path

from . import db, audit, forensics, infra, source_checker, rulepacks, alerts
from .config import MAX_RETRIES, TOOL_VERSION
from .docintel import read_pages, classify, extract_fields, OCR_AVAILABLE
from .findings import make_finding, validate, from_rule_result
from .rules import engine

class TransientError(Exception):
    """Recoverable failure (timeout, temporary IO)."""

# ------------------------------------------------------------------ loading
def get_app(app_id):
    a = db.one("SELECT * FROM applications WHERE id=?", (app_id,))
    if a: a["declared"] = db.jl(a["declared"], {}); a["pack_ids"] = db.jl(a["pack_ids"], [])
    return a

def current_docs(app_id):
    rows = db.many("SELECT * FROM documents WHERE application_id=? AND superseded_by IS NULL ORDER BY uploaded_at", (app_id,))
    for r in rows:
        r["processing"] = db.jl(r["processing"], {}); r["meta"] = db.jl(r["meta"], {})
    return rows

def doc_fields(doc_id):
    return db.many("SELECT * FROM fields WHERE document_id=?", (doc_id,))

def manifest_hash(docs):
    return hashlib.sha256(json.dumps(sorted((d["doc_type"], d["sha256"]) for d in docs)).encode()).hexdigest()

def build_ctx(app, docs, sub_date: date):
    views, reg_no = [], (app["declared"] or {}).get("registration_number")
    for d in docs:
        v = engine.DocView(id=d["id"], group_id=d["group_id"], type=d["doc_type"], sha256=d["sha256"], version=d["version"],
                           filename=d["filename"], uploaded_date=d["uploaded_at"])
        for f in doc_fields(d["id"]):
            corr = f["corrected_value"] is not None
            raw = f["corrected_value"] if corr else f["raw_value"]
            v.fields[f["name"]] = engine.FieldView(f["id"], f["name"], raw, f["corrected_value"] if corr and f["name"] not in
                                                    ("issue_date", "validity_end") else raw, 1.0 if corr else f["confidence"],
                                                    f["page"], db.jl(f["bbox"]), d["id"], corr)
            if f["name"] == "registration_number" and not reg_no: reg_no = raw
        v.meta = d["meta"]
        views.append(v)
    rec = source_checker.lookup_institution(reg_no, app["institution_name"])
    records = None
    if rec and rec.get("adapter_state") not in ("unavailable",):
        records = {k: rec[k] for k in ("institution_name", "registration_number", "approved_intake", "pending_inquiry")}
    return engine.CaseContext({"id": app["id"], "category": app["category"], "declared": app["declared"]}, sub_date, views,
                              records, "synthetic", manifest_hash(docs), rulepacks.checklist_for(app["category"]))

# ------------------------------------------------------------------ task runner
def run_task(app_id, run_id, name, idem, fn, reuse=False):
    if reuse:
        prev = db.one("SELECT * FROM tasks WHERE idem_key=? AND status='done' ORDER BY finished_at DESC LIMIT 1", (idem,))
        if prev:
            tid = "T-" + uuid.uuid4().hex[:8]
            db.run("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)", (tid, app_id, run_id, name, "reused", 0, idem, prev["result"], None, audit.now(), audit.now()))
            return db.jl(prev["result"]), "reused"
    tid, attempts, started = "T-" + uuid.uuid4().hex[:8], 0, audit.now()
    last = None
    while attempts <= MAX_RETRIES:
        attempts += 1
        try:
            res = fn()
            db.run("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)", (tid, app_id, run_id, name, "done", attempts, idem,
                   db.jd(res if isinstance(res, (dict, list, str, int, float, type(None))) else {}), None, started, audit.now()))
            return res, "done"
        except (TransientError, OSError) as e:
            last = f"{type(e).__name__}: {e}"
        except Exception as e:  # permanent
            last = f"{type(e).__name__}: {e}"; break
    db.run("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)", (tid, app_id, run_id, name, "failed", attempts, idem, None, last, started, audit.now()))
    return None, f"failed: {last}"

# ------------------------------------------------------------------ per-document tools
def process_document(doc, run_ela=False):
    pages, notes = read_pages(doc["path"], doc["mime"])
    text = "\n".join(p["text"] for p in pages)
    dtype, conf = classify(pages, doc["filename"])
    if dtype == "unknown" and doc["mime"].startswith("image/"):
        dtype, conf = "photograph", 0.6
    if dtype == "unknown" and doc["filename"].lower().endswith(".mp4"):
        dtype, conf = "evc_video", 0.9
    fields = extract_fields(doc["path"], pages) if pages and doc["mime"] == "application/pdf" else []
    meta = {"text_sample": text[:4000], "metadata": forensics.metadata_report(doc["path"]),
            "signature": forensics.signature_report(doc["path"]), "ocr_available": OCR_AVAILABLE}
    if run_ela or doc["mime"].startswith("image/"):
        meta["ela"] = forensics.ela_report(doc["path"], doc["id"])
    with db.conn() as c:
        c.execute("DELETE FROM fields WHERE document_id=? AND corrected_value IS NULL", (doc["id"],))
        for f in fields:
            fid = "FLD-" + hashlib.sha1(f"{doc['id']}|{f['name']}".encode()).hexdigest()[:10]
            c.execute("INSERT OR REPLACE INTO fields(id,document_id,name,raw_value,normalized,confidence,page,bbox,method) VALUES(?,?,?,?,?,?,?,?,?)",
                      (fid, doc["id"], f["name"], f["raw_value"], f["normalized"], f["confidence"], f["page"], db.jd(f["bbox"]), f["method"]))
        c.execute("UPDATE documents SET doc_type=?, doc_type_conf=?, page_count=?, processing=?, meta=? WHERE id=?",
                  (dtype, conf, len(pages), db.jd({"extracted": True, "notes": notes, "scanned_pages": [p["page"] for p in pages if p["scanned"]]}),
                   db.jd(meta), doc["id"]))
    return {"doc_type": dtype, "fields": len(fields), "notes": notes}

def source_check_doc(app, doc):
    fields = {f["name"]: (f["corrected_value"] or f["raw_value"]) for f in doc_fields(doc["id"])}
    d = {"id": doc["id"], "doc_type": doc["doc_type"], "integrity": doc["meta"]}
    res = source_checker.verify(d, fields, {"submission_date": date.today().isoformat(), "application_id": app["id"]})
    db.run("INSERT OR REPLACE INTO source_checks(id,application_id,document_id,data,created_at) VALUES(?,?,?,?,?)",
           ("SC-" + doc["id"], app["id"], doc["id"], db.jd(res), audit.now()))
    return res

# ------------------------------------------------------------------ main run
def build_plan(app, docs, mode):
    plan = [{"task": "intake", "note": f"category={app['category']}; checklist+rule packs selected"}]
    for d in docs:
        plan.append({"task": f"extract:{d['id']}", "depends_on": ["intake"], "parallel_group": "A"})
        plan.append({"task": f"integrity:{d['id']}", "depends_on": ["intake"], "parallel_group": "A",
                     "note": "runs in parallel with extraction (no dependency)"})
    plan += [{"task": f"source:{d['id']}", "depends_on": [f"extract:{d['id']}"], "parallel_group": "B"} for d in docs]
    plan += [{"task": "rules", "depends_on": ["extract:*", "source:*"]}, {"task": "duplicates", "depends_on": ["extract:*"]},
             {"task": "infrastructure", "depends_on": ["extract:*"]}, {"task": "report", "depends_on": ["rules", "duplicates", "infrastructure"]}]
    if mode == "targeted": plan.insert(1, {"task": "note", "note": "targeted re-check: only affected rules run"})
    return plan

def run_case(app_id, mode="full", actor="system", role="system", only_rules=None, run_ela=False, today=None):
    app = get_app(app_id)
    if not app: raise LookupError("application not found")
    run_id = "RUN-" + uuid.uuid4().hex[:8].upper()
    today = today or date.today()
    docs = current_docs(app_id)
    plan = build_plan(app, docs, mode)
    audit.append("run_started", actor, role, app_id, refs={"run_id": run_id, "mode": mode, "plan": [p["task"] for p in plan]})
    failures, rejected = [], []

    # Stage A: extraction + integrity, parallel across documents
    def stage_a(d):
        key = hashlib.sha256(f"extract|{d['sha256']}|{TOOL_VERSION}|{d['id']}".encode()).hexdigest()
        if d["processing"].get("extracted"):
            db.run("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)", ("T-" + uuid.uuid4().hex[:8], app_id, run_id, f"extract:{d['id']}", "reused", 0, key, None, None, audit.now(), audit.now()))
            return None
        return run_task(app_id, run_id, f"extract+integrity:{d['id']}", key, lambda: process_document(d, run_ela))
    with ThreadPoolExecutor(max_workers=4) as ex:
        for r in ex.map(stage_a, docs):
            if r and r[1].startswith("failed"): failures.append(r[1])
    docs = current_docs(app_id)

    # Stage B: source checks (parallel)
    def stage_b(d):
        key = hashlib.sha256(f"source|{d['sha256']}|{today}|{d['id']}|{db.jd([f['corrected_value'] for f in doc_fields(d['id'])])}".encode()).hexdigest()
        return d["id"], run_task(app_id, run_id, f"source:{d['id']}", key, lambda: source_check_doc(app, d))
    with ThreadPoolExecutor(max_workers=4) as ex:
        src = dict(ex.map(stage_b, docs))
    src_res = {k: v[0] for k, v in src.items() if v[0]}

    # Stage C: rules, integrity, infrastructure
    ctx = build_ctx(app, docs, today)
    packs = rulepacks.active_packs(app["category"])
    only = set(only_rules) if only_rules else None
    results, skipped = engine.evaluate(packs, ctx, only)
    dtype_by_id = {d["id"]: d["doc_type"] for d in docs}
    findings = [from_rule_result(app_id, r, dtype_by_id) for r in results]
    if only is None:
        findings += integrity_findings(app, docs, src_res)
        findings += infra_findings(app, docs, ctx)
        findings += processing_findings(app, docs, skipped)
        findings += source_findings(app, docs, src_res)

    good = []
    for f in findings:
        ok, why = validate(f)
        if ok: good.append(f)
        else: rejected.append({"finding": f.get("id"), "reasons": why})
    summary = {"run_id": run_id, "mode": mode, "plan": plan, "documents": len(docs), "findings_total": len(good),
               "by_status": {s: sum(1 for f in good if f["status"] == s) for s in ("pass", "deficiency", "needs_review", "indicator", "not_checked", "processing")},
               "rejected_by_validator": rejected, "task_failures": failures, "skipped_rules": skipped,
               "rule_packs": [f"{p['id']}@{p['version']}" for p in packs]}
    if mode == "presubmission":
        sid = "SNAP-" + uuid.uuid4().hex[:8].upper()
        summary["snapshot_id"] = sid
        snap = {"documents": [{"id": d["id"], "group_id": d["group_id"], "type": d["doc_type"], "sha256": d["sha256"], "filename": d["filename"], "version": d["version"]} for d in docs],
                "fields": {d["id"]: {f["name"]: (f["corrected_value"] or f["raw_value"]) for f in doc_fields(d["id"])} for d in docs},
                "findings": good, "summary": summary}
        db.run("INSERT INTO snapshots VALUES(?,?,?,?,?)", (sid, app_id, "presubmission", audit.now(), db.jd(snap)))
        audit.append("presubmission_check_completed", actor, role, app_id, refs={"snapshot": sid, "counts": summary["by_status"], "advisory": True,
                     "note": "Advisory only; no official record or deficiency created."})
        return {"summary": summary, "findings": good}
    persist_findings(app, good, run_id, partial=bool(only), actor=actor, role=role)
    raise_alerts(app_id, good)
    db.run("UPDATE applications SET status=? WHERE id=? AND status NOT IN ('decided')",
           ("awaiting_review" if db.one("SELECT 1 x FROM gates WHERE application_id=? AND status='open'", (app_id,)) else "under_scrutiny", app_id))
    audit.append("run_completed", actor, role, app_id, refs={"run_id": run_id, "counts": summary["by_status"], "rejected": len(rejected)},
                 rule_pack_version=",".join(summary["rule_packs"]))
    return {"summary": summary, "findings": good}

# ------------------------------------------------------------------ finding producers
def _ev(d, page=1, bbox=None, kind="document"):
    return {"kind": kind, "doc_id": d["id"], "sha256": d["sha256"], "filename": d["filename"], "page": page, "bbox": bbox}

def integrity_findings(app, docs, src_res):
    out = []
    peers = db.many("SELECT * FROM documents WHERE sha256 IS NOT NULL")
    for d in docs:
        meta = d["meta"]; ver = "forensics-1.0"
        mk = lambda **kw: make_finding(app["id"], rule_version=ver, pack_version="integrity@1.0", clause=None,
                                       clause_confirmed=False, family="integrity", **kw)
        # hash recorded (Tier A)
        out.append(mk(check_id="FOR-HASH-001", rule_id="FOR-HASH-001", title="File hash recorded", status="pass", severity="info", tier="A",
                      message=f"SHA-256 {d['sha256'][:16]}... recorded for original file (proves integrity of stored bytes only).",
                      evidence=[_ev(d)], subject=d["id"], method="SHA-256"))
        sig = meta.get("signature") or {}
        st = sig.get("status")
        if st == "not_present":
            out.append(mk(check_id="FOR-SIG-001", rule_id="FOR-SIG-001", title="Digital signature", status="not_checked", severity="info", tier="A",
                          message="No digital signature present (not itself an irregularity unless the issuer is expected to sign).",
                          evidence=[_ev(d)], subject=d["id"], method=sig.get("method", ""), limitations=sig.get("limitations", "")))
        elif st == "valid":
            out.append(mk(check_id="FOR-SIG-001", rule_id="FOR-SIG-001", title="Digital signature", status="pass", severity="info", tier="A",
                          message="Digital signature cryptographically valid and trusted.", evidence=[_ev(d)], subject=d["id"], method=sig.get("method", "")))
        elif st in ("invalid", "untrusted"):
            out.append(mk(check_id="FOR-SIG-001", rule_id="FOR-SIG-001", title="Digital signature", status="needs_review",
                          severity="major" if st == "invalid" else "minor", tier="B", gate="serious_integrity_indicator", review_reason=f"signature_{st}",
                          message=f"Signature status: {st}. Preliminary indicator - requires human verification.", evidence=[_ev(d)],
                          subject=d["id"], method=sig.get("method", ""), outputs={"signatures": sig.get("signatures")}, limitations=sig.get("limitations", ""),
                          review_basis="Cryptographic signature validation result"))
        elif st == "unable_to_validate":
            out.append(mk(check_id="FOR-SIG-001", rule_id="FOR-SIG-001", title="Digital signature", status="not_checked", severity="info", tier="A",
                          message="Signature present but could not be validated here.", evidence=[_ev(d)], subject=d["id"],
                          limitations=sig.get("note", "") or sig.get("error", "")))
        md = meta.get("metadata") or {}
        for a in md.get("anomalies", []):
            out.append(mk(check_id="FOR-META-001", rule_id="FOR-META-001", title="PDF metadata observation", status="needs_review", severity="minor",
                          tier="B", gate="serious_integrity_indicator", review_reason="metadata_anomaly", message=a + " Observed metadata; not proof of alteration.",
                          evidence=[_ev(d)], subject=f"{d['id']}:{a[:30]}", outputs={"metadata": {k: md.get(k) for k in ("producer", "creator", "creation_date", "mod_date", "incremental_updates")}},
                          method="PDF metadata + xref analysis", limitations=forensics.DISCLAIMER, review_basis="Metadata consistency check"))
        issue = next((f for f in doc_fields(d["id"]) if f["name"] == "issue_date"), None)
        if issue:
            msg = forensics.creation_vs_issue(md, issue["corrected_value"] or issue["raw_value"])
            if msg:
                out.append(mk(check_id="FOR-META-002", rule_id="FOR-META-002", title="PDF creation date vs stated issue date", status="needs_review",
                              severity="minor", tier="B", gate="serious_integrity_indicator", review_reason="metadata_anomaly",
                              message=msg + " Reported as a metadata indicator only, never as a deficiency.",
                              evidence=[_ev(d, issue["page"], db.jl(issue["bbox"]), "field")], subject=d["id"], method="PDF metadata vs extracted date",
                              limitations=forensics.DISCLAIMER, review_basis="Metadata vs document date"))
        ela = meta.get("ela")
        if ela and ela.get("available") and ela.get("candidate_regions"):
            out.append(mk(check_id="FOR-ELA-001", rule_id="FOR-ELA-001", title="Image-region anomaly (ELA)", status="needs_review", severity="minor",
                          tier="B", gate="serious_integrity_indicator", review_reason="image_anomaly",
                          message=f"{len(ela['candidate_regions'])} region(s) with elevated error level - potential anomaly indicator.",
                          evidence=[_ev(d, 1, ela["candidate_regions"][0]["bbox"], "region")], subject=d["id"], method=ela["method"],
                          outputs={"overlay": ela["overlay_path"], "regions": ela["candidate_regions"]}, limitations=ela["limitations"], review_basis="ELA heuristic"))
        dup = forensics.duplicate_report(d, meta.get("text_sample", ""), peers, permitted_history=True)
        for e in dup["exact"]:
            other = next((p for p in docs if p["id"] == e["doc_id"]), None)
            if e["same_case"] and other and other["doc_type"] == d["doc_type"]:
                continue
            out.append(mk(check_id="FOR-DUP-001", rule_id="FOR-DUP-001", title="Exact duplicate file", status="needs_review", severity="minor", tier="B",
                          gate="serious_integrity_indicator", review_reason="duplicate",
                          message=f"Identical file (SHA-256 match) also found as {e['filename']} ({'same case' if e['same_case'] else 'other case ' + str(e['application_id'])}). Officer to confirm relevance.",
                          evidence=[_ev(d)], subject=f"{d['id']}:{e['doc_id']}", outputs={"match": e}, method="SHA-256 comparison", limitations=dup["limitations"],
                          review_basis="Exact duplicate detection"))
        for n in dup["near"]:
            out.append(mk(check_id="FOR-DUP-002", rule_id="FOR-DUP-002", title="Near-duplicate document", status="needs_review", severity="minor", tier="B",
                          gate="serious_integrity_indicator", review_reason="duplicate",
                          message=f"Similar to {n['filename']} (pHash distance {n['phash_distance']}, text similarity {n['text_similarity']}). Officer confirms relevance.",
                          evidence=[_ev(d)], subject=f"{d['id']}:{n['doc_id']}", outputs={"match": n, "thresholds": dup["thresholds"]},
                          method=n["method"], limitations=dup["limitations"], review_basis="Near-duplicate detection"))
    return out

def source_findings(app, docs, src_res):
    out = []
    for d in docs:
        r = src_res.get(d["id"])
        if not r: continue
        s = r["status"]
        status = {"verified": "pass", "mismatch_detected": "needs_review", "expired": "not_checked", "verification_pending": "needs_review",
                  "source_unavailable": "not_checked", "manual_review_required": "needs_review"}[s]
        if s == "expired": continue   # covered by validity rule; avoid duplicate findings
        out.append(make_finding(app["id"], check_id="SRC-001", rule_id="SRC-001", rule_version="source-checker-1.0", pack_version="source@1.0",
                                clause=None, clause_confirmed=False, title=f"Source verification: {d['filename']}", family="source", status=status,
                                severity="minor" if s != "mismatch_detected" else "major", tier="B" if status != "pass" else "A",
                                message=f"Verification status: {s.replace('_', ' ')} via {r['source_name']} [{r['provenance']}]. {r['limitations']}",
                                evidence=[_ev(d)], subject=d["id"], source_check_status=s, provenance=r["provenance"],
                                inputs={"prefilled_request": r.get("prefilled_request")},
                                outputs={k: r[k] for k in ("matched_fields", "mismatched_fields", "response_reference")},
                                method="Source Checker adapter registry", limitations=r["limitations"], next_action=r["next_action"],
                                review_basis="Source verification result", gate=""))
    return out

def processing_findings(app, docs, skipped):
    out = []
    for d in docs:
        for n in d["processing"].get("notes", []):
            out.append(make_finding(app["id"], check_id=f"PROC-{n['code']}", rule_id="PROC-001", rule_version="processing-1.0", pack_version="processing@1.0",
                                    clause=None, clause_confirmed=False, title="Processing status", family="processing", status="processing",
                                    severity="info", tier="A", message=n["message"] + " Reported as a processing status, not a violation.",
                                    evidence=[_ev(d, n.get("page", 1))], subject=f"{d['id']}:{n['code']}:{n.get('page', '')}", method="document intake"))
        if d["doc_type"] == "unknown":
            out.append(make_finding(app["id"], check_id="PROC-classify", rule_id="PROC-002", rule_version="processing-1.0", pack_version="processing@1.0",
                                    clause=None, clause_confirmed=False, title="Document type not recognised", family="processing", status="needs_review",
                                    severity="info", tier="B", review_reason="classification", gate="ambiguous_extraction",
                                    message="Classifier returned 'unknown' (allowed outcome). Officer to set the document type.",
                                    evidence=[_ev(d)], subject=d["id"], method="keyword classifier with unknown label", review_basis="Classification confidence below threshold"))
    return out

def infra_findings(app, docs, ctx):
    inp = db.jl((db.one("SELECT data FROM infra_inputs WHERE application_id=?", (app["id"],)) or {}).get("data"), {}) or {}
    declared = app["declared"] or {}
    obs, out = [], []
    mk = lambda d, o, check_id, title: make_finding(
        app["id"], check_id=check_id, rule_id=check_id, rule_version="infra-1.0", pack_version="infrastructure@1.0", clause=None, clause_confirmed=False,
        title=title, family="infrastructure", status=o["status"] if o["status"] != "pass" else "pass", severity="minor", tier="A" if o["status"] == "pass" else "B",
        message=(o.get("reason") or "") + (" Advisory only." if o["status"] != "pass" else ""), evidence=[_ev(d, o.get("page", 1), (o.get("regions") or [{}])[0].get("bbox_norm") if o.get("regions") else None)],
        subject=d["id"], inputs={k: o.get(k) for k in ("declared_sqm", "declared", "tolerance_pct", "tolerance_km")}, outputs={k: v for k, v in o.items() if k not in ("limitations",)},
        method=o.get("method", ""), limitations=o.get("limitations", ""), next_action=o.get("next_step", ""), review_basis="Infrastructure advisory check")
    for d in docs:
        if d["doc_type"] == "floor_plan" and d["mime"] == "application/pdf":
            fp = inp.get("floorplan", {})
            f_decl = next((float(f["normalized"]) for f in doc_fields(d["id"]) if f["name"] == "declared_area_sqm" and str(f["normalized"]).replace(".", "", 1).isdigit()), None)
            decl = fp.get("declared_area_sqm") or declared.get("declared_area_sqm") or f_decl
            o = infra.analyze_floorplan(d["path"], fp.get("page", 1), fp.get("calibration"), decl, doc_id=d["id"])
            if o.get("status") == "not_checked": o["status"] = "not_checked"
            obs.append(o); out.append(mk(d, o, "INFRA-AREA-001", "Floor-plan area vs declared"))
        if d["doc_type"] == "photograph" or d["mime"].startswith("image/"):
            q = infra.image_quality(d["path"])
            oq = {"check": "evidence_quality", "status": "pass" if q["usable"] else "needs_review", "reason": "Evidence usable." if q["usable"] else
                  "Unusable evidence: " + ", ".join(q["issues"]) + ".", "method": "resolution/blur/brightness", "measured": q,
                  "limitations": "Heuristic thresholds are configurable.", "next_step": "" if q["usable"] else "Request resubmission."}
            obs.append(oq); out.append(mk(d, oq, "INFRA-QUAL-001", "Photograph quality"))
            loc = infra.check_location(d["path"], inp.get("location") or ({"latitude": declared.get("latitude"), "longitude": declared.get("longitude")}), (inp.get("location") or {}).get("tolerance_km", 0.5))
            obs.append(loc); out.append(mk(d, loc, "INFRA-LOC-001", "Evidence location vs declared site"))
            cd = infra.check_capture_date(d["path"], inp.get("application_period") or declared.get("application_period"))
            obs.append(cd); out.append(mk(d, cd, "INFRA-DATE-001", "Evidence capture date"))
            my = forensics.page_phash(d["path"]); reused = []
            for p in db.many("SELECT * FROM documents WHERE id!=? AND (mime LIKE 'image/%' OR doc_type='photograph')", (d["id"],)):
                ph = forensics.page_phash(p["path"])
                if my and ph:
                    import imagehash
                    dist = imagehash.hex_to_hash(my) - imagehash.hex_to_hash(ph)
                    if dist <= 6: reused.append({"doc_id": p["id"], "application_id": p["application_id"], "phash_distance": int(dist)})
            if reused:
                orr = {"check": "reused_images", "status": "needs_review", "reason": f"Image matches {len(reused)} other evidence image(s) (possible reuse); reviewer to confirm.",
                       "method": "perceptual hash", "matches": reused, "limitations": "Similar scenes can match legitimately.", "next_step": "Confirm on side-by-side comparison."}
                obs.append(orr); out.append(mk(d, orr, "INFRA-REUSE-001", "Possible reused image"))
        if d["doc_type"] == "evc_video":
            ov = {"check": "video_evidence", "status": "not_checked", "reason": "Video received and hashed; key-frame sampling and GPS-track continuity analysis are designed but not implemented.",
                  "method": "none (designed)", "limitations": "No video analysis performed.", "next_step": "Reviewer to watch video manually."}
            obs.append(ov); out.append(mk(d, ov, "INFRA-VID-001", "EVC video evidence"))
    if obs:
        miss = False
        rec = infra.recommend(obs, miss)
        anchor = next((d for d in docs if d["doc_type"] in ("floor_plan", "photograph", "evc_video")), docs[0])
        out.append(make_finding(app["id"], check_id="INFRA-REC-001", rule_id="INFRA-REC-001", rule_version="infra-1.0", pack_version="infrastructure@1.0",
                                clause=None, clause_confirmed=False, title="Infrastructure evidence recommendation", family="infrastructure",
                                status="pass" if rec["level"] == "evidence_adequate" else "needs_review", severity="info", tier="B",
                                message=f"Advisory recommendation: {rec['level'].replace('_', ' ')}. " + " ".join(rec["reasons"])[:300],
                                evidence=[_ev(anchor)], subject="recommendation", outputs=rec, method="aggregation of advisory checks",
                                limitations="Recommendation only; decision belongs to the competent authority.", review_basis="Infrastructure advisory aggregation"))
    return out

# ------------------------------------------------------------------ persistence, gates, alerts
GATE_FOR = {"ambiguous_extraction", "serious_integrity_indicator"}

def persist_findings(app, findings, run_id, partial, actor, role):
    app_id = app["id"]; seen = set()
    for f in findings:
        seen.add(f["id"])
        ex = db.one("SELECT review FROM findings WHERE id=?", (f["id"],))
        review = ex["review"] if ex else None
        if ex:
            db.run("UPDATE findings SET data=?, status=?, queue=?, visibility=?, updated_at=?, run_id=?, active=1 WHERE id=?",
                   (db.jd(f), f["status"], f["queue"], f["visibility"], audit.now(), run_id, f["id"]))
        else:
            db.run("INSERT INTO findings(id,application_id,data,status,queue,visibility,review,created_at,updated_at,run_id,active) VALUES(?,?,?,?,?,?,?,?,?,?,1)",
                   (f["id"], app_id, db.jd(f), f["status"], f["queue"], f["visibility"], None, audit.now(), audit.now(), run_id))
            audit.append("finding_created", actor, role, app_id, refs={"finding_id": f["id"], "rule_id": f["rule_id"], "status": f["status"]}, rule_pack_version=f["pack_version"])
        if f.get("gate") in GATE_FOR and f["status"] in ("needs_review", "indicator") and not (review and db.jl(review, {}).get("outcome")):
            g = db.one("SELECT id FROM gates WHERE finding_id=? AND status='open'", (f["id"],))
            if not g:
                gid = "G-" + uuid.uuid4().hex[:8].upper()
                db.run("INSERT INTO gates VALUES(?,?,?,?,?,?,?,?,?,?)", (gid, app_id, f["gate"], f["id"], "open", audit.now(), None, None, None, db.jd({"reason": f["review_reason"]})))
                audit.append("gate_opened", "system", "system", app_id, refs={"gate_id": gid, "gate_type": f["gate"], "finding_id": f["id"]})
    if not partial:
        for r in db.many("SELECT id FROM findings WHERE application_id=? AND active=1", (app_id,)):
            if r["id"] not in seen:
                db.run("UPDATE findings SET active=0, updated_at=? WHERE id=?", (audit.now(), r["id"]))
                for g in db.many("SELECT id FROM gates WHERE finding_id=? AND status='open'", (r["id"],)):
                    db.run("UPDATE gates SET status='resolved', resolved_at=?, resolved_by='system', outcome='resolved_by_recheck' WHERE id=?", (audit.now(), g["id"]))

def raise_alerts(app_id, findings):
    for f in findings:
        rid, st = f["rule_id"], f["status"]
        if st == "deficiency" and "-DOC-" in rid:
            alerts.raise_alert(app_id, "required_document_missing", f["message"], f["subject"], "high", f["id"], ("scrutiny_officer",))
        elif st == "deficiency" and "-VAL-" in rid:
            alerts.raise_alert(app_id, "certificate_expired", f["message"], f["subject"], "high", f["id"])
        elif st == "needs_review" and f.get("review_reason") == "nearing_expiry":
            alerts.raise_alert(app_id, "certificate_nearing_expiry", f["message"], f["subject"], "medium", f["id"])
        elif f["family"] == "processing" and "unreadable" in f["check_id"]:
            alerts.raise_alert(app_id, "document_unreadable", f["message"], f["subject"], "high", f["id"])
        elif f["family"] == "integrity" and st == "needs_review":
            alerts.raise_alert(app_id, "integrity_indicator_awaiting_review", f["message"], f["id"], "medium", f["id"], ("specialist_reviewer",))
