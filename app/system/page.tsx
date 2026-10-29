'use client';
import React from 'react';
import { api } from '@/lib/api';
import { Card, ErrorBox, Loading, PageTitle, useLoad } from '@/components/ui';
import { useSession } from '@/lib/session';

const tone = (s: string) => s.startsWith('implemented') ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : s.startsWith('mocked') ? 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200' : 'bg-slate-100 text-slate-700 border-slate-200';

export default function System() {
  const { t } = useSession();
  const { data, error, loading } = useLoad<any>(() => api('/system/status'));
  return (
    <div className="space-y-4">
      <PageTitle title={t.system} sub="Claims policy: planned features are never presented as implemented. Each capability is marked implemented, mocked or designed." />
      {loading && <Loading />}{error != null && <ErrorBox error={error} />}
      {data && <Card title={`${data.tool_version} - ${data.policy}`}>
        <ul className="divide-y">{data.capabilities.map((c: any) => <li key={c.capability} className="flex items-start justify-between gap-4 py-2 text-sm"><span>{c.capability}</span><span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs ${tone(c.status)}`}>{c.status}</span></li>)}</ul></Card>}
    </div>
  );
}
