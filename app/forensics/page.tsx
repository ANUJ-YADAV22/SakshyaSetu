'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Card, DemoTag, Empty, ErrorBox, Loading, PageTitle, StatusBadge, fmtTime, useLoad } from '@/components/ui';
import { ArtifactImg } from '@/components/shared';
import { useSession } from '@/lib/session';
import ELASandbox from '@/components/ELASandbox';
import ForensicStudio from '@/components/ForensicStudio';
import DocLab from '@/components/DocLab';
import FacultyCrossCheck from '@/components/FacultyCrossCheck';

export default function Forensics() {
  const { t, role } = useSession();
  const [status, setStatus] = useState('needs_review');
  const { data, error, loading, reload } = useLoad<any>(() => api(`/findings?family=integrity&status=${status}`), [status]);
  const [reason, setReason] = useState<Record<string, string>>({});

  const act = async (id: string, action: string) => {
    try { await api(`/findings/${id}/review`, { method: 'POST', json: { action, reason: reason[id] ?? '' } }); toast.success(`Recorded: ${action}`); reload(); }
    catch (e: any) { toast.error(e.message); }
  };
  if (role === 'applicant') return <Card>Integrity and forensic indicators are visible to officers and reviewers only, so they are never shown to applicants as accusations.</Card>;

  return (
    <div className="space-y-4">
      <PageTitle title={t.forensics} sub="Signature status, metadata observations, exact and near duplicates, and optional image-region (ELA) analysis. Every item is a preliminary indicator that requires human verification - never proof of forgery or misconduct." />
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Indicators can arise from legitimate causes (re-saved PDFs, shared templates, scanner software). Open the original, compare, then confirm or dismiss with a reason.</div>
      <ForensicStudio />
      <ELASandbox />
      <DocLab />
      <FacultyCrossCheck />
      <div className="flex gap-2">{['needs_review', 'pass', 'not_checked'].map((s) => <Btn key={s} variant={status === s ? 'primary' : 'ghost'} onClick={() => setStatus(s)}>{s.replace('_', ' ')}</Btn>)}</div>
      {loading && <Loading />}{error != null && <ErrorBox error={error} />}
      {data && (data.items.length === 0 ? <Empty>No integrity items in this state.</Empty> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
          {data.items.map((f: any) => (
            <Card key={f.id} title={<span className="flex items-center gap-2"><StatusBadge status={f.status} />{f.title}</span>} right={f.is_demo ? <DemoTag /> : undefined}>
              <p className="text-sm">{f.message}</p>
              <p className="mt-1 text-[11px] text-slate-500">{f.institution_name} · <Link className="text-indigo-700 underline" href={`/applications/${f.application_id}`}>{f.application_id}</Link> · {f.evidence?.[0]?.filename} · {fmtTime(f.timestamp)}</p>
              <p className="mt-1 text-[11px] text-slate-500">Method: {f.method}. {f.limitations}</p>
              {f.outputs?.overlay && <ArtifactImg path={f.outputs.overlay} label="ELA overlay - potential anomaly indicator" />}
              {f.outputs?.match && <div className="mt-1 rounded bg-slate-50 p-1.5 text-[11px]">Match: {f.outputs.match.filename} {f.outputs.match.phash_distance != null && `· pHash distance ${f.outputs.match.phash_distance}`} {f.outputs.match.text_similarity != null && `· text similarity ${f.outputs.match.text_similarity}`}</div>}
              {f.status === 'needs_review' && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
                  <input className="min-w-40 flex-1 rounded border border-slate-300 px-2 py-1 text-xs" placeholder="Reason" value={reason[f.id] ?? ''} onChange={(e) => setReason({ ...reason, [f.id]: e.target.value })} />
                  <Btn onClick={() => act(f.id, 'confirm')}>Confirm indicator</Btn><Btn variant="ghost" onClick={() => act(f.id, 'dismiss')}>Dismiss</Btn><Btn variant="ghost" onClick={() => act(f.id, 'escalate')}>Escalate</Btn>
                </div>)}
              {f.review && <p className="mt-1 text-[11px]">Outcome: <b>{f.review.outcome}</b> by {f.review.by}</p>}
            </Card>))}
        </div>))}
    </div>
  );
}
