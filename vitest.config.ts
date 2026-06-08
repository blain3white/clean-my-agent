import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'electron/lib/**/*.ts',
        'src/lib/**/*.ts',
        'src/shared/usage-pricing.ts',
        'src/features/cleanup/*.ts',
        'src/features/skills/*.ts',
        'src/features/usage/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'electron/**/*.test.ts',
        'src/lib/mock-data.ts',
        'src/lib/i18n-provider.tsx',
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
