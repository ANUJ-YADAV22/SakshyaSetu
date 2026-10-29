'use client';
import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { Btn, ErrorBox, Loading, StatusBadge, fmtTime, useLoad } from '@/components/ui';
import { CATS } from '@/components/shared';
import { CARD_META, CardStatus, Tally } from '@/components/ProofCards';

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const rep = useLoad<any>(() => api(`/applications/${id}/report`), [id]);
  const pc = useLoad<any>(() => api(`/applications/${id}/proof-cards`), [id]);
  if (rep.error) return <ErrorBox error={rep.error} />;
  if (!rep.data || !pc.data) return <Loading />;
  const r = rep.data, c = pc.data;
  const list = (title: string, items: any[], empty: string) => (
    <section className="mt-6">
      <h2 className="font-display text-lg">{title}</h2>
      {items.length === 0 ? <p className="mt-1 text-sm text-slate-500">{empty}</p> : (
        <ol className="mt-2 space-y-3">{items.map((f) => (
          <li key={f.id} className="panel p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={f.status} /><b>{f.title}</b><span className="font-mono text-xs text-slate-500">{f.rule_id}</span></div>
            <p className="mt-1">{f.message}</p>
            <p className="mt-1 text-xs text-slate-600">Evidence: {(f.evidence || []).filter((e: any) => e.filename).map((e: any) => `${e.filename}${e.page ? ` p.${e.page}` : ''}`).join(', ') || 'dossier manifest'} · Clause: {f.aph_clause ?? 'n/a'}{f.aph_clause && !f.clause_confirmed ? ' (to be confirmed)' : ''}</p>
            {f.next_action && <p className="mt-1 text-xs"><b>Next:</b> {f.next_action}</p>}
          </li>))}</ol>)}
    </section>);
  return (
    <article className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/applications/${id}`} className="text-sm font-semibold text-indigo-700 underline">Back to case</Link>
        <Btn onClick={() => window.print()}><Printer className="h-3.5 w-3.5" />Print or save as PDF</Btn>
      </div>
      <header className="border-b-2 border-[#15201A] pb-3">
        <p className="text-sm text-slate-600">Sakshya scrutiny report · generated {fmtTime(r.generated_at)}</p>
        <h1 className="font-display text-3xl">{r.application.institution_name}</h1>
        <p className="text-sm text-slate-700">{CATS[r.application.category] ?? r.application.category} · {r.application.id} · status {r.application.status.replace(/_/g, ' ')}</p>
        {r.demo_data_label && <p className="mt-1 inline-block rounded-[3px] bg-[#F4CB45] px-1.5 py-0.5 text-xs font-bold text-[#3A2A00]">{r.demo_data_label}</p>}
      </header>
      <section className="mt-5"><h2 className="font-display text-lg">Overall: {c.overall_label}</h2><div className="mt-2"><Tally counts={c.counts} /></div></section>
      <section className="mt-6"><h2 className="font-display text-lg">Document by document</h2>
        <table className="mt-2 w-full text-sm"><thead><tr className="border-b border-[var(--rule)] text-left text-slate-600"><th className="py-1">Document</th><th>Result</th><th>Why</th><th>Next step</th></tr></thead>
          <tbody>{c.cards.map((d: any) => <tr key={d.document_id} className="border-b border-[var(--rule)] align-top"><td className="py-1.5">{d.doc_type.replace(/_/g, ' ')}<div className="text-xs text-slate-500">{d.filename}</div></td>
            <td className="font-semibold">{CARD_META[d.status as CardStatus].label}</td><td className="text-xs">{d.why}</td><td className="text-xs">{d.next_actions?.[0] ?? '-'}</td></tr>)}</tbody></table></section>
      {list('Rule results', r.rule_results, 'No rule results yet.')}
      {list('Unresolved items', r.unresolved_items, 'Nothing unresolved.')}
      {list('Advisory indicators (not proof)', r.advisory_indicators, 'No advisory indicators.')}
      <footer className="mt-8 border-t border-[var(--rule)] pt-3 text-xs text-slate-600">
        <p>{r.notice}</p>
        <p className="mt-1">Audit chain: {r.audit_chain.valid ? 'intact' : 'BROKEN'} · {r.audit_chain.events} events · head {r.audit_chain.last_hash?.slice(0, 16)}…</p>
      </footer>
    </article>
  );
}
