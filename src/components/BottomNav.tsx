/**
 * Bottom nav: Home · Activity · Add · Reports · Settings.
 *
 * Add is a raised circular button in the centre, carrying the peach primary
 * accent -- the one CTA in the chrome. The bar itself is a separate element
 * behind the buttons with a circular notch masked out of it, so it appears to
 * curve around the button.
 *
 * Home is not in the spec's four tabs; without it, leaving the dashboard is a
 * one-way trip.
 */

import type { Route } from '../store/hooks';

const TABS: Array<{ route: Route; label: string; icon: string }> = [
  { route: 'dashboard', label: 'Home', icon: '⌂' },
  { route: 'transactions', label: 'Activity', icon: '≡' },
  { route: 'reports', label: 'Reports', icon: '▤' },
  { route: 'settings', label: 'Settings', icon: '⚙' },
];

export function BottomNav({ route, navigate }: { route: Route; navigate: (route: Route) => void }) {
  // Split so the Add button can sit between the second and third tab.
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  const tab = (t: (typeof TABS)[number]) => (
    <button
      key={t.route}
      type="button"
      aria-current={route === t.route ? 'page' : undefined}
      onClick={() => navigate(t.route)}
    >
      <span className="nav-icon" aria-hidden="true">
        {t.icon}
      </span>
      {t.label}
    </button>
  );

  return (
    <nav className="bottom-nav" aria-label="Main">
      {/* Painted bar with the notch cut out; purely decorative. */}
      <div className="nav-surface" aria-hidden="true" />

      {left.map(tab)}

      <button
        type="button"
        className={`nav-add${route === 'add' ? ' active' : ''}`}
        aria-label="Add a transaction"
        aria-current={route === 'add' ? 'page' : undefined}
        onClick={() => navigate('add')}
      >
        <span aria-hidden="true">+</span>
      </button>

      {right.map(tab)}
    </nav>
  );
}
