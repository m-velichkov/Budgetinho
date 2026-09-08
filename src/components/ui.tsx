/** Small shared building blocks. No component library, no runtime deps. */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { dismissNotice } from '../store/store';
import { useApp } from '../store/hooks';

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="switch">
      <label htmlFor={id} className="grow">
        <div>{label}</div>
        {hint ? <div className="tiny muted">{hint}</div> : null}
      </label>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Stop the page behind the sheet from scrolling on touch devices.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div className="grow">
            <h2>{title}</h2>
            {subtitle ? <div className="small muted">{subtitle}</div> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Delete',
  destructive = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="small" style={{ marginBottom: 16 }}>
        {body}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn grow" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={destructive ? 'btn danger grow' : 'btn primary grow'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Notices() {
  const { notices } = useApp();
  if (notices.length === 0) return null;
  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.slice(-3).map((n) => (
        <div key={n.id} className={`notice ${n.kind}`}>
          <span className="grow">{n.text}</span>
          <button type="button" onClick={() => dismissNotice(n.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card empty">
      <div style={{ fontWeight: 650, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
      <div style={{ marginBottom: action ? 14 : 0 }}>{body}</div>
      {action}
    </div>
  );
}

/**
 * Save-button state. The label reads "Save" until you have actually saved
 * something in this session, and reverts as soon as the draft diverges again --
 * a disabled button on a pristine form should not claim you saved anything.
 */
export function useSaveState(dirty: boolean): { label: string; disabled: boolean; markSaved: () => void } {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  return {
    label: saved && !dirty ? 'Saved' : 'Save',
    disabled: !dirty,
    markSaved: () => setSaved(true),
  };
}
