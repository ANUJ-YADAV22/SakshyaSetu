'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, FolderOpen } from 'lucide-react';
import clsx from 'clsx';
import { useSession } from '@/lib/session';
import { ApiError } from '@/lib/api';

export const STATUS_STYLE: Record<string, string> = {
  pass: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300',
  deficiency: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-500/10 dark:text-red-300',
  needs_review: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300',
  indicator: 'bg-violet-50 text-violet-800 border-violet-200',
  not_checked: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700/40 dark:text-slate-300',
  processing: 'bg-sky-50 text-sky-800 border-sky-200',
  verified: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  mismatch_detected: 'bg-red-50 text-red-800 border-red-200',
  expired: 'bg-orange-50 text-orange-800 border-orange-200',
  verification_pending: 'bg-sky-50 text-sky-800 border-sky-200',
  source_unavailable: 'bg-slate-100 text-slate-700 border-slate-200',
  manual_review_required: 'bg-amber-50 text-amber-800 border-amber-200',
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useSession();
  const label = (t as Record<string, string>)[status] ?? status.replace(/_/g, ' ');
  const text = label.charAt(0).toUpperCase() + label.slice(1);
  return <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold', STATUS_STYLE[status] ?? STATUS_STYLE.not_checked)}><i className="h-1.5 w-1.5 rounded-full bg-current" />{text}</span>;
}

export function ProvBadge({ provenance }: { provenance?: string | null }) {
  if (!provenance) return null;
  const live = provenance === 'live';
  return <span title="Provenance of this result" className={clsx('inline-flex rounded-[3px] border px-1.5 py-0.5 text-[11px] font-mono', live ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-fuchsia-300 text-fuchsia-800 bg-fuchsia-50')}>{provenance}</span>;
}

export function DemoTag() {
  const { t } = useSession();
  return <span className="rounded-full bg-[#F4CB45] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#3A2A00]">{t.demo}</span>;
}

export function Card({ title, right, children, className, icon: Icon }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; icon?: React.ElementType }) {
  return (
    <section className={clsx('panel rise', className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--rule)] px-5 py-3">
          <h2 className="flex items-center gap-2.5 font-display text-[15px] text-slate-900 dark:text-slate-100">
            {Icon && <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Icon className="h-4 w-4" /></span>}{title}
          </h2>{right}
        </header>
      )}
      <div className="overflow-x-auto p-5">{children}</div>
    </section>
  );
}

export function Btn({ children, onClick, variant = 'primary', disabled, busy, type = 'button', title }: {
  children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'quiet'; disabled?: boolean; busy?: boolean; type?: 'button' | 'submit'; title?: string;
}) {
  const style = {
    primary: 'bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-[0_1px_0_rgba(255,255,255,.25)_inset,0_6px_14px_-6px_rgba(15,101,86,.7)] hover:from-indigo-600 hover:to-indigo-700',
    ghost: 'border border-slate-300 bg-[var(--panel)] text-slate-800 hover:border-indigo-500 hover:text-indigo-700 dark:border-slate-600 dark:text-slate-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    quiet: 'text-indigo-700 hover:bg-indigo-50 dark:text-indigo-200 dark:hover:bg-indigo-500/10',
  }[variant];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled || busy}
      className={clsx('inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-all active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50', style)}>
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}{children}
    </button>
  );
}

export function PageTitle({ title, sub, right, eyebrow }: { title: string; sub?: string; right?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="rise mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-indigo-600">{eyebrow}</div>}
        <h1 className="font-display text-[32px] leading-tight text-slate-900 dark:text-white">{title}</h1>
        {sub && <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><FolderOpen className="h-5 w-5" /></span><div className="max-w-md">{children}</div></div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof ApiError ? `${error.status}: ${error.message}` : String((error as Error)?.message ?? error);
  const offline = /fetch|network/i.test(msg);
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      {offline ? 'Cannot reach the Sakshya API. Start the backend: cd backend && uvicorn main:app --port 8000' : msg}
    </div>
  );
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const { role, ready } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); } catch (e) { setError(e); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, ...deps]);
  useEffect(() => { if (ready) reload(); }, [reload, ready]);
  return { data, error, loading, reload, setData };
}

export function Loading() { return <div className="space-y-3 p-2" aria-busy="true" aria-label="Loading"><div className="skeleton h-5 w-1/3" /><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-5/6" /><div className="skeleton h-4 w-2/3" /></div>; }

export function fmtTime(s?: string | null) { return s ? new Date(s).toLocaleString() : '-'; }
