/**
 * Money is stored as an integer number of minor units (cents/stotinki).
 * Never floats: 0.1 + 0.2 !== 0.3 and a budget app that drifts by a cent per
 * transaction is worthless.
 */

export type Cents = number;

/** Parse free-form user input ('12', '12.5', '1 234,56', '-8') into cents. */
export function parseAmount(input: string): Cents | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;

  const negative = s.startsWith('-');
  if (negative || s.startsWith('+')) s = s.slice(1);

  // Strip currency symbols, spaces and thin spaces used as group separators.
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;

  // Which separator, if any, is the decimal point?
  //   both present            -> the last one is decimal, the other is grouping
  //   one, repeated           -> grouping ('1,234,567')
  //   a comma + exactly 3     -> grouping ('1,234'); nobody writes money to
  //                              three decimal places with a comma
  //   anything else           -> decimal ('12.999', '1,50', '12.5')
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const decimalPos = Math.max(lastComma, lastDot);

  let whole: string;
  let frac: string;
  if (decimalPos === -1) {
    whole = s;
    frac = '';
  } else {
    const separator = s[decimalPos]!;
    const tail = s.slice(decimalPos + 1);
    const bothPresent = lastComma !== -1 && lastDot !== -1;
    const repeated = s.indexOf(separator) !== decimalPos;
    const isGrouping = !bothPresent && (repeated || (separator === ',' && tail.length === 3));

    if (isGrouping) {
      whole = s;
      frac = '';
    } else {
      whole = s.slice(0, decimalPos);
      frac = tail;
    }
  }

  whole = whole.replace(/[.,]/g, '');
  frac = frac.replace(/[.,]/g, '');
  if (!whole && !frac) return null;
  if (frac.length > 2) frac = frac.slice(0, 2); // truncate, don't round up money
  frac = frac.padEnd(2, '0');

  const value = Number(whole || '0') * 100 + Number(frac || '0');
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function centsToDecimalString(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export interface FormatOptions {
  /** Always show a leading + on positive values. */
  signed?: boolean;
  /** Drop the decimals when the amount is a whole unit (compact chart labels). */
  compact?: boolean;
}

/**
 * Format cents for display. `currency` is a symbol or code from settings and is
 * placed after the number with a hair space -- that suits BGN/EUR conventions
 * and keeps '$' users legible too.
 */
export function formatMoney(cents: Cents, currency = 'лв', opts: FormatOptions = {}): string {
  const rounded = Math.round(cents);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;

  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const body = opts.compact && frac === 0 ? grouped : `${grouped}.${String(frac).padStart(2, '0')}`;
  const sign = negative ? '\u2212' : opts.signed ? '+' : ''; // U+2212 minus reads better than a hyphen
  return `${sign}${body}\u00A0${currency}`;
}

/** Round-half-up division used when splitting a goal across periods. */
export function divideCents(total: Cents, divisor: number): Cents {
  if (divisor <= 0) return total;
  return Math.ceil(total / divisor);
}

export function sum(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
