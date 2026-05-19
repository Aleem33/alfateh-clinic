import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import packageJson from './package.json';

export default defineConfig({
  base: './',   // Required for Electron — loads assets relatively
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  optimizeDeps: {
    include: [
      'react-is',
      'recharts',
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/firebase/')) return 'firebase';
          if (id.includes('/recharts/')) return 'charts';
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router-dom/') ||
            id.includes('/react-is/')
          ) {
            return 'react-vendor';
          }
        },
      },
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
