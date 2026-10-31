import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'POS & Inventory Lokal',
        short_name: 'POS Lokal',
        description: 'Sistem Kasir dan Inventory Offline-First',
        theme_color: '#DC2626',
        background_color: '#F8FAFC',
        display: 'standalone',
        icons: []
      }
    })
  ]
});