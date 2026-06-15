/** Numeric helpers for render-time display. */

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'NaN' : n > 0 ? '∞' : '−∞';
  if (Number.isInteger(n)) return String(n);
  return Number(n.toPrecision(6)).toString();
}
