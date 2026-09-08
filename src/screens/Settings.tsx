/**
 * Settings: the period start day (the setting the whole app pivots on),
 * category management, and the shared-Gist sync with its conflict warning.
 *
 * Every field here is a draft until you press Save. Nothing commits on
 * keystroke or on blur, and each Save button is disabled until that section
 * actually differs from what is stored.
 */

import { useEffect, useRef, useState } from 'react';
import { MAX_START_DAY, MIN_START_DAY } from '../domain/period';
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
import type { StatusBasis } from '../domain/budget';

export function Settings() {
  const { data, sync } = useApp();
  const settings = data.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // --- drafts ---------------------------------------------------------------
  const [periodDraft, setPeriodDraft] = useState({
    periodStartDay: String(settings.periodStartDay),
    currency: settings.currency,
  });
  const [colourDraft, setColourDraft] = useState({
    nearLimitThreshold: settings.nearLimitThreshold,
    statusBasis: settings.statusBasis,
  });
  const [gistDraft, setGistDraft] = useState({
    token: settings.gist.token,
    gistId: settings.gist.gistId,
    fileName: settings.gist.fileName,
  });
  const [periodError, setPeriodError] = useState<string | undefined>();

  // Re-seed the drafts when the stored settings change underneath us -- a Gist
  // pull can rewrite them while this screen is open.
  useEffect(() => {
    setPeriodDraft({ periodStartDay: String(settings.periodStartDay), currency: settings.currency });
  }, [settings.periodStartDay, settings.currency]);

  useEffect(() => {
    setColourDraft({ nearLimitThreshold: settings.nearLimitThreshold, statusBasis: settings.statusBasis });
  }, [settings.nearLimitThreshold, settings.statusBasis]);

  useEffect(() => {
    setGistDraft({
      token: settings.gist.token,
      gistId: settings.gist.gistId,
      fileName: settings.gist.fileName,
    });
  }, [settings.gist.token, settings.gist.gistId, settings.gist.fileName]);

  const periodDirty =
    periodDraft.periodStartDay !== String(settings.periodStartDay) ||
    periodDraft.currency !== settings.currency;

  const colourDirty =
    colourDraft.nearLimitThreshold !== settings.nearLimitThreshold ||
    colourDraft.statusBasis !== settings.statusBasis;

  const gistDirty =
    gistDraft.token !== settings.gist.token ||
    gistDraft.gistId !== settings.gist.gistId ||
    gistDraft.fileName !== settings.gist.fileName;

  const savePeriod = () => {
    const day = Number(periodDraft.periodStartDay);
    if (!Number.isFinite(day) || day < MIN_START_DAY || day > MAX_START_DAY) {
      setPeriodError(`Pick a day between ${MIN_START_DAY} and ${MAX_START_DAY}.`);
      return;
    }
    const currency = periodDraft.currency.trim();
    if (!currency) {
      setPeriodError('Currency cannot be empty.');
      return;
    }
    setPeriodError(undefined);
    updateSettings({ periodStartDay: day, currency });
  };

  const saveColours = () => {
    updateSettings({
      nearLimitThreshold: colourDraft.nearLimitThreshold,
      statusBasis: colourDraft.statusBasis,
    });
  };

  const saveGist = () => {
    updateGistSettings({
      token: gistDraft.token.trim(),
      gistId: gistDraft.gistId.trim(),
      fileName: gistDraft.fileName.trim() || 'budgetinho.json',
    });
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Settings</h1>
      </div>

      {/* ------------------------------------------------------ period ---- */}
      <div className="section-title">Budget period</div>
      <div className="card">
        <Field label="Period start day" error={periodError}>
          {(id) => (
            <input
              id={id}
              className="input num"
              type="number"
              inputMode="numeric"
              min={MIN_START_DAY}
              max={MAX_START_DAY}
              value={periodDraft.periodStartDay}
              onChange={(e) => setPeriodDraft({ ...periodDraft, periodStartDay: e.target.value })}
            />
          )}
        </Field>

        <Field label="Currency">
          {(id) => (
            <input
              id={id}
              className="input"
              maxLength={8}
              value={periodDraft.currency}
              onChange={(e) => setPeriodDraft({ ...periodDraft, currency: e.target.value })}
            />
          )}
        </Field>

        <button type="button" className="btn primary block" disabled={!periodDirty} onClick={savePeriod}>
          {periodDirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {/* ------------------------------------------------------ colours --- */}
      <div className="section-title">Category colours</div>
      <div className="card">
        <Field
          label={`Near-limit threshold: ${Math.round(colourDraft.nearLimitThreshold * 100)}%`}
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
              value={Math.round(colourDraft.nearLimitThreshold * 100)}
              onChange={(e) =>
                setColourDraft({ ...colourDraft, nearLimitThreshold: Number(e.target.value) / 100 })
              }
            />
          )}
        </Field>

        <div className="field">
          <span className="field-label">Measure spending against</span>
          <Segmented
            label="Status basis"
            value={colourDraft.statusBasis}
            onChange={(statusBasis: StatusBasis) => setColourDraft({ ...colourDraft, statusBasis })}
            options={[
              { value: 'available', label: 'Available' },
              { value: 'assigned', label: 'Assigned' },
            ]}
          />
          <span className="field-hint">
            {colourDraft.statusBasis === 'available'
              ? 'Carried-over balance plus what you assigned this period. Recommended once rollover kicks in.'
              : 'Only what you assigned this period, ignoring anything carried over.'}
          </span>
        </div>

        <button type="button" className="btn primary block" disabled={!colourDirty} onClick={saveColours}>
          {colourDirty ? 'Save' : 'Saved'}
        </button>
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
          hint="A personal access token with the gist scope, from the account that owns the gist."
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
                value={gistDraft.token}
                onChange={(e) => setGistDraft({ ...gistDraft, token: e.target.value })}
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
              value={gistDraft.gistId}
              onChange={(e) => setGistDraft({ ...gistDraft, gistId: e.target.value })}
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
              value={gistDraft.fileName}
              onChange={(e) => setGistDraft({ ...gistDraft, fileName: e.target.value })}
            />
          )}
        </Field>

        <button type="button" className="btn primary block" disabled={!gistDirty} onClick={saveGist}>
          {gistDirty ? 'Save sync settings' : 'Saved'}
        </button>

        <div className="divider" />

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn small"
            disabled={sync.busy || gistDirty}
            onClick={() => void checkToken()}
          >
            Test token
          </button>
          {!settings.gist.gistId ? (
            <button
              type="button"
              className="btn small"
              disabled={sync.busy || gistDirty || !settings.gist.token}
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

        {gistDirty ? (
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            Save your sync settings before testing or syncing.
          </p>
        ) : null}

        <div className="divider" />

        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn grow"
            disabled={sync.busy || gistDirty || !settings.gist.gistId}
            onClick={() => void pullFromGist()}
          >
            {sync.busy ? 'Working…' : 'Import (pull)'}
          </button>
          <button
            type="button"
            className="btn primary grow"
            disabled={sync.busy || gistDirty || !settings.gist.gistId}
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
        {/* Sync is the one action that still reports success, inline rather
            than as a toast -- pressing Export with no visible result would be
            indistinguishable from nothing happening. */}
        {sync.lastResult ? (
          <p className="tiny pos" style={{ marginBottom: 0 }} role="status">
            {sync.lastResult}
          </p>
        ) : null}
        {sync.lastError ? (
          <p className="tiny neg" style={{ marginBottom: 0 }} role="alert">
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
