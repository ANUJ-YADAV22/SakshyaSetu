'use client';
import React, { useEffect, useState } from 'react';
import { blobUrl } from '@/lib/api';

export const CATS: Record<string, string> = {
  eoa_self_disclosure: 'EoA based on Self-Disclosure (Cl. 2.5)',
  eoa_increase_intake: 'Increase in Intake / Additional Course (Cl. 2.6)',
  eoa_change_of_site: 'Change of Site / Location (Cl. 2.17)',
  eoa_change_name_address: 'Change in Name/Address of Trust/Society/Company (Cl. 2.20)',
};

export function ArtifactImg({ path, label = 'Derived overlay (source file unchanged)' }: { path: string; label?: string }) {
  const [u, setU] = useState('');
  useEffect(() => {
    let x = '';
    blobUrl(`/artifacts/${path.split('/').pop()}`).then((v) => { x = v; setU(v); }).catch(() => {});
    return () => { if (x) URL.revokeObjectURL(x); };
  }, [path]);
  if (!u) return null;
  return (
    <div>
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={u} alt="derived overlay" className="max-h-72 rounded border" />
    </div>
  );
}
