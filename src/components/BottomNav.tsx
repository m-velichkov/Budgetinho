/**
 * Bottom nav. The spec lists four tabs (Add, Reports, Transactions, Settings);
 * Home is added as a fifth because without it there is no way back to the
 * dashboard once you leave it. Add keeps the peach primary accent -- it is the
 * one CTA in the chrome.
 */

import type { Route } from '../store/hooks';

const TABS: Array<{ route: Route; label: string; icon: string; className?: string }> = [
  { route: 'dashboard', label: 'Home', icon: '◆' },
  { route: 'add', label: 'Add', icon: '+', className: 'add' },
  { route: 'reports', label: 'Reports', icon: '▤' },
  { route: 'transactions', label: 'Activity', icon: '≡' },
  { route: 'settings', label: 'Settings', icon: '⚙' },
];

export function BottomNav({ route, navigate }: { route: Route; navigate: (route: Route) => void }) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {TABS.map((tab) => (
        <button
          key={tab.route}
          type="button"
          className={tab.className}
          aria-current={route === tab.route ? 'page' : undefined}
          onClick={() => navigate(tab.route)}
        >
          <span className="nav-icon" aria-hidden="true">
            {tab.icon}
          </span>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
