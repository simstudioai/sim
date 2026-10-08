import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

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
    fsModuleCache: true,
    exclude: [...configDefaults.exclude, '**/dist/**'],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
})

/** Seconds a file of unknown duration is assumed to take: about the median measured file. */
const UNKNOWN_FILE_SECONDS = 6
/** Floor for any file: one that skips every test in CI still pays its import and collection. */
const MIN_FILE_SECONDS = 1
const DURATIONS_FILE = 'vitest.integration-durations.json'

/**
 * The committed weights, or none when the file is absent. A file that does not parse stops the run
 * with the fix in the message rather than a bare SyntaxError.
 */
function readDurations(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `${DURATIONS_FILE} is not valid JSON. Regenerate it with scripts/update-integration-durations.ts.`,
      { cause: error }
    )
  }
}

function findRepoRoot(from: string): string {
  let dir = from
  while (!existsSync(path.join(dir, 'bun.lock'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`No bun.lock above ${from}`)
    dir = parent
  }
  return dir
}

/**
 * Splits `--shard` runs by measured duration instead of by file count.
 *
 * Vitest's own shard() sorts files by path hash and hands each shard an equal number of them, so
 * one long suite can land beside dozens of others and set the slowest shard. This packs files
 * greedily, longest first, into the currently lightest shard, using the per-file seconds committed
 * in `vitest.integration-durations.json` (refreshed by `scripts/update-integration-durations.ts`).
 *
 * Every shard computes the full partition from the same file list and the same committed weights,
 * with ties broken by path and then by lowest shard index, so the shards are disjoint and together
 * cover every file. A stale or missing weight only costs balance, never coverage. Ordering within a
 * shard is Vitest's own sort().
 */
class DurationBalancedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard ?? { index: 1, count: 1 }
    const root = findRepoRoot(this.ctx.config.root)
    const durations = readDurations(path.join(root, DURATIONS_FILE))

    const weighted = files.map((spec) => {
      const key = path.relative(root, spec.moduleId).split(path.sep).join('/')
      const recorded = durations[key]
      const seconds =
        typeof recorded === 'number' && Number.isFinite(recorded) ? recorded : UNKNOWN_FILE_SECONDS
      return { spec, key, seconds: Math.max(seconds, MIN_FILE_SECONDS) }
    })
    weighted.sort((a, b) => b.seconds - a.seconds || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

    const loads = new Array<number>(count).fill(0)
    const shards = Array.from({ length: count }, () => [] as TestSpecification[])
    for (const { spec, seconds } of weighted) {
      let lightest = 0
      for (let shard = 1; shard < count; shard++) {
        if (loads[shard] < loads[lightest]) lightest = shard
      }
      loads[lightest] += seconds
      shards[lightest].push(spec)
    }
    return shards[index - 1]
  }
}

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
    outputFile: { json: process.env.INTEGRATION_REPORT_PATH ?? 'test-results/integration.json' },
    sequence: { sequencer: DurationBalancedSequencer },
  },
})
