import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../vitest.shared'

/**
 * Repo-level scripts have their own suites. One invocation for all of them
 * replaces separate `vitest run <file>` processes, each of which paid its own
 * startup. OpenAPI suites share this owner so the collection guard verifies
 * every script test against the configuration `bun run test` actually runs.
 *
 * The root is pinned so `bun run test:scripts` behaves the same from any cwd.
 */
export default mergeConfig(
  sharedConfig,
  defineConfig({
    resolve: {
      alias: {
        '@scripts': fileURLToPath(new URL('.', import.meta.url)),
        '@': fileURLToPath(new URL('../apps/sim', import.meta.url)),
      },
    },
    test: {
      root: fileURLToPath(new URL('..', import.meta.url)),
      include: ['scripts/**/*.{test,spec}.{ts,tsx,js,jsx,mts,mjs,cts,cjs}'],
    },
  })
)
