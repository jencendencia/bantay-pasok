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

/** Admin tab routes — keep in sync with PAGES in App.tsx (the scanner has its own root). */
const ADMIN_ROUTES = new Set([
  'dashboard', 'standby', 'classprog', 'sections', 'teachers',
  'reports', 'students', 'guardians', 'settings'
]);
const LAST_TAB_KEY = 'bantay_pasok_last_tab';

/**
 * Reads the current admin route from the URL hash.
 * Accepts both "#/settings" and "#settings". Empty, unknown or scanner-style
 * hashes fall back to the last tab the user visited (remembered in
 * localStorage), so a reload or app restart stays on the current tab
 * instead of jumping back to the Dashboard.
 */
function readHashRoute(): string {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if (ADMIN_ROUTES.has(raw)) {
    try { localStorage.setItem(LAST_TAB_KEY, raw); } catch { /* ignore */ }
    return raw;
  }
  try {
    const last = localStorage.getItem(LAST_TAB_KEY);
    if (last && ADMIN_ROUTES.has(last)) return last;
  } catch { /* ignore */ }
  return 'dashboard';
}

/** One-way hash route for the admin window. */
export function useHashRoute(): [string, (h: string) => void] {
  const [route, setRoute] = useState(readHashRoute);
  useEffect(() => {
    const fn = (): void => setRoute(readHashRoute());
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  const nav = (h: string): void => { window.location.hash = `#${h}`; };
  return [route, nav];
}
