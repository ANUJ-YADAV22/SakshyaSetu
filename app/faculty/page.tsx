'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { UsersRound, Calculator } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, Empty, ErrorBox, PageTitle, useLoad } from '@/components/ui';
import { Kpi } from '@/components/viz';
import FacultyCrossCheck from '@/components/FacultyCrossCheck';

const Chip = ({ ok, children, off }: { ok?: boolean; children: React.ReactNode; off?: boolean }) =>
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${off ? 'bg-slate-100 text-slate-500' : ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{children}</span>;

export default function Faculty() {
  const apps = useLoad<any>(() => api('/applications?page_size=100'));
  const [appId, setAppId] = useState('');
  const [intake, setIntake] = useState(120), [years, setYears] = useState(4), [ratio, setRatio] = useState(20);
  const [data, setData] = useState<any>(null), [error, setError] = useState<unknown>(null);
  useEffect(() => { setData(null); setError(null); if (appId) api(`/lab/faculty-roster/${appId}`).then(setData).catch(setError); }, [appId]);
  const req = useMemo(() => {
    const need = Math.ceil((intake * years) / ratio), p = Math.floor(need / 9), a = Math.floor((2 * need) / 9);
    return { need, p, a, s: need - p - a };
  }, [intake, years, ratio]);
  const listed = data?.listed ?? 0, short = Math.max(0, req.need - listed);
  const initials = (n: string) => n.replace(/^(dr|prof|mr|mrs|ms|er)\.?\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const slider = (label: string, v: number, set: (n: number) => void, min: number, max: number, step: number) => (
    <label className="block text-xs"><span className="flex justify-between font-semibold"><span>{label}</span><b className="font-display text-sm tabular-nums">{v}</b></span><input type="range" className="mt-1 w-full" min={min} max={max} step={step} value={v} onChange={(e) => set(+e.target.value)} /></label>);

  return (
    <div className="space-y-5">
      <PageTitle eyebrow="Evidence" title="Faculty verification" sub="Who is listed, whether the identifiers are well-formed, whether the same person appears at another institution, and what the proposed intake requires." />
      <div className="panel rise p-3"><select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-800 md:max-w-md" value={appId} onChange={(e) => setAppId(e.target.value)}><option value="">Select application…</option>{(apps.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.institution_name} · {a.id}</option>)}</select></div>
      {error != null && <ErrorBox error={error} />}
      {!appId ? <Empty>Select an application that has a faculty list. A sample faculty list is in the demo files.</Empty> : data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi index={0} icon={UsersRound} tone="verdigris" label="Faculty listed" value={listed} hint="parsed from the faculty list" />
            <Kpi index={1} icon={Calculator} tone="ink" label="Required (draft rule)" value={req.need} hint={`⌈${intake} × ${years} ÷ ${ratio}⌉`} />
            <Kpi index={2} icon={Calculator} tone={short ? 'vermilion' : 'verdigris'} label="Shortfall" value={short} hint={short ? 'indicator for review' : 'requirement met'} />
            <Kpi index={3} icon={UsersRound} tone="marigold" label="Listed elsewhere" value={data.people.filter((p: any) => p.listed_elsewhere.length).length} hint="possible dual listing" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card icon={UsersRound} title="Faculty roster">
              {data.people.length === 0 ? <Empty>No named faculty were found. Upload a faculty list PDF with one person per line (name, designation, UAN or PAN).</Empty> : (
                <ul className="divide-y divide-[var(--rule)]">{data.people.map((p: any, i: number) => (
                  <li key={i} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-50 font-display text-indigo-700">{initials(p.name)}</span>
                    <div className="min-w-[10rem] flex-1"><div className="font-semibold">{p.name}</div><div className="text-xs text-slate-500">{p.designation ?? 'Designation not stated'}</div></div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.uan ? <Chip ok={p.uan_format_ok}>UAN {p.uan}</Chip> : <Chip off>no UAN</Chip>}
                      {p.pan ? <Chip ok={p.pan_format_ok}>PAN {p.pan}{p.pan_format_ok ? '' : ' ?'}</Chip> : <Chip off>no PAN</Chip>}
                      {p.listed_elsewhere.map((h: any, k: number) => <Link key={k} href={`/applications/${h.application_id}`}><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${h.level === 'strong' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{h.level} · also at {h.institution}</span></Link>)}
                    </div></li>))}</ul>)}
              <p className="mt-3 text-[11px] text-slate-500">{data.limitations}</p>
            </Card>
            <div className="space-y-5">
              <Card icon={Calculator} title="Requirement planner (draft parameters)">
                <div className="space-y-3">{slider('Proposed annual intake', intake, setIntake, 30, 480, 10)}{slider('Programme years', years, setYears, 1, 6, 1)}{slider('Students per faculty', ratio, setRatio, 8, 30, 1)}</div>
                <div className="mt-4"><div className="mb-1 flex justify-between text-xs"><span>Listed vs required</span><b>{listed} / {req.need}</b></div><div className="h-2.5 overflow-hidden rounded-full bg-[var(--rule)]"><div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (100 * listed) / Math.max(1, req.need))}%`, background: short ? '#B93A28' : '#2C7A3E' }} /></div></div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">{[['Professors', req.p, data.cadre_counts['Professor']], ['Associate', req.a, data.cadre_counts['Associate Professor']], ['Assistant', req.s, data.cadre_counts['Assistant Professor']]].map(([l, t, h]: any) => <div key={l} className="rounded-lg border border-[var(--rule)] p-2"><div className="text-[10px] font-semibold uppercase text-slate-500">{l}</div><div className="font-display text-lg tabular-nums">{h}<span className="text-slate-400"> / {t}</span></div></div>)}</div>
                <p className="mt-3 text-[11px] text-slate-500">Cadre target uses the 1 : 2 : 6 split, rounded down for the two senior cadres. Every parameter here is an editable placeholder; the matching rule <b>APH-2.6-FAC-001</b> stays a draft until an expert approves it in the <Link href="/rulebook" className="text-indigo-700 underline">Executable Handbook</Link>.</p>
              </Card>
            </div>
          </div>
        </>)}
      <FacultyCrossCheck />
    </div>
  );
}
