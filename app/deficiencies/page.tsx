'use client';
import React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Card, Empty, ErrorBox, Loading, PageTitle, fmtTime, useLoad } from '@/components/ui';
import { useSession } from '@/lib/session';

/** Live d/h/m/s clock to the officer-approved response date (end of that day, local time). */
function LiveClock({ due }: { due?: string | null }) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  if (!due || now == null) return null;
  const ms = new Date(due + 'T23:59:59').getTime() - now, over = ms < 0, a = Math.abs(ms);
  const parts = [['days', Math.floor(a / 864e5)], ['hrs', Math.floor(a / 36e5) % 24], ['min', Math.floor(a / 6e4) % 60], ['sec', Math.floor(a / 1e3) % 60]] as const;
  const tone = over ? 'border-red-300 bg-red-50 text-red-800' : ms < 3 * 864e5 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900';
  return (
    <div className={`inline-flex items-center gap-3 rounded-xl border px-3 py-2 ${tone}`} role="timer" aria-label={over ? 'Response overdue' : 'Time left to respond'}>
      <span className="text-[10px] font-bold uppercase tracking-wider">{over ? 'Overdue by' : 'Time to respond'}</span>
      {parts.map(([k, v]) => <span key={k} className="text-center"><b className="block font-display text-xl tabular-nums leading-none">{String(v).padStart(2, '0')}</b><span className="text-[9px] uppercase">{k}</span></span>)}
      <span className="ml-1 text-[11px] opacity-80">due {due}</span>
    </div>
  );
}

const HI = {
  title: 'कमी सूचना (प्रारूप)', subject: 'विषय: प्रस्तुत दस्तावेज़ों में पाई गई कमियाँ — कृपया निर्धारित तिथि तक सुधार/स्पष्टीकरण प्रस्तुत करें।',
  items: 'कमियाँ', due: 'उत्तर की अंतिम तिथि', foot: 'यह प्रारूप केवल निर्णय-सहायता है। अंतिम निर्णय सक्षम प्राधिकारी का होगा।',
};
const EN = { title: 'Draft deficiency notice', subject: 'Subject: Deficiencies found in the submitted documents. Please submit a rectification or clarification by the due date.',
  items: 'Deficiencies', due: 'Response due', foot: 'This draft is decision support only. The final decision rests with the competent authority.' };

export default function Notices() {
  const { t, role } = useSession();
  const [lang, setLang] = React.useState<'en' | 'hi'>('en');
  const isApplicant = role === 'applicant';
  const { data, error, loading, reload } = useLoad<any[]>(() => api('/notices'), [role]);
  if (isApplicant) return <Card>Applicants see issued deficiency notices inside their application workspace.</Card>;
  const approve = async (n: any) => {
    const due = prompt('Response due date (YYYY-MM-DD)'); if (!due) return;
    try { await api(`/notices/${n.id}/approve`, { method: 'POST', json: { due_date: due } }); toast.success('Notice approved by officer'); reload(); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <div className="space-y-4">
      <PageTitle title={t.notices} sub="Drafts cite evidence-linked findings and clauses. Nothing is issued without a recorded officer approval (human gate: official communication)." />
      {loading && <Loading />}{error != null && <ErrorBox error={error} />}
      {data && (data.length === 0 ? <Empty>No notices. Open an application with deficiency findings and choose “Draft deficiency notice”.</Empty> : data.map((n) => (
        <Card key={n.id} title={`${n.institution_name} · ${n.id} · v${n.version}`} right={<span className="flex items-center gap-2"><span className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${n.status === 'issued' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{n.status}</span></span>}>
          {n.status === 'issued' && <div className="mb-3"><LiveClock due={n.due_date} /></div>}
          <div className="mb-3 rounded-xl border border-[var(--rule)] bg-[var(--paper)] p-4">
            <div className="mb-2 flex items-center justify-between"><b className="font-display text-base">{(lang === 'hi' ? HI : EN).title}</b>
              <span className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs font-semibold"><button onClick={() => setLang('en')} className={`px-2.5 py-1 ${lang === 'en' ? 'bg-indigo-600 text-white' : 'bg-white'}`}>EN</button><button onClick={() => setLang('hi')} className={`px-2.5 py-1 ${lang === 'hi' ? 'bg-indigo-600 text-white' : 'bg-white'}`}>हिन्दी</button></span></div>
            <p className="text-sm">{(lang === 'hi' ? HI : EN).subject}</p>
            <p className="mt-1 text-xs text-slate-500">{(lang === 'hi' ? HI : EN).items}: {n.body.deficiencies.length}{n.due_date ? ` · ${(lang === 'hi' ? HI : EN).due}: ${n.due_date}` : ''}</p>
            <p className="mt-1 text-[11px] text-slate-500">{(lang === 'hi' ? HI : EN).foot}</p>
          </div>
          <p className="text-xs text-slate-600">{n.body.draft_notice}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{n.body.deficiencies.map((d: any) => <li key={d.finding_id}>{d.issue} <span className="text-xs text-slate-500">[{d.clause ?? 'no clause'}{d.clause && !d.clause_confirmed ? ' - clause to be confirmed' : ''}] {d.evidence.map((e: any) => `${e.file} p.${e.page ?? '-'}`).join(', ')}</span></li>)}</ol>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500"><span>Created {fmtTime(n.created_at)} by {n.created_by}{n.approved_by ? ` · approved by ${n.approved_by}, due ${n.due_date}` : ''}</span>
            <span className="flex gap-2"><Link className="text-indigo-700 underline" href={`/applications/${n.application_id}`}>Open case</Link>{n.status === 'draft' && role === 'scrutiny_officer' && <Btn onClick={() => approve(n)}>Approve and issue</Btn>}</span></div>
        </Card>)))}
    </div>
  );
}
