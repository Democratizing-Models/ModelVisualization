/** Compact display of values (esp. large numeric data arrays). */
import { formatNumber } from '../util/number.js';

/** One-line summary of a value; large arrays are truncated, never expanded. */
export function summarizeValue(value: unknown, maxItems = 6): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return summarizeArray(value, maxItems);
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    return `{ ${keys.slice(0, maxItems).join(', ')}${keys.length > maxItems ? ', …' : ''} }`;
  }
  return String(value);
}

function summarizeArray(arr: unknown[], maxItems: number): string {
  const head = arr.slice(0, maxItems).map((v) => summarizeValue(v, 3));
  const tail = arr.length > maxItems ? ', …' : '';

  // Single O(n) pass for min/max + all-numeric check. Never spread the array
  // (Math.min(...arr) throws RangeError on large data arrays) and never copy it.
  let min = Infinity;
  let max = -Infinity;
  let allNumeric = arr.length > 0;
  for (const v of arr) {
    if (typeof v !== 'number') { allNumeric = false; break; }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const extra = allNumeric ? `  ⟂ min ${formatNumber(min)}, max ${formatNumber(max)}` : '';
  return `array[${arr.length}] [${head.join(', ')}${tail}]${extra}`;
}
