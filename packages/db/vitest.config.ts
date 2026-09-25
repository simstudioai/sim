import { defineConfig } from 'vitest/config'

/**
 * `vitest run` collects unit tests (`*.test.ts`). `vitest run --mode integration` collects the
 * real-PostgreSQL suites (`*.integration.ts`) and requires `TEST_DATABASE_URL`; it writes a JSON
 * report to `test-results/integration.json` for CI to upload.
 */
export default defineConfig(({ mode }) => {
  const integration = mode === 'integration'
  return {
    resolve: { tsconfigPaths: true },
    test: {
      include: integration
        ? ['**/*.integration.ts']
        : ['scripts/**/*.test.ts', 'script-migrations/**/*.test.ts', '*.test.ts'],
      ...(integration && {
        setupFiles: ['./vitest.integration.setup.ts'],
        testTimeout: 30000,
        hookTimeout: 30000,
        reporters: ['default', 'json'],
        outputFile: { json: 'test-results/integration.json' },
      }),
    },
  }
})
