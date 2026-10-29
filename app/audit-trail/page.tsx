'use client';
import React, { useState } from 'react';
import { api } from '@/lib/api';
import { Btn, Card, ErrorBox, Loading, PageTitle, fmtTime, useLoad } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Audit() {
  const { t, role } = useSession();
  const ev = useLoad<any[]>(() => api('/audit?limit=300'), [role]);
  const ch = useLoad<any>(() => api('/audit/verify'), [role]);
  const [type, setType] = useState('all');
  const types = Array.from(new Set((ev.data ?? []).map((e: any) => e.event_type))) as string[];
  const rows = (ev.data ?? []).filter((e: any) => type === 'all' || e.event_type === type);
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), chain: ch.data, events: ev.data }, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(blob); const el = document.createElement('a'); el.href = u; el.download = `sakshya-audit-ledger-${Date.now()}.json`; el.click(); URL.revokeObjectURL(u);
  };
  if (role === 'applicant') return <Card>The audit ledger is available to officers.</Card>;
  return (
    <div className="space-y-4">
      <PageTitle title={t.audit} sub="Each event stores the hash of the previous event; changing history breaks the chain. This proves integrity of recorded events - not the truth of any document's contents - and does not replace access control, backups or independent audit." />
      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="ghost" onClick={() => ch.reload()}>Verify hash chain</Btn><Btn variant="ghost" onClick={exportJson} disabled={!ev.data}>Export ledger (JSON)</Btn>
        <span className="mx-1 h-5 w-px bg-slate-300" />
        {['all', ...types].map((tp) => <button key={tp} onClick={() => setType(tp)} className={`rounded-full border px-2.5 py-0.5 text-xs ${type === tp ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{tp.replace(/_/g, ' ')}</button>)}
      </div>
      {ch.data && <div className={`rounded-xl border p-3 text-sm ${ch.data.valid ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
        {ch.data.valid ? `Chain intact · ${ch.data.events} events · head ${ch.data.last_hash.slice(0, 20)}…` : `CHAIN BROKEN at event #${ch.data.broken_at_seq}`}</div>}
      {ev.loading && <Loading />}{ev.error != null && <ErrorBox error={ev.error} />}
      {ev.data && <Card><table className="w-full text-xs"><thead><tr className="text-left uppercase text-slate-500"><th className="py-1">#</th><th>Time</th><th>Actor</th><th>Event</th><th>Case</th><th>Details</th><th>Hash</th></tr></thead>
        <tbody>{rows.map((e: any) => <tr key={e.seq} className="border-t align-top"><td className="py-1.5 text-slate-400">{e.seq}</td><td>{fmtTime(e.ts)}</td><td>{e.actor}<div className="text-slate-400">{e.role}</div></td><td className="font-semibold">{e.event_type.replace(/_/g, ' ')}</td><td className="font-mono">{e.application_id ?? '-'}</td>
          <td className="max-w-xs truncate text-slate-500" title={JSON.stringify(e.refs)}>{JSON.stringify(e.refs)}</td><td className="font-mono text-[10px] text-slate-400" title={`prev ${e.prev_hash}`}>{e.hash.slice(0, 12)}…</td></tr>)}</tbody></table></Card>}
    </div>
  );
}
