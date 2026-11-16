import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages / Cloudflare Pages のどちらでも動くよう、相対パスで配信する。
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
});
