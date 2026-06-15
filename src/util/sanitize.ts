/** Prototype-pollution guard for untrusted ingested data (shared by adapters). */

/** Keys that, as own properties, can subvert a prototype if an object is later
 *  key-merged. Stripped from untrusted subtrees on ingest. */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Deep-copy a JSON value, dropping dangerous own keys at every level. Iterative
 *  (no recursion) so deeply-nested untrusted input cannot overflow the stack.
 *  Clones objects with a null prototype, so the result is inert even if a key
 *  slips through. */
export function sanitize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const clone: unknown = Array.isArray(value) ? [] : Object.create(null);
  const stack: Array<{ src: Record<string, unknown> | unknown[]; dst: Record<string, unknown> | unknown[] }> = [
    { src: value as Record<string, unknown> | unknown[], dst: clone as Record<string, unknown> | unknown[] },
  ];
  while (stack.length > 0) {
    const { src, dst } = stack.pop()!;
    for (const key of Object.keys(src)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const v = (src as Record<string, unknown>)[key];
      if (v !== null && typeof v === 'object') {
        const child: Record<string, unknown> | unknown[] = Array.isArray(v) ? [] : Object.create(null);
        (dst as Record<string, unknown>)[key] = child;
        stack.push({ src: v as Record<string, unknown> | unknown[], dst: child });
      } else {
        (dst as Record<string, unknown>)[key] = v;
      }
    }
  }
  return clone;
}
