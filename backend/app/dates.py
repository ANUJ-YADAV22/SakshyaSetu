"""Date normalisation. Raw value is always kept; ambiguity is surfaced, never guessed silently."""
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}

@dataclass
class ParsedDate:
    raw: str
    iso: Optional[str] = None          # primary interpretation (DD-MM when numeric)
    alt_iso: Optional[str] = None      # second interpretation if day/month ambiguous
    ambiguous: bool = False
    parsed: bool = False
    note: str = ""

    def candidates(self):
        return [d for d in (self.iso, self.alt_iso) if d]

def _mk(y, m, d) -> Optional[str]:
    try:
        return date(int(y), int(m), int(d)).isoformat()
    except ValueError:
        return None

def parse_date(raw: Optional[str]) -> ParsedDate:
    if raw is None or not str(raw).strip():
        return ParsedDate(raw=str(raw or ""), note="empty")
    s = str(raw).strip()
    # ISO yyyy-mm-dd
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        iso = _mk(m[1], m[2], m[3])
        return ParsedDate(s, iso, None, False, iso is not None, "" if iso else "invalid calendar date")
    # numeric dd/mm/yyyy or mm/dd/yyyy
    m = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", s)
    if m:
        a, b, y = int(m[1]), int(m[2]), int(m[3])
        if y < 100:
            y += 2000
        dmy = _mk(y, b, a)
        mdy = _mk(y, a, b)
        if dmy and mdy and dmy != mdy:
            return ParsedDate(s, dmy, mdy, True, True, "day/month order ambiguous")
        iso = dmy or mdy
        return ParsedDate(s, iso, None, False, iso is not None, "" if iso else "invalid calendar date")
    # 12 March 2024 / 12-Mar-2024 / March 12, 2024
    m = re.fullmatch(r"(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})\.?,?[\s\-]+(\d{4})", s)
    if m and m[2][:3].lower() in MONTHS:
        iso = _mk(m[3], MONTHS[m[2][:3].lower()], m[1])
        return ParsedDate(s, iso, None, False, iso is not None)
    m = re.fullmatch(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})", s)
    if m and m[1][:3].lower() in MONTHS:
        iso = _mk(m[3], MONTHS[m[1][:3].lower()], m[2])
        return ParsedDate(s, iso, None, False, iso is not None)
    return ParsedDate(s, note="unparseable format")

def to_date(iso: Optional[str]) -> Optional[date]:
    return date.fromisoformat(iso) if iso else None

DATE_RE = (r"(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|"
           r"\d{1,2}(?:st|nd|rd|th)?[\s\-]+[A-Za-z]{3,9}\.?,?[\s\-]+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})")
