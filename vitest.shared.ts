import { configDefaults, defineConfig } from 'vitest/config'

/**
 * The one Vitest base every workspace config extends with `mergeConfig`.
 *
 * Every test starts from pristine state, so tests never call `vi.restoreAllMocks()`,
 * `vi.unstubAllEnvs()`, `vi.unstubAllGlobals()`, or `vi.clearAllMocks()` in hooks. Vitest applies
 * these before each test, ahead of its `beforeEach` hooks: create a `vi.spyOn` spy, `vi.stubEnv`,
 * or `vi.stubGlobal` in `beforeEach` or in the test itself — one made at module scope or in
 * `beforeAll` is undone before the first test runs. `globals` stays at its `false` default: every
 * test file imports its APIs from `vitest`.
 *
 * Lives at the repository root so each workspace imports it by path, with no package dependency.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
})

/**
 * Overrides for a workspace's `--mode integration` run against real PostgreSQL and Redis.
 *
 * Integration suites build their fixtures once per file — they stub `fetch`, spy on collaborators,
 * and stub env in `beforeAll` — so the per-test restore and unstub is off here. Each run writes a
 * JSON report to `test-results/integration.json` for CI to upload.
 */
export const integrationTestConfig = defineConfig({
  test: {
    restoreMocks: false,
    unstubEnvs: false,
    unstubGlobals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/integration.json' },
  },
})
