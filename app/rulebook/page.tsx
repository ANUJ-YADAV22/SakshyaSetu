'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Card, ErrorBox, Loading, PageTitle, useLoad } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Rulebook() {
  const { t, role } = useSession();
  const { data, error, loading, reload } = useLoad<any[]>(() => api('/rulepacks'), [role]);
  const [open, setOpen] = useState<any>(null);
  const [draft, setDraft] = useState('');
  const view = async (id: string) => setOpen(await api(`/rulepacks/${id}`));
  const activate = async (id: string) => { try { await api(`/rulepack-activate/${id}`, { method: 'POST' }); toast.success('Pack activated (maker-checker satisfied)'); reload(); } catch (e: any) { toast.error(e.message); } };
  const create = async () => {
    try { const r = await api('/rulepacks', { method: 'POST', json: { pack: JSON.parse(draft), changelog: 'draft via UI' } }); toast.success(`Draft ${r.id}: ${r.tests.passed}/${r.tests.total} tests pass`); setDraft(''); reload(); }
    catch (e: any) { toast.error(e.message); }
  };
  return (
    <div className="space-y-5">
      <PageTitle title={t.rulebook} sub="The handbook as versioned, effective-dated data. A new category or rule is a new pack - no application code change. Activation needs a different person from the author (maker-checker) and passing tests; rules never change themselves." />
      <div className="rounded-xl border border-fuchsia-300 bg-fuchsia-50 p-3 text-xs text-fuchsia-900">Starter packs are a <b>synthetic demo seed</b>, not a real regulatory approval. Clause references are marked “to be confirmed” until checked against the current authorised APH. Numeric thresholds are intentionally left as draft rules.</div>
      {loading && <Loading />}{error != null && <ErrorBox error={error} />}
      {data && <Card title="Rule packs"><table className="w-full text-sm"><thead><tr className="text-left text-[11px] uppercase text-slate-500"><th className="py-1">Pack</th><th>Scope</th><th>Status</th><th>Effective</th><th>Tests</th><th>Author / approver</th><th /></tr></thead>
        <tbody>{data.map((p) => <tr key={p.id} className="border-t"><td className="py-2 font-mono text-xs"><button className="text-indigo-700 underline" onClick={() => view(p.id)}>{p.id}</button><div className="font-sans text-slate-500">{p.name}</div></td><td className="text-xs">{p.scope}</td>
          <td><span className={`rounded px-2 py-0.5 text-xs font-semibold ${p.status === 'active' ? 'bg-emerald-100 text-emerald-800' : p.status === 'draft' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200'}`}>{p.status}</span></td><td className="text-xs">{p.effective_date}</td>
          <td className="text-xs">{p.test_results?.passed}/{p.test_results?.total}</td><td className="text-xs text-slate-500">{p.authored_by} / {p.approved_by ?? '-'}</td>
          <td>{p.status === 'draft' && role === 'regulatory_expert' && <Btn onClick={() => activate(p.id)}>Activate</Btn>}</td></tr>)}</tbody></table></Card>}
      {open && <Card title={`${open.id} - rules`} right={<Btn variant="quiet" onClick={() => setOpen(null)}>Close</Btn>}>
        {open.data.ambiguities?.length > 0 && <div className="mb-3 rounded bg-amber-50 p-2 text-xs"><b>Ambiguities recorded for expert review (not hard-coded):</b><ul className="list-disc pl-4">{open.data.ambiguities.map((a: string) => <li key={a}>{a}</li>)}</ul></div>}
        <table className="w-full text-xs"><thead><tr className="text-left uppercase text-slate-500"><th className="py-1">Rule</th><th>Clause</th><th>Check</th><th>Severity</th><th>Approval</th><th>Tests</th></tr></thead>
          <tbody>{open.data.rules.map((r: any) => <tr key={r.rule_id} className="border-t align-top"><td className="py-1.5"><span className="font-mono">{r.rule_id}</span><div className="text-slate-500">{r.title}</div></td><td>{r.clause}{!r.clause_confirmed && <div className="text-amber-700">unconfirmed</div>}</td><td>{r.check.type}</td><td>{r.severity}</td><td>{r.approval}</td><td>{r.tests?.length ?? 0}</td></tr>)}</tbody></table></Card>}
      {(role === 'rule_author' || role === 'regulatory_expert') && <Card title="Propose a draft pack (JSON)"><textarea className="h-40 w-full rounded border border-slate-300 p-2 font-mono text-xs" placeholder="Paste a rule pack JSON (see backend/app/rules/packs/*.json for the schema). Bump the version." value={draft} onChange={(e) => setDraft(e.target.value)} /><div className="mt-2"><Btn onClick={create} disabled={!draft.trim()}>Create draft and run tests</Btn></div></Card>}
    </div>
  );
}
