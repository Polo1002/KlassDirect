import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/KlassDirect/',
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        // On force Vite à chercher l'index à la racine du projet
        input: path.resolve(__dirname, 'index.html'),
      },
      outDir: 'dist',
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
