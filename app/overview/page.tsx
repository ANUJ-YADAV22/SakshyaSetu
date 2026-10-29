'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Card, DemoTag, Empty, ErrorBox, Loading, PageTitle, useLoad } from '@/components/ui';
import { Donut, BarList, Kpi } from '@/components/viz';
import { Inbox, ShieldAlert, Network, BellRing, ListChecks, Building2, GitPullRequestArrow, Gauge } from 'lucide-react';
import { useSession } from '@/lib/session';
import { CATS } from '@/components/shared';
import { CARD_META, CARD_ORDER } from '@/components/ProofCards';

const Row = ({ label, value, href, tone }: { label: string; value: React.ReactNode; href?: string; tone?: string }) => {
  const inner = (<div className="flex items-baseline justify-between gap-3 border-b border-[var(--rule)] py-2 last:border-0">
    <span className="text-sm text-slate-700">{label}</span><b className={`font-display text-xl tabular-nums ${tone ?? ''}`}>{value}</b></div>);
  return href ? <Link href={href} className="block hover:bg-slate-50">{inner}</Link> : inner;
};

export default function Overview() {
  const { role, t } = useSession();
  const isOfficer = role !== 'applicant' && role !== 'rule_author';
  const { data, error, loading, reload } = useLoad<any>(() => (isOfficer ? api('/dashboard/summary') : Promise.resolve(null)), [isOfficer]);
  const queue = useLoad<any>(() => (isOfficer ? api('/applications?page_size=50') : Promise.resolve(null)), [isOfficer]);
  const [busy, setBusy] = useState(false);

  const seed = async () => {
    setBusy(true);
    try { const r = await api('/demo/seed', { method: 'POST' }); toast.success(`Synthetic demo dossiers created: ${r.application_ids.join(', ')}`); reload(); queue.reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const rows = (items: any[], key: string) => items.length
    ? items.map((c: any) => <div key={c[key]} className="flex justify-between border-b border-[var(--rule)] py-1.5 text-sm last:border-0"><span>{String(c[key]).replace(/_/g, ' ')}</span><b className="tabular-nums">{c.n}</b></div>)
    : <p className="text-sm text-slate-500">Nothing yet.</p>;

  const [cat, setCat] = useState('all');
  const [stat, setStat] = useState('all');
  // Transparent priority score: 3 x open deficiencies + 1 x items to review. Shown in the UI; it is a sort order, not a verdict.
  const score = (a: any) => 3 * a.counts.deficiency + a.counts.needs_review;
  const all: any[] = queue.data?.items ?? [];
  const cats = Array.from(new Set(all.map((a) => a.category))) as string[];
  const stats = Array.from(new Set(all.map((a) => a.status))) as string[];
  const waiting = all.filter((a) => score(a) > 0 && (cat === 'all' || a.category === cat) && (stat === 'all' || a.status === stat))
    .sort((x, y) => score(y) - score(x)).slice(0, 10);
  const maxScore = Math.max(1, ...waiting.map(score));

  return (
    <div>
      {!isOfficer && <PageTitle eyebrow="Scrutiny" title={t.overview} sub="Your queue, ranked by how much evidence needs a decision." />}
      {!isOfficer && <Card>Switch to an officer role (top right) to see the case desk. Applicants can open <Link className="font-semibold text-indigo-700 underline" href="/applications">their applications</Link>.</Card>}
      {isOfficer && loading && <Loading />}
      {isOfficer && error != null && <ErrorBox error={error} />}
      {isOfficer && data && (
        <div className="space-y-6">
          <section className="hero rise">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#F4CB45]">{t.overview} · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                <h1 className="mt-2 font-display text-[32px] leading-tight text-white">Evidence that needs a person today</h1>
                <p className="mt-1.5 max-w-xl text-sm text-slate-300">Agents propose, rules verify, humans decide. Every figure is read from the live database.</p>
              </div>
              <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${data.audit_chain.valid ? 'bg-[#7FC48A] shadow-[0_0_10px_#7FC48A]' : 'bg-[#E48B7A]'}`} />
                <Link href="/audit-trail" className="hover:underline"><b>{data.audit_chain.valid ? 'Audit chain intact' : 'Audit chain broken'}</b> <span className="text-slate-400">· {data.audit_chain.events} events</span></Link>
              </div>
              <button onClick={seed} disabled={busy} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-[#F4CB45] hover:text-white disabled:opacity-50">{busy ? 'Loading…' : 'Load synthetic demo dossiers'}</button>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi dark index={1} icon={Inbox} tone="verdigris" label="Findings to review" value={data.pending_officer_actions} hint="waiting for a reviewer" />
              <Kpi dark index={2} icon={ShieldAlert} tone="marigold" label="Human gates open" value={data.open_gates} hint="paused for a person" />
              <Kpi dark index={3} icon={Network} tone="ink" label="Source checks" value={data.unresolved_source_checks} href="/authority-bridge" hint="unresolved" />
              <Kpi dark index={4} icon={BellRing} tone="vermilion" label="Alerts" value={data.unacknowledged_alerts} href="/alerts" hint="not acknowledged" />
            </div>
          </section>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)]">
            <Card icon={Gauge} title="Document proof cards">
              <div className="flex flex-wrap items-center gap-6">
                <Donut sub="documents" segs={CARD_ORDER.map((k) => ({ label: CARD_META[k].label, value: data.proof_totals?.[k] ?? 0, color: CARD_META[k].bar }))} />
                <ul className="min-w-[10rem] flex-1 space-y-2.5">{CARD_ORDER.map((k) => (
                  <li key={k} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ background: CARD_META[k].bar }} />{CARD_META[k].label}</span><b className="font-display text-lg tabular-nums">{data.proof_totals?.[k] ?? 0}</b></li>))}</ul>
              </div>
            </Card>

            <Card icon={GitPullRequestArrow} title="Cases waiting for a person" right={<Link className="text-sm font-semibold text-indigo-700 hover:underline" href="/applications">All applications →</Link>}>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <select className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:bg-slate-800" value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">All categories</option>{cats.map((c) => <option key={c} value={c}>{CATS[c]?.split(' (')[0] ?? c}</option>)}</select>
                <select className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:bg-slate-800" value={stat} onChange={(e) => setStat(e.target.value)}><option value="all">All statuses</option>{stats.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select>
                <span className="text-slate-500">priority = 3 × deficiencies + 1 × items to review</span>
              </div>
              {queue.loading && !queue.data ? <Loading /> : waiting.length === 0
                ? <Empty>No case has open deficiencies or review items. Load the demo dossiers to see the workbench with data.</Empty>
                : <ul className="space-y-2">{waiting.map((a: any) => { const sc = score(a); const lvl = sc >= 10 ? ['High', 'bg-red-100 text-red-800'] : sc >= 4 ? ['Medium', 'bg-amber-100 text-amber-800'] : ['Low', 'bg-emerald-50 text-emerald-800'];
                  return (<li key={a.id}><Link href={`/applications/${a.id}`} className="panel-lift flex items-center gap-3 rounded-xl border border-[var(--rule)] bg-[var(--panel)] p-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 font-display text-lg text-indigo-700">{a.institution_name.charAt(0)}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{a.institution_name} {a.is_demo ? <DemoTag /> : null}</span>
                      <span className="block truncate text-xs text-slate-600">{CATS[a.category]?.split(' (')[0] ?? a.category} · {a.id}</span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--rule)]"><span className="block h-full rounded-full bg-gradient-to-r from-[#D9A21B] to-[#B93A28]" style={{ width: `${(100 * sc) / maxScore}%` }} /></span></span>
                    <span className="shrink-0 text-right text-xs"><span className={`rounded-full px-2 py-0.5 font-bold ${lvl[1]}`}>{lvl[0]}</span><span className="mt-1.5 block"><b className="text-red-700">{a.counts.deficiency}</b> def · <b className="text-indigo-700">{a.counts.needs_review}</b> review</span></span>
                  </Link></li>); })}</ul>}
            </Card>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-3">
            <Card icon={Building2} title="Applications by category"><BarList items={data.by_category.map((c: any) => ({ label: String(c.category).replace(/_/g, ' '), value: c.n }))} /></Card>
            <Card icon={ListChecks} title="Applications by status"><BarList items={data.by_status.map((c: any) => ({ label: String(c.status).replace(/_/g, ' '), value: c.n, color: '#D9A21B' }))} /></Card>
            <Card icon={Inbox} title="Review queues (open items)"><BarList items={data.review_queues.map((c: any) => ({ label: String(c.queue).replace(/_/g, ' '), value: c.n, color: '#B93A28' }))} /></Card>
          </div>
          <Card title="Operational signals">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 text-sm md:grid-cols-2">
              <Link href="/deficiencies" className="flex items-baseline justify-between rounded-xl border border-[var(--rule)] p-3 hover:border-indigo-500"><span>Notices awaiting a response</span><b className="font-display text-2xl">{data.deficiencies_awaiting_response}</b></Link>
              <div className="rounded-xl border border-[var(--rule)] p-3">{data.alert_timeliness.n ? <span><b>{data.alert_timeliness.n}</b> alerts · median <b>{data.alert_timeliness.median_s}s</b> · worst <b>{data.alert_timeliness.worst_s}s</b></span> : <span className="text-slate-500">No alerts delivered yet.</span>}</div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
