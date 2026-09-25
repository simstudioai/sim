import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig, { integrationTestConfig } from '../../vitest.shared'

/**
 * `vitest run` collects unit tests (`*.test.ts`). `vitest run --mode integration` collects the
 * real-PostgreSQL suites (`*.integration.ts`) and requires `TEST_DATABASE_URL`.
 */
export default defineConfig(({ mode }) => {
  const integration = mode === 'integration'
  return mergeConfig(
    integration ? mergeConfig(sharedConfig, integrationTestConfig) : sharedConfig,
    defineConfig({
      resolve: { tsconfigPaths: true },
      test: {
        include: integration
          ? ['**/*.integration.ts']
          : ['scripts/**/*.test.ts', 'script-migrations/**/*.test.ts', '*.test.ts'],
        ...(integration && { setupFiles: ['./vitest.integration.setup.ts'] }),
      },
    })
  )
})
