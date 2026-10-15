import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: { outDir: 'dist', assetsInlineLimit: 1_000_000, rolldownOptions: { output: { codeSplitting: false } } },
});
