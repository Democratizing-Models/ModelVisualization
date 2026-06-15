// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fromHs3Json } from '../src/adapters/hs3.js';

describe('prototype-pollution: untrusted metadata/misc are sanitized on ingest', () => {
  it('a __proto__ key NESTED inside a metadata value cannot pollute Object.prototype', () => {
    const src = JSON.stringify({
      metadata: { hs3_version: '0.2', extra: { '__proto__': { polluted: 1 }, ok: 2 } },
      data: [{ name: 'd', type: 'unbinned' }],
    });
    const m = fromHs3Json(src);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // the dangerous key is stripped; the sibling survives
    const extra = (m.meta as Record<string, Record<string, unknown>>).extra;
    expect(extra.ok).toBe(2);
    expect(Object.getPrototypeOf(extra)).toBeNull();
  });

  it('misc subtree is sanitized too', () => {
    const src = JSON.stringify({
      metadata: { hs3_version: '0.2' },
      misc: { '__proto__': { polluted: 1 }, kept: true },
      data: [{ name: 'd', type: 'unbinned' }],
    });
    const m = fromHs3Json(src);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const misc = (m.meta as Record<string, Record<string, unknown>>).misc;
    expect(misc.kept).toBe(true);
  });

  it('top-level meta stays null-proto', () => {
    const m = fromHs3Json('{"metadata":{"hs3_version":"0.2"},"data":[{"name":"d","type":"unbinned"}]}');
    expect(Object.getPrototypeOf(m.meta)).toBeNull();
  });
});
