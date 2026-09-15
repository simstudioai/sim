import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Repo-level scripts have their own suites. One invocation for all of them
 * replaces eighteen sequential `vitest run <file>` processes, each of which
 * paid its own startup. `scripts/openapi` keeps its own config and runs under
 * `check:openapi`.
 *
 * Lives here rather than as a root `vitest.config.ts`: Vitest walks up from a
 * package's directory looking for that name, so a root config would silently
 * replace the defaults of every workspace package that has none of its own.
 * The root is pinned so `bun run test:scripts` behaves the same from any cwd.
 */
export default defineConfig({
  resolve: {
    alias: { '@scripts': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    environment: 'node',
    include: ['scripts/*.test.ts', 'scripts/design-diff/tests/**/*.test.ts'],
  },
})
