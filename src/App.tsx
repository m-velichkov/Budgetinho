import { useEffect } from 'react';
import { BottomNav } from './components/BottomNav';
import { PeriodBar } from './components/PeriodBar';
import { Notices } from './components/ui';
import { Dashboard } from './screens/Dashboard';
import { AddTransaction } from './screens/AddTransaction';
import { Reports } from './screens/Reports';
import { Transactions } from './screens/Transactions';
import { Settings } from './screens/Settings';
import { useApp, usePeriodAutoAdvance, useRoute } from './store/hooks';

/** Screens whose numbers are scoped to a period get the period switcher. */
const PERIOD_SCOPED = new Set(['dashboard', 'reports', 'transactions']);

export default function App() {
  const { ready, periodKey, data } = useApp();
  const [route, navigate] = useRoute();
  usePeriodAutoAdvance();

  // Keep the browser/PWA chrome in step with the app background.
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1B1F2A');
  }, []);

  if (!ready) {
    return (
      <div className="app">
        <div className="screen center muted" style={{ paddingTop: 60 }}>
          Loading your budget…
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {PERIOD_SCOPED.has(route) ? (
        <PeriodBar periodKey={periodKey} startDay={data.settings.periodStartDay} />
      ) : null}

      {route === 'dashboard' ? <Dashboard navigate={navigate} /> : null}
      {route === 'add' ? <AddTransaction navigate={navigate} /> : null}
      {route === 'reports' ? <Reports /> : null}
      {route === 'transactions' ? <Transactions navigate={navigate} /> : null}
      {route === 'settings' ? <Settings /> : null}

      <Notices />
      <BottomNav route={route} navigate={navigate} />
    </div>
  );
}
