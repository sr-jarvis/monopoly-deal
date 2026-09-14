import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Monopoly Deal',
        short_name: 'MonopolyDeal',
        description: 'Server-authoritative Monopoly Deal Card Game',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          {
            src: '/assets/imgs/logo.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@monopoly-deal/shared': path.resolve(__dirname, '../shared/protocol.ts')
    }
  },
  server: {
    port: 8100,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://127.0.0.1:9000',
        ws: true
      }
    }
  },
  preview: {
    port: 8100,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://127.0.0.1:9000',
        ws: true
      }
    }
  }
});
