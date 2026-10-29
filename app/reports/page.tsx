'use client';
import React, { useState } from 'react';
import { Download, Printer, ShieldCheck, FileCheck2, FileWarning, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import { Btn, Card, Empty, ErrorBox, Loading, PageTitle, useLoad } from '@/components/ui';
import { Donut, BarList, Kpi } from '@/components/viz';

type Pt = { date: string; events: number; uploads: number; officer_actions: number };

/** Smooth area/line chart in plain SVG (no chart library). */
function Trend({ data }: { data: Pt[] }) {
  const W = 640, H = 220, P = { l: 34, r: 12, t: 12, b: 26 };
  const keys = [['events', '#1F7A6A', 'All events'], ['officer_actions', '#D9A21B', 'Officer actions']] as const;
  const max = Math.max(4, ...data.map((d) => d.events)), x = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, data.length - 1), y = (v: number) => H - P.b - (v * (H - P.t - P.b)) / max;
  const path = (k: 'events' | 'officer_actions') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Activity per day" onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id="gA" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1F7A6A" stopOpacity=".35" /><stop offset="1" stopColor="#1F7A6A" stopOpacity="0" /></linearGradient></defs>
        {[0, .25, .5, .75, 1].map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(max * t)} y2={y(max * t)} stroke="var(--rule)" /><text x={P.l - 6} y={y(max * t) + 3} textAnchor="end" fontSize="9" fill="#667464">{Math.round(max * t)}</text></g>)}
        <path d={`${path('events')} L${x(data.length - 1)},${H - P.b} L${x(0)},${H - P.b} Z`} fill="url(#gA)" />
        {keys.map(([k, c]) => <path key={k} d={path(k)} fill="none" stroke={c} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />)}
        {data.map((d, i) => <g key={d.date}><rect x={x(i) - 14} y={P.t} width="28" height={H - P.t - P.b} fill="transparent" onMouseEnter={() => setHover(i)} />{(i % 2 === 0 || data.length < 9) && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#667464">{d.date.slice(5)}</text>}</g>)}
        {hover != null && <g><line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="#1F7A6A" strokeDasharray="3 3" />{keys.map(([k, c]) => <circle key={k} cx={x(hover)} cy={y(data[hover][k])} r="4" fill={c} />)}</g>}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex gap-3">{keys.map(([k, c, l]) => <span key={k} className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>)}</span>
        <span className="text-slate-500">{hover != null ? `${data[hover].date}: ${data[hover].events} events, ${data[hover].uploads} uploads, ${data[hover].officer_actions} officer actions` : 'Hover a day for detail'}</span>
      </div>
    </div>
  );
}

export default function Reports() {
  const [days, setDays] = useState(14);
  const { data, error, loading } = useLoad<any>(() => api(`/reports/summary?days=${days}`), [days]);
  const pretty = (s: string) => s.replace(/_/g, ' ');
  const csv = () => {
    if (!data) return; const rows: (string | number)[][] = [['metric', 'value'], ['applications', data.totals.applications], ['documents', data.totals.documents], ['evaluated', data.totals.evaluated], ['clearance_pct', data.rates.clearance_pct], ['deficiency_pct', data.rates.deficiency_pct],
      ...data.top_rules.map((r: any) => [`rule:${r.rule}`, r.n]), ...Object.entries(data.by_category).map(([k, v]) => [`category:${k}`, v as number]), ...Object.entries(data.officer_outcomes).map(([k, v]) => [`outcome:${k}`, v as number]), ...data.series.map((s: Pt) => [`events:${s.date}`, s.events])];
    const u = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })); const a = document.createElement('a'); a.href = u; a.download = 'sakshya-report.csv'; a.click(); URL.revokeObjectURL(u);
  };
  return (
    <div className="space-y-6">
      <PageTitle eyebrow="Governance" title="Reports & analytics" sub="Live figures computed from the database when you open this page: scrutiny outcomes, recurring deficiencies, and activity over time."
        right={<><Btn variant="ghost" onClick={csv} disabled={!data}><Download className="h-4 w-4" />Export CSV</Btn><Btn onClick={() => window.print()} disabled={!data}><Printer className="h-4 w-4" />Print brief</Btn></>} />
      {loading && <Loading />}{error != null && <ErrorBox error={error} />}
      {data && (<>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi index={0} icon={Layers} tone="ink" label="Applications" value={data.totals.applications} hint={`${data.totals.documents} current documents`} />
          <Kpi index={1} icon={FileCheck2} tone="verdigris" label="Clear of findings" value={Math.round(data.rates.clearance_pct)} hint={`% of ${data.totals.evaluated} evaluated`} />
          <Kpi index={2} icon={FileWarning} tone="vermilion" label="With a deficiency" value={Math.round(data.rates.deficiency_pct)} hint={`% · ${data.rates.with_deficiency} application(s)`} />
          <Kpi index={3} icon={ShieldCheck} tone="marigold" label="Ledger events" value={data.audit_events} hint="hash-chained, tamper-evident" />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Card title="Activity over time" right={<span className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs font-semibold">{[7, 14, 30].map((d) => <button key={d} onClick={() => setDays(d)} className={`px-2.5 py-1 ${days === d ? 'bg-indigo-600 text-white' : 'bg-white'}`}>{d}d</button>)}</span>}><Trend data={data.series} /></Card>
          <Card title="Application categories"><div className="flex flex-wrap items-center gap-5"><Donut size={150} stroke={20} sub="applications" segs={Object.entries(data.by_category).map(([k, v], i) => ({ label: pretty(k), value: v as number, color: ['#1F7A6A', '#D9A21B', '#B93A28', '#5B6B8C'][i % 4] }))} />
            <ul className="space-y-1.5 text-sm">{Object.entries(data.by_category).map(([k, v], i) => <li key={k} className="flex items-center gap-2 capitalize"><i className="h-2.5 w-2.5 rounded-full" style={{ background: ['#1F7A6A', '#D9A21B', '#B93A28', '#5B6B8C'][i % 4] }} />{pretty(k)} <b className="ml-auto pl-3">{v as number}</b></li>)}</ul></div></Card>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-3">
          <Card title="Most frequent findings (open)"><BarList empty="No open findings." items={data.top_rules.map((r: any) => ({ label: r.rule, value: r.n, color: '#B93A28' }))} /></Card>
          <Card title="Officer outcomes"><BarList empty="No officer decisions recorded yet." items={Object.entries(data.officer_outcomes).map(([k, v]) => ({ label: pretty(k), value: v as number, color: '#1F7A6A' }))} /></Card>
          <Card title="Issuer verification states"><BarList empty="No source checks yet." items={Object.entries(data.source_checks).map(([k, v]) => ({ label: pretty(k), value: v as number, color: k === 'verified' ? '#2C7A3E' : k === 'mismatch_detected' || k === 'expired' ? '#B93A28' : '#D9A21B' }))} /></Card>
        </div>
        <p className="text-xs text-slate-500">{data.note} Generated {new Date(data.generated_at).toLocaleString('en-IN')}. Demo dossiers, when loaded, are included and labelled in the case list.</p>
      </>)}
      {data && data.totals.applications === 0 && <Empty>No applications yet. Load the demo dossiers from the Case desk to see this report with data.</Empty>}
    </div>
  );
}
