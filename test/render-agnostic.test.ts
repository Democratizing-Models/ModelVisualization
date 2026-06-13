// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RENDER_DIR = resolve(process.cwd(), 'src/render');

describe('render layer is format-agnostic (IR-only)', () => {
  it('no file under src/render/ imports from src/adapters/', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(RENDER_DIR)) {
      if (!file.endsWith('.ts')) continue;
      const src = readFileSync(resolve(RENDER_DIR, file), 'utf8');
      if (/from\s+['"][^'"]*adapters\//.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
