import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'node:path';

const analyze = process.env.ANALYZE === '1';

export default defineConfig({
  plugins: [
    react(),
    analyze &&
      (visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        brotliSize: true,
        open: true,
      }) as PluginOption),
  ].filter(Boolean) as PluginOption[],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
