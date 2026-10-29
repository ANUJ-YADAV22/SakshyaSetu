'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/** Count-up number (respects reduced motion). */
export function CountUp({ value, ms = 800 }: { value: number; ms?: number }) {
  const [v, setV] = useState(0);
  const raf = useRef<number>(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(value); return; }
    const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / ms); setV(Math.round(value * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf.current);
  }, [value, ms]);
  return <>{v}</>;
}

export type Seg = { label: string; value: number; color: string };

/** Donut with a centre total. Segments grow in on mount. */
export function Donut({ segs, size = 176, stroke = 22, centre, sub }: { segs: Seg[]; size?: number; stroke?: number; centre?: React.ReactNode; sub?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id); }, []);
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, total = segs.reduce((n, s) => n + s.value, 0);
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={segs.map((s) => `${s.value} ${s.label}`).join(', ')}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rule)" strokeWidth={stroke} />
        {total > 0 && segs.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / total) * C, gap = segs.filter((x) => x.value > 0).length > 1 ? 3 : 0; const off = -acc; acc += len;
          return <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke} strokeDasharray={`${ready ? Math.max(0, len - gap) : 0} ${C}`} strokeDashoffset={off} strokeLinecap="butt" style={{ transition: 'stroke-dasharray .9s cubic-bezier(.2,.7,.2,1)' }} />;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><div className="font-display text-4xl leading-none tabular-nums">{centre ?? total}</div>{sub && <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{sub}</div>}</div>
      </div>
    </div>
  );
}

/** Horizontal bars with the value at the right. */
export function BarList({ items, empty = 'Nothing yet.' }: { items: { label: string; value: number; color?: string; href?: string }[]; empty?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id); }, []);
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((i) => {
        const body = (<>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm"><span className="truncate capitalize">{i.label}</span><b className="font-display tabular-nums">{i.value}</b></div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--rule)]"><div className="h-full rounded-full" style={{ width: ready ? `${(100 * i.value) / max}%` : 0, background: i.color ?? '#1F7A6A', transition: 'width .8s cubic-bezier(.2,.7,.2,1)' }} /></div></>);
        return <li key={i.label}>{i.href ? <Link href={i.href} className="block hover:opacity-80">{body}</Link> : body}</li>;
      })}
    </ul>
  );
}

/** Headline number tile. `dark` is for use on the hero band. */
export function Kpi({ icon: Icon, label, value, tone = 'ink', href, dark, hint, index = 0 }: {
  icon: React.ElementType; label: string; value: number; tone?: 'ink' | 'verdigris' | 'vermilion' | 'marigold'; href?: string; dark?: boolean; hint?: string; index?: number }) {
  const chip = (dark ? { ink: 'bg-white/10 text-slate-100', verdigris: 'bg-[#1F7A6A]/25 text-[#9FE0D0]', vermilion: 'bg-[#CF4A36]/25 text-[#FFB3A5]', marigold: 'bg-[#F4CB45]/25 text-[#F4CB45]' } : { ink: 'bg-slate-100 text-slate-700', verdigris: 'bg-[#1F7A6A]/15 text-[#1F7A6A]', vermilion: 'bg-[#CF4A36]/15 text-[#B93A28]', marigold: 'bg-[#F4CB45]/30 text-[#8A6A00]' })[tone];
  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className={`text-[11px] font-semibold uppercase tracking-wider ${dark ? 'text-slate-300' : 'text-slate-500'}`}>{label}</div>
        <div className={`mt-1.5 font-display text-[38px] leading-none tabular-nums ${dark && tone === 'vermilion' && value > 0 ? 'text-[#FFB3A5]' : ''}`}><CountUp value={value} /></div>
        {hint && <div className={`mt-1.5 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{hint}</div>}
      </div>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${chip}`}><Icon className="h-[18px] w-[18px]" /></span>
    </div>);
  const cls = `rise block p-4 ${dark ? 'glass' : 'panel panel-lift'}`;
  return href ? <Link href={href} className={cls} style={{ ['--i' as any]: index }}>{inner}</Link> : <div className={cls} style={{ ['--i' as any]: index }}>{inner}</div>;
}
