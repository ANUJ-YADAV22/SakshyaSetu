'use client';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ROLES, setApiSession } from './api';
import { L, Language, Labels } from './labels';

type Ctx = { role: string; actor: string; setRole: (r: string) => void; language: Language; setLanguage: (l: Language) => void; t: Labels; ready: boolean };
const C = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState('scrutiny_officer');
  const [language, setLanguage] = useState<Language>('en');
  const [ready, setReady] = useState(false);
  const actor = ROLES.find((r) => r.id === role)?.actor ?? 'officer.demo';
  setApiSession({ role, actor });
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('sakshya.role') : null;
    if (saved && ROLES.some((r) => r.id === saved)) setRoleState(saved);
    setReady(true);
  }, []);
  const value = useMemo<Ctx>(() => ({
    role, actor, language, setLanguage, ready, t: L[language] as Labels,
    setRole: (r) => { window.localStorage.setItem('sakshya.role', r); setRoleState(r); },
  }), [role, actor, language, ready]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useSession() {
  const v = useContext(C);
  if (!v) throw new Error('useSession outside provider');
  return v;
}
