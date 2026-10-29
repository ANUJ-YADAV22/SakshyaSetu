'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Card, DemoTag, Empty, ErrorBox, Loading, PageTitle, fmtTime, useLoad } from '@/components/ui';
import { useSession } from '@/lib/session';
import { CATS } from '@/components/shared';

export default function Applications() {
  const { t } = useSession();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad<any>(() => api(`/applications?page=${page}&page_size=15${q ? `&q=${encodeURIComponent(q)}` : ''}${cat ? `&category=${cat}` : ''}`), [q, cat, page]);
  const [form, setForm] = useState({ institution_name: '', category: 'eoa_self_disclosure', registration_number: '' });
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!form.institution_name.trim()) return toast.error('Institution name is required');
    setBusy(true);
    try {
      const r = await api('/applications', { method: 'POST', json: { institution_name: form.institution_name, category: form.category, declared: form.registration_number ? { registration_number: form.registration_number } : {} } });
      toast.success(`Application ${r.id} created`); setForm({ ...form, institution_name: '', registration_number: '' }); reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const download = (name: string, mime: string, body: string) => { const u = URL.createObjectURL(new Blob([body], { type: mime })); const el = document.createElement('a'); el.href = u; el.download = name; el.click(); URL.revokeObjectURL(u); };
  const exportJson = () => data && download('sakshya-applications.json', 'application/json', JSON.stringify(data.items, null, 2));
  const exportCsv = () => {
    if (!data) return; const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['id', 'institution_name', 'category', 'status', 'deficiencies', 'needs_review', 'created_at'];
    download('sakshya-applications.csv', 'text/csv', [head.join(','), ...data.items.map((r: any) => [r.id, r.institution_name, r.category, r.status, r.counts.deficiency, r.counts.needs_review, r.created_at].map(esc).join(','))].join('\n'));
  };
  const inp = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';

  return (
    <div className="space-y-5">
      <PageTitle title={t.applications} sub="Server-side search and pagination with row-level access (applicants see only their own applications)." right={<><Btn variant="ghost" onClick={exportCsv} disabled={!data}>Export CSV</Btn><Btn variant="ghost" onClick={exportJson} disabled={!data}>Export JSON</Btn></>} />
      <Card title="New application">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-4">
          <input className={inp} placeholder="Institution name" value={form.institution_name} onChange={(e) => setForm({ ...form, institution_name: e.target.value })} />
          <select className={inp} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className={inp} placeholder="Registration no. (optional)" value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} />
          <Btn onClick={create} busy={busy}>Create application</Btn>
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        <input className={`w-full sm:w-72 ${inp}`} placeholder="Search institution or application ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className={inp} value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }}>
          <option value="">All categories</option>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {loading && <Loading />}{error != null && <ErrorBox error={error} />}
      {data && (data.items.length === 0 ? <Empty>No applications. Create one above, or load the synthetic demo dossiers from the Overview page.</Empty> : (
        <Card>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="py-2">Application</th><th>Institution</th><th>Category</th><th>Status</th><th>Open items</th><th>Created</th></tr></thead>
            <tbody>
              {data.items.map((a: any) => (
                <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 font-mono text-xs"><Link className="text-indigo-700 underline" href={`/applications/${a.id}`}>{a.id}</Link> {a.is_demo ? <DemoTag /> : null}</td>
                  <td>{a.institution_name}</td><td className="text-xs">{CATS[a.category]?.split(' (')[0] ?? a.category}</td>
                  <td><span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">{a.status.replace(/_/g, ' ')}</span></td>
                  <td className="text-xs">{a.counts.deficiency} deficiency · {a.counts.needs_review} review</td><td className="text-xs text-slate-500">{fmtTime(a.created_at)}</td>
                </tr>))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>{data.total} total</span>
            <div className="flex gap-2"><Btn variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn><Btn variant="ghost" disabled={page * 15 >= data.total} onClick={() => setPage(page + 1)}>Next</Btn></div>
          </div>
        </Card>))}
    </div>
  );
}
