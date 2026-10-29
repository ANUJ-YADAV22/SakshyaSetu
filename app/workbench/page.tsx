'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Crosshair, ZoomIn, ShieldAlert, CircleCheck, CircleHelp, FileText, ScanEye, Waves, Scan } from 'lucide-react';
import { api, blobUrl } from '@/lib/api';
import { Card, Empty, PageTitle, StatusBadge, useLoad } from '@/components/ui';
import { ela, loadImage, noiseMap } from '@/lib/alteration';

const LENS = 170, ZOOM = 4;
type View = 'original' | 'fields' | 'heatmap' | 'compression';
type Side = 'attributes' | 'compliance' | 'faculty';
const VIEWS: { id: View; label: string; icon: React.ElementType }[] = [{ id: 'original', label: 'Original document', icon: FileText }, { id: 'fields', label: 'Extracted fields', icon: Scan }, { id: 'heatmap', label: 'Alteration heatmap', icon: ScanEye }, { id: 'compression', label: 'Compression analysis', icon: Waves }];
const sel = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-800';
const confColor = (c: number) => (c >= 0.9 ? '#2C7A3E' : c >= 0.75 ? '#D9A21B' : '#B93A28');

export default function Workbench() {
  const apps = useLoad<any>(() => api('/applications?page_size=100'));
  const [appId, setAppId] = useState(''), [docs, setDocs] = useState<any[]>([]), [docId, setDocId] = useState(''), [page, setPage] = useState(1);
  const [rec, setRec] = useState<any>(null), [findings, setFindings] = useState<any[]>([]), [roster, setRoster] = useState<any>(null);
  const [view, setView] = useState<View>('original'), [side, setSide] = useState<Side>('attributes'), [sel_, setSel] = useState<string | null>(null);
  const [src, setSrc] = useState(''), [viewSrc, setViewSrc] = useState(''), [loupe, setLoupe] = useState(true);
  const [pos, setPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const doc = docs.find((d) => d.id === docId), isPdf = /\.pdf$/i.test(doc?.filename ?? '');

  useEffect(() => { setDocs([]); setDocId(''); if (appId) api(`/applications/${appId}/documents`).then((d: any[]) => setDocs(d.filter((x) => !x.superseded_by && /\.(pdf|png|jpe?g)$/i.test(x.filename)))).catch((e) => toast.error(e.message)); }, [appId]);
  useEffect(() => {
    setRec(null); setFindings([]); setRoster(null); setSel(null); setPage(1); setView('original'); if (!docId) return;
    api(`/lab/documents/${docId}/reconciliation`).then(setRec).catch(() => {});
    api(`/applications/${appId}/findings`).then((r: any) => setFindings((r.items ?? []).filter((f: any) => (f.evidence ?? []).some((e: any) => e.doc_id === docId)))).catch(() => {});
  }, [docId]);
  useEffect(() => { if (side === 'faculty' && appId && !roster) api(`/lab/faculty-roster/${appId}`).then(setRoster).catch(() => {}); }, [side, appId]);
  useEffect(() => {
    let u = ''; setSrc(''); if (!docId) return;
    blobUrl(isPdf ? `/documents/${docId}/page/${page}.png?boxes=false&dpi=130` : `/documents/${docId}/file`).then((v) => { u = v; setSrc(v); }).catch(() => toast.error('Could not render this document'));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [docId, page, doc?.filename]);
  useEffect(() => {
    if (!src) { setViewSrc(''); return; } let live = true;
    (async () => {
      if (view === 'original' || view === 'fields') { setViewSrc(src); return; }
      const im = await loadImage(src);
      const url = view === 'heatmap' ? (await ela(im, 75, 20)).canvas.toDataURL() : noiseMap(im).canvas.toDataURL();
      if (live) setViewSrc(url);
    })().catch(() => {});
    return () => { live = false; };
  }, [src, view]);

  const rows = (rec?.rows ?? []) as any[], pageRows = rows.filter((r) => r.page === page && r.bbox);
  const mism = rows.filter((r) => r.state === 'mismatch').length;
  const jump = (name: string, pg: number) => { setSel(name); if (pg && pg !== page) setPage(pg); };
  const move = (e: React.MouseEvent) => { const r = box.current!.getBoundingClientRect(); setPos({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }); };
  const SrcBadge = rec?.source;

  return (
    <div className="space-y-5">
      <PageTitle eyebrow="Evidence" title="Evidence workbench" sub="One document, four views, and the authority record beside what was uploaded. Click any row to see where on the page the value came from." />
      <div className="panel rise grid grid-cols-[minmax(0,1fr)] gap-2 p-3 md:grid-cols-[1fr_1fr_auto]">
        <select className={sel} value={appId} onChange={(e) => setAppId(e.target.value)}><option value="">Select application…</option>{(apps.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.institution_name} · {a.id}</option>)}</select>
        <select className={sel} value={docId} onChange={(e) => setDocId(e.target.value)}><option value="">Select document…</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.filename} · {d.doc_type ?? 'unclassified'}</option>)}</select>
        <button onClick={() => setLoupe(!loupe)} className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${loupe ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white'}`}><ZoomIn className="h-4 w-4" />{ZOOM}× loupe</button>
      </div>

      {!docId ? <Empty>Select an application and a document. Load the demo dossiers on the Case desk if you have none.</Empty> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <nav className="flex flex-wrap gap-1.5 rounded-2xl border border-[var(--rule)] bg-[var(--panel)] p-1.5" role="tablist">
              {VIEWS.map((v) => <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold transition-all ${view === v.id ? 'bg-[#11201B] text-white shadow' : 'text-slate-600 hover:bg-indigo-50'}`}><v.icon className="h-4 w-4" />{v.label}</button>)}
              {isPdf && doc?.page_count > 1 && <span className="ml-auto flex items-center gap-1">{Array.from({ length: doc.page_count }, (_, i) => <button key={i} onClick={() => setPage(i + 1)} className={`h-8 w-8 rounded-md text-xs font-bold ${page === i + 1 ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>{i + 1}</button>)}</span>}
            </nav>
            <div className="panel rise p-4">
              {!viewSrc ? <div className="skeleton h-[520px] w-full" /> : (
                <div ref={box} className="relative mx-auto w-full max-w-[680px] cursor-crosshair select-none rounded-lg border border-slate-300 bg-white shadow-md" onMouseMove={move} onMouseLeave={() => setPos(null)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={viewSrc} alt={`${view} view of ${doc?.filename}`} className="block w-full rounded-lg" draggable={false} />
                  {(view === 'original' || view === 'fields') && pageRows.map((r) => (view === 'fields' || sel_ === r.name) && (
                    <button key={r.name} onClick={() => setSel(r.name)} aria-label={`Field ${r.name}`} className={`absolute rounded-sm border-2 transition-all ${sel_ === r.name ? 'z-10 border-[#CF4A36] bg-[#F4CB45]/40 shadow-[0_0_0_3px_rgba(244,203,69,.5)]' : r.state === 'mismatch' ? 'border-[#CF4A36]/80 bg-[#CF4A36]/10' : 'border-[#1F7A6A]/70 bg-[#1F7A6A]/10 hover:bg-[#1F7A6A]/25'}`}
                      style={{ left: `${r.bbox[0] * 100}%`, top: `${r.bbox[1] * 100}%`, width: `${(r.bbox[2] - r.bbox[0]) * 100}%`, height: `${(r.bbox[3] - r.bbox[1]) * 100}%` }} />))}
                  {loupe && pos && (
                    <div className="pointer-events-none absolute z-20 rounded-full border-[3px] border-[#F4CB45] shadow-[0_8px_30px_rgba(0,0,0,.45)]" style={{ width: LENS, height: LENS, left: pos.x - LENS / 2, top: pos.y - LENS / 2, backgroundColor: '#fff', backgroundImage: `url(${viewSrc})`, backgroundRepeat: 'no-repeat', backgroundSize: `${pos.w * ZOOM}px ${pos.h * ZOOM}px`, backgroundPosition: `${-(pos.x * ZOOM - LENS / 2)}px ${-(pos.y * ZOOM - LENS / 2)}px` }}>
                      <span className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-red-500/70" />
                      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#11201B] px-1.5 py-0.5 text-[10px] font-bold text-white">{Math.round(pos.x)}, {Math.round(pos.y)} · {ZOOM}×</span>
                    </div>)}
                </div>)}
              <p className="mt-3 text-center text-[11px] text-slate-500">{view === 'heatmap' ? 'Error-level heatmap of this page (indicator only).' : view === 'compression' ? 'Local noise map. Rendered text pages have no grain, so use scans and photographs.' : 'Derived rendering; the source file is never changed.'}</p>
            </div>
          </div>

          <div className="space-y-3">
            <nav className="flex gap-1.5 rounded-2xl border border-[var(--rule)] bg-[var(--panel)] p-1.5" role="tablist">
              {([['attributes', 'Attributes & verification'], ['compliance', `Compliance (${findings.length})`], ['faculty', 'Faculty cross-check']] as [Side, string][]).map(([id, l]) => <button key={id} role="tab" aria-selected={side === id} onClick={() => setSide(id)} className={`flex-1 rounded-xl px-2 py-2 text-[12.5px] font-semibold transition-all ${side === id ? 'bg-[#11201B] text-white shadow' : 'text-slate-600 hover:bg-indigo-50'}`}>{l}</button>)}
            </nav>

            {side === 'attributes' && (<>
              <div className="panel rise p-4">
                <h2 className="font-display text-lg">Document attributes & authority reconciliation</h2>
                <p className="mt-0.5 text-xs text-slate-500">Click a row to highlight its box on the page.</p>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Issuing source</dt><dd className="text-right font-semibold">{SrcBadge?.source_name ?? 'No source check yet'}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Reference</dt><dd className="font-mono text-xs font-semibold text-indigo-700">{SrcBadge?.response_reference ?? rec?.record?.aicte_id ?? '-'}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Verification status</dt><dd className="flex items-center gap-2">{SrcBadge && <StatusBadge status={SrcBadge.status} />}{SrcBadge?.provenance && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">{SrcBadge.provenance}</span>}</dd></div>
                </dl>
              </div>
              {rows.length === 0 ? <Empty>No fields yet. Open the case and choose Evaluate rules; fields are extracted when the application is evaluated.</Empty> : rows.map((r) => (
                <button key={r.name} onClick={() => jump(r.name, r.page)} className={`panel rise block w-full overflow-hidden text-left transition-all hover:-translate-y-0.5 ${sel_ === r.name ? 'ring-2 ring-[#CF4A36]' : ''}`}>
                  <div className={`flex items-center justify-between gap-2 px-4 py-2.5 ${r.state === 'mismatch' ? 'bg-red-50' : r.state === 'match' ? 'bg-emerald-50/60' : 'bg-slate-50'} dark:bg-transparent`}>
                    <span className="flex items-center gap-2 font-display text-[15px]">{r.state === 'mismatch' ? <ShieldAlert className="h-4 w-4 text-red-700" /> : r.state === 'match' ? <CircleCheck className="h-4 w-4 text-emerald-700" /> : <CircleHelp className="h-4 w-4 text-slate-500" />}{r.name.replace(/_/g, ' ')}</span>
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `${confColor(r.confidence)}22`, color: confColor(r.confidence) }}>OCR {Math.round(r.confidence * 100)}%</span>
                  </div>
                  <div className="grid grid-cols-2 gap-px bg-[var(--rule)]">
                    <div className="bg-[var(--panel)] p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Uploaded document (OCR)</div><div className={`mt-0.5 break-words font-semibold ${r.state === 'mismatch' ? 'text-red-700' : ''}`}>{r.uploaded}</div></div>
                    <div className="bg-[var(--panel)] p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Authority record</div><div className="mt-0.5 break-words font-semibold">{r.authority ?? <span className="font-normal text-slate-400">no automated record</span>}</div></div>
                  </div>
                  {r.state === 'mismatch' && <div className="bg-red-50 px-4 py-2 text-xs font-semibold text-red-800">Differs from the authority record. An officer confirms with the issuer; this is an indicator, not a finding of fault.</div>}
                  {r.state === 'no_record' && r.confidence < 0.75 && <div className="bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900">Low OCR confidence: an officer must confirm this value.</div>}
                </button>))}
              <p className="text-[11px] text-slate-500">{rec?.note}</p>
            </>)}

            {side === 'compliance' && (
              <Card title="Findings that cite this document">
                {findings.length === 0 ? <p className="text-sm text-slate-500">No finding cites this document yet. Evaluate the application to run the rules.</p> : (
                  <ul className="space-y-2">{findings.map((f) => { const ev = f.evidence.find((e: any) => e.doc_id === docId);
                    return <li key={f.id}><button onClick={() => ev?.page && setPage(ev.page)} className="w-full rounded-xl border border-[var(--rule)] p-3 text-left hover:border-indigo-500">
                      <div className="flex items-center justify-between gap-2"><StatusBadge status={f.status} /><span className="font-mono text-[11px] text-slate-500">{f.rule_id ?? f.check_id}</span></div>
                      <p className="mt-1.5 text-sm">{f.message}</p><p className="mt-1 text-[11px] text-slate-500">Evidence: page {ev?.page ?? '-'}{f.aph_clause ? ` · ${f.aph_clause}` : ''}</p></button></li>; })}</ul>)}
              </Card>)}

            {side === 'faculty' && (
              <Card title="Faculty cross-check">
                {doc?.doc_type !== 'faculty_list' && !roster?.listed ? <p className="text-sm text-slate-600">This document is not a faculty list. Open the <Link className="text-indigo-700 underline" href="/faculty">Faculty page</Link> for the case roster and the cross-institution check.</p>
                  : !roster ? <div className="skeleton h-24 w-full" /> : (<>
                    <p className="mb-2 text-sm"><b>{roster.listed}</b> people listed · {roster.people.filter((p: any) => p.listed_elsewhere.length).length} also appear at another institution.</p>
                    <ul className="space-y-1.5">{roster.people.map((p: any, i: number) => <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--rule)] p-2 text-sm"><span>{p.name}<span className="block text-[11px] text-slate-500">{p.designation ?? '-'}</span></span>{p.listed_elsewhere.length > 0 ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p.listed_elsewhere[0].level === 'strong' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{p.listed_elsewhere[0].level} · {p.listed_elsewhere[0].institution}</span> : <span className="text-[11px] text-emerald-700">unique</span>}</li>)}</ul></>)}
              </Card>)}
          </div>
        </div>)}
    </div>
  );
}
