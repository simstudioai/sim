import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: false,
    environment: 'node',
    include: ['scripts/**/*.test.ts', 'script-migrations/**/*.test.ts', '*.test.ts'],
  },
})
