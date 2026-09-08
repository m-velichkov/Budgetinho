# Budgetinho

A two-person household budget built on **custom rolling periods** instead of calendar months. Static site, no backend, data lives in `localStorage`, shared between phones through a single secret GitHub Gist.

Built to [`budget-app-spec.md`](budget-app-spec.md).

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite once (66 tests) |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | TypeScript only |

**Requirements:** Node 20+. No database, no server, no API keys to build or run.

---

## Deploying to GitHub Pages

The repo ships a workflow that builds, tests and publishes on every push to `main`.

1. Create a GitHub repository and push this folder to it.
   ```bash
   git init
   git add -A
   git commit -m "Budgetinho"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push (or run the workflow manually from the Actions tab). The URL appears in the workflow summary — typically `https://<you>.github.io/<repo>/`.

There is nothing else to configure: no secrets, no environment variables, no base-path edit. `vite.config.ts` uses `base: './'`, so the same build works at a user site, a project subpath, or a custom domain. If you ever need absolute asset URLs, set `BASE_PATH=/<repo>/` in the build environment.

**Install it on a phone:** open the Pages URL, then *Add to Home Screen*. It runs full-screen from the web app manifest.

### Deploying anywhere else

`npm run build` produces a plain static `dist/` folder. Drop it on Netlify, Cloudflare Pages, S3, or any static host. The app uses hash routing (`#/reports`), so no server rewrite rules are needed.

---

## Setting up shared sync

Both people point at one Gist. Do this once, on one device:

1. Create a GitHub personal access token with the **`gist`** scope
   (Settings → Developer settings → Personal access tokens; classic tokens need only `gist`, fine-grained tokens need Gists: read and write).
2. In the app: **Settings → Shared sync**, paste the token, tap **Create a new secret gist**. The gist id is filled in automatically.
3. On the second device: paste the same gist id and that person's own token, then tap **Import (pull)**.

Day to day: **Export (push)** after you have entered things, **Import (pull)** before you start.

**Conflict warning.** Every successful sync records the gist's `updated_at`. Before pushing, the app re-checks it. If it moved, the push is refused and you are shown when the gist changed versus when you last synced, with the option to pull their version first or deliberately overwrite. This is the "someone else changed it first" guard from the spec — it is not automatic merging, and there is none.

### About the token

The token is stored in that browser's `localStorage` and sent only to `api.github.com` as an `Authorization` header. It is **never** part of the build, and `serialise()` strips the token and gist id from anything written to the Gist or downloaded as a file — the Gist is shared, so credentials must not travel in it.

A secret gist is unlisted, not private: anyone with the URL can read it. Do not put anything in a memo you would mind a stranger reading if the link leaked.

If you would rather not use GitHub at all, **Settings → File backup** downloads and restores the same JSON.

---

## Project structure

```
src/
  domain/          Pure business logic. No React, no storage, no DOM.
    date.ts        'YYYY-MM-DD' helpers. Never Date objects in stored data.
    period.ts      ** The rolling-period engine. Everything depends on this. **
    money.ts       Integer minor units, parsing and formatting.
    budget.ts      Ledger, rollover, status colours, safe-to-spend, pace,
                   goals, payee memory, report aggregations.
    *.test.ts      53 unit tests, including an exhaustive period sweep.

  data/            Persistence -- this is the "database" layer.
    schema.ts      The stored document shape + SCHEMA_VERSION.
    migrations.ts  Versioned forward migrations for the stored document.
    validation.ts  Form validation + hostile-input repair for whole documents.
    storage.ts     localStorage repository, serialise/deserialise.
    seed.ts        Starter budget for a fresh install.

  api/
    gist.ts        The only network code: pull/push/create/verify + conflicts.

  store/
    store.ts       All actions and state transitions -- the app's API surface.
    hooks.ts       React bindings, hash router, period auto-advance.

  components/      Reusable UI (category card, sheets, charts, form controls).
  screens/         Dashboard, Add, Reports, Transactions, Settings.
  styles/app.css   The whole theme, as CSS custom properties.
  App.test.tsx     13 integration tests that mount the real app.
```

There is no `migrations/` SQL folder and no `server/` because the spec's stack is a static site on `localStorage`. The equivalent layers are mapped as: **schema + migrations →** `src/data/`, **API endpoints →** `src/store/store.ts` (local actions) and `src/api/gist.ts` (the one remote surface).

---

## How the core logic works

### Rolling periods

One setting — **period start day (1–31)** — defines everything. A period runs from that day of one month to the day before it in the next.

If the day does not exist in a month, the boundary rolls back to that month's last valid day. With start day 31 in a non-leap year:

| Period | Length |
|---|---|
| Jan 31 → Feb 27 | 28 days |
| Feb 28 → Mar 30 | 31 days |
| Mar 31 → Apr 29 | 30 days |
| Apr 30 → May 30 | 31 days |

A period is identified by its **anchor month** (`YYYY-MM`), which is what assignments are keyed on. Changing the start day re-slices which transactions land where, but never renames a period.

The test suite verifies exhaustively that for **all 31 start days across 2023–2026**, every date falls in exactly one period and consecutive periods touch with no gap and no overlap.

Periods auto-advance: the view snaps to the new period when the calendar crosses a boundary, on tab focus and hourly.

### Rollover

```
balance(period) = balance(previous period) + assigned(period) − activity(period)
```

Leftovers carry forward; overspending carries forward as a negative that reduces the next period. Because balances are cumulative, the ledger is built by walking forward from the first period that has any data (memoised on a revision counter, recomputed only when the document changes).

### Status colours

Green under 80% spent, orange 80–99%, red overspent — as full pastel card fills. The 80% cutoff is `NEAR_LIMIT_THRESHOLD` in [`src/data/schema.ts`](src/data/schema.ts) and is also exposed as a slider in Settings.

### Safe to spend

```
safe to spend = unassigned income this period − Σ positive balances of categories flagged "essential"
```

Flag a category essential in its sheet or in Settings.

### Pace

Compares *% of period elapsed* against *% of funding spent*, with a ±10 point tolerance (`PACE_TOLERANCE`). Informational only — nothing in the app blocks or nags.

### Goals

- **Every period** — a fixed amount you want assigned each period.
- **By a date** — the app back-calculates the per-period contribution over the periods remaining (custom periods, not months), counting what the category already holds. Overdue targets ask for the whole shortfall.

"Fund N goals for this period" on the dashboard assigns everything outstanding in one tap.

---

## Judgment calls worth knowing about

Three places where the spec was ambiguous or where following it literally would have produced a worse app. All are reversible.

1. **Status basis (Settings → Category colours).** The spec says red means "activity exceeds assigned amount". Taken literally, a category holding 500 carried over with nothing newly assigned turns red the moment you spend 1 of it — wrong, given the same spec mandates rollover. The default basis is therefore **Available** (carry-over + assigned). **Assigned** is selectable and is the spec's literal reading. The two are identical whenever there is no carry-over, which includes every category in a brand-new budget.

2. **A fifth nav tab.** The spec lists four (Add, Reports, Transactions, Settings) plus a dashboard-first home screen. With only four, leaving the dashboard is a one-way trip. **Home** is added as the first tab. Add keeps the peach accent as the single CTA in the chrome.

3. **A fourth `neutral` card state.** A category with nothing assigned and nothing spent is not "funded", so painting it green is misleading and makes an untouched budget very loud. Those cards stay on the neutral dark surface. The three specified states are unchanged.

Two smaller ones: an overspent essential category contributes **0** to safe-to-spend rather than a negative (subtracting a negative would *raise* the number for money already gone), and deleting a category keeps its transactions as uncategorised rather than deleting them, so money never silently disappears from reports.

---

## Data, errors, and edge cases

- **Money** is stored as integer minor units. `parseAmount` accepts `12`, `12.5`, `12,50`, `1 234,56`, `1,234`, and truncates rather than rounds up a third decimal.
- **Documents are validated on the way in**, from `localStorage` and from the Gist alike — the Gist is edited by another person and is hand-editable on github.com, so it is treated as hostile input. Malformed rows are dropped or repaired, orphaned categories land in a "Recovered" group, and the repairs are reported to you rather than applied silently.
- **Corrupt JSON in `localStorage`** is copied aside under a timestamped key before a fresh budget is started, so nothing is destroyed.
- **Schema migrations** run on every load, including on documents pulled from a device on an older build. A document from a *newer* build is left untouched and you are warned to update.
- **Storage unavailable** (private mode) or **quota exceeded** surfaces as a visible message, not a silent failure.
- **Sync errors** are typed: bad token, missing scope, gist not found, wrong filename, rate limit, timeout, offline, conflict — each with a message that says what to do.

## Out of scope for v1

Multiple accounts, split transactions, recurring transactions, real-time sync, Age of Money, bank sync/CSV import, zero-based enforcement, net worth, AI categorisation, debt payoff tools.
