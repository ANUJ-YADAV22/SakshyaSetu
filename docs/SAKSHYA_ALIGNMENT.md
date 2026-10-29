# Deck-to-code alignment (SIH26261, team EvidenceX)

| Deck claim | Where it lives | Status |
|---|---|---|
| Handbook as versioned, configurable rule packs; a handbook change is a rule change, not a code change | `backend/app/rules/packs/*.json`, `rulepacks.py`, maker-checker activation on `/rulebook` | Implemented |
| Pre-submission check: what is missing, expired or inconsistent, rule, evidence location, how to fix | `POST /applications/{id}/presubmission-check`; finding list shows "How to fix" for applicants | Implemented |
| Supervisor + specialist agents; OCR, fields with confidence; compliance, integrity and floor-plan checks in parallel | `supervisor.py`, `docintel.py`, `rules/engine.py`, `forensics.py`, `infra.py` | Implemented (OCR needs Tesseract) |
| Source verification; unreachable source goes to manual review, never shown as verified | `source_checker.py`; Proof Cards only say Verified when the source said verified | Implemented; issuer adapters are mocked/designed and labelled |
| Officer workbench: each finding opens at exact page and region | `app/applications/[id]` (marker highlight on the original) | Implemented |
| System never approves, rejects or accuses; authority decides | Decision endpoint is authority-only with mandatory rationale; explanation guard rejects accusatory wording | Implemented |
| Tamper-evident (hash-chained) audit trail | `audit.py`, `/audit-trail` | Implemented |
| Document-wise Proof Cards and overall status (Verified / Needs review / Mismatch / Pending, Partially compliant) | `proofcards.py`, `components/ProofCards.tsx` | **Added in 1.1** |
| LLM explains only; verdicts stay in code | `explain.py` (template default, optional model, output guard, provider always shown) | **Added in 1.1** |
| Downloadable report | `/applications/{id}/report` (print or save as PDF) + JSON export | **Added in 1.1** |
| Knowledge Agent (signature, SHA-256, perceptual hash, metadata) | `forensics.py` (name in deck only) | Implemented under a different name |
| Digital-signature / QR / government-portal verification | Signature validation implemented (no trust roots configured); QR and portals designed | Partly designed |
| Satellite map check, vision-model facility recognition | Designed, not implemented | Not built |

## Things in the deck to correct before submission
1. Slide 3 shows a "Verified" Affidavit 8 with source "Manual review required". The product now prevents that state. Re-shoot the screenshot from the new UI.
2. "Our Prototype" slide is empty. Use the Case desk, a proof-card row, and the original-page highlight.
3. The deck says "Satellite Map" and "Digital Signature Verification (Crypto-library)" in the data flow. Mark them as designed unless you build them.
4. "Roughly 7 minutes saved per case" is an assumption. Keep the pilot-validation wording you already have.
5. Rename PramaanSetu to Sakshya (or keep the old name on slides and the new one in the product; do not mix them).
6. Typos on slide 2: "had became", "Applicants goes", "inconsistency" (should be "inconsistencies"), "Officers gets", "it's rules".
