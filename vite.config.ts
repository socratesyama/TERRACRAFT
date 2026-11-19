import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages / Cloudflare Pages のどちらでも動くよう、相対パスで配信する。
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // 初期ロードを軽くする（§17）: 3D ライブラリと React を別チャンクにして、キャッシュを効かせる
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'vendor-three' : id.includes('node_modules/react') ? 'vendor-react' : undefined),
      },
    },
  },
});
