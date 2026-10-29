'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { FileText, Upload, RefreshCw, CheckCircle2, CircleDashed } from 'lucide-react';
import { api, blobUrl, upload } from '@/lib/api';
import { Btn, Card, DemoTag, Empty, ErrorBox, Loading, PageTitle, ProvBadge, StatusBadge, fmtTime, useLoad } from '@/components/ui';
import { useSession } from '@/lib/session';
import { ArtifactImg, CATS } from '@/components/shared';
import { ProofCardRow } from '@/components/ProofCards';
import Link from 'next/link';

type Bbox = number[] | null | undefined;

function PageViewer({ docId, page, highlight }: { docId?: string; page: number; highlight: Bbox }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true; let u: string | null = null; setUrl(null); setErr('');
    if (!docId) return;
    blobUrl(`/documents/${docId}/page/${page}.png?boxes=false`).then((x) => { u = x; if (live) setUrl(x); }).catch(() => live && setErr('Preview not available for this file type (original is preserved unchanged).'));
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [docId, page]);
  if (!docId) return <Empty>Select a document or finding to view the original page.</Empty>;
  if (err) return <Empty>{err}</Empty>;
  if (!url) return <Loading />;
  return (
    <div className="relative inline-block max-w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`Page ${page}`} className="block max-w-full" />
      {highlight && <div className="pointer-events-none absolute rounded-sm border-2 border-[#15201A] bg-[#F4CB45]/45 ring-4 ring-[#F4CB45]/30"
        style={{ left: `${highlight[0] * 100}%`, top: `${highlight[1] * 100}%`, width: `${(highlight[2] - highlight[0]) * 100}%`, height: `${(highlight[3] - highlight[1]) * 100}%` }} />}
    </div>
  );
}

function ReviewPanel({ finding, onDone }: { finding: any; onDone: () => void }) {
  const { role } = useSession();
  const [reason, setReason] = useState('');
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldEv = (finding.evidence || []).filter((e: any) => e.field_id);
  const [fid, setFid] = useState<string>(fieldEv[0]?.field_id ?? '');
  const can = ['scrutiny_officer', 'specialist_reviewer', 'regulatory_expert', 'administrator'].includes(role);
  if (!can) return null;
  const act = async (action: string) => {
    setBusy(true);
    try {
      const r = await api(`/findings/${finding.id}/review`, { method: 'POST', json: { action, reason, field_id: action === 'correct_field' ? fid : undefined, new_value: action === 'correct_field' ? val : undefined } });
      toast.success(`Recorded: ${action.replace(/_/g, ' ')}${r.targeted_recheck ? ` - ${r.targeted_recheck.rules_rerun} rules re-checked` : ''}`);
      setReason(''); setVal(''); onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-500/30 dark:bg-indigo-500/10">
      <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-200">Reviewer actions (human decision)</div>
      <input className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:bg-slate-800" placeholder="Reason (required for dismiss / clarify / escalate)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex flex-wrap gap-1.5">
        <Btn onClick={() => act('confirm')} busy={busy}>Confirm finding</Btn>
        <Btn variant="ghost" onClick={() => act('dismiss')} busy={busy}>Dismiss</Btn>
        <Btn variant="ghost" onClick={() => act('request_clarification')} busy={busy}>Request clarification</Btn>
        <Btn variant="ghost" onClick={() => act('escalate')} busy={busy}>Escalate</Btn>
        {finding.family === 'source' && <><Btn variant="ghost" onClick={() => act('mark_source_pending')} busy={busy}>Source pending</Btn><Btn variant="ghost" onClick={() => act('mark_source_completed')} busy={busy}>Source confirmed</Btn></>}
      </div>
      {fieldEv.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-indigo-200 pt-2">
          <select className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs dark:bg-slate-800" value={fid} onChange={(e) => setFid(e.target.value)}>
            {fieldEv.map((e: any) => <option key={e.field_id} value={e.field_id}>{e.field}: {String(e.value).slice(0, 28)}</option>)}
          </select>
          <input className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:bg-slate-800" placeholder="Corrected value (original is kept)" value={val} onChange={(e) => setVal(e.target.value)} />
          <Btn variant="ghost" disabled={!val} onClick={() => act('correct_field')} busy={busy}>Correct field</Btn>
        </div>)}
      {finding.review && <p className="text-[11px] text-slate-600">Last outcome: <b>{finding.review.outcome}</b> by {finding.review.by} · {fmtTime(finding.review.at)}{finding.review.reason ? ` - ${finding.review.reason}` : ''}</p>}
    </div>
  );
}

function FindingDetail({ f, reload, onShow }: { f: any; reload: () => void; onShow: (e: any) => void }) {
  const { role } = useSession();
  const [passport, setPassport] = useState<any>(null);
  useEffect(() => setPassport(null), [f.id]);
  const loadPassport = async () => { try { setPassport(await api(`/findings/${f.id}/passport`)); } catch (e: any) { toast.error(e.message); } };
  const [plain, setPlain] = useState<any>(null);
  useEffect(() => setPlain(null), [f.id]);
  const loadPlain = async () => { try { setPlain(await api(`/findings/${f.id}/explain`)); } catch (e: any) { toast.error(e.message); } };
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={f.status} /><span className="font-mono text-[11px] text-slate-500">{f.rule_id}</span><ProvBadge provenance={f.provenance} />
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-700">Tier {f.tier}</span></div>
      <h3 className="font-semibold">{f.title}</h3>
      <p>{f.message}</p>
      <div className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
        <div><b>Clause:</b> {f.aph_clause ?? 'n/a'} {f.aph_clause && !f.clause_confirmed && <span className="text-amber-700">(to be confirmed against current authorised APH)</span>}</div>
        <div><b>Queue:</b> {f.queue?.replace(/_/g, ' ')} · <b>Rule pack:</b> {f.pack_version}</div>
        {f.limitations && <div className="mt-1 text-slate-600"><b>Limitations:</b> {f.limitations}</div>}
        <div className="mt-1"><b>Next action:</b> {f.next_action}</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(f.evidence || []).filter((e: any) => e.doc_id).map((e: any, i: number) => (
          <button key={i} onClick={() => onShow(e)} className="rounded-md border border-indigo-300 bg-white px-2 py-1 text-[11px] text-indigo-800 hover:bg-indigo-50"><FileText className="mr-1 inline h-3 w-3" />{e.filename} · p.{e.page}{e.field ? ` · ${e.field}` : ''}</button>))}
        {(f.evidence || []).filter((e: any) => e.kind === 'dossier_manifest').map((e: any, i: number) => <span key={i} className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600">Dossier manifest: {e.checklist_item}</span>)}
      </div>
      {f.outputs?.overlay && <ArtifactImg path={f.outputs.overlay} />}
      {f.inputs && Object.keys(f.inputs).length > 0 && role !== 'applicant' && <details className="text-xs"><summary className="cursor-pointer text-slate-600">Inputs and outputs</summary><pre className="mt-1 overflow-auto rounded bg-slate-900 p-2 text-[10px] text-slate-100">{JSON.stringify({ inputs: f.inputs, outputs: f.outputs }, null, 2)}</pre></details>}
      <div className="flex flex-wrap gap-1">
        <Btn variant="quiet" onClick={loadPlain}>Explain in plain language</Btn>
        {role !== 'applicant' && <Btn variant="quiet" onClick={loadPassport}>Open Verification Passport</Btn>}
      </div>
      {plain && <div className="rounded-[5px] border-l-4 border-[#F4CB45] bg-slate-50 p-2.5 text-sm">
        <p>{plain.text}</p>
        <p className="mt-1 text-xs text-slate-500">Wording: {plain.provider === 'llm' ? `language model (${plain.model}), validated fields only` : 'deterministic template'} · the result comes from the rule engine.</p></div>}
      {passport && <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[10px] leading-relaxed text-emerald-200">{JSON.stringify(passport, null, 2)}</pre>}
      {role !== 'applicant' && <ReviewPanel finding={f} onDone={reload} />}
    </div>
  );
}

export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const { role, t } = useSession();
  const isApplicant = role === 'applicant';
  const app = useLoad<any>(() => api(`/applications/${id}`), [id]);
  const fnd = useLoad<any>(() => api(`/applications/${id}/findings`), [id]);
  const cards = useLoad<any>(() => api(`/applications/${id}/proof-cards`), [id]);
  const [pre, setPre] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);
  const [view, setView] = useState<{ doc?: string; page: number; bbox: Bbox }>({ page: 1, bbox: null });
  const [filter, setFilter] = useState('flagged');
  const [docFilter, setDocFilter] = useState<string>('');
  const [busy, setBusy] = useState('');
  const [diff, setDiff] = useState<any>(null);
  const [notice, setNotice] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<string | undefined>(undefined);

  const refresh = () => { app.reload(); fnd.reload(); cards.reload(); };
  const run = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try { const r = await fn(); toast.success(ok); return r; } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };

  const docs: any[] = app.data?.documents ?? [];
  const current = docs.filter((d) => !d.superseded_by);
  const items: any[] = isApplicant && pre ? pre.findings : (fnd.data?.items ?? []);
  const shown = useMemo(() => items
    .filter((f) => filter === 'all' ? true : filter === 'flagged' ? ['deficiency', 'needs_review', 'indicator', 'processing'].includes(f.status) : f.status === filter)
    .filter((f) => !docFilter || (f.evidence || []).some((e: any) => e.doc_id === docFilter)), [items, filter, docFilter]);

  const show = (e: any) => setView({ doc: e.doc_id, page: e.page || 1, bbox: e.bbox });
  const choose = (f: any) => { setSel(f); const e = (f.evidence || []).find((x: any) => x.doc_id); if (e) show(e); };
  const missing = (app.data?.checklist ?? []).filter((c: any) => c.required && !current.some((d) => d.doc_type === c.doc_type));

  if (app.loading && !app.data) return <Loading />;
  if (app.error) return <ErrorBox error={app.error} />;
  const a = app.data;

  return (
    <div className="space-y-4">
      <section className="hero rise">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#F4CB45]"><span>{CATS[a.category]?.split(' (')[0] ?? a.category}</span><span className="text-slate-500">·</span><span className="font-mono normal-case tracking-normal text-slate-300">{a.id}</span>{a.is_demo ? <DemoTag /> : null}</div>
            <h1 className="mt-2 font-display text-[30px] leading-tight text-white">{a.institution_name}</h1>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-0.5 text-xs font-semibold capitalize"><i className="h-1.5 w-1.5 rounded-full bg-[#F4CB45]" />{a.status.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="ghost" busy={busy === 'pre'} onClick={async () => { const r = await run('pre', () => api(`/applications/${id}/presubmission-check`, { method: 'POST' }), 'Advisory pre-submission check complete (no official record created)'); if (r) setPre(r); }}>Pre-submission check</Btn>
            {isApplicant && <Btn busy={busy === 'submit'} onClick={async () => { const r = await run('submit', () => api(`/applications/${id}/submit`, { method: 'POST' }), 'Submitted'); if (r) { setPre(null); refresh(); } }}>Final submission</Btn>}
            {!isApplicant && <Btn busy={busy === 'eval'} onClick={async () => { await run('eval', () => api(`/applications/${id}/evaluate-rules`, { method: 'POST' }), 'Evaluation complete'); refresh(); }}><RefreshCw className="h-3 w-3" />Evaluate rules</Btn>}
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['Documents', current.length, 'current versions', 'text-white'],
            ['Open findings', (fnd.data?.items ?? []).filter((f: any) => ['deficiency', 'needs_review'].includes(f.status)).length, 'deficiency or review', 'text-[#FFB3A5]'],
            ['Missing required', missing.length, 'not yet submitted', missing.length ? 'text-[#F4CB45]' : 'text-[#9FE0A8]'],
            ['Human gates', a.open_gates?.length ?? 0, 'waiting for a person', 'text-white']].map(([l, v, h, c]: any) => (
            <div key={l} className="glass px-4 py-3"><dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">{l}</dt><dd className={`mt-1 font-display text-[28px] leading-none tabular-nums ${c}`}>{v}</dd><div className="mt-1 text-[11px] text-slate-400">{h}</div></div>))}
        </dl>
      </section>

      {a.open_gates?.length > 0 && !isApplicant && (
        <div className="rounded-xl border border-indigo-300 bg-indigo-50 p-3 text-xs text-indigo-900">
          <b>{a.open_gates.length} human gate(s) open.</b> Dependent steps wait until an authorised person acts: {[...new Set(a.open_gates.map((g: any) => g.gate_type.replace(/_/g, ' ')))].join(', ')}.
        </div>)}
      {pre && <div className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-xs text-sky-900">Showing <b>advisory</b> pre-submission results. {pre.notice}</div>}

      {!isApplicant || a.status !== 'draft' ? (cards.data && cards.data.cards.length > 0 && (
        <ProofCardRow data={cards.data} activeDoc={docFilter || undefined}
          onPick={(c) => { const next = docFilter === c.document_id ? '' : c.document_id; setDocFilter(next); setFilter('all'); if (next) setView({ doc: c.document_id, page: 1, bbox: null }); }} />)) : null}
      {docFilter && <div className="flex items-center gap-2 text-sm"><span>Showing findings for one document.</span><Btn variant="quiet" onClick={() => setDocFilter('')}>Show all documents</Btn></div>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[260px_minmax(0,1fr)_420px]">
        {/* LEFT: checklist and documents */}
        <div className="space-y-4">
          <Card title="Checklist">
            <ul className="space-y-1.5 text-xs">
              {(a.checklist ?? []).map((c: any) => { const have = current.find((d) => d.doc_type === c.doc_type); return (
                <li key={c.doc_type} className="flex items-start gap-1.5">{have ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" /> : <CircleDashed className={`mt-0.5 h-3.5 w-3.5 ${c.required ? 'text-red-500' : 'text-slate-400'}`} />}
                  <span className={have ? '' : c.required ? 'text-red-700' : 'text-slate-500'}>{c.label}{!c.required && ' (optional)'}</span></li>); })}
            </ul>
            {missing.length > 0 && <p className="mt-2 text-[11px] text-red-700">{missing.length} required document(s) not yet submitted.</p>}
          </Card>
          <Card title="Documents" right={<Btn variant="quiet" onClick={() => { replaceRef.current = undefined; fileRef.current?.click(); }}><Upload className="h-3 w-3" />Upload</Btn>}>
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.mp4" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              await run('up', () => upload(id, f, replaceRef.current), replaceRef.current ? 'New version stored; earlier file stays immutable' : 'Uploaded and hashed'); e.target.value = ''; refresh();
            }} />
            <ul className="space-y-2 text-xs">
              {docs.map((d) => (
                <li key={d.id} className={`rounded-lg border p-2 ${d.superseded_by ? 'border-dashed opacity-60' : 'border-slate-200'} dark:border-slate-700`}>
                  <button className="text-left font-semibold text-indigo-800 hover:underline" onClick={() => setView({ doc: d.id, page: 1, bbox: null })}>{d.filename}</button>
                  <div className="text-[10px] text-slate-500">{d.doc_type.replace(/_/g, ' ')} · v{d.version}{d.superseded_by ? ' · superseded' : ''}</div>
                  <div className="font-mono text-[9px] text-slate-400" title={d.sha256}>SHA-256 {d.sha256.slice(0, 20)}…</div>
                  {!d.superseded_by && a.status !== 'decided' && <button className="mt-1 text-[10px] text-indigo-700 underline" onClick={() => { replaceRef.current = d.id; fileRef.current?.click(); }}>Replace (keeps history)</button>}
                </li>))}
              {docs.length === 0 && <Empty>No documents yet.</Empty>}
            </ul>
          </Card>
          {!isApplicant && (
            <Card title="Case actions">
              <div className="flex flex-col gap-1.5">
                <Btn variant="ghost" onClick={async () => setDiff(await run('diff', () => api(`/applications/${id}/diff`), 'Diff computed'))}>Pre/final diff</Btn>
                <Btn variant="ghost" onClick={async () => { const r = await run('notice', () => api(`/applications/${id}/deficiency-draft`, { method: 'POST' }), 'Draft created - not issued until an officer approves'); if (r) setNotice(r); }}>Draft deficiency notice</Btn>
                <Link href={`/applications/${id}/report`} className="inline-flex items-center rounded-[5px] border border-slate-300 bg-[var(--panel)] px-3 py-1.5 text-[13px] font-semibold text-slate-800 hover:border-indigo-500">Open printable report</Link>
                <Btn variant="ghost" onClick={async () => { const r = await run('rep', () => api(`/applications/${id}/report`), 'Report exported'); if (r) { const l = document.createElement('a'); l.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })); l.download = `${id}-report.json`; l.click(); } }}>Export report (JSON)</Btn>
              </div>
            </Card>)}
        </div>

        {/* CENTRE: original with evidence highlight */}
        <div className="space-y-2">
          <Card title="Original document" right={view.doc && <div className="flex items-center gap-1 text-xs"><Btn variant="ghost" disabled={view.page <= 1} onClick={() => setView({ ...view, page: view.page - 1, bbox: null })}>‹</Btn><span>page {view.page}</span><Btn variant="ghost" onClick={() => setView({ ...view, page: view.page + 1, bbox: null })}>›</Btn></div>}>
            <PageViewer docId={view.doc} page={view.page} highlight={view.bbox} />
            <p className="mt-2 text-[10px] text-slate-500">Highlight is a derived visualisation tied to the original file hash; it never replaces the source.</p>
          </Card>
          {diff && (
            <Card title="Pre-submission vs final submission" right={<Btn variant="quiet" onClick={() => setDiff(null)}>Close</Btn>}>
              <p className="mb-2 text-xs text-slate-600">{diff.note}</p>
              {!diff.baseline ? <p className="text-xs">No baseline.</p> : <div className="space-y-1 text-xs">
                <div>Added: <b>{diff.added.length}</b> · Removed: <b>{diff.removed.length}</b> · Replaced: <b>{diff.replaced.length}</b> · Unchanged: <b>{diff.unchanged.length}</b></div>
                {diff.replaced.map((r: any, i: number) => <div key={i} className="rounded bg-amber-50 p-1.5">Replaced <b>{r.before.filename}</b> (v{r.before.version}) → <b>{r.after.filename}</b> (v{r.after.version})</div>)}
                {diff.changed_fields.map((c: any, i: number) => <div key={i} className="rounded bg-slate-50 p-1.5">{c.document} · <b>{c.field}</b>: <s>{String(c.before)}</s> → {String(c.after)}</div>)}</div>}
            </Card>)}
          {notice && (
            <Card title={`Draft notice ${notice.id} (v${notice.version}) - NOT ISSUED`} right={role === 'scrutiny_officer' ? <Btn onClick={async () => { const due = prompt('Response due date (YYYY-MM-DD)'); if (!due) return; await run('ap', () => api(`/notices/${notice.id}/approve`, { method: 'POST', json: { due_date: due } }), 'Notice approved by officer'); setNotice(null); refresh(); }}>Approve and issue</Btn> : undefined}>
              <p className="text-xs text-slate-600">{notice.draft_notice}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs">{notice.deficiencies.map((d: any) => <li key={d.finding_id}>{d.issue} <span className="text-slate-500">[{d.clause ?? 'no clause'}{d.clause && !d.clause_confirmed ? ' - to be confirmed' : ''}]</span></li>)}</ol>
            </Card>)}
          {role === 'competent_authority' && <DecisionBox appId={id} onDone={refresh} />}
        </div>

        {/* RIGHT: findings */}
        <div className="space-y-3">
          <Card title="Findings" right={<select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs dark:bg-slate-800">
            <option value="flagged">Needs attention</option><option value="all">All</option><option value="deficiency">Deficiency</option><option value="needs_review">Needs review</option><option value="pass">Pass</option><option value="not_checked">Not checked</option></select>}>
            {fnd.loading && !fnd.data && !pre ? <Loading /> : shown.length === 0 ? <Empty>{items.length === 0 ? 'No findings yet. Run an evaluation.' : 'Nothing in this filter.'}</Empty> : (
              <ul className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                {shown.map((f) => (
                  <li key={f.id}><button onClick={() => choose(f)} className={`w-full rounded-lg border p-2 text-left text-xs transition hover:border-indigo-400 ${sel?.id === f.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-200 dark:border-slate-700'}`}>
                    <div className="flex items-center justify-between gap-2"><StatusBadge status={f.status} /><span className="font-mono text-[10px] text-slate-400">{f.rule_id}</span></div>
                    <div className="mt-1 line-clamp-2">{f.message}</div>{isApplicant && f.next_action && f.status !== 'pass' && <div className="mt-1 text-xs"><b>How to fix:</b> {f.next_action}</div>}</button></li>))}
              </ul>)}
          </Card>
          {sel && <Card title="Finding detail"><FindingDetail f={sel} reload={() => { fnd.reload(); setSel(null); }} onShow={show} /></Card>}
        </div>
      </div>
    </div>
  );
}

function DecisionBox({ appId, onDone }: { appId: string; onDone: () => void }) {
  const [decision, setDecision] = useState('');
  const [rationale, setRationale] = useState('');
  return (
    <Card title="Final regulatory decision (human-only)">
      <p className="mb-2 text-xs text-slate-600">The system never approves, rejects or penalises. Record the decision exactly as taken by the competent authority, with rationale.</p>
      <input className="mb-2 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" placeholder="Decision (as entered by the authority)" value={decision} onChange={(e) => setDecision(e.target.value)} />
      <textarea className="mb-2 w-full rounded border border-slate-300 px-2 py-1.5 text-xs" rows={3} placeholder="Rationale (required)" value={rationale} onChange={(e) => setRationale(e.target.value)} />
      <Btn onClick={async () => { try { await api(`/applications/${appId}/decision`, { method: 'POST', json: { decision, rationale } }); toast.success('Decision recorded'); onDone(); } catch (e: any) { toast.error(e.message); } }}>Record decision</Btn>
    </Card>
  );
}
