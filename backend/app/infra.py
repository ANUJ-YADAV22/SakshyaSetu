"""Infrastructure assistance: geometry first, vision second. All results are ADVISORY and cannot reject an application.
Vision-model facility recognition and video continuity are NOT implemented here (reported honestly as 'designed')."""
import io, math, re
from datetime import date, datetime
import numpy as np
import pymupdf
from PIL import Image
from PIL.ExifTags import TAGS

from .config import DERIVED_DIR, AREA_TOLERANCE_PCT, GPS_TOLERANCE_KM, MIN_IMAGE_SIDE_PX, MIN_BLUR_VARIANCE
from . import forensics

PT_TO_M = 0.0003527778  # 1 PDF point in metres at 1:1

def shoelace(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def _poly_from_drawing(d):
    pts = []
    for it in d["items"]:
        if it[0] == "re":
            r = it[1]; return [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
        if it[0] == "l":
            if not pts: pts.append((it[1].x, it[1].y))
            pts.append((it[2].x, it[2].y))
    if len(pts) >= 4 and math.dist(pts[0], pts[-1]) < 1.0:
        return pts[:-1]
    return None

def analyze_floorplan(path: str, page_no: int = 1, calibration: dict | None = None, declared_area_sqm=None,
                      tolerance_pct=AREA_TOLERANCE_PCT, doc_id="doc", min_pt2=900.0) -> dict:
    """calibration: {"meters_per_pt": x} or {"pt_length": a, "real_length_m": b}. If absent, 'Scale 1:N' text is used
    (assumes the PDF is printed at its nominal page size - assumption is recorded)."""
    out = {"check": "floor_plan_area", "method": "vector geometry (PyMuPDF drawings) + shoelace formula", "units": "sq.m",
           "limitations": "Vector plans only; scanned/raster plans need manual polygon marking. Advisory; cannot reject an application.",
           "assumptions": []}
    try:
        doc = pymupdf.open(path); page = doc[page_no - 1]
    except Exception as e:
        return {**out, "status": "not_checked", "reason": f"Plan could not be opened: {e}"}
    text = page.get_text("text")
    scale, how = None, None
    if calibration and calibration.get("meters_per_pt"):
        scale, how = float(calibration["meters_per_pt"]), "reviewer calibration (metres per point)"
    elif calibration and calibration.get("pt_length") and calibration.get("real_length_m"):
        scale, how = float(calibration["real_length_m"]) / float(calibration["pt_length"]), "reviewer calibration (known length)"
    else:
        m = re.search(r"scale\s*(?:1\s*[:/]\s*|=\s*1\s*:\s*)(\d+)", text, re.I)
        if m:
            scale, how = int(m.group(1)) * PT_TO_M, f"printed scale 1:{m.group(1)}"
            out["assumptions"].append("Plan printed at nominal page size (no print scaling).")
    polys = []
    for d in page.get_drawings():
        poly = _poly_from_drawing(d)
        if poly:
            a = shoelace(poly)
            if a >= min_pt2 and a < page.rect.width * page.rect.height * 0.9:
                polys.append({"polygon": [(round(x, 1), round(y, 1)) for x, y in poly], "area_pt2": a})
    polys.sort(key=lambda p: -p["area_pt2"])
    if not polys:
        return {**out, "status": "needs_review", "reason": "No closed vector regions found; mark polygon manually.",
                "next_step": "Request reviewer polygon marking or a vector floor plan."}
    if scale is None:
        return {**out, "status": "needs_review", "reason": "calibration_required",
                "next_step": "Reviewer to calibrate scale using a known dimension.", "regions_found": len(polys)}
    for i, p in enumerate(polys):
        p["id"] = f"R{i+1}"; p["area_sqm"] = round(p["area_pt2"] * scale * scale, 2)
        xs, ys = [q[0] for q in p["polygon"]], [q[1] for q in p["polygon"]]
        p["bbox_norm"] = [round(min(xs) / page.rect.width, 4), round(min(ys) / page.rect.height, 4),
                          round(max(xs) / page.rect.width, 4), round(max(ys) / page.rect.height, 4)]
        lbl = [b[4].strip().replace("\n", " ") for b in page.get_text("blocks")
               if min(xs) <= b[0] <= max(xs) and min(ys) <= b[1] <= max(ys) and b[4].strip()]
        p["label"] = lbl[0][:60] if lbl else None
    boundary, rooms = polys[0], polys[1:]
    measured = round(sum(r["area_sqm"] for r in rooms), 2) if rooms else boundary["area_sqm"]
    basis = "sum of inner regions" if rooms else "single region"
    res = {**out, "scale_source": how, "scale_m_per_pt": scale, "boundary_sqm": boundary["area_sqm"], "regions": polys,
           "measured_sqm": measured, "measured_basis": basis, "declared_sqm": declared_area_sqm, "page": page_no,
           "formula": "area_m2 = shoelace(points_pt) x (metres_per_pt)^2"}
    # overlay
    ov = pymupdf.open(path); pg = ov[page_no - 1]
    for p in polys:
        pg.draw_polyline(p["polygon"] + [p["polygon"][0]], color=(0.85, 0.1, 0.1), width=1.2, fill=(1, 0.6, 0.0), fill_opacity=0.12)
    pix = pg.get_pixmap(dpi=100); op = DERIVED_DIR / f"{doc_id}_plan_overlay.png"; pix.save(str(op)); res["overlay_path"] = str(op)
    if declared_area_sqm is None:
        res.update(status="needs_review", reason="No declared area to compare with.", next_step="Obtain declared area.")
        return res
    dev = (measured - float(declared_area_sqm)) / float(declared_area_sqm) * 100.0
    res["deviation_pct"] = round(dev, 2); res["tolerance_pct"] = tolerance_pct
    if abs(dev) <= tolerance_pct:
        res.update(status="pass", reason="Measured area within configured tolerance of declared area.")
    else:
        res.update(status="needs_review", reason=f"Measured area differs from declared by {dev:+.1f}% (tolerance +/-{tolerance_pct}%).",
                   next_step="Request additional evidence or recommend physical inspection.")
    return res

def _dms(v, ref):
    d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
    return -d if ref in ("S", "W") else d

def read_exif(path: str) -> dict:
    try:
        img = Image.open(path); ex = img.getexif()
    except Exception:
        return {}
    out = {"width": img.width, "height": img.height}
    named = {TAGS.get(k, k): v for k, v in ex.items()}
    out["datetime"] = named.get("DateTimeOriginal") or named.get("DateTime")
    try:
        sub = ex.get_ifd(0x8769); out["datetime"] = sub.get(0x9003) or out["datetime"]
        g = ex.get_ifd(0x8825)
        if g and 2 in g and 4 in g:
            out["lat"], out["lon"] = _dms(g[2], g.get(1, "N")), _dms(g[4], g.get(3, "E"))
    except Exception:
        pass
    return out

def image_quality(path: str) -> dict:
    img = Image.open(path).convert("L"); a = np.asarray(img, dtype=np.float32)
    k = a[1:-1, 1:-1] * -4 + a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:]
    blur = float(k.var()); bright = float(a.mean())
    issues = []
    if min(img.size) < MIN_IMAGE_SIDE_PX: issues.append(f"low resolution ({img.width}x{img.height})")
    if blur < MIN_BLUR_VARIANCE: issues.append(f"blurry (Laplacian variance {blur:.0f})")
    if bright < 40 or bright > 220: issues.append(f"poor exposure (mean brightness {bright:.0f})")
    return {"width": img.width, "height": img.height, "blur_variance": round(blur, 1), "brightness": round(bright, 1),
            "usable": not issues, "issues": issues}

def check_location(path: str, declared: dict, tol_km=GPS_TOLERANCE_KM) -> dict:
    ex = read_exif(path)
    base = {"check": "location_vs_declared", "method": "EXIF GPS vs declared coordinates (haversine)", "units": "km",
            "limitations": "EXIF can be edited or stripped; indicator only."}
    if "lat" not in ex:
        return {**base, "status": "needs_review", "reason": "GPS metadata missing in evidence (reported as missing, not as mismatch).",
                "next_step": "Request geotagged evidence."}
    if not declared or declared.get("latitude") is None:
        return {**base, "status": "needs_review", "reason": "No declared coordinates to compare with."}
    dist = haversine_km(ex["lat"], ex["lon"], float(declared["latitude"]), float(declared["longitude"]))
    ok = dist <= tol_km
    return {**base, "status": "pass" if ok else "needs_review", "measured": {"lat": ex["lat"], "lon": ex["lon"]},
            "declared": declared, "distance_km": round(dist, 3), "tolerance_km": tol_km,
            "reason": "Within tolerance." if ok else f"Evidence location is {dist:.2f} km from declared site (tolerance {tol_km} km).",
            "next_step": "" if ok else "Recommend physical inspection or additional evidence."}

def check_capture_date(path: str, period: list | None) -> dict:
    ex = read_exif(path)
    base = {"check": "capture_date", "method": "EXIF timestamp vs application period", "limitations": "Metadata can be edited."}
    if not ex.get("datetime"):
        return {**base, "status": "needs_review", "reason": "Capture timestamp missing."}
    if not period:
        return {**base, "status": "not_checked", "reason": "No application period configured."}
    try:
        d = datetime.strptime(ex["datetime"][:10], "%Y:%m:%d").date()
    except Exception:
        return {**base, "status": "needs_review", "reason": f"Unparseable timestamp '{ex['datetime']}'."}
    lo, hi = date.fromisoformat(period[0]), date.fromisoformat(period[1])
    ok = lo <= d <= hi
    return {**base, "status": "pass" if ok else "needs_review", "measured": d.isoformat(), "period": period,
            "reason": "Within application period." if ok else f"Captured {d} outside application period {lo}..{hi}."}

def recommend(observations: list, missing_evidence: bool) -> dict:
    """Three-level advisory recommendation. A recommendation only - decision belongs to the competent authority."""
    inspect = [o for o in observations if o["status"] == "needs_review" and (
        o["check"] in ("floor_plan_area", "location_vs_declared") and "calibration" not in str(o.get("reason", ""))
        and "missing" not in str(o.get("reason", "")).lower() and "No declared" not in str(o.get("reason", ""))
        or o["check"] == "reused_images")]
    more = [o for o in observations if o["status"] in ("needs_review", "not_checked") and o not in inspect]
    if inspect:
        level, why = "physical_inspection_recommended", [o["reason"] for o in inspect]
    elif more or missing_evidence:
        level, why = "additional_evidence_needed", [o.get("reason", "") for o in more] or ["Evidence incomplete."]
    else:
        level, why = "evidence_adequate", ["No discrepancy found in evidence checked."]
    return {"level": level, "reasons": why, "advisory": True,
            "not_assessed": ["Facility presence in photographs (vision model: designed, not implemented)",
                             "Video key-frame / GPS-track continuity (designed, not implemented)"]}
