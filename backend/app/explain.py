"""Plain-language explanations - 'rules decide, the LLM only explains'.

Default is a deterministic template (no network, no cost, no data leaves the server). If SAKSHYA_LLM=anthropic and
ANTHROPIC_API_KEY are set, a model may re-word the *already validated* finding. Guard rails:
  * input is limited to validated finding fields (never raw documents); identifiers are masked before sending
  * the verdict/status shown to the user always comes from the finding, never from model output
  * output that uses accusatory or decision language is discarded and the template is used instead
  * every call is reported with its provider so the UI can label it ('template' vs 'llm')"""
import os, re
from .config import LLM_PROVIDER, LLM_MODEL, LLM_TIMEOUT_S

FORBIDDEN = re.compile(r"\b(approve[ds]?|reject(?:ed|s|ion)?|fraud\w*|forg(?:ed|ery|eries)|fake|counterfeit|guilty|illegal|penali[sz]e\w*|cancel(?:led)?)\b", re.I)
SENSITIVE = re.compile(r"\b(\d{12}|[A-Z]{5}\d{4}[A-Z])\b")

STATUS_PHRASE = {
    "pass": "This check passed.",
    "deficiency": "This check found something that does not meet the rule. An officer will confirm it before anything is communicated.",
    "needs_review": "The system could not settle this automatically, so a reviewer will look at the original document.",
    "indicator": "This is a preliminary indicator for a reviewer to look at. It is not proof of anything.",
    "processing": "The file could not be fully read, so this item needs manual handling.",
    "not_checked": "This check has not been completed yet.",
}


def _where(f):
    ev = next((e for e in (f.get("evidence") or []) if e.get("filename") or e.get("checklist_item")), {})
    name = ev.get("filename") or ev.get("checklist_item") or "the dossier"
    return f"{name}, page {ev['page']}" if ev.get("page") else name


def template(f):
    parts = [STATUS_PHRASE.get(f["status"], ""), f["message"].rstrip(".") + "."]
    if f.get("aph_clause"):
        tail = " (clause still to be confirmed against the authorised handbook)" if not f.get("clause_confirmed") else ""
        parts.append(f"Rule basis: {f['aph_clause']}{tail}.")
    parts.append(f"Where to look: {_where(f)}.")
    if f.get("next_action") and f["status"] != "pass":
        parts.append(f"Next step: {f['next_action']}")
    return " ".join(p for p in parts if p)


def _mask(s):
    return SENSITIVE.sub(lambda m: "*" * (len(m.group(0)) - 4) + m.group(0)[-4:], s or "")


def _llm(f):
    """Returns re-worded text or None. Any failure returns None so the caller falls back to the template."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if LLM_PROVIDER != "anthropic" or not key:
        return None
    try:
        import httpx
        facts = (f"Result: {f['status']}\nTitle: {f['title']}\nFinding: {_mask(f['message'])}\n"
                 f"Rule: {f.get('rule_id')} {f.get('aph_clause') or ''}\nLocation: {_where(f)}\nNext step: {f.get('next_action')}")
        r = httpx.post("https://api.anthropic.com/v1/messages", timeout=LLM_TIMEOUT_S,
                       headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                       json={"model": LLM_MODEL, "max_tokens": 300,
                             "system": ("You explain one already-validated document-scrutiny finding to an applicant or officer in plain, "
                                        "calm English, in at most 4 sentences. Use only the facts given. Do not add facts, do not change the "
                                        "result, never say a document is fake, forged, approved or rejected, and say who decides next."),
                             "messages": [{"role": "user", "content": facts}]})
        r.raise_for_status()
        text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text").strip()
        if not text or len(text) > 900 or FORBIDDEN.search(text):
            return None
        return text
    except Exception:
        return None


def explain(f):
    text = _llm(f)
    if text:
        return {"text": text, "provider": "llm", "model": LLM_MODEL, "verdict_source": "rule engine",
                "note": "Wording by a language model from validated fields only; the result above is from the rule engine."}
    return {"text": template(f), "provider": "template", "model": None, "verdict_source": "rule engine",
            "note": "Deterministic template; no data left the server."}
