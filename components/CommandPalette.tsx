'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';

type Item = { label: string; hint: string; href: string };

/** Ctrl/Cmd+K jump-to: pages, plus applications by institution name or id (officers only). */
export function CommandPalette({ pages, officer }: { pages: Item[]; officer: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cur, setCur] = useState(0);
  const [apps, setApps] = useState<Item[]>([]);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!open) return; setQ(''); setCur(0); setTimeout(() => input.current?.focus(), 0);
    if (officer) api('/applications?page_size=100').then((r: any) => setApps(r.items.map((a: any) => ({ label: a.institution_name, hint: `Application · ${a.id}`, href: `/applications/${a.id}` })))).catch(() => setApps([]));
  }, [open, officer]);

  const results = useMemo(() => {
    const all = [...pages.map((p) => ({ ...p, hint: p.hint || 'Page' })), ...apps]; const s = q.trim().toLowerCase();
    return (s ? all.filter((i) => (i.label + ' ' + i.hint).toLowerCase().includes(s)) : all).slice(0, 12);
  }, [q, pages, apps]);
  const go = (i?: Item) => { if (i) { router.push(i.href); setOpen(false); } };

  return (
    <>
      <button onClick={() => setOpen(true)} className="hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-[var(--panel)] px-2.5 py-1.5 text-xs text-slate-600 hover:border-indigo-500 sm:inline-flex" aria-label="Open jump-to search"><Search className="h-3 w-3" />Jump to… <kbd className="rounded border px-1 text-[10px]">Ctrl K</kbd></button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Jump to">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--rule)] bg-[var(--panel)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setCur(0); }} placeholder="Search pages and applications…" className="w-full border-b border-[var(--rule)] bg-transparent px-4 py-3 text-sm outline-none"
              onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(c + 1, results.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); } if (e.key === 'Enter') go(results[cur]); }} />
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">No match.</li>}
              {results.map((r, i) => <li key={r.href + r.label}><button onMouseEnter={() => setCur(i)} onClick={() => go(r)} className={`flex w-full items-baseline justify-between gap-3 px-4 py-2 text-left text-sm ${i === cur ? 'bg-indigo-50 dark:bg-indigo-500/10' : ''}`}><span className="truncate font-medium">{r.label}</span><span className="shrink-0 text-xs text-slate-500">{r.hint}</span></button></li>)}
            </ul>
          </div>
        </div>)}
    </>
  );
}
