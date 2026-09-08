/**
 * Charts. Hand-rolled SVG/CSS -- no charting library, so the bundle stays small
 * enough to open instantly on a phone.
 *
 * Colour rules applied here:
 *  - Two-series charts use ONE fixed categorical pair, assigned by series
 *    identity (income is always teal, spending is always peach) and never
 *    re-assigned when a filter changes the series shown.
 *  - Single-series charts use one hue; the labels carry identity, not colour.
 *  - The pair is stepped down from the app's accents so it sits in the dark
 *    surface's lightness band: validated for CVD separation (ΔE 9.9 protan,
 *    25.2 tritan), chroma, and >= 3:1 contrast against #242938.
 *  - Every value label wears a text token, never the series colour.
 *  - One y-axis, always. Never two scales in one plot.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatMoney } from '../domain/money';

/** Fixed categorical assignment. Order is identity, not rank. */
export const SERIES = {
  income: '#0D9488',
  spending: '#C97A3C',
  assigned: '#0D9488',
  spent: '#C97A3C',
} as const;

const AXIS = '#2E3444';
const INK_MUTED = '#8890A4';

/** Measure the container so the SVG is drawn at real pixel size (crisp text). */
function useMeasure<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** Round money to a readable axis tick (1/2/5 x 10^n). */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

const compact = (cents: number, currency: string) =>
  Math.abs(cents) >= 100_000
    ? `${Math.round(cents / 100_00) / 10}k`
    : formatMoney(cents, currency, { compact: true }).replace(` ${currency}`, '');

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <span className="swatch" style={{ background: i.color }} aria-hidden="true" />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bars: magnitude across categories, one hue, direct labels
// ---------------------------------------------------------------------------

export function BarList({
  rows,
  currency,
  color = SERIES.spending,
  onSelect,
}: {
  rows: Array<{ id: string; label: string; sublabel?: string; value: number; share?: number }>;
  currency: string;
  color?: string;
  onSelect?: (id: string) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div>
      {rows.map((row) => {
        const content = (
          <>
            <span className="truncate">
              {row.label}
              {row.sublabel ? <span className="tiny muted"> · {row.sublabel}</span> : null}
            </span>
            <span className="num small">
              {formatMoney(row.value, currency, { compact: true })}
              {row.share !== undefined ? (
                <span className="tiny muted"> · {Math.round(row.share * 100)}%</span>
              ) : null}
            </span>
            <span className="bar-track">
              {/* 4px rounded data-end, anchored to a zero baseline on the left. */}
              <span
                className="bar-fill"
                style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: color }}
              />
            </span>
          </>
        );

        return onSelect ? (
          <button
            key={row.id}
            type="button"
            className="bar-row"
            onClick={() => onSelect(row.id)}
            style={{ background: 'none', border: 'none', color: 'inherit', padding: 0, width: '100%', textAlign: 'left' }}
          >
            {content}
          </button>
        ) : (
          <div key={row.id} className="bar-row">
            {content}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped bars across periods: two series, one y-axis, hover tooltip
// ---------------------------------------------------------------------------

export interface GroupedPoint {
  key: string;
  label: string;
  a: number;
  b: number;
}

export function GroupedBars({
  points,
  currency,
  seriesA,
  seriesB,
  height = 190,
}: {
  points: GroupedPoint[];
  currency: string;
  seriesA: { label: string; color: string };
  seriesB: { label: string; color: string };
  height?: number;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const padding = { top: 10, right: 6, bottom: 22, left: 44 };
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = height - padding.top - padding.bottom;

  const max = useMemo(() => niceCeil(Math.max(1, ...points.flatMap((p) => [p.a, p.b]))), [points]);
  const ticks = [0, max / 2, max];

  const slot = points.length > 0 ? plotWidth / points.length : 0;
  // 2px gap between the two bars in a group, and breathing room between groups.
  const barWidth = Math.max(3, Math.min(18, (slot - 10) / 2));

  const y = (value: number) => padding.top + plotHeight - (value / max) * plotHeight;
  const activePoint = active !== null ? points[active] : undefined;

  return (
    <div>
      <div ref={ref} style={{ position: 'relative' }}>
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${seriesA.label} and ${seriesB.label} by period`}
            onMouseLeave={() => setActive(null)}
          >
            {/* Recessive gridlines and a labelled y-axis. */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padding.left} x2={width - padding.right} y1={y(t)} y2={y(t)} stroke={AXIS} strokeWidth={1} />
                <text x={padding.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED}>
                  {compact(t, currency)}
                </text>
              </g>
            ))}

            {points.map((p, i) => {
              const centre = padding.left + slot * i + slot / 2;
              const base = y(0);
              return (
                <g key={p.key}>
                  {/* Full-height hit target: bigger than the marks themselves. */}
                  <rect
                    x={padding.left + slot * i}
                    y={padding.top}
                    width={slot}
                    height={plotHeight}
                    fill={active === i ? 'rgba(255,255,255,0.04)' : 'transparent'}
                    onMouseEnter={() => setActive(i)}
                    onTouchStart={() => setActive(i)}
                  />
                  <rect
                    x={centre - barWidth - 1}
                    y={y(p.a)}
                    width={barWidth}
                    height={Math.max(0, base - y(p.a))}
                    rx={3}
                    fill={seriesA.color}
                    pointerEvents="none"
                  />
                  <rect
                    x={centre + 1}
                    y={y(p.b)}
                    width={barWidth}
                    height={Math.max(0, base - y(p.b))}
                    rx={3}
                    fill={seriesB.color}
                    pointerEvents="none"
                  />
                  <text x={centre} y={height - 6} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
                    {p.label}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : null}

        {activePoint ? (
          <div
            className="card card-tight"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              pointerEvents: 'none',
              background: 'var(--surface-raised)',
              fontSize: 12,
            }}
          >
            <div className="row-between">
              <strong>{activePoint.label}</strong>
              <span className="num">
                <span className="swatch" style={{ background: seriesA.color }} />
                {formatMoney(activePoint.a, currency, { compact: true })}
                <span className="swatch" style={{ background: seriesB.color, marginLeft: 10 }} />
                {formatMoney(activePoint.b, currency, { compact: true })}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <Legend items={[seriesA, seriesB]} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table view -- every chart has one, so nothing is colour-only
// ---------------------------------------------------------------------------

export function ChartTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="chart">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                style={{
                  textAlign: i === 0 ? 'left' : 'right',
                  padding: '6px 8px',
                  borderBottom: `1px solid ${AXIS}`,
                  color: INK_MUTED,
                  fontWeight: 600,
                  fontSize: 11.5,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    textAlign: ci === 0 ? 'left' : 'right',
                    padding: '6px 8px',
                    borderBottom: `1px solid ${AXIS}`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
