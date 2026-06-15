// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initTheme } from '../src/render/theme.js';

// Controllable matchMedia + localStorage stubs.
let listeners: Array<(e: { matches: boolean }) => void>;
let lightMatches: boolean;
const store = new Map<string, string>();

beforeEach(() => {
  listeners = [];
  lightMatches = true; // system = light
  (globalThis as Record<string, unknown>).matchMedia = (media: string) => ({
    media, get matches() { return lightMatches; },
    addEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
    removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; }, onchange: null,
  });
  store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k), clear: () => store.clear(), key: () => null, length: 0,
  };
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).matchMedia;
  delete (globalThis as Record<string, unknown>).localStorage;
});

const emitSystem = (light: boolean): void => { lightMatches = light; listeners.forEach((cb) => cb({ matches: light })); };
const theme = (): string | undefined => document.documentElement.dataset.theme;

describe('theme defaults to and follows the OS scheme', () => {
  it('defaults to the system scheme when nothing is stored', () => {
    initTheme(document.createElement('button'));
    expect(theme()).toBe('light'); // lightMatches = true
  });

  it('live-follows OS changes while the user has not chosen', () => {
    initTheme(document.createElement('button'));
    expect(theme()).toBe('light');
    emitSystem(false); // OS → dark
    expect(theme()).toBe('dark');
    emitSystem(true); // OS → light
    expect(theme()).toBe('light');
  });

  it('an explicit toggle wins and stops following the OS', () => {
    const btn = document.createElement('button');
    initTheme(btn);          // light
    btn.click();             // user → dark, stored
    expect(theme()).toBe('dark');
    emitSystem(true);        // OS says light, but user chose dark
    expect(theme()).toBe('dark');
    expect(store.get('mv-theme')).toBe('dark');
  });
});
