'use client';
import React from 'react';
import clsx from 'clsx';
import { BadgeCheck, CircleHelp, Hourglass, ScanSearch, TriangleAlert, FolderOpen } from 'lucide-react';

export type CardStatus = 'verified' | 'partially_compliant' | 'needs_review' | 'mismatch' | 'pending';

export const CARD_META: Record<CardStatus, { label: string; tone: string; bar: string; icon: React.ElementType }> = {
  verified:            { label: 'Verified',            tone: 'text-emerald-700', bar: '#2C7A3E', icon: BadgeCheck },
  partially_compliant: { label: 'Partially compliant', tone: 'text-[#946500]',   bar: '#D9A21B', icon: CircleHelp },
  needs_review:        { label: 'Needs review',        tone: 'text-indigo-700',  bar: '#1F7A6A', icon: ScanSearch },
  mismatch:            { label: 'Mismatch',            tone: 'text-red-600',     bar: '#B93A28', icon: TriangleAlert },
  pending:             { label: 'Pending',             tone: 'text-slate-500',   bar: '#8E9B8C', icon: Hourglass },
};
export const CARD_ORDER: CardStatus[] = ['mismatch', 'partially_compliant', 'needs_review', 'pending', 'verified'];

export function Tally({ counts }: { counts: Record<string, number> }) {
  const total = CARD_ORDER.reduce((n, k) => n + (counts[k] ?? 0), 0);
  return (
    <div>
      <div className="tally" role="img" aria-label={CARD_ORDER.map((k) => `${counts[k] ?? 0} ${CARD_META[k].label}`).join(', ')}>
        {total === 0 ? <span style={{ width: '100%' }} /> : CARD_ORDER.filter((k) => counts[k]).map((k) => <span key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: CARD_META[k].bar }} />)}
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {CARD_ORDER.map((k) => (
          <div key={k} className="flex items-baseline gap-2">
            <i className="h-2.5 w-2.5 rounded-[2px]" style={{ background: CARD_META[k].bar }} />
            <dd className="font-display text-2xl leading-none tabular-nums">{counts[k] ?? 0}</dd>
            <dt className="text-sm text-slate-600">{CARD_META[k].label}</dt>
          </div>))}
      </dl>
    </div>
  );
}

const STAMP: Record<CardStatus, string> = { verified: 'Verified', mismatch: 'Mismatch', needs_review: 'Review', pending: 'Pending', partially_compliant: 'Partial' };
const TILT = [-1.5, 1, -0.7, 1.4, -1.1, 0.6];

/** The dossier: every document is a sheet of paper that carries a rubber stamp for its current status. */
export function ProofCardRow({ data, activeDoc, onPick }: { data: any; activeDoc?: string; onPick: (c: any) => void }) {
  return (
    <section aria-label="Document proof cards" className="panel rise">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rule)] px-5 py-3">
        <h2 className="flex items-center gap-2.5 font-display text-[15px]"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><FolderOpen className="h-4 w-4" /></span>Dossier · {data.cards.length} document{data.cards.length === 1 ? '' : 's'}</h2>
        <span className="rounded-full border border-[var(--rule)] px-3 py-0.5 text-sm font-semibold text-slate-700">{data.overall_label}</span>
      </header>
      <div className="p-5">
        <Tally counts={data.counts} />
        {data.cards.length > 0 && (
          <ul className="mt-6 grid gap-x-5 gap-y-7 sm:grid-cols-2 xl:grid-cols-4">
            {data.cards.map((c: any, i: number) => {
              const m = CARD_META[c.status as CardStatus]; const Icon = m.icon;
              return (
                <li key={c.document_id} className="sheet-wrap" style={{ ['--i' as any]: i }}>
                  <button onClick={() => onPick(c)} aria-pressed={activeDoc === c.document_id} aria-label={`${c.doc_type.replace(/_/g, ' ')}: ${m.label}`}
                    className={clsx('sheet', activeDoc === c.document_id && 'sheet-active')} style={{ ['--tone' as any]: m.bar, ['--rot' as any]: `${TILT[i % TILT.length]}deg`, ['--i' as any]: i }}>
                    <span className="sheet-tab"><Icon className="h-3 w-3" />{m.label}</span>
                    <span className="mt-3 block font-display text-[18px] capitalize leading-tight">{c.doc_type.replace(/_/g, ' ')}</span>
                    <span className="block truncate font-mono text-[10px] text-slate-500" title={c.filename}>{c.filename}</span>
                    <span className="mt-2 block text-[12.5px] leading-[26px]">{c.why}</span>
                    {c.next_actions?.[0] && <span className="block text-[12px] leading-[26px]"><b>Next:</b> {c.next_actions[0]}</span>}
                    <span className="stamp" style={{ color: m.bar }}>{STAMP[c.status as CardStatus]}</span>
                  </button>
                </li>);
            })}
          </ul>)}
        {data.case_level?.length > 0 && (
          <div className="mt-6 rounded-xl border border-[var(--rule)] bg-slate-50 p-3 text-xs text-slate-700">
            <b>Case-level items:</b> {data.case_level.map((c: any) => c.title).join(' · ')}
          </div>)}
        <p className="mt-4 text-xs text-slate-500">A “Verified” stamp appears only when the issuing source confirmed the document. Passed rule checks with no source confirmation stay Pending.</p>
      </div>
    </section>
  );
}
