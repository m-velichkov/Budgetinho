/**
 * Settings: the period start day (the setting the whole app pivots on),
 * category management, and the shared-Gist sync with its conflict warning.
 */

import { useRef, useState } from 'react';
import { formatPeriodRange, periodForDate, MAX_START_DAY, MIN_START_DAY } from '../domain/period';
import { today } from '../domain/date';
import { ConfirmDialog, Field, Modal, Segmented } from '../components/ui';
import { CategoryManager } from '../components/CategoryManager';
import {
  checkToken,
  createSharedGist,
  dismissConflict,
  exportToFile,
  importFromText,
  notify,
  pullFromGist,
  pushToGist,
  resetEverything,
  updateGistSettings,
  updateSettings,
} from '../store/store';
import { useApp } from '../store/hooks';

export function Settings() {
  const { data, sync } = useApp();
  const settings = data.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Preview the period the current setting produces, so the effect of changing
  // the start day is visible before it is committed.
  const preview = periodForDate(today(), settings.periodStartDay);

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Settings</h1>
      </div>

      {/* ------------------------------------------------------ period ---- */}
      <div className="section-title">Budget period</div>
      <div className="card">
        <Field
          label="Period start day"
          hint={`Right now that means ${formatPeriodRange(preview)}. If a month is too short (e.g. the 31st in February) the period starts on that month's last day instead.`}
        >
          {(id) => (
            <input
              id={id}
              className="input num"
              type="number"
              inputMode="numeric"
              min={MIN_START_DAY}
              max={MAX_START_DAY}
              value={settings.periodStartDay}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value)) updateSettings({ periodStartDay: value });
              }}
            />
          )}
        </Field>

        <Field label="Currency" hint="Shown after every amount. Any short symbol or code.">
          {(id) => (
            <input
              id={id}
              className="input"
              maxLength={8}
              value={settings.currency}
              onChange={(e) => updateSettings({ currency: e.target.value })}
            />
          )}
        </Field>
      </div>

      {/* ------------------------------------------------------ colours --- */}
      <div className="section-title">Category colours</div>
      <div className="card">
        <Field
          label={`Near-limit threshold: ${Math.round(settings.nearLimitThreshold * 100)}%`}
          hint="Below this a category is green; from here to fully spent it is orange; past it, red."
        >
          {(id) => (
            <input
              id={id}
              type="range"
              min={50}
              max={95}
              step={5}
              style={{ width: '100%' }}
              value={Math.round(settings.nearLimitThreshold * 100)}
              onChange={(e) => updateSettings({ nearLimitThreshold: Number(e.target.value) / 100 })}
            />
          )}
        </Field>

        <div className="field">
          <span className="field-label">Measure spending against</span>
          <Segmented
            label="Status basis"
            value={settings.statusBasis}
            onChange={(statusBasis) => updateSettings({ statusBasis })}
            options={[
              { value: 'available', label: 'Available' },
              { value: 'assigned', label: 'Assigned' },
            ]}
          />
          <span className="field-hint">
            {settings.statusBasis === 'available'
              ? 'Carried-over balance plus what you assigned this period. Recommended once rollover kicks in.'
              : 'Only what you assigned this period, ignoring anything carried over.'}
          </span>
        </div>
      </div>

      {/* ---------------------------------------------------- categories -- */}
      <div className="section-title">Categories</div>
      <CategoryManager />

      {/* ---------------------------------------------------------- sync -- */}
      <div className="section-title">Shared sync (GitHub Gist)</div>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Both phones point at one secret Gist. Export pushes this device’s budget to it; import pulls the
          latest copy down. The token is stored only on this device.
        </p>

        <Field
          label="GitHub token"
          hint="A fine-grained or classic personal access token with the gist scope."
        >
          {(id) => (
            <div className="row" style={{ gap: 8 }}>
              <input
                id={id}
                className="input grow"
                type={showToken ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder="ghp_…"
                value={settings.gist.token}
                onChange={(e) => updateGistSettings({ token: e.target.value })}
              />
              <button type="button" className="btn small" onClick={() => setShowToken((v) => !v)}>
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
          )}
        </Field>

        <Field label="Gist id or URL" hint="Paste the full gist URL and the id is extracted for you.">
          {(id) => (
            <input
              id={id}
              className="input"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. 9f2c…"
              value={settings.gist.gistId}
              onChange={(e) => updateGistSettings({ gistId: e.target.value })}
            />
          )}
        </Field>

        <Field label="File name inside the gist">
          {(id) => (
            <input
              id={id}
              className="input"
              autoComplete="off"
              spellCheck={false}
              value={settings.gist.fileName}
              onChange={(e) => updateGistSettings({ fileName: e.target.value })}
            />
          )}
        </Field>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn small" disabled={sync.busy} onClick={() => void checkToken()}>
            Test token
          </button>
          {!settings.gist.gistId ? (
            <button
              type="button"
              className="btn small"
              disabled={sync.busy || !settings.gist.token}
              onClick={() => void createSharedGist()}
            >
              Create a new secret gist
            </button>
          ) : (
            <a
              className="btn small ghost"
              href={`https://gist.github.com/${settings.gist.gistId}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open on GitHub
            </a>
          )}
        </div>

        <div className="divider" />

        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn grow"
            disabled={sync.busy || !settings.gist.gistId}
            onClick={() => void pullFromGist()}
          >
            {sync.busy ? 'Working…' : 'Import (pull)'}
          </button>
          <button
            type="button"
            className="btn primary grow"
            disabled={sync.busy || !settings.gist.gistId}
            onClick={() => void pushToGist()}
          >
            {sync.busy ? 'Working…' : 'Export (push)'}
          </button>
        </div>

        <p className="tiny muted" style={{ marginBottom: 0 }}>
          {settings.gist.lastSyncedAt
            ? `Last synced ${new Date(settings.gist.lastSyncedAt).toLocaleString()}.`
            : 'Never synced from this device.'}
        </p>
        {sync.lastError ? (
          <p className="tiny neg" style={{ marginBottom: 0 }}>
            {sync.lastError}
          </p>
        ) : null}
      </div>

      {/* ------------------------------------------------------- backups -- */}
      <div className="section-title">File backup</div>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Works with no GitHub account at all — a plain JSON file you can keep anywhere.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn grow" onClick={exportToFile}>
            Download JSON
          </button>
          <button type="button" className="btn grow" onClick={() => fileRef.current?.click()}>
            Restore from file
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // let the same file be picked again after a failure
            if (!file) return;
            if (file.size > 8_000_000) {
              notify('error', 'That file is too large to be a budget export.');
              return;
            }
            importFromText(await file.text());
          }}
        />
      </div>

      {/* --------------------------------------------------------- danger -- */}
      <div className="section-title">Danger zone</div>
      <div className="card">
        <button type="button" className="btn danger block" onClick={() => setConfirmReset(true)}>
          Reset this device’s budget
        </button>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Deletes every transaction, category and assignment stored in this browser. Your Gist is untouched
          until you push again.
        </p>
      </div>

      <p className="tiny muted center" style={{ marginTop: 20 }}>
        Budgetinho · data v{data.schemaVersion} · last local change{' '}
        {new Date(data.updatedAt).toLocaleString()}
      </p>

      {/* Conflict warning: the spec's "someone else changed it first" guard. */}
      {sync.conflict ? (
        <Modal title="The gist changed since your last sync" onClose={dismissConflict}>
          <p className="small">
            Someone else pushed to the shared gist after you last synced. Pushing now would overwrite their
            changes.
          </p>
          <div className="card card-tight small" style={{ marginBottom: 14 }}>
            <div className="row-between">
              <span className="muted">Gist updated</span>
              <span>{new Date(sync.conflict.remoteUpdatedAt).toLocaleString()}</span>
            </div>
            <div className="row-between">
              <span className="muted">You last synced</span>
              <span>
                {sync.conflict.lastSeenUpdatedAt
                  ? new Date(sync.conflict.lastSeenUpdatedAt).toLocaleString()
                  : 'never'}
              </span>
            </div>
          </div>
          <p className="small muted">
            Safest is to pull their version first, re-enter anything of yours that is missing, then push.
          </p>
          <div className="stack">
            <button
              type="button"
              className="btn primary"
              disabled={sync.busy}
              onClick={async () => {
                dismissConflict();
                await pullFromGist();
              }}
            >
              Pull their version (recommended)
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={sync.busy}
              onClick={() => {
                void pushToGist(true);
              }}
            >
              Overwrite with mine
            </button>
            <button type="button" className="btn ghost" onClick={dismissConflict}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {confirmReset ? (
        <ConfirmDialog
          title="Reset this device’s budget?"
          body="Every transaction, category and assignment in this browser will be deleted and replaced with a fresh starter budget. Sync settings are kept."
          confirmLabel="Reset everything"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            resetEverything();
            setConfirmReset(false);
          }}
        />
      ) : null}
    </div>
  );
}
