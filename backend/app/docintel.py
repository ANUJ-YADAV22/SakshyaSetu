"""Document intelligence: text/OCR, classification, schema-constrained field extraction.
Every extracted field keeps its page, bounding box and confidence. Raw values are never overwritten."""
import re, shutil
from pathlib import Path
from typing import Optional
import pymupdf

from .dates import parse_date, DATE_RE

try:  # OCR is optional; absence is reported as a processing status, never silently skipped
    import pytesseract
    from PIL import Image
    _OCR = shutil.which("tesseract") is not None
except Exception:  # pragma: no cover
    _OCR = False

OCR_AVAILABLE = _OCR

DOC_TYPES = [
    "fire_noc", "occupancy_certificate", "structural_stability_certificate", "land_document",
    "floor_plan", "affidavit", "audited_accounts", "registration_certificate", "trust_deed",
    "registrar_approval", "bank_proof", "faculty_list", "satellite_map_evidence", "evc_video",
    "photograph", "unknown",
]

KEYWORDS = {
    "fire_noc": ["fire no objection", "fire noc", "fire safety certificate", "fire department", "fire services"],
    "occupancy_certificate": ["occupancy certificate", "occupation certificate"],
    "structural_stability_certificate": ["structural stability", "structural safety", "structural engineer"],
    "land_document": ["sale deed", "lease deed", "land use", "khasra", "7/12", "title deed", "land document"],
    "floor_plan": ["floor plan", "building plan", "site plan", "sanctioned plan", "carpet area", "scale 1:"],
    "affidavit": ["affidavit", "solemnly affirm", "undertaking"],
    "audited_accounts": ["balance sheet", "audited", "chartered accountant", "statement of income"],
    "registration_certificate": ["certificate of registration", "registrar of societies", "registration certificate",
                                 "certificate of incorporation"],
    "trust_deed": ["trust deed", "deed of trust", "memorandum of association"],
    "registrar_approval": ["registrar approval", "approval of change", "change of name", "registrar of"],
    "bank_proof": ["bank certificate", "bank statement", "account holder", "ifsc"],
    "faculty_list": ["faculty list", "list of faculty", "faculty roster"],
    "satellite_map_evidence": ["satellite", "map view", "google maps"],
}

# label (regex) -> canonical field name. Order matters: first match wins per line.
LABELS = [
    ("certificate_number", r"(?:certificate|noc|ref(?:erence)?|licen[cs]e|approval)\s*(?:no\.?|number)"),
    ("issuer", r"(?:issued\s*by|issuing\s*authority|issuer)"),
    ("issue_date", r"(?:date\s*of\s*issue|issue\s*date|issued\s*on|dated)"),
    ("validity_end", r"(?:valid(?:ity)?\s*(?:up\s*to|upto|till|until|end(?:s)?|date)?|expiry\s*date|expires?\s*on|valid\s*to)"),
    ("institution_name", r"(?:name\s*of\s*(?:the\s*)?institution|institution(?:\s*name)?|college\s*name|name\s*of\s*(?:the\s*)?college)"),
    ("legal_entity_name", r"(?:name\s*of\s*(?:the\s*)?(?:trust|society|company)|trust\s*name|society\s*name)"),
    ("registration_number", r"(?:registration\s*(?:no\.?|number)|reg\.?\s*no\.?|cin|society\s*reg)"),
    ("address", r"(?:address|located\s*at|site\s*address)"),
    ("declared_area_sqm", r"(?:declared\s*(?:built[- ]?up\s*)?area|built[- ]?up\s*area|total\s*area)"),
    ("declared_intake", r"(?:intake|sanctioned\s*intake|proposed\s*intake)"),
    ("faculty_count", r"(?:total\s*faculty|faculty\s*count|no\.?\s*of\s*faculty)"),
    ("latitude", r"latitude"),
    ("longitude", r"longitude"),
    ("signatory", r"(?:signed\s*by|signatory|authori[sz]ed\s*signatory)"),
]
DATE_FIELDS = {"issue_date", "validity_end"}
CRITICAL_FIELDS = {"issue_date", "validity_end", "certificate_number", "registration_number", "institution_name"}

def normalize_name(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\b(the|of|and|pvt|private|ltd|limited|trust|society|institute|institution|college)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def normalize_id(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())

def normalize_field(name: str, raw: str) -> str:
    if name in DATE_FIELDS:
        p = parse_date(raw)
        return p.iso or raw
    if name in ("institution_name", "legal_entity_name"):
        return normalize_name(raw)
    if name in ("registration_number", "certificate_number"):
        return normalize_id(raw)
    if name in ("declared_area_sqm", "declared_intake", "faculty_count", "latitude", "longitude"):
        m = re.search(r"-?\d+(?:[.,]\d+)?", raw.replace(",", ""))
        return m.group(0) if m else raw
    return re.sub(r"\s+", " ", raw).strip()

def read_pages(path: str, mime: str):
    """Return (pages, processing_notes). pages: [{page, text, scanned, ocr_conf}]"""
    notes, pages = [], []
    if mime.startswith("image/"):
        txt, conf = "", None
        if OCR_AVAILABLE:
            d = pytesseract.image_to_data(Image.open(path), output_type=pytesseract.Output.DICT)
            words = [(w, int(c)) for w, c in zip(d["text"], d["conf"]) if w.strip() and str(c) != "-1"]
            txt = " ".join(w for w, _ in words)
            conf = (sum(c for _, c in words) / len(words) / 100) if words else 0.0
        else:
            notes.append({"code": "ocr_unavailable", "message": "OCR engine not installed; image text not extracted."})
        return [{"page": 1, "text": txt, "scanned": True, "ocr_conf": conf}], notes
    if not path.lower().endswith(".pdf"):
        return [], [{"code": "unsupported_type", "message": "No text extraction for this file type."}]
    try:
        doc = pymupdf.open(path)
    except Exception as e:
        return [], [{"code": "unreadable_file", "message": f"File could not be opened: {e}"}]
    for i, page in enumerate(doc, start=1):
        text = page.get_text("text") or ""
        scanned = len(text.strip()) < 20 and len(page.get_images()) > 0
        ocr_conf = None
        if scanned:
            if OCR_AVAILABLE:
                pix = page.get_pixmap(dpi=200)
                tmp = Path(path).with_suffix(f".p{i}.png")
                pix.save(str(tmp))
                d = pytesseract.image_to_data(Image.open(tmp), output_type=pytesseract.Output.DICT)
                tmp.unlink(missing_ok=True)
                words = [(w, int(c)) for w, c in zip(d["text"], d["conf"]) if w.strip() and str(c) != "-1"]
                text = " ".join(w for w, _ in words)
                ocr_conf = (sum(c for _, c in words) / len(words) / 100) if words else 0.0
            else:
                notes.append({"code": "ocr_unavailable", "page": i,
                              "message": f"Page {i} is scanned and OCR is not installed; text not extracted."})
        pages.append({"page": i, "text": text, "scanned": scanned, "ocr_conf": ocr_conf})
    if not pages:
        notes.append({"code": "empty_document", "message": "Document has no pages."})
    return pages, notes

def classify(pages, filename: str):
    text = " ".join(p["text"] for p in pages).lower() + " " + filename.lower().replace("_", " ")
    scores = {}
    for t, kws in KEYWORDS.items():
        hits = sum(1 for k in kws if k in text)
        if hits:
            scores[t] = hits
    if not scores:
        return "unknown", 0.0
    best = max(scores, key=scores.get)
    total = sum(scores.values())
    conf = round(min(0.99, 0.5 + 0.2 * scores[best]) * (scores[best] / total) ** 0.5, 2)
    return (best, conf) if conf >= 0.5 else ("unknown", conf)

def _locate(pdf_page, value: str):
    """Find bbox of the extracted value on the page; normalised [x0,y0,x1,y1] in 0..1."""
    try:
        rects = pdf_page.search_for(value[:80])
        if rects:
            r = rects[0]
            w, h = pdf_page.rect.width, pdf_page.rect.height
            return [round(r.x0 / w, 4), round(r.y0 / h, 4), round(r.x1 / w, 4), round(r.y1 / h, 4)]
    except Exception:
        pass
    return None

def extract_fields(path: str, pages) -> list:
    """Schema-constrained, label-driven extraction. Returns list of field dicts."""
    out, seen = [], set()
    pdf = pymupdf.open(path) if path.lower().endswith(".pdf") else None
    for p in pages:
        for line in p["text"].splitlines():
            line = line.strip()
            if not line or ":" not in line:
                continue
            parts = re.split(r"\s*[:]\s*", line, maxsplit=1)
            if len(parts) != 2 or not parts[1].strip():
                continue
            label_txt, value = parts[0].lower(), parts[1].strip()
            for name, pat in LABELS:
                if re.fullmatch(r".*?" + pat + r".*", label_txt) and name not in seen:
                    if name in DATE_FIELDS:
                        m = re.search(DATE_RE, value)
                        value_use = m.group(1) if m else value
                    else:
                        value_use = value
                    # "valid" label must not swallow issue/validity confusion
                    if name == "validity_end" and re.search(r"issue", label_txt):
                        continue
                    conf = 0.98 if not p["scanned"] else float(p["ocr_conf"] or 0.0)
                    bbox = _locate(pdf[p["page"] - 1], value_use) if pdf is not None and not p["scanned"] else None
                    out.append(dict(name=name, raw_value=value_use, normalized=normalize_field(name, value_use),
                                    confidence=round(conf, 3), page=p["page"], bbox=bbox,
                                    method="text_layer_label_regex" if not p["scanned"] else "ocr_label_regex"))
                    seen.add(name)
                    break
    return out
