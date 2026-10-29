'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Card, DemoTag, Empty, ErrorBox, Loading, PageTitle, ProvBadge, StatusBadge, fmtTime, useLoad } from '@/components/ui';
import { useSession } from '@/lib/session';

const MEANING: Record<string, string> = {
  verified: 'The issuing source (or a valid cryptographic signature) confirmed the document. The only state that may be shown as verified.',
  mismatch_detected: 'The source responded and at least one field differs from the uploaded document. Routed to an officer; not an accusation.',
  expired: 'The document\'s own validity ended before the submission date. Renewal should be requested.',
  verification_pending: 'A request is outstanding. Shown with its age until the source answers.',
  source_unavailable: 'The source could not be reached. Never displayed as verified; retry or confirm manually.',
  manual_review_required: 'No authorised automated channel exists. A manual-confirmation task is created with fields prefilled.',
};
const STATUSES = ['verified', 'mismatch_detected', 'expired', 'verification_pending', 'source_unavailable', 'manual_review_required'];

export default function Authority() {
  const { t, role } = useSession();
  const health = useLoad<any>(() => api('/integrations/health'));
  const checks = useLoad<any[]>(() => api('/source-checks'));
  const [filter, setFilter] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  if (role === 'applicant') return <Card>Source verification is handled by officers.</Card>;
  const retry = async (c: any) => {
    try { const r = await api(`/applications/${c.application_id}/source-checks/${c.document_id}/retry`, { method: 'POST' }); toast.success(`Retried: ${r.status}`); checks.reload(); }
    catch (e: any) { toast.error(e.message); }
  };
  const shown = (checks.data ?? []).filter((c) => filter === 'all' || c.status === filter);
  const counts = STATUSES.map((s) => ({ s, n: (checks.data ?? []).filter((c) => c.status === s).length }));
  return (
    <div className="space-y-5">
      <PageTitle title={t.authority} sub="Authorised channels only - no scraping, no authentication bypass. Where no channel exists, a manual-confirmation task is created with extracted fields prefilled. Mock and synthetic results are always labelled." />
      <div className="rounded-xl border border-fuchsia-300 bg-fuchsia-50 p-3 text-xs text-fuchsia-900">{health.data?.claims ?? 'Loading claims policy…'}</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">{counts.map((c) => <button key={c.s} onClick={() => setFilter(filter === c.s ? 'all' : c.s)} title={MEANING[c.s]} className={`rounded-xl border bg-white p-3 text-center dark:bg-slate-900/60 ${filter === c.s ? 'ring-2 ring-indigo-500' : ''}`}><StatusBadge status={c.s} /><div className="mt-1 font-serif text-3xl">{c.n}</div></button>)}</div>
      <Card title="Six-state verification protocol"><ul className="grid grid-cols-[minmax(0,1fr)] gap-2 text-xs md:grid-cols-2">{STATUSES.map((st) => <li key={st} className="flex gap-2"><span className="shrink-0"><StatusBadge status={st} /></span><span className="text-slate-600">{MEANING[st]}</span></li>)}</ul></Card>
      <Card title="Adapter registry">
        {health.loading ? <Loading /> : health.error ? <ErrorBox error={health.error} /> : (
          <table className="w-full text-xs"><thead><tr className="text-left uppercase text-slate-500"><th className="py-1">Document / record</th><th>Channel</th><th>Fallback</th><th>Implementation</th></tr></thead>
            <tbody>{health.data.adapters.map((a: any) => <tr key={a.document_or_record} className="border-t"><td className="py-1.5 font-medium">{a.document_or_record}</td><td>{a.channel}</td><td>{a.fallback}</td><td><span className={`rounded px-1.5 py-0.5 ${a.implemented.startsWith('implemented') ? 'bg-emerald-50 text-emerald-800' : 'bg-fuchsia-50 text-fuchsia-800'}`}>{a.implemented}</span></td></tr>)}</tbody></table>)}
      </Card>
      <Card title="Per-document source checks">
        {checks.loading ? <Loading /> : shown.length === 0 ? <Empty>No source checks {filter === 'all' ? 'yet. Evaluate an application first.' : 'in this state.'}</Empty> : (
          <table className="w-full text-xs"><thead><tr className="text-left uppercase text-slate-500"><th className="py-1">Case / document</th><th>Status</th><th>Source</th><th>Provenance</th><th>Checked</th><th>Next action</th><th /></tr></thead>
            <tbody>{shown.map((c) => <React.Fragment key={c.id}><tr className="border-t align-top"><td className="py-1.5"><Link className="text-indigo-700 underline" href={`/applications/${c.application_id}`}>{c.institution_name}</Link> {c.is_demo ? <DemoTag /> : null}<div className="text-slate-500">{c.filename}</div></td>
              <td><StatusBadge status={c.status} /></td><td>{c.source_name}<div className="text-slate-500">{c.limitations}</div></td><td><ProvBadge provenance={c.provenance} /></td><td>{fmtTime(c.checked_at)}</td><td>{c.next_action}</td><td className="space-y-1"><Btn variant="ghost" onClick={() => retry(c)}>Retry</Btn><Btn variant="quiet" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide fields' : 'Fields compared'}</Btn></td></tr>
              {open === c.id && <tr className="bg-slate-50 dark:bg-slate-800/40"><td colSpan={7} className="p-3"><div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
                <div><div className="text-[11px] font-semibold uppercase text-slate-500">Matched the source record</div><div className="mt-1 flex flex-wrap gap-1">{(c.matched_fields ?? []).length ? c.matched_fields.map((f: string) => <span key={f} className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">{f.replace(/_/g, ' ')}</span>) : <span className="text-slate-500">none</span>}</div></div>
                <div><div className="text-[11px] font-semibold uppercase text-slate-500">Differ from the source record</div><div className="mt-1 flex flex-wrap gap-1">{(c.mismatched_fields ?? []).length ? c.mismatched_fields.map((f: string) => <span key={f} className="rounded bg-red-50 px-1.5 py-0.5 text-red-800">{f.replace(/_/g, ' ')}</span>) : <span className="text-slate-500">none</span>}</div></div>
                <div className="text-xs"><div className="text-[11px] font-semibold uppercase text-slate-500">Response reference</div><div className="mt-1 font-mono">{c.response_reference ?? '-'}</div>{c.prefilled_request && <details className="mt-1"><summary className="cursor-pointer text-indigo-700">Prefilled manual request</summary><pre className="mt-1 overflow-auto rounded bg-slate-900 p-2 text-[10px] text-slate-100">{JSON.stringify(c.prefilled_request, null, 2)}</pre></details>}</div>
              </div></td></tr>}</React.Fragment>)}</tbody></table>)}
      </Card>
    </div>
  );
}
