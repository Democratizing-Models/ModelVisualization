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

/** Apply the saved/system theme and wire the toggle button. */
export function initTheme(button: HTMLButtonElement): void {
  let theme: Theme = stored() ?? systemPreference();

  const render = (): void => {
    apply(theme);
    button.textContent = theme === 'dark' ? '☾' : '☀';
    button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
    button.title = `Theme: ${theme}`;
  };

  render();
  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    globalThis.localStorage?.setItem(KEY, theme);
    render();
  });
}
