'use client';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Fingerprint, FileSearch, Stamp, Waves, Binary } from 'lucide-react';
import { api, blobUrl } from '@/lib/api';
import { Card, StatusBadge, useLoad } from '@/components/ui';
import { ela, loadImage, noiseMap, residualStats, Stat } from '@/lib/alteration';

type Tab = 'sandbox' | 'noise' | 'seal' | 'audit';
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'sandbox', label: 'Alteration sandbox', icon: Fingerprint }, { id: 'noise', label: 'Noise residual inspector', icon: Waves },
  { id: 'seal', label: 'Seal & signature', icon: Stamp }, { id: 'audit', label: 'PDF stream & metadata audit', icon: FileSearch },
];
const sel = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-800';

/** Forensic studio for a document that is already in a case. The page is rendered by the server; every analysis then runs in the browser. */
export default function ForensicStudio() {
  const apps = useLoad<any>(() => api('/applications?page_size=100'));
  const [appId, setAppId] = useState(''), [docs, setDocs] = useState<any[]>([]), [docId, setDocId] = useState(''), [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>('sandbox'), [Q, setQ] = useState(75), [gain, setGain] = useState(20);
  const [img, setImg] = useState<HTMLImageElement | null>(null), [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stat[] | null>(null), [note, setNote] = useState(''), [hotTxt, setHotTxt] = useState('');
  const [info, setInfo] = useState<any>(null), [fontRep, setFontRep] = useState<any>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const doc = docs.find((d) => d.id === docId), isPdf = /\.pdf$/i.test(doc?.filename ?? '');

  useEffect(() => { setDocs([]); setDocId(''); if (appId) api(`/applications/${appId}/documents`).then((d: any[]) => setDocs(d.filter((x) => !x.superseded_by && /\.(pdf|png|jpe?g)$/i.test(x.filename)))).catch((e) => toast.error(e.message)); }, [appId]);
  useEffect(() => {
    setImg(null); setStats(null); setInfo(null); setFontRep(null); setPage(1); if (!docId) return; let u = '';
    api(`/lab/documents/${docId}/studio`).then(setInfo).catch((e) => toast.error(e.message));
  }, [docId]);
  useEffect(() => {
    if (!docId || !doc) return; let u = ''; setImg(null);
    const path = isPdf ? `/documents/${docId}/page/${page}.png?boxes=false&dpi=150` : `/documents/${docId}/file`;
    blobUrl(path).then(async (v) => { u = v; setImg(await loadImage(v)); }).catch(() => toast.error('Could not load this document'));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [docId, page, doc?.filename]);

  const draw = (c: HTMLCanvasElement) => { const el = view.current; if (!el) return; el.width = c.width; el.height = c.height; el.getContext('2d')!.drawImage(c, 0, 0); };
  useEffect(() => {
    if (!img || (tab !== 'sandbox' && tab !== 'noise')) return; let live = true; setBusy(true);
    (async () => {
      try {
        if (tab === 'sandbox') {
          const r = await ela(img, Q, gain); if (!live) return; draw(r.canvas); setStats(residualStats(r.resid, r.w, r.h, gain));
          setNote('Yellow boxes: the five 32 px blocks with the highest residual.'); setHotTxt(`Peak block residual ${r.hot[0]?.v.toFixed(2) ?? '-'}`);
        } else {
          const r = noiseMap(img); if (!live) return; draw(r.canvas);
          setNote(r.note || `Typical noise σ≈${r.sigma.toFixed(2)}. ${r.flagged} of ${r.measurable} measurable blocks deviate strongly (red noisier, blue smoother).`); setHotTxt('');
          if (!stats) { const e = await ela(img, Q, gain); setStats(residualStats(e.resid, e.w, e.h, gain)); }
        }
      } catch (e: any) { toast.error(String(e.message ?? e)); } finally { if (live) setBusy(false); }
    })();
    return () => { live = false; };
  }, [img, tab, Q, gain]);
  useEffect(() => { if (tab === 'audit' && docId && isPdf && !fontRep) api(`/lab/documents/${docId}/font-report`, { method: 'POST' }).then(setFontRep).catch(() => {}); }, [tab, docId]);

  const md = info?.metadata ?? {}, sig = info?.signature ?? {};
  const row = (k: string, v: React.ReactNode, bad?: boolean) => <div key={k} className="flex items-baseline justify-between gap-4 border-b border-[var(--rule)] py-1.5 text-sm last:border-0"><dt className="text-slate-500">{k}</dt><dd className={`break-all text-right font-medium ${bad ? 'text-red-700' : ''}`}>{v ?? '-'}</dd></div>;

  return (
    <div className="space-y-4">
      <div className="panel rise grid grid-cols-[minmax(0,1fr)] gap-2 p-3 md:grid-cols-3">
        <select className={sel} value={appId} onChange={(e) => setAppId(e.target.value)}><option value="">Select application…</option>{(apps.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.institution_name} · {a.id}</option>)}</select>
        <select className={sel} value={docId} onChange={(e) => setDocId(e.target.value)}><option value="">Select document…</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.filename} · {d.doc_type ?? 'unclassified'}</option>)}</select>
        <div className="flex items-center gap-1.5 text-xs">{isPdf && doc?.page_count > 1 ? Array.from({ length: doc.page_count }, (_, i) => <button key={i} onClick={() => setPage(i + 1)} className={`h-8 w-8 rounded-md font-bold ${page === i + 1 ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>{i + 1}</button>) : <span className="text-slate-500">{docId ? 'Single page' : 'Pick a document to open the studio'}</span>}</div>
      </div>
      {docId && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <nav className="flex flex-wrap gap-1.5 rounded-2xl border border-[var(--rule)] bg-[var(--panel)] p-1.5" role="tablist">
              {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold transition-all ${tab === t.id ? 'bg-[#11201B] text-white shadow' : 'text-slate-600 hover:bg-indigo-50'}`}><t.icon className="h-4 w-4" />{t.label}</button>)}
            </nav>

            {(tab === 'sandbox' || tab === 'noise') && (
              <Card title={tab === 'sandbox' ? 'Pixel alteration & compression analysis' : 'Local noise-level consistency'}>
                <p className="mb-3 text-xs text-slate-600">{tab === 'sandbox' ? 'Residual |I − I_Q| × γ after re-saving at the reference quality. Regions with a different compression history can stand out.' : 'Robust noise estimate per 32 px block compared with the rest of the page.'}</p>
                {tab === 'sandbox' && <div className="mb-3 grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60 md:grid-cols-2">
                  <label className="flex items-center gap-3">Reference Q<input type="range" min={50} max={95} value={Q} onChange={(e) => setQ(+e.target.value)} className="flex-1" /><b className="w-10 text-right font-display text-sm text-indigo-700">{Q}%</b></label>
                  <label className="flex items-center gap-3">Gain γ<input type="range" min={5} max={60} value={gain} onChange={(e) => setGain(+e.target.value)} className="flex-1" /><b className="w-10 text-right font-display text-sm text-indigo-700">{gain}×</b></label></div>}
                <div className="relative overflow-hidden rounded-xl bg-[#0B1713] p-2">
                  {(!img || busy) && <div className="skeleton absolute inset-2 z-10 opacity-60" />}
                  <canvas ref={view} className="mx-auto block max-h-[560px] w-auto max-w-full rounded-lg" />
                </div>
                <p className="mt-2 text-xs text-slate-600">{note}{hotTxt && ` ${hotTxt}.`}</p>
              </Card>)}

            {tab === 'seal' && (
              <Card title="Seal & signature authenticator">
                <div className="flex items-center gap-3"><StatusBadge status={sig.status === 'valid' ? 'verified' : sig.status === 'invalid' ? 'mismatch_detected' : 'manual_review_required'} /><b>Cryptographic signature: {String(sig.status ?? 'unknown').replace(/_/g, ' ')}</b></div>
                {(sig.signatures ?? []).length > 0 ? <ul className="mt-3 space-y-2 text-sm">{sig.signatures.map((s: any, i: number) => <li key={i} className="rounded-lg border border-[var(--rule)] p-2.5"><b>{s.field ?? `Signature ${i + 1}`}</b><div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">{[['intact', s.intact], ['valid', s.valid], ['trusted chain', s.trusted]].map(([k, v]: any) => <span key={k} className={`rounded-full px-2 py-0.5 ${v ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{k}: {v ? 'yes' : 'no'}</span>)}</div></li>)}</ul>
                  : <p className="mt-3 text-sm text-slate-600">No embedded digital signature was found in this file. A picture of a signature or a stamp is shown as an image only; it is never treated as proof.</p>}
                <p className="mt-3 text-[11px] text-slate-500">{sig.limitations}</p>
              </Card>)}

            {tab === 'audit' && (
              <Card title="PDF stream & metadata audit">
                {!isPdf ? <p className="text-sm text-slate-600">This is an image file, so there is no PDF stream. See the byte structure panel for its container.</p> : (<>
                  <dl>{row('Producer', md.producer, /photoshop|canva|gimp|editor/i.test(md.producer ?? ''))}{row('Creator', md.creator)}{row('Created', md.creation_date)}{row('Modified', md.mod_date, !!md.mod_date && !!md.creation_date && md.mod_date > md.creation_date)}{row('Pages', md.page_count)}{row('Incremental updates', md.incremental_updates, (md.incremental_updates ?? 0) > 0)}{row('Embedded fonts', (md.fonts ?? []).length)}</dl>
                  {(md.anomalies ?? []).length > 0 ? <ul className="mt-3 space-y-1">{md.anomalies.map((a: string) => <li key={a} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{a}</li>)}</ul> : <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900">No metadata anomaly found. Stripped or clean metadata proves nothing either way.</p>}
                  {fontRep && <div className="mt-3 rounded-lg border border-[var(--rule)] p-2.5 text-xs"><div className="mb-1 flex items-center gap-2"><StatusBadge status={fontRep.status} /><b>Font consistency</b></div>{fontRep.message}</div>}
                </>)}
              </Card>)}
          </div>

          <div className="space-y-4">
            <Card icon={Fingerprint} title="Residual statistics (12 descriptive scalars)" right={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">no classifier</span>}>
              {stats ? <div className="grid grid-cols-2 gap-2">{stats.map((s) => <div key={s.k} title={s.d} className="rounded-lg border border-[var(--rule)] p-2"><div className="text-[10px] font-semibold text-slate-500">{s.k}</div><div className="font-display text-base tabular-nums">{s.v}</div></div>)}</div> : <div className="skeleton h-40 w-full" />}
              <p className="mt-2 text-[11px] text-slate-500">Plain numbers describing the residual image. They produce no score and no verdict; a reviewer interprets them next to the heatmap.</p>
            </Card>
            <Card icon={Binary} title="Byte structure & software signature">
              {info ? (<dl>
                {row('Filename', info.filename)}{row('File size', `${(info.size / 1024).toFixed(1)} KB`)}
                {info.page_size_pt && row('Page size', `${info.page_size_pt[0]} × ${info.page_size_pt[1]} pt`)}
                {info.raster && row('Raster', `${info.raster.width} × ${info.raster.height} px${info.raster.dpi?.[0] ? ` (${info.raster.dpi[0]} dpi)` : ''}`)}
                {row('Detected producer', md.producer ?? (info.editor_strings[0] ?? 'none found'), /photoshop|canva|gimp|editor/i.test(md.producer ?? '') || info.editor_strings.length > 0)}
                {info.editor_strings.length > 0 && row('Editor strings in bytes', info.editor_strings.join(', '), true)}
                <div className="pt-2"><dt className="text-sm text-slate-500">SHA-256 digest</dt><dd className="mt-0.5 break-all font-mono text-[11px] text-indigo-700">{info.sha256}</dd></div>
              </dl>) : <div className="skeleton h-32 w-full" />}
            </Card>
          </div>
        </div>)}
    </div>
  );
}
