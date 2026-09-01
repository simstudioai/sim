import { defineConfig } from 'vitest/config'

/**
 * Repo-level scripts have their own suites. One invocation for all of them
 * replaces eleven sequential `vitest run <file>` processes, each of which paid
 * its own startup. `scripts/openapi` keeps its own config and runs under
 * `check:openapi`.
 *
 * Deliberately not named `vitest.config.ts`: Vitest walks up from a package's
 * directory looking for that name, so a root config would silently replace
 * the defaults of every workspace package that has none of its own.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/*.test.ts'],
  },
})
