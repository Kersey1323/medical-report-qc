import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwindcss()],server:{host:'0.0.0.0',port:5174,strictPort:true,proxy:{'/api':'http://127.0.0.1:5100'}},preview:{host:'0.0.0.0',port:5174,strictPort:true},build:{outDir:'dist'}});
