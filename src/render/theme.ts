/** Light/dark theme toggle. Dark = Tokyo Night, light = Tango. Persisted. */
const KEY = 'mv-theme';
export type Theme = 'light' | 'dark';

function systemPreference(): Theme {
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function stored(): Theme | null {
  const v = globalThis.localStorage?.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Apply the saved/system theme and wire the toggle button. Defaults to — and
 *  live-follows — the OS colour scheme until the user makes an explicit choice. */
export function initTheme(button: HTMLButtonElement): void {
  let theme: Theme = stored() ?? systemPreference();

  const render = (): void => {
    apply(theme);
    const target = theme === 'dark' ? 'light' : 'dark';
    // Icon and label both signal the ACTION (the theme you'll switch TO), so the
    // glyph and the accessible name agree: sun = "go light", moon = "go dark".
    button.textContent = target === 'light' ? '☀' : '☾';
    button.setAttribute('aria-label', `Switch to ${target} theme`);
    button.title = `Switch to ${target} theme`;
  };

  render();

  // Follow the OS theme as long as the user hasn't picked one explicitly.
  globalThis.matchMedia?.('(prefers-color-scheme: light)')
    .addEventListener?.('change', (e) => {
      if (stored()) return; // an explicit choice wins over the system default
      theme = e.matches ? 'light' : 'dark';
      render();
    });

  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    globalThis.localStorage?.setItem(KEY, theme);
    render();
  });
}
