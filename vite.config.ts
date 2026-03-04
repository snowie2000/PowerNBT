import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import electron from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'zlib'],
      globals: { Buffer: true, global: true, process: true },
    }),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // Native Node.js modules and Node-only libs cannot be bundled
              external: ['leveldb-zlib', 'prismarine-nbt'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
  resolve: {
    alias: {
      buffer: 'buffer',
    },
  },
})
