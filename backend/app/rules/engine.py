"""Deterministic rule engine. Rules are data (versioned JSON packs); this file holds only the
check implementations. No LLM is involved in any pass/deficiency decision."""
from __future__ import annotations
import difflib, math, re
from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Any, Optional

from ..config import LOW_CONFIDENCE_THRESHOLD, EXPIRY_WARNING_DAYS
from ..dates import parse_date, to_date
from ..docintel import normalize_name, normalize_id

STATUSES = ("pass", "deficiency", "needs_review", "not_checked")
_RANK = {"deficiency": 3, "needs_review": 2, "not_checked": 1, "pass": 0}

@dataclass
class FieldView:
    id: str; name: str; raw: str; normalized: str; confidence: float; page: int
    bbox: Optional[list]; doc_id: str; corrected: bool = False

@dataclass
class DocView:
    id: str; group_id: str; type: str; sha256: str; version: int; filename: str
    uploaded_date: Optional[str]; fields: dict = field(default_factory=dict)
    meta: dict = field(default_factory=dict)

@dataclass
class CaseContext:
    application: dict
    submission_date: date
    docs: list
    records: Optional[dict] = None          # institutional record from adapter (None = unavailable)
    record_provenance: str = "synthetic"
    manifest_hash: str = ""
    checklist: list = field(default_factory=list)

    def by_type(self, t):
        return [d for d in self.docs if d.type == t]

@dataclass
class RuleResult:
    rule_id: str
    status: str
    message: str
    evidence: list = field(default_factory=list)
    inputs: dict = field(default_factory=dict)
    outputs: dict = field(default_factory=dict)
    confidence: Optional[float] = None
    limitations: str = ""
    severity: str = "major"
    subject: str = ""                    # stable discriminator for finding identity (doc id, field, ...)
    review_reason: str = ""              # why needs_review (low_confidence | ambiguous_date | ...)
    gate: str = ""                       # human gate opened, if any
    depends_on_fields: list = field(default_factory=list)

# ------------------------------------------------------------------ helpers
def _ev_field(d: DocView, f: FieldView):
    return {"kind": "field", "doc_id": d.id, "sha256": d.sha256, "filename": d.filename, "page": f.page,
            "bbox": f.bbox, "field": f.name, "field_id": f.id, "value": f.raw, "confidence": f.confidence}

def _ev_doc(d: DocView):
    return {"kind": "document", "doc_id": d.id, "sha256": d.sha256, "filename": d.filename, "page": 1, "bbox": None}

def _ev_manifest(ctx: CaseContext, item: str):
    return {"kind": "dossier_manifest", "manifest_sha256": ctx.manifest_hash, "checklist_item": item,
            "page": None, "bbox": None}

def _low(f: FieldView):
    return (not f.corrected) and f.confidence < LOW_CONFIDENCE_THRESHOLD

def _worst(statuses):
    return max(statuses, key=lambda s: _RANK[s]) if statuses else "not_checked"

def _fmt(tpl: str, **kw):
    try:
        return tpl.format(**kw)
    except Exception:
        return tpl

# ------------------------------------------------------------------ checks
def chk_document_present(rule, p, ctx):
    t, label = p["doc_type"], p.get("label", p["doc_type"])
    docs = ctx.by_type(t)
    if docs:
        return [RuleResult(rule["rule_id"], "pass", f"{label} present.", [_ev_doc(docs[0])],
                           {"doc_type": t}, {"count": len(docs)}, 1.0, subject=t, severity="info")]
    return [RuleResult(rule["rule_id"], "deficiency", _fmt(rule["message_template"], label=label),
                       [_ev_manifest(ctx, label)], {"doc_type": t}, {"count": 0}, 1.0,
                       subject=t, severity=rule.get("severity", "major"))]

def chk_field_present(rule, p, ctx):
    t = p["doc_type"]; docs = ctx.by_type(t); out = []
    if not docs:
        return [RuleResult(rule["rule_id"], "not_checked", f"{t} not submitted; field checks skipped.",
                           [_ev_manifest(ctx, t)], {"doc_type": t}, subject=t, severity="info")]
    for d in docs:
        missing, low, evs = [], [], []
        for fn in p["fields"]:
            f = d.fields.get(fn)
            if f is None or not str(f.raw).strip():
                missing.append(fn)
            else:
                evs.append(_ev_field(d, f))
                if _low(f):
                    low.append(fn)
        if missing:
            out.append(RuleResult(rule["rule_id"], "deficiency",
                                  _fmt(rule["message_template"], label=d.filename, missing=", ".join(missing)),
                                  evs or [_ev_doc(d)], {"doc_type": t, "required": p["fields"]},
                                  {"missing": missing}, 0.9, subject=d.id, severity=rule.get("severity", "major"),
                                  depends_on_fields=list(p["fields"])))
        elif low:
            out.append(RuleResult(rule["rule_id"], "needs_review", f"Low-confidence extraction for: {', '.join(low)}.",
                                  evs, {"doc_type": t}, {"low_confidence": low}, min(f.confidence for f in
                                  [d.fields[x] for x in low]), subject=d.id, review_reason="low_confidence",
                                  gate="ambiguous_extraction", severity="info", depends_on_fields=list(p["fields"])))
        else:
            out.append(RuleResult(rule["rule_id"], "pass", "All required fields present.", evs,
                                  {"doc_type": t}, {}, min(f.confidence for f in
                                  [d.fields[x] for x in p["fields"]]), subject=d.id, severity="info"))
    return out

def _classify_validity(valid_iso, sub: date, warn: int):
    v = to_date(valid_iso)
    if v < sub:
        return "expired"
    if (v - sub).days <= warn:
        return "nearing"
    return "valid"

def chk_validity(rule, p, ctx):
    t, warn = p["doc_type"], p.get("warn_days", EXPIRY_WARNING_DAYS)
    docs = ctx.by_type(t); out = []
    if not docs:
        return [RuleResult(rule["rule_id"], "not_checked", f"{t} not submitted; validity not checked.",
                           [_ev_manifest(ctx, t)], {"doc_type": t}, subject=t, severity="info")]
    for d in docs:
        f = d.fields.get("validity_end")
        if f is None:
            out.append(RuleResult(rule["rule_id"], "not_checked", "Validity end date not found in document.",
                                  [_ev_doc(d)], {"doc_type": t}, subject=d.id, severity="info"))
            continue
        pd = parse_date(f.raw if not f.corrected else f.normalized)
        inputs = {"validity_end_raw": f.raw, "submission_date": ctx.submission_date.isoformat(), "warn_days": warn}
        if not pd.parsed:
            out.append(RuleResult(rule["rule_id"], "needs_review", "Validity date could not be parsed.",
                                  [_ev_field(d, f)], inputs, {}, f.confidence, subject=d.id, review_reason="unparseable_date",
                                  gate="ambiguous_extraction", severity="info", depends_on_fields=["validity_end"]))
            continue
        if _low(f):
            out.append(RuleResult(rule["rule_id"], "needs_review", "Validity date read with low confidence; confirm on page.",
                                  [_ev_field(d, f)], inputs, {"value": pd.iso}, f.confidence, subject=d.id,
                                  review_reason="low_confidence", gate="ambiguous_extraction", severity="info",
                                  depends_on_fields=["validity_end"]))
            continue
        outcomes = {_classify_validity(c, ctx.submission_date, warn) for c in pd.candidates()}
        if len(outcomes) > 1:
            out.append(RuleResult(rule["rule_id"], "needs_review",
                                  f"Date '{f.raw}' is day/month ambiguous and the two readings give different validity outcomes.",
                                  [_ev_field(d, f)], inputs, {"readings": pd.candidates()}, f.confidence, subject=d.id,
                                  review_reason="ambiguous_date", gate="ambiguous_extraction", severity="info",
                                  depends_on_fields=["validity_end"]))
            continue
        o = outcomes.pop(); inputs["parsed"] = pd.iso
        if o == "expired":
            out.append(RuleResult(rule["rule_id"], "deficiency",
                                  _fmt(rule["message_template"], label=p.get("label", t), date=pd.iso,
                                       submission=ctx.submission_date.isoformat()),
                                  [_ev_field(d, f)], inputs, {"state": "expired"}, f.confidence, subject=d.id,
                                  severity=rule.get("severity", "major"), depends_on_fields=["validity_end"]))
        elif o == "nearing":
            out.append(RuleResult(rule["rule_id"], "needs_review",
                                  f"{p.get('label', t)} valid until {pd.iso}, within the {warn}-day warning window.",
                                  [_ev_field(d, f)], inputs, {"state": "nearing_expiry"}, f.confidence, subject=d.id,
                                  review_reason="nearing_expiry", severity="info", depends_on_fields=["validity_end"]))
        else:
            out.append(RuleResult(rule["rule_id"], "pass", f"Valid until {pd.iso}.", [_ev_field(d, f)], inputs,
                                  {"state": "valid"}, f.confidence, subject=d.id, severity="info",
                                  depends_on_fields=["validity_end"]))
    return out

def _date_problems(i_iso, v_iso, uploaded, dtype, must_predate, sub):
    """Return list of (kind, message) for one concrete reading of the dates."""
    probs = []
    if i_iso and v_iso and to_date(i_iso) > to_date(v_iso):
        probs.append(("issue_after_validity", f"Issue date {i_iso} is after validity end {v_iso}."))
    if i_iso and uploaded and to_date(i_iso) > uploaded:
        probs.append(("issue_in_future", f"Issue date {i_iso} is in the future relative to upload date {uploaded}."))
    if i_iso and dtype in must_predate and to_date(i_iso) > sub:
        probs.append(("postdates_application", f"{dtype} must predate the application but is dated {i_iso}."))
    return probs

def chk_date_irregularities(rule, p, ctx):
    """Run on every dated document. Raw values kept. Day/month ambiguity is resolved ONLY when every reading gives the
    same outcome (ambiguity_mode='outcome_sensitive', default); otherwise - or in 'strict' mode - it goes to needs_review."""
    out, strict = [], p.get("ambiguity_mode", "outcome_sensitive") == "strict"
    must_predate = set(p.get("must_predate_application", []))
    for d in ctx.docs:
        fi, fv = d.fields.get("issue_date"), d.fields.get("validity_end")
        if not fi and not fv:
            continue
        evs, review = [], []
        pi = parse_date(fi.raw) if fi else None
        pv = parse_date(fv.raw) if fv else None
        for f, pdte, nm in ((fi, pi, "issue"), (fv, pv, "validity end")):
            if f is None:
                continue
            evs.append(_ev_field(d, f))
            if not pdte.parsed:
                review.append(f"{nm} date '{f.raw}' cannot be parsed")
            elif strict and pdte.ambiguous and not f.corrected:
                review.append(f"{nm} date '{f.raw}' is day/month ambiguous")
            if _low(f):
                review.append(f"{nm} date read with low confidence")
        inputs = {"issue_raw": fi.raw if fi else None, "validity_raw": fv.raw if fv else None}
        if review:
            out.append(RuleResult(rule["rule_id"], "needs_review", "; ".join(review) + ".", evs, inputs, {"reasons": review}, 0.5,
                                  subject=d.id, review_reason="ambiguous_date", gate="ambiguous_extraction", severity="info",
                                  depends_on_fields=["issue_date", "validity_end"]))
            continue
        uploaded = to_date(d.uploaded_date[:10]) if d.uploaded_date else None
        readings = [(i, v) for i in (pi.candidates() if pi else [None]) for v in (pv.candidates() if pv else [None])]
        outcomes = [_date_problems(i, v, uploaded, d.type, must_predate, ctx.submission_date) for i, v in readings]
        kinds = {frozenset(k for k, _ in o) for o in outcomes}
        if len(kinds) > 1:
            out.append(RuleResult(rule["rule_id"], "needs_review",
                                  f"Dates '{inputs['issue_raw']}' / '{inputs['validity_raw']}' are day/month ambiguous and the readings give different outcomes.",
                                  evs, inputs, {"readings": [list(r) for r in readings]}, 0.5, subject=d.id,
                                  review_reason="ambiguous_date", gate="ambiguous_extraction", severity="info",
                                  depends_on_fields=["issue_date", "validity_end"]))
        elif outcomes[0]:
            msgs = [m for _, m in outcomes[0]]
            out.append(RuleResult(rule["rule_id"], "deficiency", " ".join(msgs), evs, inputs, {"problems": msgs}, 0.95,
                                  subject=d.id, severity=rule.get("severity", "major"), depends_on_fields=["issue_date", "validity_end"]))
        else:
            out.append(RuleResult(rule["rule_id"], "pass", "No date irregularity found.", evs, inputs, {}, 0.95,
                                  subject=d.id, severity="info", depends_on_fields=["issue_date", "validity_end"]))
    if not out:
        out.append(RuleResult(rule["rule_id"], "not_checked", "No dated documents available.", [], subject="all", severity="info"))
    return out

def chk_date_order(rule, p, ctx):
    (et, ef), (lt, lf) = p["earlier"].split("."), p["later"].split(".")
    e_docs, l_docs = ctx.by_type(et), ctx.by_type(lt)
    if not e_docs or not l_docs:
        return [RuleResult(rule["rule_id"], "not_checked", "One of the documents in the date-order check is absent.",
                           [_ev_manifest(ctx, f"{et}/{lt}")], subject=f"{et}>{lt}", severity="info")]
    e, l = e_docs[0], l_docs[0]
    fe, fl = e.fields.get(ef), l.fields.get(lf)
    if not fe or not fl:
        return [RuleResult(rule["rule_id"], "not_checked", "Date field missing for order check.",
                           [_ev_doc(e), _ev_doc(l)], subject=f"{et}>{lt}", severity="info")]
    pe, pl = parse_date(fe.raw), parse_date(fl.raw)
    evs = [_ev_field(e, fe), _ev_field(l, fl)]
    if not (pe.parsed and pl.parsed) or pe.ambiguous or pl.ambiguous or _low(fe) or _low(fl):
        return [RuleResult(rule["rule_id"], "needs_review", "Dates in order check are ambiguous, unparseable or low-confidence.",
                           evs, {"earlier": fe.raw, "later": fl.raw}, {}, 0.5, subject=f"{et}>{lt}",
                           review_reason="ambiguous_date", gate="ambiguous_extraction", severity="info",
                           depends_on_fields=[ef, lf])]
    ok = to_date(pe.iso) <= to_date(pl.iso)
    msg = _fmt(rule["message_template"], earlier=p.get("earlier_label", p["earlier"]),
               later=p.get("later_label", p["later"]), d1=pe.iso, d2=pl.iso)
    return [RuleResult(rule["rule_id"], "pass" if ok else "deficiency", "Date order satisfied." if ok else msg, evs,
                       {"earlier": pe.iso, "later": pl.iso}, {"ordered": ok}, 0.95, subject=f"{et}>{lt}",
                       severity="info" if ok else rule.get("severity", "major"), depends_on_fields=[ef, lf])]

def _name_match(a, b):
    na, nb = normalize_name(a), normalize_name(b)
    if na == nb:
        return 1.0
    return difflib.SequenceMatcher(None, na, nb).ratio()

def chk_cross_doc_match(rule, p, ctx):
    fn, kind = p["field"], p.get("kind", "name")
    vals = [(d, d.fields[fn]) for d in ctx.docs if fn in d.fields and (not p.get("doc_types") or d.type in p["doc_types"])]
    if len(vals) < 2:
        return [RuleResult(rule["rule_id"], "not_checked", f"Fewer than two documents carry '{fn}'; no comparison possible.",
                           [_ev_field(d, f) for d, f in vals] or [_ev_manifest(ctx, fn)], {"field": fn},
                           subject=fn, severity="info")]
    ref_d, ref_f = vals[0]; evs = [_ev_field(ref_d, ref_f)]; worst, notes, mism = "pass", [], []
    for d, f in vals[1:]:
        evs.append(_ev_field(d, f))
        if _low(f) or _low(ref_f):
            worst = "needs_review" if worst != "deficiency" else worst
            notes.append("low-confidence value")
            continue
        sim = _name_match(ref_f.raw, f.raw) if kind == "name" else (1.0 if normalize_id(ref_f.raw) == normalize_id(f.raw) else 0.0)
        if sim >= 0.92:
            continue
        if kind == "name" and sim >= 0.70:
            worst = "needs_review" if worst != "deficiency" else worst
            notes.append(f"'{ref_f.raw}' ({ref_d.type}) vs '{f.raw}' ({d.type}) similar but not identical ({sim:.2f})")
        else:
            worst = "deficiency"
            mism.append(f"'{ref_f.raw}' in {ref_d.type} vs '{f.raw}' in {d.type}")
    inputs = {"field": fn, "values": [{"doc": d.type, "value": f.raw} for d, f in vals]}
    if worst == "deficiency":
        return [RuleResult(rule["rule_id"], "deficiency", _fmt(rule["message_template"], label=p.get("label", fn),
                           detail="; ".join(mism)), evs, inputs, {"mismatches": mism}, 0.9, subject=fn,
                           severity=rule.get("severity", "major"), depends_on_fields=[fn])]
    if worst == "needs_review":
        return [RuleResult(rule["rule_id"], "needs_review", "; ".join(notes) or "Values need confirmation.", evs, inputs,
                           {"notes": notes}, 0.6, subject=fn, review_reason="near_match_or_low_confidence",
                           gate="ambiguous_extraction", severity="info", depends_on_fields=[fn])]
    return [RuleResult(rule["rule_id"], "pass", f"'{fn}' consistent across {len(vals)} documents.", evs, inputs, {}, 0.95,
                       subject=fn, severity="info", depends_on_fields=[fn])]

def chk_record_match(rule, p, ctx):
    fn, rk = p["field"], p["record_key"]
    if ctx.records is None:
        return [RuleResult(rule["rule_id"], "not_checked",
                           "Institutional record source unavailable; check not completed (never treated as a pass).",
                           [_ev_manifest(ctx, "institutional record")], {"field": fn}, {"source_status": "source_unavailable"},
                           subject=fn, severity="info", limitations="Source unavailable.")]
    rec = ctx.records.get(rk)
    vals = [(d, d.fields[fn]) for d in ctx.docs if fn in d.fields]
    if rec is None or not vals:
        return [RuleResult(rule["rule_id"], "not_checked", f"No '{rk}' record or no submitted '{fn}' value.",
                           [_ev_manifest(ctx, fn)], {"field": fn}, subject=fn, severity="info")]
    d, f = vals[0]
    if _low(f):
        return [RuleResult(rule["rule_id"], "needs_review", "Submitted value read with low confidence.",
                           [_ev_field(d, f)], {"field": fn}, {}, f.confidence, subject=fn, review_reason="low_confidence",
                           gate="ambiguous_extraction", severity="info", depends_on_fields=[fn])]
    same = (_name_match(f.raw, str(rec)) >= 0.92) if p.get("kind", "name") == "name" else normalize_id(f.raw) == normalize_id(str(rec))
    inputs = {"submitted": f.raw, "record": rec, "provenance": ctx.record_provenance}
    if same:
        return [RuleResult(rule["rule_id"], "pass", f"'{fn}' matches institutional record.", [_ev_field(d, f)], inputs, {},
                           0.95, subject=fn, severity="info", depends_on_fields=[fn])]
    return [RuleResult(rule["rule_id"], "deficiency", _fmt(rule["message_template"], label=p.get("label", fn),
                       submitted=f.raw, record=rec), [_ev_field(d, f)], inputs, {"mismatch": True}, 0.9, subject=fn,
                       severity=rule.get("severity", "major"), depends_on_fields=[fn],
                       limitations=f"Record provenance: {ctx.record_provenance}.")]

def chk_declared_vs_record(rule, p, ctx):
    """Declared application value compared with an institutional record value (e.g. proposed vs approved intake)."""
    dk, rk, op = p["declared_key"], p["record_key"], p.get("op", "gt_flags")
    declared = (ctx.application.get("declared") or {}).get(dk)
    if ctx.records is None or declared is None or ctx.records.get(rk) is None:
        return [RuleResult(rule["rule_id"], "not_checked", "Declared value or record unavailable.",
                           [_ev_manifest(ctx, dk)], {"declared_key": dk}, subject=dk, severity="info")]
    rec = ctx.records[rk]
    inputs = {"declared": declared, "record": rec, "provenance": ctx.record_provenance}
    if op == "flag_true":
        if rec:
            return [RuleResult(rule["rule_id"], "needs_review", _fmt(rule["message_template"], label=p.get("label", rk)),
                               [_ev_manifest(ctx, rk)], inputs, {}, 0.9, subject=rk, review_reason="record_flag",
                               severity="major", limitations=f"Record provenance: {ctx.record_provenance}.")]
        return [RuleResult(rule["rule_id"], "pass", "No flag in record.", [_ev_manifest(ctx, rk)], inputs, {}, 0.9,
                           subject=rk, severity="info")]
    inc = float(declared) - float(rec)
    return [RuleResult(rule["rule_id"], "pass", f"Declared {declared} vs approved {rec} (change {inc:+g}); recorded for reviewer.",
                       [_ev_manifest(ctx, dk)], inputs, {"change": inc}, 0.95, subject=dk, severity="info",
                       limitations=f"Record provenance: {ctx.record_provenance}.")]

def chk_ratio_max(rule, p, ctx):
    d = ctx.application.get("declared") or {}
    st, fc = d.get(p["students_key"]), d.get(p["faculty_key"])
    if st is None or fc is None or float(fc) == 0:
        return [RuleResult(rule["rule_id"], "not_checked", "Declared students/faculty missing.", [_ev_manifest(ctx, "ratio")],
                           subject="ratio", severity="info")]
    ratio = float(st) / float(fc)
    ok = ratio <= float(p["max_ratio"])
    return [RuleResult(rule["rule_id"], "pass" if ok else "deficiency",
                       f"Students per faculty = {ratio:.2f} (configured maximum {p['max_ratio']})." if ok else
                       _fmt(rule["message_template"], ratio=f"{ratio:.2f}", max=p["max_ratio"]),
                       [_ev_manifest(ctx, "declared ratio")], {"students": st, "faculty": fc, "max": p["max_ratio"]},
                       {"ratio": round(ratio, 3)}, 0.95, subject="ratio", severity="info" if ok else rule.get("severity", "major"),
                       limitations="Threshold comes from the rule pack; confirm against current APH." if not p.get("parameters_verified") else "")]

def _num(v):
    m = re.search(r"\d+(?:\.\d+)?", str(v).replace(",", "")) if v is not None else None
    return float(m.group(0)) if m else None

def chk_faculty_required(rule, p, ctx):
    """Listed faculty >= ceil(proposed intake x programme years / students-per-faculty). Parameters live in the rule pack
    (draft until a regulatory expert confirms them against the Handbook); the engine only does the arithmetic."""
    d = ctx.application.get("declared") or {}
    intake, listed, evs = _num(d.get(p.get("intake_key", "proposed_intake"))), _num(d.get(p.get("faculty_key", "faculty_count"))), []
    low = False
    if intake is None:                                   # fall back to what the affidavit says
        for dd in ctx.by_type("affidavit"):
            f = dd.fields.get("declared_intake")
            if f: intake = _num(f.normalized or f.raw); evs.append(_ev_field(dd, f)); low = low or _low(f); break
    if listed is None:                                   # fall back to the faculty list's stated total
        for dd in ctx.by_type("faculty_list"):
            f = dd.fields.get("faculty_count")
            if f: listed = _num(f.normalized or f.raw); evs.append(_ev_field(dd, f)); low = low or _low(f); break
    if intake is None or listed is None:
        return [RuleResult(rule["rule_id"], "not_checked", "Proposed intake or listed faculty is missing; requirement not computed.",
                           evs or [_ev_manifest(ctx, "faculty requirement")], subject="faculty_required", severity="info")]
    years, ratio = float(p["program_years"]), float(p["faculty_ratio"])
    need = math.ceil(intake * years / ratio)
    inputs = {"proposed_intake": intake, "program_years": years, "students_per_faculty": ratio, "listed_faculty": listed}
    lim = "Programme years and ratio come from the rule pack; confirm against the current APH." if not p.get("parameters_verified") else ""
    if low:
        return [RuleResult(rule["rule_id"], "needs_review", f"Low-confidence extraction of the figures behind the faculty requirement (needs {need}, listed {listed:g}).",
                           evs, inputs, {"required": need}, 0.6, subject="faculty_required", review_reason="low_confidence", gate="ambiguous_extraction", severity="info", limitations=lim)]
    ok = listed >= need
    msg = (f"Listed faculty {listed:g} meets the computed requirement of {need} (= ceil({intake:g} x {years:g} / {ratio:g})).") if ok else \
          _fmt(rule["message_template"], listed=f"{listed:g}", need=need, intake=f"{intake:g}", years=f"{years:g}", ratio=f"{ratio:g}", short=f"{need - listed:g}")
    return [RuleResult(rule["rule_id"], "pass" if ok else "deficiency", msg, evs or [_ev_manifest(ctx, "faculty requirement")], inputs,
                       {"required": need, "shortfall": max(0, need - listed)}, 0.9, subject="faculty_required", severity="info" if ok else rule.get("severity", "major"), limitations=lim)]

CHECKS = {
    "document_present": chk_document_present, "field_present": chk_field_present, "validity": chk_validity,
    "date_irregularities": chk_date_irregularities, "date_order": chk_date_order, "cross_doc_match": chk_cross_doc_match,
    "record_match": chk_record_match, "declared_vs_record": chk_declared_vs_record, "ratio_max": chk_ratio_max,
    "faculty_required": chk_faculty_required,
}

# ------------------------------------------------------------------ engine
def rule_applies(rule, category, submission: date, pack):
    scope = rule.get("applies_to", pack.get("scope", "*"))
    scopes = scope if isinstance(scope, list) else [scope]
    if "*" not in scopes and category not in scopes:
        return False
    eff = pack.get("effective_date")
    return not eff or date.fromisoformat(eff) <= submission

def rule_input_doc_types(rule) -> set:
    p, s = rule["check"].get("params", {}), set()
    for k in ("doc_type",):
        if k in p: s.add(p[k])
    for k in ("doc_types",):
        s.update(p.get(k, []))
    for k in ("earlier", "later"):
        if k in p: s.add(p[k].split(".")[0])
    return s

def evaluate(packs: list, ctx: CaseContext, only_rule_ids: Optional[set] = None, include_draft=False):
    """Returns (results, skipped). skipped lists draft/inapplicable rules honestly as not_checked."""
    results, skipped = [], []
    cat = ctx.application["category"]
    for pack in packs:
        for rule in pack["rules"]:
            if only_rule_ids is not None and rule["rule_id"] not in only_rule_ids:
                continue
            if rule.get("approval") != "approved" and not include_draft:
                skipped.append({"rule_id": rule["rule_id"], "reason": f"rule approval state is '{rule.get('approval')}'",
                                "pack": pack["id"]})
                continue
            if not rule_applies(rule, cat, ctx.submission_date, pack):
                continue
            fn = CHECKS.get(rule["check"]["type"])
            try:
                rs = fn(rule, rule["check"].get("params", {}), ctx)
            except Exception as e:  # a crash is never a pass
                rs = [RuleResult(rule["rule_id"], "not_checked", f"Rule execution failed: {type(e).__name__}: {e}",
                                 [_ev_manifest(ctx, "rule execution")], subject="error", severity="info",
                                 limitations="Execution error; not treated as pass.")]
            for r in rs:
                r._meta = {"clause": rule.get("clause"), "clause_confirmed": rule.get("clause_confirmed", False),
                           "title": rule.get("title"), "family": rule.get("family"), "pack_id": pack["id"],
                           "pack_version": pack["version"], "tier": rule.get("tier", "A"), "queue": rule.get("queue")}
            results.extend(rs)
    return results, skipped

# ------------------------------------------------------------------ pack tests
def build_test_ctx(spec: dict, category: str) -> CaseContext:
    docs = []
    for i, dd in enumerate(spec.get("docs", [])):
        d = DocView(id=f"T-D{i}", group_id=f"T-G{i}", type=dd["type"], sha256="0" * 64, version=1,
                    filename=dd.get("filename", f"{dd['type']}.pdf"), uploaded_date=dd.get("uploaded_date", spec["submission_date"]))
        for fn, raw in dd.get("fields", {}).items():
            d.fields[fn] = FieldView(f"T-F{i}-{fn}", fn, str(raw), str(raw), dd.get("confidence", 0.98), 1, None, d.id)
        docs.append(d)
    app = {"id": "T-APP", "category": spec.get("category", category), "declared": spec.get("declared", {})}
    return CaseContext(app, date.fromisoformat(spec["submission_date"]), docs, spec.get("records"), "synthetic", "0" * 64)

def run_pack_tests(pack: dict) -> dict:
    out, passed = [], 0
    for rule in pack["rules"]:
        for t in rule.get("tests", []):
            probe = {**rule, "approval": "approved"}
            sub = {"id": pack["id"], "rules": [probe], "version": pack["version"], "scope": "*"}
            ctx = build_test_ctx(t["ctx"], t["ctx"].get("category", "eoa_self_disclosure"))
            res, _ = evaluate([sub], ctx)
            got = _worst([r.status for r in res])
            ok = got == t["expect"]
            passed += ok
            out.append({"rule_id": rule["rule_id"], "test": t["name"], "expected": t["expect"], "got": got, "ok": ok})
    return {"total": len(out), "passed": passed, "failed": len(out) - passed, "results": out}
