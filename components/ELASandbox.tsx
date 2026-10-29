'use client';
import React, { useRef, useState } from 'react';
import { Card } from '@/components/ui';

type Tab = 'ela' | 'noise' | 'stats' | 'bytes';
type Hot = { x: number; y: number; w: number; h: number; v: number };
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'ela', label: 'Error level', hint: 'Re-save at quality Q and amplify the difference' },
  { id: 'noise', label: 'Noise consistency', hint: 'Local sensor/scan noise compared with the rest of the image' },
  { id: 'stats', label: 'Residual statistics', hint: 'Descriptive numbers of the error-level residual' },
  { id: 'bytes', label: 'File bytes', hint: 'SHA-256, container structure, editor strings' },
];

const quantile = (sorted: Float32Array, q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];

/** Browser-side alteration lab. Nothing is uploaded. Every output is a descriptive indicator for a human reviewer. */
export default function ELASandbox() {
  const src = useRef<HTMLCanvasElement>(null), out = useRef<HTMLCanvasElement>(null);
  const [tab, setTab] = useState<Tab>('ela');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [q, setQ] = useState(75), [gain, setGain] = useState(20);
  const [err, setErr] = useState(''), [note, setNote] = useState('');
  const [stats, setStats] = useState<{ k: string; v: string; d: string }[] | null>(null);
  const [bytes, setBytes] = useState<{ sha: string; rows: [string, string][]; structure: string[]; editors: string[] } | null>(null);
  const [hot, setHot] = useState<Hot[]>([]);
  const resid = useRef<{ r: Float32Array; w: number; h: number } | null>(null);

  /* ---------------- ELA ---------------- */
  const runEla = async (image: HTMLImageElement, quality: number, g: number) => {
    const c = src.current!, o = out.current!, scale = Math.min(1, 900 / image.naturalWidth);
    const w = Math.round(image.naturalWidth * scale), h = Math.round(image.naturalHeight * scale);
    c.width = o.width = w; c.height = o.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true })!; cx.drawImage(image, 0, 0, w, h);
    const a = cx.getImageData(0, 0, w, h);
    const re = new Image();
    await new Promise<void>((res, rej) => { re.onload = () => res(); re.onerror = () => rej(new Error('re-encode failed')); re.src = c.toDataURL('image/jpeg', quality / 100); });
    const t = document.createElement('canvas'); t.width = w; t.height = h; const tx = t.getContext('2d', { willReadFrequently: true })!; tx.drawImage(re, 0, 0);
    const b = tx.getImageData(0, 0, w, h), ox = o.getContext('2d')!, d = ox.createImageData(w, h), r = new Float32Array(w * h);
    for (let i = 0, p = 0; i < a.data.length; i += 4, p++) {
      const dr = Math.abs(a.data[i] - b.data[i]), dg = Math.abs(a.data[i + 1] - b.data[i + 1]), db = Math.abs(a.data[i + 2] - b.data[i + 2]);
      r[p] = (dr + dg + db) / 3; d.data[i] = Math.min(255, dr * g); d.data[i + 1] = Math.min(255, dg * g); d.data[i + 2] = Math.min(255, db * g); d.data[i + 3] = 255;
    }
    ox.putImageData(d, 0, 0); resid.current = { r, w, h };
    const B = 32, blocks: Hot[] = [];
    for (let y = 0; y + B <= h; y += B) for (let x = 0; x + B <= w; x += B) { let s = 0; for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) s += r[(y + j) * w + x + i]; blocks.push({ x, y, w: B, h: B, v: s / (B * B) }); }
    blocks.sort((p, q2) => q2.v - p.v); const top = blocks.slice(0, 5); setHot(top);
    ox.strokeStyle = '#F4CB45'; ox.lineWidth = 2; top.forEach((k) => ox.strokeRect(k.x, k.y, k.w, k.h));
    setNote('Yellow boxes: the five 32 px blocks with the highest residual.');
  };

  /* ---------------- noise consistency ---------------- */
  // Pasted or regenerated regions often carry a different noise level than the rest of a scan or photo.
  // Per 32 px block: robust noise sigma = median(|Laplacian|) / (0.6745 * sqrt(20)); the median ignores real edges.
  const runNoise = (image: HTMLImageElement) => {
    const c = src.current!, o = out.current!, scale = Math.min(1, 1600 / image.naturalWidth);
    const W = Math.round(image.naturalWidth * scale), H = Math.round(image.naturalHeight * scale);
    c.width = o.width = W; c.height = o.height = H;
    const cx = c.getContext('2d', { willReadFrequently: true })!; cx.drawImage(image, 0, 0, W, H);
    const px = cx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const B = 32, K = 0.6745 * Math.sqrt(20), cells: { x: number; y: number; s: number }[] = [];
    for (let by = 1; by + B < H; by += B) for (let bx = 1; bx + B < W; bx += B) {
      const v: number[] = [];
      for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) { const i = y * W + x; v.push(Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W])); }
      v.sort((a, b2) => a - b2); cells.push({ x: bx, y: by, s: v[v.length >> 1] / K });
    }
    const ox = o.getContext('2d')!; ox.globalAlpha = 0.5; ox.drawImage(image, 0, 0, W, H); ox.globalAlpha = 1;
    const ok = cells.filter((k) => k.s >= 0.5);                      // flat, noise-free areas cannot be measured
    if (ok.length < 12) { setHot([]); setNote('Too little measurable texture (mostly flat or noise-free). This test needs a scan or photograph with visible grain.'); return; }
    const ls = ok.map((k) => Math.log(k.s)), med = [...ls].sort((a, b2) => a - b2)[ls.length >> 1];
    const mad = [...ls.map((v) => Math.abs(v - med))].sort((a, b2) => a - b2)[ls.length >> 1] * 1.4826 || 0.05;
    const bad: Hot[] = [];
    for (const k of ok) {
      const dev = Math.log(k.s) - med;
      if (Math.abs(dev) > Math.max(3 * mad, Math.log(1.7))) { bad.push({ x: k.x, y: k.y, w: B, h: B, v: dev }); ox.fillStyle = dev > 0 ? 'rgba(207,74,54,.55)' : 'rgba(40,110,200,.55)'; ox.fillRect(k.x, k.y, B, B); }
    }
    setHot(bad);
    setNote(`Typical noise level σ≈${Math.exp(med).toFixed(2)} (grey levels). ${bad.length} of ${ok.length} measurable blocks (${((100 * bad.length) / ok.length).toFixed(1)}%) deviate strongly: red = noisier than the rest, blue = smoother. Isolated blocks are common on real documents; a compact cluster is worth a closer look.`);
  };

  /* ---------------- residual statistics ---------------- */
  const runStats = () => {
    const R = resid.current; if (!R) return; const { r, w, h } = R, n = r.length;
    let m = 0; for (let i = 0; i < n; i++) m += r[i]; m /= n;
    let v = 0, s3 = 0, s4 = 0, mx = 0, hi = 0; for (let i = 0; i < n; i++) { const d = r[i] - m; v += d * d; s3 += d ** 3; s4 += d ** 4; if (r[i] > mx) mx = r[i]; if (r[i] * gain > 128) hi++; }
    v /= n; const sd = Math.sqrt(v) || 1e-9;
    const step = Math.max(1, Math.floor(n / 60000)), sm = Float32Array.from({ length: Math.floor(n / step) }, (_, i) => r[i * step]).sort();
    const med = quantile(sm, 0.5), mad = (() => { const dv = Float32Array.from(sm, (x) => Math.abs(x - med)).sort(); return quantile(dv, 0.5); })(), iqr = quantile(sm, 0.75) - quantile(sm, 0.25);
    const hist = new Float64Array(256); for (let i = 0; i < n; i++) hist[Math.min(255, Math.round(r[i]))]++; let ent = 0; for (const c of hist) if (c) { const p = c / n; ent -= p * Math.log2(p); }
    const dvar = (dx: number, dy: number) => { let s = 0, c = 0, mm = 0; const vals: number[] = []; for (let y = 0; y + dy < h; y += 2) for (let x = 0; x + dx < w; x += 2) { const d = r[(y + dy) * w + x + dx] - r[y * w + x]; vals.push(d); mm += d; c++; } mm /= c; for (const d of vals) s += (d - mm) ** 2; return s / c; };
    const f = (x: number, k = 4) => x.toFixed(k);
    setStats([
      { k: 'Mean residual', v: f(m), d: 'Average error level' }, { k: 'Variance', v: f(v), d: 'Spread of the error level' },
      { k: 'Skewness', v: f(s3 / n / sd ** 3, 3), d: 'Asymmetry of the distribution' }, { k: 'Excess kurtosis', v: f(s4 / n / sd ** 4 - 3, 3), d: 'Heaviness of the tails' },
      { k: 'Median abs. deviation', v: f(mad), d: 'Robust spread' }, { k: 'IQR', v: f(iqr), d: 'Inter-quartile range of the residual' },
      { k: 'Entropy (bits)', v: f(ent, 3), d: 'Disorder of the residual histogram' }, { k: 'Max residual', v: f(mx, 1), d: 'Largest single-pixel difference' },
      { k: 'Horizontal variance', v: f(dvar(1, 0)), d: 'Residual change along x' }, { k: 'Vertical variance', v: f(dvar(0, 1)), d: 'Residual change along y' },
      { k: 'Diagonal variance', v: f(dvar(1, 1)), d: 'Residual change along the diagonal' }, { k: '% pixels above threshold', v: f((100 * hi) / n, 2), d: `At gain ${gain}×` },
    ]);
  };

  /* ---------------- file bytes ---------------- */
  const readBytes = async (f: File, image: HTMLImageElement) => {
    const buf = await f.arrayBuffer(), u = new Uint8Array(buf);
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const structure: string[] = [];
    if (u[0] === 0xff && u[1] === 0xd8) {
      structure.push('SOI'); let i = 2; const NAME: Record<number, string> = { 0xe0: 'APP0 (JFIF)', 0xe1: 'APP1 (EXIF/XMP)', 0xe2: 'APP2', 0xed: 'APP13 (Photoshop IRB)', 0xee: 'APP14 (Adobe)', 0xdb: 'DQT', 0xc0: 'SOF0', 0xc2: 'SOF2 (progressive)', 0xc4: 'DHT', 0xfe: 'COM', 0xdd: 'DRI' };
      while (i + 4 < u.length && u[i] === 0xff) { const mk = u[i + 1]; if (mk === 0xda) { structure.push('SOS (scan data)'); break; } structure.push(NAME[mk] ?? `0x${mk.toString(16)}`); i += 2 + ((u[i + 2] << 8) | u[i + 3]); }
    } else if (u[0] === 0x89 && u[1] === 0x50) {
      structure.push('PNG signature'); let i = 8; while (i + 8 < u.length && structure.length < 40) { const len = (u[i] << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]; const t = String.fromCharCode(u[i + 4], u[i + 5], u[i + 6], u[i + 7]); structure.push(t); if (t === 'IEND') break; i += 12 + len; }
    }
    const text = new TextDecoder('latin1').decode(u.subarray(0, Math.min(u.length, 3_000_000)));
    const editors = Array.from(new Set((text.match(/Adobe Photoshop[ \d.]*|Photoshop|Canva|GIMP[ \d.]*|Paint\.NET|Pixelmator|Affinity|Snapseed|Lightroom|ImageMagick|Microsoft Office|Illustrator/gi) ?? []).map((s) => s.trim())));
    setBytes({ sha, structure: Array.from(new Set(structure)), editors, rows: [['Name', f.name], ['Type', f.type || 'unknown'], ['Size', `${(f.size / 1024).toFixed(1)} KB`], ['Dimensions', `${image.naturalWidth} × ${image.naturalHeight} px`]] });
  };

  const run = async (t: Tab, image = img, quality = q, g = gain) => {
    if (!image) return; setErr('');
    try {
      if (t === 'ela' || t === 'stats') await runEla(image, quality, g);
      if (t === 'stats') runStats();
      if (t === 'noise') runNoise(image);
    } catch (e: any) { setErr(String(e.message ?? e)); }
  };
  const onFile = async (f?: File) => {
    setErr(''); setStats(null); setBytes(null); setHot([]); setNote(''); if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setErr('Use a PNG, JPG or WebP image. For PDFs, use the Document lab below (server side).'); return; }
    const im = new Image(); im.onload = async () => { setImg(im); setFile(f); await readBytes(f, im); run(tab, im); }; im.src = URL.createObjectURL(f);
  };
  const pick = (t: Tab) => { setTab(t); if (img) run(t); };

  return (
    <Card title="Alteration lab (runs in your browser, nothing is uploaded)">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="font-semibold">Image <input type="file" accept="image/png,image/jpeg,image/webp" className="ml-1" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        {(tab === 'ela' || tab === 'stats') && <>
          <label>Re-save quality {q}% <input type="range" min={50} max={95} value={q} onChange={(e) => { const v = +e.target.value; setQ(v); run(tab, img, v, gain); }} /></label>
          <label>Gain {gain}× <input type="range" min={5} max={60} value={gain} onChange={(e) => { const v = +e.target.value; setGain(v); run(tab, img, q, v); }} /></label></>}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} title={t.hint} onClick={() => pick(t.id)} className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${tab === t.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-indigo-500'}`}>{t.label}</button>)}
      </div>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
      {!img && !err && <p className="mt-3 text-xs text-slate-500">Choose a scan or photo of a document to begin. {TABS.find((t) => t.id === tab)?.hint}.</p>}
      <div className={`mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 ${tab === 'ela' || tab === 'noise' ? 'md:grid-cols-2' : ''} ${img && tab !== 'bytes' && tab !== 'stats' ? '' : 'hidden'}`}>
        <div><div className="mb-1 text-[11px] font-semibold text-slate-600">Original {file && `· ${file.name}`}</div><canvas ref={src} className="w-full rounded-lg border border-slate-200" /></div>
        <div><div className="mb-1 text-[11px] font-semibold text-slate-600">{tab === 'noise' ? 'Noise-consistency map' : 'Error-level residual'}</div><canvas ref={out} className="w-full rounded-lg border border-slate-200" /></div>
      </div>
      {note && (tab === 'ela' || tab === 'noise') && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-700 dark:bg-slate-800/60">{note}{hot.length > 0 && tab === 'ela' ? ` Highest block residual ${hot[0].v.toFixed(2)}.` : ''}</p>}
      {tab === 'stats' && stats && (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">{stats.map((s) => <div key={s.k} className="rounded-lg border border-[var(--rule)] p-2.5" title={s.d}><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{s.k}</div><div className="font-display text-lg tabular-nums">{s.v}</div></div>)}</div>)}
      {tab === 'stats' && !stats && img && <p className="mt-3 text-xs text-slate-500">Computing…</p>}
      {tab === 'bytes' && bytes && (
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <dl className="space-y-1.5 text-sm">{bytes.rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="truncate font-medium">{v}</dd></div>)}
            <div><dt className="text-slate-500">SHA-256</dt><dd className="break-all font-mono text-[11px]">{bytes.sha}</dd></div></dl>
          <div className="space-y-2 text-sm"><div><div className="text-[11px] font-semibold uppercase text-slate-500">Container structure</div><div className="mt-1 flex flex-wrap gap-1">{bytes.structure.map((s) => <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800">{s}</span>)}</div></div>
            <div><div className="text-[11px] font-semibold uppercase text-slate-500">Editing-software strings found in the bytes</div>{bytes.editors.length ? <div className="mt-1 flex flex-wrap gap-1">{bytes.editors.map((s) => <span key={s} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{s}</span>)}</div> : <p className="text-xs text-slate-500">None. Stripped metadata is common and proves nothing either way.</p>}</div></div>
        </div>)}
      <p className="mt-3 text-[11px] text-slate-500">Preliminary indicators, never proof. Screenshots, re-saved scans and heavy compression produce error-level residuals; the noise map needs visible grain and flags real texture changes too. The statistics are descriptive numbers and feed no classifier. A reviewer opens the original and decides.</p>
    </Card>
  );
}
