/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vitest/config';

// GitHub Pages serves this project under /ModelVisualization/.
// Local dev/preview use '/'. Override with BASE_PATH if the repo is renamed.
const base = process.env.BASE_PATH ?? (process.env.NODE_ENV === 'production' ? '/ModelVisualization/' : '/');

// Inject a strict Content-Security-Policy into the BUILT html only. It is
// deliberately not applied in dev, where Vite's HMR needs inline/eval scripts
// and a websocket. The app uses no inline <script>, but does set inline style
// attributes (node colours), hence 'unsafe-inline' for style only.
// Note: frame-ancestors is omitted — it is ignored when delivered via <meta>
// (header-only), and GitHub Pages cannot set response headers.
const csp =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'";
const cspPlugin: Plugin = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace(
      '</title>',
      `</title>\n  <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    );
  },
};

export default defineConfig({
  base,
  plugins: [cspPlugin],
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
