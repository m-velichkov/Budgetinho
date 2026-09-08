# Personal Budget App — Feature Spec

**Stack:** Static site, GitHub Pages, localStorage, mobile-first. Built solo.

## 1. The core mechanic: custom rolling period

This replaces YNAB's calendar-month scoping everywhere.

- **Setting:** one number in Settings — "period start day" (1–31).
- **Period boundaries:** a period runs from the start day of one month to the day *before* the start day of the next month (e.g. start day 15 → Sep 15–Oct 14, then Oct 15–Nov 14).
- **Short-month edge case:** if the start day doesn't exist in a given month (e.g. day 31 in February), the period rolls to the **last valid day of that month** instead.
- **Every date-scoped feature in the app** (category assigned/activity/balance, "unassigned" total, goal progress, reports) is calculated against the *current period's* start/end dates, not `getMonth()`. This is the one piece of logic every other feature depends on — build it first, test the edge cases (31st, 30th, 29th, Feb) before anything else.
- Periods auto-advance: when "today" crosses the next start day, the app opens into a new period automatically. Category balances carry forward per the rollover rule below.

## 2. Categories

- **Grouped** — category groups containing categories (e.g. "Fixed costs" → Rent, Utilities).
- Each category tracks, **per period**: assigned amount, activity (spending), running balance.
- **Rollover:** leftover balances carry forward automatically into the next period; overspending carries forward as a negative that reduces next period's effective balance — same behavior as YNAB, just on your custom cadence.
- **Color coding (3 states, doubles as near-limit alerting):**
  - **Green** — under ~80% of assigned amount spent this period.
  - **Orange** — 80–99% spent this period (near limit; this *is* your near-limit alert, no separate notification needed).
  - **Red** — overspent (activity exceeds assigned amount).
  - Thresholds are a starting point — make the 80% cutoff a constant so it's easy to tune later.
  - Applied as a **full pastel card background per category** (not just a text/pill accent) — see section 10 for exact colors. Each category card's entire surface is tinted by its state, giving an at-a-glance scan of the whole budget.

## 3. Accounts

- **Single account only.** No multi-account switching, no transfers, no credit-card payment-category mechanics. This meaningfully simplifies the transaction model — every transaction is either income or a categorized expense, nothing else.

## 4. Transactions

- Manual entry only (no bank sync, no CSV import needed for v1).
- Fields: date, payee, category, amount, memo.
- **No split transactions** — you'll manually enter multi-category purchases as separate line items.
- **Payee tracking:** app remembers payees you've used and autocompletes/suggests the last-used category for that payee.
- **No recurring/scheduled transactions** — every entry is manual, every time.
- Each transaction is attributed to whichever period its date falls into (per the rolling-period logic above) — this determines which period's category balance it affects.

## 5. Budgeting behavior ("zero-based," loosely)

- App shows **assigned vs. unassigned** income for the current period as plain numbers.
- **No enforcement** — no nagging, no red banner forcing you to hit zero. It's informational only.

### Safe-to-spend number (borrowed from PocketGuard)

A single, prominent number on the dashboard: what's actually free to spend right now, distinct from "unassigned."

- Calculation: `unassigned income` **minus** `balances in categories flagged as "essential/upcoming"` (e.g. rent, a bill due later this period). You mark which categories count toward this subtraction — everything else is treated as discretionary and doesn't reduce the number.
- This complements, not replaces, category balances — it's the "can I afford this right now" glance; category balances are the "where did my money go" detail.

### Spending pace indicator

Per category (or overall), shows whether you're on pace, under pace, or over pace for the *current custom period* — not a calendar month.

- Calculation: compare `% of period elapsed` (days since period start / total period length) against `% of assigned amount spent`. If spent% meaningfully exceeds elapsed%, you're over pace; meaningfully under, under pace; roughly equal, on pace.
- Purely informational, same spirit as the loose zero-based approach — a nudge, not a gate.

## 6. Goals / targets

- **Both types supported:**
  - **Target by date** — save a specific amount by a specific date; app back-calculates the per-period funding needed (adapted to your custom period length rather than calendar months).
  - **Recurring per-period funding target** — a fixed amount you want assigned to a category every period.
- No Age of Money metric (not useful for a single-account setup).

## 7. Reporting

- **Fuller reporting:** spending by category, trends across multiple periods, category history over time.
- All charts/trends are bucketed by your custom periods, not calendar months — a "last 6 periods" view rather than "last 6 months."

## 8. Data storage, backup, and shared sync

- Primary data store: **localStorage**, per device.
- **Manual export/import** for backup, built on top of a shared **GitHub Gist**:
  - Export writes current state as JSON to the Gist via the GitHub API.
  - Import/sync pulls the Gist's latest content into localStorage.
  - **Conflict warning:** before overwriting, the app compares the Gist's `updated_at` timestamp against the timestamp of your last successful pull. If they differ, you're warned someone else changed it first, so you can review before pushing over their changes.
- This is a two-person shared household budget — both of you point your export/import at the same Gist.

## 9. Mobile UI

- **Dashboard-first home screen** (Option B): opens directly to category balances (color-coded), current period's unassigned total up top.
- **Bottom nav**, 4 tabs: Add (+), Reports, Transactions list, Settings.
- Adding a transaction is one tap away via the bottom nav — no floating action button.

## 10. Visual design — dark theme color palette

Warm dark-navy base with a peach-orange primary accent and a teal secondary accent, plus fully-tinted pastel cards for category status (bolder than a subtle wash — the whole card surface carries the color).

**Base surfaces:**

| Role | Hex | Use |
|---|---|---|
| Page background | `#1B1F2A` | App background — warm navy, not pure black |
| Card surface (neutral, e.g. settings rows, info cards) | `#242938` | Anything not carrying a status color |
| Border / divider | `#2E3444` | Hairlines |

**Text:**

| Role | Hex | Use |
|---|---|---|
| Primary text | `#F5F6FA` | Default text on dark surfaces |
| Secondary text | `#8890A4` | Labels, timestamps, muted detail |

**Accents:**

| Role | Hex | Use |
|---|---|---|
| Primary accent | `#F0A868` (peach-orange) | The "add transaction" button and other primary CTAs — reserve for the single most important action per screen |
| Secondary accent | `#2DD4BF` (teal) | Safe-to-spend number, active nav icon, secondary highlights |

**Category status — full-card pastel tint** (the whole category card is filled with this color, not just a badge):

| State | Card background | Title text | Detail text |
|---|---|---|---|
| Green (funded) | `#C9F4DC` | `#14532D` | `#1E6B3F` |
| Orange (near-limit) | `#F6D9C6` | `#7C2D12` | `#9A4A1F` |
| Red (overspent) | `#F9D2D2` | `#7F1D1D` | `#A13030` |

- Text on these cards is **dark**, since the pastel fills are genuinely light — this is the opposite of the base UI (light text on dark surfaces), so keep the two systems visually distinct: dark chrome/dark text vs. pastel cards/dark text.
- This is a deliberate trade-off: full-card tint is bold and easy to scan at a glance, at the cost of feeling busier with many categories on screen. If the dashboard ever feels too loud with a long category list, the fallback is the same three hex values applied as a small pill/badge on an otherwise neutral `#242938` card instead — same palette, quieter application.

## Explicitly out of scope for v1

- Multiple accounts / credit card handling
- Split transactions
- Recurring/scheduled transactions
- Automatic real-time multi-device sync
- Age of Money metric
- Bank sync / CSV import
- Strict zero-based enforcement/nagging
- Net worth / investment tracking
- AI auto-categorization / adaptive budgets
- Automatic recurring bill/subscription detection (requires bank sync)
- Debt payoff tools (snowball, etc.)
- "Don't count" transaction flag
- Bill negotiation service
