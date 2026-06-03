import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolvePath('./electron/main.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolvePath('./electron/preload.ts'),
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: Number(process.env.CMA_DEV_PORT ?? 14000),
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: resolvePath('./index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolvePath('./src'),
      },
    },
  },
})
