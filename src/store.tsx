import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { AppData } from './shared/types';
import { api } from './api';

interface Ctx {
  data: AppData | null;
  refresh: () => Promise<void>;
  now: Date;
}

const DataCtx = createContext<Ctx>({ data: null, refresh: async () => {}, now: new Date() });

export function DataProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [data, setData] = useState<AppData | null>(null);
  const [now, setNow] = useState(new Date());

  const refresh = useCallback(async () => {
    const res = await api.getData();
    if (res.ok && res.data) setData(res.data);
  }, []);

  useEffect(() => {
    void refresh();
    const off = api.onDataChanged((d: AppData) => setData(d));
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => { off(); clearInterval(t); };
  }, [refresh]);

  return <DataCtx.Provider value={{ data, refresh, now }}>{children}</DataCtx.Provider>;
}

export function useData(): Ctx {
  return useContext(DataCtx);
}

/** One-way hash route for the admin window. */
export function useHashRoute(): [string, (h: string) => void] {
  const [route, setRoute] = useState(window.location.hash || '#dashboard');
  useEffect(() => {
    const fn = (): void => setRoute(window.location.hash || '#dashboard');
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  const nav = (h: string): void => { window.location.hash = h; };
  return [route.replace('#', '') || 'dashboard', nav];
}
