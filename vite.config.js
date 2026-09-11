import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  // The dev server must never expose private backups or proprietary inspection files.
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/local/**'] } },
  build: {
    rollupOptions: {
      input: {
        observatory: fileURLToPath(new URL('./index.html', import.meta.url)),
        extraction: fileURLToPath(new URL('./extraction.html', import.meta.url)),
      },
      output: { manualChunks: { three: ['three', 'three/addons/controls/OrbitControls.js'] } },
    },
  },
});
