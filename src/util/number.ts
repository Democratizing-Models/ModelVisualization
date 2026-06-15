/** Numeric helpers for render-time display. */

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'NaN' : n > 0 ? '∞' : '−∞';
  if (Number.isInteger(n)) return String(n);
  return Number(n.toPrecision(6)).toString();
}

/**
 * XS3 literal rule, mirroring the reference engine's `isnumeric` check: an
 * input/output port value is a literal (not a node reference) when it is a
 * number, or a string of digits only. A float-valued string like "1.5" is NOT
 * a literal — the engine treats it as a reference (→ synthesized variable).
 */
export function isXs3Literal(value: unknown): boolean {
  if (typeof value === 'number') return true;
  return typeof value === 'string' && /^\d+$/.test(value.trim());
}
