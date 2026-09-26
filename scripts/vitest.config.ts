import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../vitest.shared'

/**
 * Repo-level scripts have their own suites. One invocation for all of them
 * replaces eighteen sequential `vitest run <file>` processes, each of which
 * paid its own startup. `scripts/openapi` keeps its own config and runs under
 * `check:openapi`.
 *
 * The root is pinned so `bun run test:scripts` behaves the same from any cwd.
 */
export default mergeConfig(
  sharedConfig,
  defineConfig({
    resolve: {
      alias: { '@scripts': fileURLToPath(new URL('.', import.meta.url)) },
    },
    test: {
      root: fileURLToPath(new URL('..', import.meta.url)),
      include: ['scripts/*.test.ts'],
    },
  })
)
