'use client';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Card, StatusBadge, useLoad } from '@/components/ui';
import { ArtifactImg } from '@/components/shared';

/** Runs the backend document-lab checks (font consistency, copy-move) on a chosen uploaded file. */
export default function DocLab() {
  const apps = useLoad<any>(() => api('/applications?page_size=100'));
  const [appId, setAppId] = useState('');
  const [docs, setDocs] = useState<any[]>([]);
  const [docId, setDocId] = useState('');
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setDocs([]); setDocId(''); setRes(null);
    if (!appId) return;
    api(`/applications/${appId}/documents`).then((d: any[]) => setDocs(d.filter((x) => !x.superseded_by && /\.(pdf|png|jpe?g)$/i.test(x.filename)))).catch((e) => toast.error(e.message));
  }, [appId]);

  const run = async (kind: 'font-report' | 'copy-move') => {
    if (!docId) return toast.error('Select a document');
    setBusy(kind); setRes(null);
    try { setRes({ kind, ...(await api(`/lab/documents/${docId}/${kind}`, { method: 'POST' })) }); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };
  const sel = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-800';
  return (
    <Card title="Document lab (runs on the server, original file untouched)">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-4">
        <select className={sel} value={appId} onChange={(e) => setAppId(e.target.value)}><option value="">Select application…</option>{(apps.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.institution_name} · {a.id}</option>)}</select>
        <select className={sel} value={docId} onChange={(e) => { setDocId(e.target.value); setRes(null); }}><option value="">Select document…</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.filename} (v{d.version})</option>)}</select>
        <Btn busy={busy === 'font-report'} onClick={() => run('font-report')}>Font consistency</Btn>
        <Btn variant="ghost" busy={busy === 'copy-move'} onClick={() => run('copy-move')}>Copy-move scan</Btn>
      </div>
      {res && (
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><StatusBadge status={res.status} /><b>{res.kind === 'font-report' ? 'Font consistency' : 'Copy-move scan'}</b></div>
            <p>{res.message ?? res.reason}</p>
            {res.kind === 'font-report' && (res.instances ?? []).length > 0 && (
              <ul className="space-y-1 text-xs">{res.instances.map((i: any, k: number) => <li key={k} className="rounded bg-amber-50 p-2 text-amber-900">Page {i.page}: “{i.text}” set in <b>{i.font}</b>; the page’s words use {i.page_word_fonts.join(', ')}.</li>)}</ul>)}
            {res.kind === 'font-report' && res.fonts && <details className="text-xs"><summary className="cursor-pointer text-indigo-700">Fonts in this file</summary><ul className="mt-1 font-mono">{Object.entries(res.fonts).map(([f, p]: any) => <li key={f}>{f} · p.{p.join(',')}</li>)}</ul></details>}
            {res.kind === 'copy-move' && res.transform && <div className="rounded bg-slate-50 p-2 text-xs dark:bg-slate-800/60">Repeat is shifted {res.transform.shift_px[0]}, {res.transform.shift_px[1]} px · rotation {res.transform.rotation_deg}° · scale {res.transform.scale} · {res.inliers} matching keypoints</div>}
            <p className="text-[11px] text-slate-500">{res.limitations}</p>
          </div>
          {res.overlay_path && <ArtifactImg path={res.overlay_path} label="Matched keypoints (red = source, blue = repeat)" />}
        </div>)}
    </Card>
  );
}
