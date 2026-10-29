'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Ruler, ZoomIn, ZoomOut, RotateCcw, SlidersHorizontal, UsersRound } from 'lucide-react';
import { api, blobUrl } from '@/lib/api';
import { Card, Empty, PageTitle, useLoad } from '@/components/ui';
import { CountUp } from '@/components/viz';

type Pt = [number, number];
type Room = { id: string; label: string | null; poly: Pt[]; orig: Pt[]; stated: string };
const PT_TO_M_1_100 = 0.0352778;
const sel = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-800';
const shoelace = (p: Pt[]) => { let s = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; };
const f1 = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 1 });

export default function Blueprint() {
  const apps = useLoad<any>(() => api('/applications?page_size=100'));
  const [appId, setAppId] = useState(''), [docs, setDocs] = useState<any[]>([]), [docId, setDocId] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]), [outer, setOuter] = useState<Pt[] | null>(null), [scale, setScale] = useState(PT_TO_M_1_100), [how, setHow] = useState(''), [declared, setDeclared] = useState('');
  const [bg, setBg] = useState(''), [dim, setDim] = useState<{ w: number; h: number } | null>(null), [zoom, setZoom] = useState(1), [msg, setMsg] = useState('');
  const [layers, setLayers] = useState({ rooms: true, handles: true, labels: true, underlay: true });
  const [tol, setTol] = useState(5);
  const drag = useRef<{ room: string; idx: number } | null>(null), svg = useRef<SVGSVGElement>(null);
  // what-if engine (every number is an editable draft parameter)
  const [ug, setUg] = useState(360), [pg, setPg] = useState(90), [share, setShare] = useState(15), [far, setFar] = useState(2.0), [norm, setNorm] = useState(4.5), [circ, setCirc] = useState(25), [rUg, setRUg] = useState(20), [rPg, setRPg] = useState(15);

  useEffect(() => { setDocs([]); setDocId(''); if (appId) api(`/applications/${appId}/documents`).then((d: any[]) => { const p = d.filter((x) => !x.superseded_by && /\.pdf$/i.test(x.filename)); setDocs(p); const fp = p.find((x) => x.doc_type === 'floor_plan' || /plan/i.test(x.filename)); if (fp) setDocId(fp.id); }).catch((e) => toast.error(e.message)); }, [appId]);

  useEffect(() => {
    setRooms([]); setOuter(null); setMsg(''); setBg(''); setHow(''); if (!docId) return; let u = '';
    (async () => {
      try {
        let r = await api(`/infrastructure/geometry?doc_id=${docId}&page=1`, { method: 'POST' }), assumed = false;
        if (!r.regions || r.reason === 'calibration_required') { r = await api(`/infrastructure/geometry?doc_id=${docId}&page=1&meters_per_pt=${PT_TO_M_1_100}`, { method: 'POST' }); assumed = true; }
        if (!r.regions?.length) { setMsg(r.reason ?? 'No closed vector regions found. Scanned or raster plans need manual polygon marking.'); return; }
        const regs = r.regions as any[]; setOuter(regs[0].polygon); setRooms(regs.slice(1).map((g, i) => ({ id: g.id ?? `R${i + 2}`, label: g.label, poly: g.polygon, orig: g.polygon, stated: (g.label?.match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m|m²|m2)/i) ?? [])[1] ?? '' })));
        setScale(r.scale_m_per_pt ?? PT_TO_M_1_100); setHow(assumed ? 'assumed 1:100 - calibrate below' : r.scale_source); if (r.declared_sqm) setDeclared(String(r.declared_sqm)); else api(`/documents/${docId}/fields`).then((fs: any[]) => { const f = fs.find((x) => x.name === 'declared_area_sqm'); const n = f && parseFloat(String(f.corrected_value ?? f.raw_value).replace(/[^\d.]/g, '')); if (n) setDeclared(String(n)); }).catch(() => {});
        u = await blobUrl(`/documents/${docId}/page/1.png?boxes=false&dpi=100`); setBg(u); const im = new Image(); im.onload = () => setDim({ w: im.naturalWidth * 0.72, h: im.naturalHeight * 0.72 }); im.src = u;
      } catch (e: any) { setMsg(e.message); }
    })();
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [docId]);

  const area = (p: Pt[]) => shoelace(p) * scale * scale;
  const measured = useMemo(() => rooms.reduce((s, r) => s + area(r.poly), 0), [rooms, scale]);
  const decl = parseFloat(declared), dev = decl > 0 ? ((measured - decl) / decl) * 100 : null;
  const toPt = (e: React.PointerEvent) => { const r = svg.current!.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * dim!.w, ((e.clientY - r.top) / r.height) * dim!.h] as Pt; };
  const onMove = (e: React.PointerEvent) => { const d = drag.current; if (!d || !dim) return; const p = toPt(e); setRooms((rs) => rs.map((r) => r.id === d.room ? { ...r, poly: r.poly.map((q, i) => (i === d.idx ? p : q)) } : r)); };
  const reset = () => { setRooms((rs) => rs.map((r) => ({ ...r, poly: r.orig }))); setScale(PT_TO_M_1_100); };

  const eng = useMemo(() => {
    const students = ug * 4 + pg * 2, ina = students * norm * (1 - share / 100), tb = ina * (1 + circ / 100), land = tb / far / 4046.86;
    const fac = Math.ceil((ug * 4) / rUg) + Math.ceil((pg * 2) / rPg), p = Math.floor(fac / 9), a = Math.floor((2 * fac) / 9);
    return { students, ina, circA: ina * (circ / 100), tb, land, fac, p, a, s: fac - p - a, cover: tb > 0 ? (measured / tb) * 100 : 0 };
  }, [ug, pg, share, far, norm, circ, rUg, rPg, measured]);
  const slider = (label: string, v: number, set: (n: number) => void, min: number, max: number, step: number, unit = '') => (
    <label className="block text-xs"><span className="flex justify-between font-semibold"><span>{label}</span><b className="font-display text-sm tabular-nums text-indigo-700">{v}{unit}</b></span><input type="range" className="mt-1 w-full" min={min} max={max} step={step} value={v} onChange={(e) => set(+e.target.value)} /></label>);
  const Chip = ({ k, children }: { k: keyof typeof layers; children: React.ReactNode }) => <button onClick={() => setLayers({ ...layers, [k]: !layers[k] })} aria-pressed={layers[k]} className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${layers[k] ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-600'}`}>{children}</button>;

  return (
    <div className="space-y-5">
      <PageTitle eyebrow="Evidence" title="Blueprint analysis" sub="Measure every room from the vector plan, drag a corner to correct it, calibrate the scale, and test what the proposed intake needs. Everything is advisory." />
      <div className="panel rise grid grid-cols-[minmax(0,1fr)] gap-2 p-3 md:grid-cols-2">
        <select className={sel} value={appId} onChange={(e) => setAppId(e.target.value)}><option value="">Select application…</option>{(apps.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.institution_name} · {a.id}</option>)}</select>
        <select className={sel} value={docId} onChange={(e) => setDocId(e.target.value)}><option value="">Select floor plan (PDF)…</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.filename} · {d.doc_type ?? 'unclassified'}</option>)}</select>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="panel rise p-4">
            <div className="flex flex-wrap items-center gap-2"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Layers</span>
              <Chip k="rooms">Room polygons</Chip><Chip k="handles">Corner handles</Chip><Chip k="labels">Labels</Chip><Chip k="underlay">Plan image</Chip>
              <span className="ml-auto flex items-center gap-1"><button aria-label="Zoom out" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300"><ZoomOut className="h-4 w-4" /></button><b className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</b><button aria-label="Zoom in" onClick={() => setZoom(Math.min(3, zoom + 0.25))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300"><ZoomIn className="h-4 w-4" /></button><button onClick={reset} className="ml-1 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold"><RotateCcw className="h-3.5 w-3.5" />Reset</button></span></div>
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60"><Ruler className="h-4 w-4 text-indigo-700" /><span className="font-semibold">Scale calibration</span><b className="font-display text-sm tabular-nums text-indigo-700">{scale.toFixed(5)} m/pt</b><span className="text-slate-500">{how}</span>
              <input type="range" aria-label="Scale m per pt" className="min-w-[8rem] flex-1" min={0.01} max={0.1} step={0.0005} value={scale} onChange={(e) => setScale(+e.target.value)} /><button onClick={() => setScale(PT_TO_M_1_100)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold">1:100</button></div>
          </div>

          <div className="rise overflow-auto rounded-2xl border border-[#1c3a31] bg-[#0B1713] p-3 shadow-lg" style={{ backgroundImage: 'linear-gradient(rgba(63,148,132,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(63,148,132,.12) 1px,transparent 1px)', backgroundSize: '24px 24px', maxHeight: 620 }}>
            {!docId ? <p className="p-10 text-center text-sm text-slate-400">Select an application with a vector floor plan. The demo floor plan works.</p> : msg ? <p className="p-10 text-center text-sm text-amber-300">{msg}</p> : !dim || !outer ? <div className="skeleton m-6 h-80 opacity-40" /> : (
              <div className="relative mx-auto" style={{ width: dim.w * zoom, maxWidth: 'none' }}>
                {layers.underlay && bg && /* eslint-disable-next-line @next/next/no-img-element */ <img src={bg} alt="Floor plan page" className="absolute inset-0 h-full w-full rounded-md opacity-35" draggable={false} />}
                <svg ref={svg} viewBox={`0 0 ${dim.w} ${dim.h}`} className="relative block w-full touch-none" onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerLeave={() => (drag.current = null)}>
                  <polygon points={outer.map((p) => p.join(',')).join(' ')} fill="none" stroke="#6FB1A3" strokeWidth={1.4} strokeDasharray="6 4" />
                  {layers.rooms && rooms.map((r) => {
                    const a = area(r.poly), st = parseFloat(r.stated), d = st > 0 ? ((a - st) / st) * 100 : null, bad = d != null && Math.abs(d) > tol, c = [r.poly.reduce((s, p) => s + p[0], 0) / r.poly.length, r.poly.reduce((s, p) => s + p[1], 0) / r.poly.length];
                    return (<g key={r.id}>
                      <polygon points={r.poly.map((p) => p.join(',')).join(' ')} fill={bad ? 'rgba(207,74,54,.38)' : 'rgba(63,148,132,.32)'} stroke={bad ? '#FF8A75' : '#9FE0D0'} strokeWidth={1.6} strokeDasharray={bad ? '5 3' : undefined} />
                      {layers.labels && <text x={c[0]} y={c[1]} textAnchor="middle" fontSize={Math.max(7, dim.w / 55)} fill="#E8EEE6" style={{ pointerEvents: 'none' }}><tspan x={c[0]} dy="-0.2em" fontWeight="700">{r.id}{r.label ? ` · ${r.label.slice(0, 18)}` : ''}</tspan><tspan x={c[0]} dy="1.3em">{f1(a)} m²{d != null ? ` (${d > 0 ? '+' : ''}${d.toFixed(1)}%)` : ''}</tspan></text>}
                      {layers.handles && r.poly.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={Math.max(3.5, dim.w / 160)} fill="#F4CB45" stroke="#11201B" strokeWidth={1} style={{ cursor: 'grab' }} onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { room: r.id, idx: i }; }} />)}
                    </g>);
                  })}
                </svg>
              </div>)}
          </div>

          <Card title="Rooms measured from the plan" right={<span className="flex items-center gap-2 text-xs">tolerance ±<input type="number" className="w-14 rounded border border-slate-300 px-1.5 py-0.5" value={tol} onChange={(e) => setTol(+e.target.value)} />%</span>}>
            {rooms.length === 0 ? <p className="text-sm text-slate-500">No rooms yet.</p> : (
              <table className="text-sm"><thead><tr className="text-left"><th>Room</th><th>Measured</th><th>Stated area (m²)</th><th>Difference</th></tr></thead>
                <tbody>{rooms.map((r) => { const a = area(r.poly), st = parseFloat(r.stated), d = st > 0 ? ((a - st) / st) * 100 : null, bad = d != null && Math.abs(d) > tol;
                  return <tr key={r.id} className="border-t border-[var(--rule)]"><td className="py-1.5"><b>{r.id}</b> <span className="text-xs text-slate-500">{r.label ?? ''}</span></td><td className="tabular-nums">{f1(a)} m²</td>
                    <td><input className="w-24 rounded border border-slate-300 px-1.5 py-0.5" placeholder="optional" value={r.stated} onChange={(e) => setRooms((rs) => rs.map((x) => (x.id === r.id ? { ...x, stated: e.target.value } : x)))} /></td>
                    <td>{d == null ? <span className="text-slate-400">-</span> : <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${bad ? 'bg-red-100 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{bad ? (d < 0 ? 'SHORTFALL' : 'INFLATION') : 'WITHIN'} {d > 0 ? '+' : ''}{d.toFixed(1)}%</span>}</td></tr>; })}</tbody></table>)}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><span>Total measured: <b className="font-display text-lg tabular-nums">{f1(measured)} m²</b></span>
              <label className="flex items-center gap-2 text-xs">Declared built-up (m²)<input className="w-24 rounded border border-slate-300 px-1.5 py-0.5" value={declared} onChange={(e) => setDeclared(e.target.value)} /></label>
              {dev != null && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${Math.abs(dev) > tol ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>{dev > 0 ? '+' : ''}{dev.toFixed(1)}% vs declared · {Math.abs(dev) > tol ? 'indicator for review' : 'within tolerance'}</span>}</div>
            <p className="mt-2 text-[11px] text-slate-500">area = ½·|Σ(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)| × (m/pt)². Dragging a corner recomputes instantly. Vector plans only; the result can never reject an application.</p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card icon={SlidersHorizontal} title="What-if intake engine (draft parameters)" right={<button onClick={() => { setUg(360); setPg(90); setShare(15); setFar(2); setNorm(4.5); setCirc(25); }} className="text-xs font-semibold text-indigo-700">Reset</button>}>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">{slider('UG annual intake', ug, setUg, 60, 960, 30, ' / yr')}{slider('PG annual intake', pg, setPg, 0, 240, 15, ' / yr')}{slider('Lab sharing discount', share, setShare, 0, 30, 1, '%')}{slider('Municipal FAR / FSI', far, setFar, 1, 4, 0.1)}{slider('Instructional norm (m² / student)', norm, setNorm, 2, 8, 0.1)}{slider('Circulation add-on', circ, setCirc, 10, 40, 1, '%')}</div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center">{[['Total built-up', eng.tb, 'm²'], ['Instructional', eng.ina, 'm²'], ['Circulation', eng.circA, 'm²'], ['Minimum land', eng.land, 'acres']].map(([l, v, u]: any) => <div key={l} className="rounded-xl border border-[var(--rule)] p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{l}</div><div className="font-display text-2xl tabular-nums">{u === 'acres' ? v.toFixed(2) : <CountUp ms={400} value={Math.round(v)} />}</div><div className="text-[11px] text-slate-500">{u}</div></div>)}</div>
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">Plan measured <b>{f1(measured)} m²</b> covers <b className={eng.cover < 100 ? 'text-red-700' : 'text-emerald-700'}>{eng.cover.toFixed(0)}%</b> of the computed built-up requirement for {eng.students} students.</div>
            <p className="mt-2 text-[11px] text-slate-500">Programme years 4 (UG) and 2 (PG). The norm, circulation, sharing and FAR values are placeholders, not APH numbers; replace them with approved rule-pack parameters before relying on any output.</p>
          </Card>
          <Card icon={UsersRound} title="Faculty requirement (1 : 2 : 6 cadre)">
            <div className="grid grid-cols-2 gap-3">{slider('UG students per faculty', rUg, setRUg, 10, 30, 1)}{slider('PG students per faculty', rPg, setRPg, 8, 25, 1)}</div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">{[['Total', eng.fac], ['Professors', eng.p], ['Associate', eng.a], ['Assistant', eng.s]].map(([l, v]: any) => <div key={l} className="rounded-xl border border-[var(--rule)] p-2"><div className="text-[10px] font-bold uppercase text-slate-500">{l}</div><div className="font-display text-xl tabular-nums">{v}</div></div>)}</div>
            <p className="mt-2 text-[11px] text-slate-500">Need = ⌈UG ÷ ratio⌉ + ⌈PG ÷ ratio⌉ using total enrolment (annual intake × years). Compare it with the roster on the <Link href="/faculty" className="text-indigo-700 underline">Faculty page</Link>.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
