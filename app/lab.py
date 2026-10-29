"""Document lab: three real, deterministic checks that run on uploaded files.
 * font-consistency   - numeric text whose font family is used nowhere else for words on that page (common in digit edits)
 * copy-move          - ORB keypoints + RANSAC: regions of a page that repeat elsewhere with the same geometry transform
 * faculty cross-check- the same person listed by different institutions (exact UAN/PAN, or normalised-name match)
Every result is a PRELIMINARY INDICATOR for a human reviewer, never proof. No biometric data is processed."""
import difflib, re
from typing import Optional
import numpy as np
import pymupdf
from fastapi import APIRouter, Depends, HTTPException

from . import db, audit, docintel
from .api import actor, need, OFFICER, Actor, mask
from .config import DERIVED_DIR

try:
    import cv2  # optional: opencv-python-headless
except Exception:  # pragma: no cover
    cv2 = None

router = APIRouter(prefix="/api/v1/lab", tags=["lab"])
DISCLAIMER = "Preliminary indicator only - not proof of alteration or misconduct. Requires human verification."

def _doc(doc_id):
    d = db.one("SELECT * FROM documents WHERE id=?", (doc_id,))
    if not d: raise HTTPException(404, "document not found")
    return d

# ------------------------------------------------------------------ font consistency
def _family(name: str) -> str:
    n = re.sub(r"^[A-Z]{6}\+", "", name or "")                      # drop subset prefix
    n = re.sub(r"[-,]?(Bold|Italic|Oblique|Regular|Roman|MT|PSMT)+$", "", n, flags=re.I)
    return n.lower()

def font_report(path: str) -> dict:
    out = {"check": "font_consistency", "limitations": DISCLAIMER + " Legitimate documents may use a separate numeric font (tables, stamps)."}
    if not path.lower().endswith(".pdf"):
        return {**out, "status": "not_checked", "reason": "Font analysis needs a PDF with a text layer."}
    try: doc = pymupdf.open(path)
    except Exception as e: return {**out, "status": "not_checked", "reason": f"File could not be opened: {e}"}
    findings, fonts = [], {}
    for pno, page in enumerate(doc, start=1):
        W, H = page.rect.width, page.rect.height
        spans = [s for b in page.get_text("dict")["blocks"] if b.get("type") == 0 for l in b["lines"] for s in l["spans"] if s["text"].strip()]
        word_fams = {_family(s["font"]) for s in spans if len(re.findall(r"[A-Za-z]", s["text"])) >= 3}
        for s in spans: fonts.setdefault(s["font"], set()).add(pno)
        for s in spans:
            digits = re.findall(r"\d", s["text"])
            if len(digits) >= 2 and len(re.findall(r"[A-Za-z]", s["text"])) <= 2 and word_fams and _family(s["font"]) not in word_fams:
                x0, y0, x1, y1 = s["bbox"]
                findings.append({"page": pno, "text": s["text"].strip()[:40], "font": s["font"], "page_word_fonts": sorted(word_fams),
                                 "bbox": [round(x0 / W, 4), round(y0 / H, 4), round(x1 / W, 4), round(y1 / H, 4)]})
    status = "needs_review" if findings else "pass"
    return {**out, "status": status, "fonts": {k: sorted(v) for k, v in fonts.items()}, "instances": findings[:20],
            "message": (f"{len(findings)} numeric text run(s) use a font family that no word on the same page uses." if findings
                        else "No numeric text uses a font family that is absent from the page's wording. This does not prove the file is unaltered.")}

# ------------------------------------------------------------------ copy-move
def copy_move_report(path: str, doc_id: str, dpi=150, min_inliers=12, min_shift_px=40) -> dict:
    out = {"check": "copy_move", "method": "ORB keypoints + self-matching (ratio test) + RANSAC partial-affine", "limitations":
           DISCLAIMER + " Repeated letters, logos and ruled tables can match themselves; scanned photographs work best."}
    if cv2 is None:
        return {**out, "status": "not_checked", "reason": "OpenCV is not installed (pip install opencv-python-headless)."}
    try:
        if path.lower().endswith(".pdf"):
            pix = pymupdf.open(path)[0].get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB)
            rgb = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, 3)
        else:
            im = cv2.imread(path); rgb = cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
    except Exception as e:
        return {**out, "status": "not_checked", "reason": f"File could not be rendered: {e}"}
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    kp, des = cv2.ORB_create(nfeatures=6000, scaleFactor=1.2).detectAndCompute(gray, None)
    if des is None or len(kp) < 40:
        return {**out, "status": "not_checked", "reason": "Too few image features (blank or very simple page)."}
    knn = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(des, des, k=3)
    src, dst = [], []
    for m in knn:
        if len(m) < 3: continue
        a, b = m[1], m[2]                                   # m[0] is the keypoint matched with itself
        if a.distance < 0.6 * b.distance:
            p, q = kp[a.queryIdx].pt, kp[a.trainIdx].pt
            if np.hypot(p[0] - q[0], p[1] - q[1]) > min_shift_px: src.append(p); dst.append(q)
    res = {**out, "page": 1, "keypoints": len(kp), "candidate_pairs": len(src)}
    if len(src) < min_inliers:
        return {**res, "status": "pass", "message": "No repeated region found with the configured sensitivity. This does not prove the page is unaltered."}
    S, D = np.float32(src), np.float32(dst)
    M, inl = cv2.estimateAffinePartial2D(S, D, method=cv2.RANSAC, ransacReprojThreshold=3.0)
    n_in = int(inl.sum()) if inl is not None else 0
    if M is None or n_in < min_inliers:
        return {**res, "status": "pass", "inliers": n_in, "message": "Candidate matches did not agree on one geometric transform."}
    keep = inl.ravel().astype(bool); pts_a, pts_b = S[keep], D[keep]
    H0, W0 = gray.shape
    def _bb(P): return (P[:, 0].min(), P[:, 1].min(), P[:, 0].max(), P[:, 1].max())
    ba, bb = _bb(pts_a), _bb(pts_b)
    area = lambda b: max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    ix = max(0.0, min(ba[2], bb[2]) - max(ba[0], bb[0])) * max(0.0, min(ba[3], bb[3]) - max(ba[1], bb[1]))
    iou = ix / (area(ba) + area(bb) - ix + 1e-6)
    # Repeated letters and ruled lines match everywhere: they give small, scattered, mutually overlapping regions. Real duplicated
    # regions are compact blocks that do not overlap their copy.
    if min(area(ba), area(bb)) < 0.015 * W0 * H0 or iou > 0.2:
        return {**res, "status": "pass", "inliers": n_in, "message": "Only small or overlapping repeats were found (typical of repeated letters and ruled lines); no duplicated block detected."}
    overlay = rgb.copy()
    for (ax, ay), (bx, by) in zip(pts_a, pts_b):
        cv2.line(overlay, (int(ax), int(ay)), (int(bx), int(by)), (255, 140, 0), 1); cv2.circle(overlay, (int(ax), int(ay)), 3, (220, 0, 0), -1); cv2.circle(overlay, (int(bx), int(by)), 3, (0, 90, 220), -1)
    path_out = DERIVED_DIR / f"{doc_id}_copymove.png"; cv2.imwrite(str(path_out), cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR))
    H, W = gray.shape
    def box(P): return [round(float(P[:, 0].min()) / W, 4), round(float(P[:, 1].min()) / H, 4), round(float(P[:, 0].max()) / W, 4), round(float(P[:, 1].max()) / H, 4)]
    rot = float(np.degrees(np.arctan2(M[1, 0], M[0, 0]))); sc = float(np.hypot(M[0, 0], M[1, 0]))
    return {**res, "status": "needs_review", "inliers": n_in, "region_a": box(pts_a), "region_b": box(pts_b), "overlay_path": str(path_out),
            "transform": {"shift_px": [round(float(M[0, 2]), 1), round(float(M[1, 2]), 1)], "rotation_deg": round(rot, 2), "scale": round(sc, 3)},
            "message": f"{n_in} keypoints in one region repeat in another with a consistent geometric transform (possible copy-move). Red dots = source side, blue = repeat."}

# ------------------------------------------------------------------ faculty cross-check
TITLE = re.compile(r"^(dr|prof|professor|mr|mrs|ms|shri|smt|er|engr)\.?\s+", re.I)
UAN = re.compile(r"\b\d{12}\b"); PAN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")

def norm_person(name: str) -> str:
    n = TITLE.sub("", name.strip().lower()); n = re.sub(r"[^a-z\s]", " ", n)
    return " ".join(sorted(t for t in n.split() if len(t) > 1 or True))

def parse_roster(text: str) -> list:
    people = []
    for ln in text.splitlines():
        raw = ln.strip()
        if not raw: continue
        numbered = bool(re.match(r"^\s*\d+[\.\)]\s+", raw)); body = re.sub(r"^\s*\d+[\.\)]\s*", "", raw)
        mu, mp = UAN.search(body), PAN.search(body)
        uan, pan = (mu.group(0) if mu else None), (mp.group(0) if mp else None)
        name = re.split(r"\||,|\t|;| - ", body)[0].strip()
        if ":" in name or not re.fullmatch(r"[A-Za-z][A-Za-z.' ]{3,60}", name): continue
        if not (uan or pan or numbered or TITLE.match(name)): continue
        if len(TITLE.sub("", name).split()) < 2: continue
        people.append({"name": name, "norm": norm_person(name), "uan": uan, "pan": pan})
    return people

@router.get("/faculty-cross-check")
def faculty_cross_check(a: Actor = Depends(actor)):
    need(a, *OFFICER)
    cand = db.many("SELECT d.id, d.application_id, d.filename, d.path, d.mime, d.doc_type, ap.institution_name FROM documents d JOIN applications ap ON ap.id=d.application_id "
                   "WHERE d.superseded_by IS NULL AND d.path LIKE '%.pdf'")
    entries, rows = [], []
    for r in cand:
        pages, _ = docintel.read_pages(r["path"], r["mime"])
        # documents are classified when a case is evaluated; classify on the fly so the check also works right after upload
        kind = r["doc_type"] if r["doc_type"] not in (None, "", "unknown") else docintel.classify(pages, r["filename"])[0]
        if kind != "faculty_list": continue
        rows.append(r)
        for p in parse_roster("\n".join(pg["text"] for pg in pages)): entries.append({**p, "app": r["application_id"], "inst": r["institution_name"], "doc": r["id"], "file": r["filename"]})
    pairs = []
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            x, y = entries[i], entries[j]
            if x["app"] == y["app"]: continue
            same_id = [k for k in ("uan", "pan") if x[k] and x[k] == y[k]]
            conflict = any(x[k] and y[k] and x[k] != y[k] for k in ("uan", "pan"))
            ratio = difflib.SequenceMatcher(None, x["norm"], y["norm"]).ratio()
            if same_id: level, why = "strong", f"same {' and '.join(k.upper() for k in same_id)}"
            elif not conflict and ratio >= 0.9: level, why = "weak", ("identical name" if ratio == 1 else f"similar name ({ratio:.2f})") + ", no identifier to confirm"
            else: continue
            pairs.append({"level": level, "reason": why, "a": {"name": x["name"], "institution": x["inst"], "application_id": x["app"], "file": x["file"], "uan": mask(x["uan"]) if x["uan"] else None, "pan": mask(x["pan"]) if x["pan"] else None},
                          "b": {"name": y["name"], "institution": y["inst"], "application_id": y["app"], "file": y["file"], "uan": mask(y["uan"]) if y["uan"] else None, "pan": mask(y["pan"]) if y["pan"] else None}})
    pairs.sort(key=lambda p: p["level"] != "strong")
    audit.append("lab_faculty_cross_check", a.name, a.role, refs={"rosters": len(rows), "people": len(entries), "pairs": len(pairs)})
    return {"rosters": len(rows), "people": len(entries), "pairs": pairs,
            "limitations": DISCLAIMER + " Text-based only: no biometric or face data is used. A person may legitimately appear at two institutions (visiting or shared faculty); a name match alone is weak evidence."}

# ------------------------------------------------------------------ per-document endpoints
@router.post("/documents/{doc_id}/font-report")
def api_font(doc_id: str, a: Actor = Depends(actor)):
    need(a, *OFFICER); d = _doc(doc_id); r = font_report(d["path"])
    audit.append("lab_font_report", a.name, a.role, d["application_id"], doc_id, refs={"status": r.get("status"), "instances": len(r.get("instances", []))})
    return r

@router.post("/documents/{doc_id}/copy-move")
def api_copy_move(doc_id: str, a: Actor = Depends(actor)):
    need(a, *OFFICER); d = _doc(doc_id); r = copy_move_report(d["path"], doc_id)
    audit.append("lab_copy_move", a.name, a.role, d["application_id"], doc_id, refs={"status": r.get("status"), "inliers": r.get("inliers")})
    return r
