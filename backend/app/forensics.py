"""Integrity & forensics. Every output is a PRELIMINARY INDICATOR requiring human verification,
never proof of forgery or misconduct."""
import difflib, hashlib, io, re
from pathlib import Path
import numpy as np
import pymupdf
from PIL import Image, ImageChops, ImageEnhance
import imagehash

from . import db
from .config import DERIVED_DIR, NEAR_DUP_PHASH_DISTANCE, NEAR_DUP_TEXT_SIMILARITY, TOOL_VERSION
from .dates import parse_date, to_date

DISCLAIMER = "Preliminary indicator only - not proof of alteration or misconduct. Requires human verification."

def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def _pdf_date(s):
    m = re.match(r"D:(\d{4})(\d{2})?(\d{2})?", s or "")
    if not m:
        return None
    y, mo, d = m.group(1), m.group(2) or "01", m.group(3) or "01"
    try:
        return f"{y}-{mo}-{d}"
    except Exception:
        return None

# ------------------------------------------------------------------ metadata
def metadata_report(path: str) -> dict:
    out = {"available": False, "limitations": DISCLAIMER}
    if not path.lower().endswith(".pdf"):
        return out
    try:
        doc = pymupdf.open(path)
    except Exception as e:
        return {**out, "error": str(e)}
    md = doc.metadata or {}
    raw = Path(path).read_bytes()
    out.update(available=True, producer=md.get("producer"), creator=md.get("creator"), title=md.get("title"),
               creation_date_raw=md.get("creationDate"), mod_date_raw=md.get("modDate"),
               creation_date=_pdf_date(md.get("creationDate")), mod_date=_pdf_date(md.get("modDate")),
               page_count=doc.page_count, incremental_updates=max(0, raw.count(b"%%EOF") - 1),
               fonts=sorted({f[3] for p in doc for f in p.get_fonts()}))
    anomalies = []
    if out["incremental_updates"] > 0:
        anomalies.append(f"{out['incremental_updates']} incremental update(s) appended after the original save.")
    if out["creation_date"] and out["mod_date"] and out["mod_date"] > out["creation_date"]:
        anomalies.append(f"Modified ({out['mod_date']}) after creation ({out['creation_date']}).")
    if len(out["fonts"]) > 6:
        anomalies.append(f"{len(out['fonts'])} distinct embedded fonts (unusual for a single-source certificate).")
    out["anomalies"] = anomalies
    return out

def creation_vs_issue(meta: dict, issue_raw):
    """Metadata indicator only: PDF created before the issue date it states. Never a deficiency."""
    if not meta.get("creation_date") or not issue_raw:
        return None
    pd = parse_date(issue_raw)
    if not pd.parsed or pd.ambiguous:
        return None
    if meta["creation_date"] < pd.iso:
        return f"PDF creation date {meta['creation_date']} is earlier than the issue date {pd.iso} stated in the document."
    return None

# ------------------------------------------------------------------ signatures
def signature_report(path: str) -> dict:
    """Status vocabulary: valid / invalid / untrusted / not_present / unable_to_validate.
    A visible signature image is never taken as proof."""
    base = {"status": "not_present", "method": "pyhanko (if installed) + PDF signature-field detection",
            "signatures": [], "limitations": "No trust roots are configured in this prototype; chain trust is reported as 'untrusted'."}
    if not path.lower().endswith(".pdf"):
        return {**base, "status": "not_present", "note": "Not a PDF."}
    try:
        doc = pymupdf.open(path)
        has_sig = False
        for page in doc:
            for w in page.widgets() or []:
                if w.field_type_string == "Signature":
                    has_sig = True
        raw = Path(path).read_bytes()
        has_sig = has_sig or (b"/ByteRange" in raw and b"/Contents" in raw and b"/Sig" in raw)
    except Exception as e:
        return {**base, "status": "unable_to_validate", "error": str(e)}
    if not has_sig:
        return base
    try:
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.sign.validation import validate_pdf_signature
        sigs = []
        with open(path, "rb") as f:
            r = PdfFileReader(f)
            for emb in r.embedded_signatures:
                st = validate_pdf_signature(emb)
                sigs.append({"field": emb.field_name, "intact": bool(st.intact), "valid": bool(st.valid),
                             "trusted": bool(st.trusted), "signer": getattr(st.signing_cert, "subject", None) and
                             st.signing_cert.subject.human_friendly, "summary": st.summary()})
        if not sigs:
            return {**base, "status": "unable_to_validate", "note": "Signature marker found but no embedded signature parsed."}
        if any(not s["intact"] or not s["valid"] for s in sigs):
            status = "invalid"
        elif all(s["trusted"] for s in sigs):
            status = "valid"
        else:
            status = "untrusted"
        return {**base, "status": status, "signatures": sigs}
    except Exception as e:
        return {**base, "status": "unable_to_validate", "error": f"{type(e).__name__}: {e}",
                "note": "Signature present but could not be cryptographically validated here."}

# ------------------------------------------------------------------ duplicates
def page_phash(path: str, page_no=0):
    try:
        if path.lower().endswith(".pdf"):
            pix = pymupdf.open(path)[page_no].get_pixmap(dpi=60)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
        else:
            img = Image.open(path)
        return str(imagehash.phash(img.convert("L")))
    except Exception:
        return None

def text_sim(a: str, b: str) -> float:
    ta, tb = re.sub(r"\s+", " ", a.lower()).strip(), re.sub(r"\s+", " ", b.lower()).strip()
    if not ta or not tb:
        return 0.0
    return difflib.SequenceMatcher(None, ta[:4000], tb[:4000]).ratio()

def duplicate_report(doc: dict, text: str, peers: list, permitted_history: bool) -> dict:
    """peers: other documents. Near-duplicate needs strong evidence: text similarity alone >= threshold, OR matching
    page image AND substantial text overlap, OR matching image for image-only documents. Thresholds are visible."""
    exact, near = [], []
    my_ph = page_phash(doc["path"])
    for p in peers:
        if p["id"] == doc["id"] or p.get("group_id") == doc.get("group_id") or p.get("superseded_by"):
            continue
        same_case = p["application_id"] == doc["application_id"]
        if not same_case and not permitted_history:
            continue
        if same_case and doc["id"] < p["id"]:
            continue  # report each same-case pair once
        if p["sha256"] == doc["sha256"]:
            exact.append({"doc_id": p["id"], "application_id": p["application_id"], "filename": p["filename"],
                          "sha256": p["sha256"], "same_case": same_case})
            continue
        ph = page_phash(p["path"])
        dist = (imagehash.hex_to_hash(my_ph) - imagehash.hex_to_hash(ph)) if (my_ph and ph) else None
        ptext = (db.jl(p.get("meta"), {}) or {}).get("text_sample", "")
        has_text = bool(text.strip()) and bool(ptext.strip())
        ts = text_sim(text, ptext) if has_text else 0.0
        visual = dist is not None and dist <= NEAR_DUP_PHASH_DISTANCE
        both_images = (not doc["path"].lower().endswith(".pdf")) and (not p["path"].lower().endswith(".pdf"))
        hit = (ts >= NEAR_DUP_TEXT_SIMILARITY) or (visual and ts >= 0.75) or (visual and both_images)
        if hit:
            near.append({"doc_id": p["id"], "application_id": p["application_id"], "filename": p["filename"],
                         "phash_distance": None if dist is None else int(dist), "text_similarity": round(ts, 3), "same_case": same_case,
                         "method": "perceptual hash (page 1) + text similarity"})
    return {"exact": exact, "near": near, "thresholds": {"phash_max_distance": NEAR_DUP_PHASH_DISTANCE,
            "text_min_similarity": NEAR_DUP_TEXT_SIMILARITY, "mixed_text_min_similarity": 0.75},
            "scope": "history+case" if permitted_history else "case only",
            "limitations": "Legitimately similar documents (templates, certificates from one authority) can score high; officer confirms relevance."}

# ------------------------------------------------------------------ ELA (optional)
def ela_report(path: str, doc_id: str, quality=90, gamma=20.0) -> dict:
    """Error Level Analysis on the first rasterised page / image. Heuristic - high false-positive rate."""
    try:
        if path.lower().endswith(".pdf"):
            pix = pymupdf.open(path)[0].get_pixmap(dpi=110)
            img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        else:
            img = Image.open(path).convert("RGB")
    except Exception as e:
        return {"available": False, "error": str(e), "limitations": DISCLAIMER}
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    resaved = Image.open(buf)
    diff = ImageChops.difference(img, resaved)
    arr = np.asarray(diff).astype(np.float32).sum(axis=2)
    scale = 255.0 / max(1.0, float(arr.max()))
    ela_img = ImageEnhance.Brightness(diff).enhance(scale * gamma / 20.0)
    out_path = DERIVED_DIR / f"{doc_id}_ela.png"
    ela_img.save(out_path)
    h, w = arr.shape
    gh, gw = 8, 8
    cells = arr[: h // gh * gh, : w // gw * gw].reshape(gh, h // gh, gw, w // gw).mean(axis=(1, 3))
    z = (cells - cells.mean()) / (cells.std() + 1e-6)
    hot = np.argwhere(z > 2.5)
    regions = [{"row": int(r), "col": int(c), "bbox": [round(c / gw, 3), round(r / gh, 3), round((c + 1) / gw, 3), round((r + 1) / gh, 3)],
                "z": round(float(z[r, c]), 2)} for r, c in hot[:5]]
    return {"available": True, "method": f"ELA JPEG q={quality}", "overlay_path": str(out_path),
            "peak_error": round(float(arr.max()), 1), "mean_error": round(float(arr.mean()), 2),
            "candidate_regions": regions, "label": "potential anomaly indicator",
            "limitations": DISCLAIMER + " ELA is sensitive to text-heavy scans and prior compression."}
