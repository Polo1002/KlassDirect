import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    // 1. On définit la base pour GitHub Pages
    base: '/KlassDirect/',
    
    // 2. On précise que l'index.html est à la racine
    root: '.',
    
    plugins: [
      react(),
      tailwindcss(),
    ],
    
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    
    server: {
      // HMR configuration
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    
    build: {
      // S'assure que le build finit bien dans le dossier 'dist'
      outDir: 'dist',
    }
  };
});
