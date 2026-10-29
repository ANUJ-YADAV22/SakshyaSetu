'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Card, Empty, ErrorBox, Loading, PageTitle, StatusBadge, useLoad } from '@/components/ui';
import { ArtifactImg } from '@/components/shared';
import { useSession } from '@/lib/session';
import GeoTools from '@/components/GeoTools';

export default function Infrastructure() {
  const { t, role } = useSession();
  const { data, error, loading } = useLoad<any>(() => api('/findings?family=infrastructure'));
  const [apps, setApps] = useState<any[]>([]);
  const [docId, setDocId] = useState('');
  const [mpp, setMpp] = useState('');
  const [declared, setDeclared] = useState('');
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const plans = useLoad<any[]>(async () => {
    const list = await api('/applications?page_size=100');
    const out: any[] = [];
    for (const a of list.items) {
      const docs = await api(`/applications/${a.id}/documents`);
      docs.filter((d: any) => d.doc_type === 'floor_plan' && !d.superseded_by).forEach((d: any) => out.push({ ...d, app: a.id, inst: a.institution_name }));
    }
    setApps(out); return out;
  });
  if (role === 'applicant') return <Card>Infrastructure advisories are visible to officers and reviewers.</Card>;

  const analyse = async () => {
    if (!docId) return toast.error('Select a floor plan');
    setBusy(true);
    try {
      const q = new URLSearchParams({ doc_id: docId });
      if (mpp) q.set('meters_per_pt', mpp);
      if (declared) q.set('declared_area_sqm', declared);
      setRes(await api(`/infrastructure/geometry?${q}`, { method: 'POST' }));
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const inp = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-800';

  return (
    <div className="space-y-5">
      <PageTitle title={t.infrastructure} sub="Geometry first, vision second. All results are advisory and cannot reject an application. Photograph facility recognition and video continuity are designed but not implemented - they are not assessed." />
      <Card title="Floor-plan area calculator (deterministic geometry)">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-5">
          <select className={`${inp} md:col-span-2`} value={docId} onChange={(e) => setDocId(e.target.value)}>
            <option value="">Select floor plan…</option>{apps.map((d) => <option key={d.id} value={d.id}>{d.inst} - {d.filename}</option>)}
          </select>
          <input className={inp} placeholder="Metres per PDF point (calibration)" value={mpp} onChange={(e) => setMpp(e.target.value)} />
          <input className={inp} placeholder="Declared area (sq.m)" value={declared} onChange={(e) => setDeclared(e.target.value)} />
          <Btn onClick={analyse} busy={busy}>Calculate</Btn>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">If no printed scale is found and no calibration is given, the system asks for calibration instead of guessing.</p>
        {res && (
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
            <div className="space-y-1 text-sm">
              <StatusBadge status={res.status} /> <span>{res.reason}</span>
              {res.measured_sqm != null && <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
                <div>Measured ({res.measured_basis}): <b>{res.measured_sqm} sq.m</b> · Boundary: {res.boundary_sqm} sq.m</div>
                <div>Declared: <b>{res.declared_sqm ?? 'n/a'}</b>{res.deviation_pct != null && <> · Deviation: <b>{res.deviation_pct}%</b> (tolerance ±{res.tolerance_pct}%)</>}</div>
                <div>Scale: {res.scale_source} · Formula: {res.formula}</div>
                <div className="mt-1 text-slate-500">Assumptions: {res.assumptions?.join('; ') || 'none'}</div></div>}
              {res.next_step && <p className="text-xs">Next step: {res.next_step}</p>}
              <p className="text-[11px] text-slate-500">{res.limitations}</p>
            </div>
            {res.overlay_path && <ArtifactImg path={res.overlay_path} label="Measured regions overlay" />}
          </div>)}
      </Card>
      <GeoTools />
      {loading && <Loading />}{error != null && <ErrorBox error={error} />}
      {data && (data.items.length === 0 ? <Empty>No infrastructure findings yet.</Empty> : (
        <Card title="Infrastructure findings (advisory)">
          <ul className="space-y-2">{data.items.map((f: any) => (
            <li key={f.id} className="rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-700">
              <div className="flex items-center gap-2"><StatusBadge status={f.status} /><b>{f.title}</b><span className="text-[11px] text-slate-500">{f.institution_name} · <Link className="text-indigo-700 underline" href={`/applications/${f.application_id}`}>{f.application_id}</Link></span></div>
              <p className="mt-1 text-xs">{f.message}</p>{f.next_action && <p className="text-[11px] text-slate-500">Next: {f.next_action}</p>}
              {f.outputs?.level && <p className="mt-1 text-xs"><b>Recommendation:</b> {f.outputs.level.replace(/_/g, ' ')}. <span className="text-slate-500">Not assessed: {f.outputs.not_assessed?.join('; ')}</span></p>}
            </li>))}</ul>
        </Card>))}
    </div>
  );
}
