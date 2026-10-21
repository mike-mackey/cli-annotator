import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

const isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);

// The built page may not talk to any server: dumps hold secrets and never leave the browser.
const CSP = [
  "default-src 'self'",
  "connect-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

const cspMeta = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), cspMeta],
  server: {
    // Watching on an NTFS mount is unreliable under WSL2.
    ...(isWsl ? { watch: null } : {}),
  },
})
