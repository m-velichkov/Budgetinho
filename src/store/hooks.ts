/** React bindings for the store. Screens use these, never the store internals. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getDerived, getSnapshot, refreshCurrentPeriod, subscribe, type AppSnapshot } from './store';

export function useApp(): AppSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Ledger + dashboard + payee index for the currently selected period. */
export function useDerived() {
  const snapshot = useApp();
  // getDerived() memoises on the same revision, so this is cheap on re-render.
  return useMemo(() => getDerived(), [snapshot.revision, snapshot.periodKey]);
}

export function useSettings() {
  return useApp().data.settings;
}

/**
 * Periods auto-advance. Re-check when the tab regains focus (a phone that sat
 * in the background overnight) and once an hour for a session left open.
 */
export function usePeriodAutoAdvance(): void {
  useEffect(() => {
    const check = () => refreshCurrentPeriod();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    const timer = window.setInterval(check, 60 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.clearInterval(timer);
    };
  }, []);
}

/** Simple hash router: #/dashboard, #/add, #/reports, #/transactions, #/settings. */
export type Route = 'dashboard' | 'add' | 'reports' | 'transactions' | 'settings';

const ROUTES: Route[] = ['dashboard', 'add', 'reports', 'transactions', 'settings'];

function readHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  return (ROUTES as string[]).includes(raw) ? (raw as Route) : 'dashboard';
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(readHash);

  useEffect(() => {
    const onChange = () => setRoute(readHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    // Hash routing keeps GitHub Pages happy: no server rewrite rules needed and
    // a refresh on any tab still resolves to index.html.
    window.location.hash = `#/${next}`;
    setRoute(next);
  }, []);

  return [route, navigate];
}
