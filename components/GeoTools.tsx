'use client';
import React, { useMemo, useState } from 'react';
import { Card } from '@/components/ui';

const inp = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:bg-slate-800';
const num = (s: string) => (s.trim() === '' || isNaN(+s) ? null : +s);

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371.0088, r = Math.PI / 180;
  const dp = (lat2 - lat1) * r, dl = (lon2 - lon1) * r;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function shoelace(pts: [number, number][]) {
  let s = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}

/** Deterministic, client-side calculators. No numbers here are APH norms: every threshold is an editable parameter
 *  that a regulatory expert must confirm. Results are advisory. */
export default function GeoTools() {
  // 1) Shoelace polygon + scale calibration
  const [poly, setPoly] = useState('0,0\n240,0\n240,180\n0,180');
  const [knownPx, setKnownPx] = useState('240'); const [knownM, setKnownM] = useState('10');
  const [declared, setDeclared] = useState('66'); const [tol, setTol] = useState('5');
  const shoe = useMemo(() => {
    const pts = poly.split('\n').map((l) => l.split(/[ ,;\t]+/).map(Number)).filter((p) => p.length >= 2 && p.every((v) => !isNaN(v))).map((p) => [p[0], p[1]] as [number, number]);
    const px2 = pts.length >= 3 ? shoelace(pts) : null;
    const kp = num(knownPx), km = num(knownM); const s = kp && km ? km / kp : null;
    const area = px2 != null && s ? px2 * s * s : null;
    const d = num(declared), t = num(tol);
    const dev = area != null && d ? ((area - d) / d) * 100 : null;
    return { n: pts.length, px2, s, area, dev, flag: dev != null && t != null && Math.abs(dev) > t, t };
  }, [poly, knownPx, knownM, declared, tol]);

  // 2) Haversine between two plots
  const [p1, setP1] = useState('28.4595, 77.0266'); const [p2, setP2] = useState('28.4682, 77.0345'); const [lim, setLim] = useState('2.0');
  const hv = useMemo(() => {
    const a = p1.split(',').map(Number), b = p2.split(',').map(Number);
    if (a.length < 2 || b.length < 2 || [...a, ...b].some(isNaN)) return null;
    const km = haversineKm(a[0], a[1], b[0], b[1]); const l = num(lim);
    return { km, over: l != null && km > l, l };
  }, [p1, p2, lim]);

  // 3) What-if built-up requirement
  const [ug, setUg] = useState('360'); const [pg, setPg] = useState('90'); const [yrsUg, setYrsUg] = useState('4'); const [yrsPg, setYrsPg] = useState('2');
  const [norm, setNorm] = useState('4.5'); const [circ, setCirc] = useState('25'); const [share, setShare] = useState('0'); const [far, setFar] = useState('2.0'); const [claimed, setClaimed] = useState('8530');
  const wi = useMemo(() => {
    const u = num(ug), p = num(pg), yu = num(yrsUg), yp = num(yrsPg), nm = num(norm), c = num(circ), sh = num(share), cl = num(claimed), fr = num(far);
    if ([u, p, yu, yp, nm, c, sh].some((v) => v == null)) return null;
    const students = u! * yu! + p! * yp!; const instructional = students * nm! * (1 - sh! / 100);
    const required = instructional * (1 + c! / 100);
    return { students, instructional, required, gap: cl != null ? cl - required : null, landAcres: fr && fr > 0 ? required / fr / 4046.86 : null };
  }, [ug, pg, yrsUg, yrsPg, norm, circ, share, claimed, far]);
  const f = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 1 });

  return (
    <div className="space-y-5">
      <Card title="Shoelace polygon calculator with scale calibration (client-side)">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <div className="space-y-2 text-xs">
            <label className="block font-semibold">Vertices (x,y per line, in pixels or PDF points)<textarea className={`${inp} h-28 font-mono`} value={poly} onChange={(e) => setPoly(e.target.value)} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label>Known length (px)<input className={inp} value={knownPx} onChange={(e) => setKnownPx(e.target.value)} /></label>
              <label>= real length (m)<input className={inp} value={knownM} onChange={(e) => setKnownM(e.target.value)} /></label>
              <label>Declared area (sq.m)<input className={inp} value={declared} onChange={(e) => setDeclared(e.target.value)} /></label>
              <label>Tolerance ± %<input className={inp} value={tol} onChange={(e) => setTol(e.target.value)} /></label>
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <div>Vertices: <b>{shoe.n}</b> · Scale: <b>{shoe.s ? shoe.s.toFixed(5) : '-'}</b> m/px</div>
            <div>Area (px²): <b>{shoe.px2 != null ? f(shoe.px2) : '-'}</b></div>
            <div>Measured area: <b className="text-lg">{shoe.area != null ? `${f(shoe.area)} sq.m` : '-'}</b></div>
            {shoe.dev != null && <div className={`mt-1 rounded p-1.5 text-xs ${shoe.flag ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`}>Deviation from declared: <b>{shoe.dev.toFixed(1)}%</b> - {shoe.flag ? `outside ±${shoe.t}% : indicator for human review` : 'within tolerance'}</div>}
            <p className="mt-2 text-[11px] text-slate-500">area = ½·|Σ(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)| × (m/px)². Tolerance is a configurable engineering parameter, not an APH value.</p>
          </div>
        </div>
      </Card>

      <Card title="Multi-plot distance (Haversine)">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 text-xs md:grid-cols-4">
          <label>Plot 1 (lat, lon)<input className={inp} value={p1} onChange={(e) => setP1(e.target.value)} /></label>
          <label>Plot 2 (lat, lon)<input className={inp} value={p2} onChange={(e) => setP2(e.target.value)} /></label>
          <label>Limit (km) - configurable<input className={inp} value={lim} onChange={(e) => setLim(e.target.value)} /></label>
          <div className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800/60">{hv ? <>Distance: <b>{hv.km.toFixed(2)} km</b><div className={`text-xs ${hv.over ? 'text-amber-800' : 'text-emerald-800'}`}>{hv.over ? 'Above the configured limit - indicator for review' : 'Within the configured limit'}</div></> : 'Enter valid coordinates'}</div>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Great-circle distance on WGS84 (R = 6371.0088 km). The limit must be taken from the authorised Handbook by a regulatory expert.</p>
      </Card>

      <Card title="What-if: built-up area requirement vs claimed area (example parameters, not APH values)">
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <label>UG annual intake<input className={inp} value={ug} onChange={(e) => setUg(e.target.value)} /></label>
          <label>UG years<input className={inp} value={yrsUg} onChange={(e) => setYrsUg(e.target.value)} /></label>
          <label>PG annual intake<input className={inp} value={pg} onChange={(e) => setPg(e.target.value)} /></label>
          <label>PG years<input className={inp} value={yrsPg} onChange={(e) => setYrsPg(e.target.value)} /></label>
          <label>Instructional norm (sq.m / student)<input className={inp} value={norm} onChange={(e) => setNorm(e.target.value)} /></label>
          <label>Circulation add-on %<input className={inp} value={circ} onChange={(e) => setCirc(e.target.value)} /></label>
          <label>Lab sharing discount %<input className={inp} value={share} onChange={(e) => setShare(e.target.value)} /></label>
          <label>Claimed built-up (sq.m)<input className={inp} value={claimed} onChange={(e) => setClaimed(e.target.value)} /></label>
          <label>Municipal FAR / FSI<input className={inp} value={far} onChange={(e) => setFar(e.target.value)} /></label>
        </div>
        {wi ? (
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
            <div className="rounded bg-slate-50 p-2 dark:bg-slate-800/60">Total students<br /><b>{f(wi.students)}</b></div>
            <div className="rounded bg-slate-50 p-2 dark:bg-slate-800/60">Instructional area<br /><b>{f(wi.instructional)} sq.m</b></div>
            <div className="rounded bg-slate-50 p-2 dark:bg-slate-800/60">Required built-up<br /><b>{f(wi.required)} sq.m</b></div>
            <div className="rounded bg-slate-50 p-2 dark:bg-slate-800/60">Minimum land<br /><b>{wi.landAcres != null ? `${wi.landAcres.toFixed(2)} acres` : '-'}</b></div>
            <div className={`rounded p-2 ${wi.gap != null && wi.gap < 0 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`}>Claimed − required<br /><b>{wi.gap != null ? `${wi.gap >= 0 ? '+' : ''}${f(wi.gap)} sq.m` : '-'}</b></div>
          </div>) : <p className="mt-2 text-xs text-slate-500">Fill all parameters to compute.</p>}
        <p className="mt-2 text-[11px] text-slate-500">Illustrative simulator only. Land = required built-up ÷ FAR ÷ 4,046.86. The norm, circulation, sharing and FAR values are placeholders; replace them with approved rule-pack parameters before relying on any output. A shortfall here is an advisory indicator and never a rejection.</p>
      </Card>
    </div>
  );
}
