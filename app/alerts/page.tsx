'use client';
import React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Card, Empty, ErrorBox, Loading, PageTitle, fmtTime, useLoad } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Alerts() {
  const { t, role } = useSession();
  const { data, error, loading, reload } = useLoad<any[]>(() => api('/alerts'), [role]);
  const ack = async (id: string) => { await api(`/alerts/${id}/ack`, { method: 'POST' }); reload(); };
  const esc = async () => { try { const r = await api('/alerts/escalate?hours=24', { method: 'POST' }); toast.success(`${r.escalated.length} alert(s) escalated to reviewer lead`); reload(); } catch (e: any) { toast.error(e.message); } };
  return (
    <div className="space-y-4">
      <PageTitle title={t.alerts} sub="In-app queue; email/SMS go through a MOCK gateway in this prototype. Repeats are merged and unacknowledged alerts escalate to the reviewer lead." right={role !== 'applicant' ? <Btn variant="ghost" onClick={esc}>Escalate overdue (&gt;24h)</Btn> : undefined} />
      {loading && <Loading />}{error != null && <ErrorBox error={error} />}
      {data && (data.length === 0 ? <Empty>No alerts for this role.</Empty> : (
        <div className="space-y-2">{data.map((a) => (
          <Card key={a.id}>
            <div className="flex items-start justify-between gap-3">
              <div><div className="flex items-center gap-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${a.severity === 'high' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{a.severity}</span>
                <b className="text-sm">{a.type.replace(/_/g, ' ')}</b>{a.count > 1 && <span className="rounded bg-slate-200 px-1.5 text-[10px]">×{a.count} merged</span>}{a.escalated_at && <span className="rounded bg-red-600 px-1.5 text-[10px] text-white">escalated</span>}</div>
                <p className="mt-1 text-sm">{a.message}</p>
                <p className="mt-1 text-[11px] text-slate-500"><Link className="text-indigo-700 underline" href={`/applications/${a.application_id}`}>{a.application_id}</Link> · for {a.role_target} · raised {fmtTime(a.event_at)} · delivered {fmtTime(a.delivered_at)} via {a.channels.map((c: any) => c.channel).join(', ')} {a.channels.some((c: any) => c.channel !== 'in_app') && '(mock gateway)'}</p></div>
              {a.acked_at ? <span className="text-xs text-emerald-700">acknowledged by {a.acked_by}</span> : <Btn variant="ghost" onClick={() => ack(a.id)}>Acknowledge</Btn>}
            </div></Card>))}</div>))}
    </div>
  );
}
