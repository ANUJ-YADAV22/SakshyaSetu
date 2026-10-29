'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Building2, ScanEye, Layers, Network, FileWarning, History, BookOpenCheck, BellRing, ListChecks, Sun, Moon, ShieldCheck, ScanSearch, UsersRound, BarChart3, Ruler } from 'lucide-react';
import { useTheme } from 'next-themes';
import clsx from 'clsx';
import { useSession } from '@/lib/session';
import { ROLES } from '@/lib/api';
import { CommandPalette } from '@/components/CommandPalette';

function Mark() {
  // A document corner with a marked line: the product idea in one glyph.
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
      <path d="M7 3h13l6 6v20H7z" fill="none" stroke="#E8EEE6" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M20 3v6h6" fill="none" stroke="#E8EEE6" strokeWidth="1.8" strokeLinejoin="round" />
      <rect x="10" y="14" width="13" height="4.5" fill="#F4CB45" />
      <path d="M10 22h10M10 25.5h7" stroke="#8E9B8C" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [m, setM] = React.useState(false);
  React.useEffect(() => setM(true), []);
  if (!m) return <span className="h-8 w-8" />;
  const dark = resolvedTheme === 'dark';
  return <button onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 bg-[var(--panel)] text-slate-700 transition-colors hover:border-indigo-500 hover:text-indigo-700">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { t, role, setRole, language, setLanguage } = useSession();
  type NavItem = { href: string; label: string; icon: React.ElementType };
  const groups: { label: string; items: NavItem[] }[] = [
    { label: t.core, items: [
      { href: '/overview', label: t.overview, icon: LayoutDashboard },
      { href: '/applications', label: t.applications, icon: Building2 },
      { href: '/deficiencies', label: t.notices, icon: FileWarning },
      { href: '/reports', label: language === 'hi' ? 'रिपोर्ट एवं विश्लेषण' : 'Reports', icon: BarChart3 } ] },
    { label: t.evidence, items: [
      { href: '/workbench', label: language === 'hi' ? 'साक्ष्य कार्यपीठ' : 'Evidence workbench', icon: ScanSearch },
      { href: '/forensics', label: t.forensics, icon: ScanEye },
      { href: '/faculty', label: language === 'hi' ? 'संकाय सत्यापन' : 'Faculty', icon: UsersRound },
      { href: '/blueprint', label: language === 'hi' ? 'मानचित्र विश्लेषण' : 'Blueprint analysis', icon: Ruler },
      { href: '/infrastructure', label: t.infrastructure, icon: Layers },
      { href: '/authority-bridge', label: t.authority, icon: Network } ] },
    { label: t.governance, items: [
      { href: '/rulebook', label: t.rulebook, icon: BookOpenCheck },
      { href: '/alerts', label: t.alerts, icon: BellRing },
      { href: '/audit-trail', label: t.audit, icon: History },
      { href: '/system', label: t.system, icon: ListChecks } ] },
  ];
  const isActive = (href: string) => path === href || (href !== '/overview' && path.startsWith(href));
  const all = groups.flatMap((g) => g.items);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-[linear-gradient(180deg,#0F2A24_0%,#0B1713_55%,#0A110E_100%)] text-slate-300 shadow-[8px_0_30px_-18px_rgba(0,0,0,.6)] md:flex">
        <Link href="/overview" className="flex items-center gap-3 px-5 pb-4 pt-5">
          <Mark />
          <div>
            <div className="font-display text-[22px] leading-none text-white">{t.appName}</div>
            <div className="mt-1 text-[11px] text-slate-400">AICTE scrutiny · SIH26261</div>
          </div>
        </Link>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2" aria-label="Main">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">{g.label}</div>
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} aria-current={isActive(it.href) ? 'page' : undefined}
                  className={clsx('group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[14px] transition-all',
                    isActive(it.href) ? 'bg-gradient-to-r from-white/15 to-white/5 font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]' : 'text-slate-300 hover:translate-x-0.5 hover:bg-white/5 hover:text-white')}>
                  {isActive(it.href) && <span className="absolute inset-y-2 -left-3 w-[4px] rounded-r-full bg-[#F4CB45] shadow-[0_0_12px_rgba(244,203,69,.7)]" />}
                  <span className={clsx('grid h-7 w-7 place-items-center rounded-lg transition-colors', isActive(it.href) ? 'bg-[#F4CB45]/20 text-[#F4CB45]' : 'bg-white/5 text-slate-300 group-hover:text-white')}><it.icon className="h-[15px] w-[15px]" /></span>{it.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="m-3 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#F4CB45]"><ShieldCheck className="h-3.5 w-3.5" />Human decides</div>
          <p className="mt-1.5 text-[11.5px] leading-snug text-slate-400">Indicators are not proof. The final decision stays with the competent AICTE authority.</p>
        </div>
      </aside>

      <div className="min-w-0 md:pl-60">
        <header className="app-header sticky top-0 z-10 border-b border-[var(--rule)] bg-[var(--paper)]/80 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 px-4 py-2 md:px-6">
            <div className="hidden items-center gap-2 text-[13px] md:flex"><span className="text-slate-500">Sakshya</span><span className="text-slate-400">/</span><b className="font-display text-[14px] text-slate-900 dark:text-white">{all.find((i) => isActive(i.href))?.label ?? ''}</b></div>
            <Link href="/overview" className="font-display text-lg md:hidden">{t.appName}</Link>
            <div className="ml-auto flex shrink-0 items-center gap-2 text-[13px]">
              <CommandPalette pages={all.map((i) => ({ label: i.label, hint: 'Page', href: i.href }))} officer={role !== 'applicant' && role !== 'rule_author'} />
              <label htmlFor="role" className="hidden text-slate-600 sm:inline">Viewing as</label>
              <select id="role" value={role} onChange={(e) => setRole(e.target.value)} className="max-w-[9.5rem] rounded-lg border border-slate-300 bg-[var(--panel)] px-2.5 py-1.5 font-semibold dark:border-slate-600 sm:max-w-none">
                {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <ThemeToggle />
              <button onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')} className="rounded-lg border border-slate-300 bg-[var(--panel)] px-2.5 py-1.5 font-semibold hover:border-indigo-500">{language === 'en' ? 'हिन्दी' : 'English'}</button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-[var(--rule)] px-3 py-1.5 md:hidden" aria-label="Main (mobile)">
            {all.map((it) => <Link key={it.href} href={it.href} className={clsx('whitespace-nowrap rounded-[5px] px-2.5 py-1 text-[13px]', isActive(it.href) ? 'bg-indigo-600 font-semibold text-white' : 'text-slate-700')}>{it.label}</Link>)}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1400px] p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
