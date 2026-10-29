/** Browser-side image forensics shared by the Forensic studio and the Evidence workbench. Descriptive indicators only. */
export type Hot = { x: number; y: number; w: number; h: number; v: number };
export type Stat = { k: string; v: string; d: string };

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image failed to load')); im.src = url; });
}
const q = (s: Float32Array, p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];

/** Error level analysis: |original - JPEG re-save at `quality`| per channel. Returns residual + a drawn canvas. */
export async function ela(image: HTMLImageElement, quality: number, gain: number, maxW = 900) {
  const scale = Math.min(1, maxW / image.naturalWidth), w = Math.round(image.naturalWidth * scale), h = Math.round(image.naturalHeight * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const cx = c.getContext('2d', { willReadFrequently: true })!; cx.drawImage(image, 0, 0, w, h);
  const a = cx.getImageData(0, 0, w, h), re = await loadImage(c.toDataURL('image/jpeg', quality / 100));
  const t = document.createElement('canvas'); t.width = w; t.height = h; const tx = t.getContext('2d', { willReadFrequently: true })!; tx.drawImage(re, 0, 0);
  const b = tx.getImageData(0, 0, w, h), out = document.createElement('canvas'); out.width = w; out.height = h; const ox = out.getContext('2d')!, d = ox.createImageData(w, h), r = new Float32Array(w * h);
  for (let i = 0, p = 0; i < a.data.length; i += 4, p++) {
    const dr = Math.abs(a.data[i] - b.data[i]), dg = Math.abs(a.data[i + 1] - b.data[i + 1]), db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    r[p] = (dr + dg + db) / 3; d.data[i] = Math.min(255, dr * gain); d.data[i + 1] = Math.min(255, dg * gain); d.data[i + 2] = Math.min(255, db * gain); d.data[i + 3] = 255;
  }
  ox.putImageData(d, 0, 0);
  const B = 32, blocks: Hot[] = [];
  for (let y = 0; y + B <= h; y += B) for (let x = 0; x + B <= w; x += B) { let s = 0; for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) s += r[(y + j) * w + x + i]; blocks.push({ x, y, w: B, h: B, v: s / (B * B) }); }
  blocks.sort((p, q2) => q2.v - p.v); const hot = blocks.slice(0, 5);
  ox.strokeStyle = '#F4CB45'; ox.lineWidth = 2; hot.forEach((k) => ox.strokeRect(k.x, k.y, k.w, k.h));
  return { canvas: out, resid: r, w, h, hot };
}

/** Local noise level per 32 px block (robust Laplacian estimate). Red = noisier than the rest, blue = smoother. */
export function noiseMap(image: HTMLImageElement, maxW = 1600) {
  const scale = Math.min(1, maxW / image.naturalWidth), W = Math.round(image.naturalWidth * scale), H = Math.round(image.naturalHeight * scale);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const cx = c.getContext('2d', { willReadFrequently: true })!; cx.drawImage(image, 0, 0, W, H);
  const px = cx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const B = 32, K = 0.6745 * Math.sqrt(20), cells: { x: number; y: number; s: number }[] = [];
  for (let by = 1; by + B < H; by += B) for (let bx = 1; bx + B < W; bx += B) {
    const v: number[] = [];
    for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) { const i = y * W + x; v.push(Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W])); }
    v.sort((a, b) => a - b); cells.push({ x: bx, y: by, s: v[v.length >> 1] / K });
  }
  const out = document.createElement('canvas'); out.width = W; out.height = H; const ox = out.getContext('2d')!; ox.globalAlpha = 0.5; ox.drawImage(image, 0, 0, W, H); ox.globalAlpha = 1;
  const ok = cells.filter((k) => k.s >= 0.5);
  if (ok.length < 12) return { canvas: out, measurable: ok.length, flagged: 0, sigma: 0, note: 'Too little measurable texture (mostly flat or noise-free). Rendered text pages have no grain; use a scan or photograph.' };
  const ls = ok.map((k) => Math.log(k.s)), med = [...ls].sort((a, b) => a - b)[ls.length >> 1];
  const mad = [...ls.map((v) => Math.abs(v - med))].sort((a, b) => a - b)[ls.length >> 1] * 1.4826 || 0.05; let flagged = 0;
  for (const k of ok) { const dev = Math.log(k.s) - med; if (Math.abs(dev) > Math.max(3 * mad, Math.log(1.7))) { flagged++; ox.fillStyle = dev > 0 ? 'rgba(207,74,54,.55)' : 'rgba(40,110,200,.55)'; ox.fillRect(k.x, k.y, B, B); } }
  return { canvas: out, measurable: ok.length, flagged, sigma: Math.exp(med), note: '' };
}

/** Twelve descriptive scalars of the ELA residual. They feed no classifier. */
export function residualStats(r: Float32Array, w: number, h: number, gain: number): Stat[] {
  const n = r.length; let m = 0; for (let i = 0; i < n; i++) m += r[i]; m /= n;
  let v = 0, s3 = 0, s4 = 0, mx = 0, hi = 0; for (let i = 0; i < n; i++) { const d = r[i] - m; v += d * d; s3 += d ** 3; s4 += d ** 4; if (r[i] > mx) mx = r[i]; if (r[i] * gain > 128) hi++; }
  v /= n; const sd = Math.sqrt(v) || 1e-9, step = Math.max(1, Math.floor(n / 60000));
  const sm = Float32Array.from({ length: Math.floor(n / step) }, (_, i) => r[i * step]).sort(), med = q(sm, 0.5), mad = q(Float32Array.from(sm, (x) => Math.abs(x - med)).sort(), 0.5), iqr = q(sm, 0.75) - q(sm, 0.25);
  const hist = new Float64Array(256); for (let i = 0; i < n; i++) hist[Math.min(255, Math.round(r[i]))]++; let ent = 0; for (const c of hist) if (c) { const p = c / n; ent -= p * Math.log2(p); }
  const dvar = (dx: number, dy: number) => { const vals: number[] = []; let mm = 0; for (let y = 0; y + dy < h; y += 2) for (let x = 0; x + dx < w; x += 2) { const d = r[(y + dy) * w + x + dx] - r[y * w + x]; vals.push(d); mm += d; } mm /= vals.length; return vals.reduce((s, d) => s + (d - mm) ** 2, 0) / vals.length; };
  const f = (x: number, k = 4) => x.toFixed(k);
  return [
    { k: 'Mean residual (µ)', v: f(m), d: 'Average error level' }, { k: 'Variance (σ²)', v: f(v), d: 'Spread of the error level' },
    { k: 'Skewness', v: f(s3 / n / sd ** 3, 3), d: 'Asymmetry of the distribution' }, { k: 'Excess kurtosis', v: f(s4 / n / sd ** 4 - 3, 3), d: 'Heaviness of the tails' },
    { k: 'Median abs. deviation', v: f(mad), d: 'Robust spread' }, { k: 'IQR', v: f(iqr), d: 'Inter-quartile range' },
    { k: 'Residual entropy (bits)', v: f(ent, 3), d: 'Disorder of the residual histogram' }, { k: 'Max residual', v: f(mx, 1), d: 'Largest single-pixel difference' },
    { k: 'Horizontal variance', v: f(dvar(1, 0)), d: 'Residual change along x' }, { k: 'Vertical variance', v: f(dvar(0, 1)), d: 'Residual change along y' },
    { k: 'Diagonal variance', v: f(dvar(1, 1)), d: 'Residual change along the diagonal' }, { k: '% pixels above threshold', v: f((100 * hi) / n, 2), d: `At gain ${gain}x` },
  ];
}
