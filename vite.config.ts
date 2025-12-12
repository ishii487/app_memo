import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa'

const manifestForPlugin: Partial<VitePWAOptions> = {
  registerType: "autoUpdate",
  includeAssets: [],
  manifest: {
    name: "Offline Memo App",
    short_name: "Memo",
    description: "An offline-capable memo app with handwriting recognition.",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: 'android-chrome-192x192.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      },
      {
        src: 'android-chrome-512x512.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ],
    theme_color: '#171717',
    background_color: '#171717',
    display: "standalone",
    scope: './',
    start_url: "./index.html",
    orientation: 'portrait'
  }
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA(manifestForPlugin)
  ],
  base: './'
})
