import { parseArgs } from 'node:util'
import {
  type RetirementThrottle,
  retireSearchEmbeddings,
  retireSearchEmbeddingsMigration,
} from '@sim/db/script-migrations/0027_retire_search_embeddings'
import {
  maintainSearchRetirement,
  maintainSearchRetirementMigration,
} from '@sim/db/script-migrations/0028_maintain_search_retirement'
import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import { type ScriptMigration, ScriptMigrationDeferred } from '@sim/db/script-migrations/types'
import postgres from 'postgres'

/**
 * How long a deploy advances the retirement before deferring to the background runner. The deploy
 * still makes progress on databases without that runner, and stays off the release's critical path.
 */
export const DEPLOY_RETIREMENT_BUDGET_MS = 60_000

export interface SearchRetirementSliceOptions {
  /** Time after which no retirement page or maintenance operation starts. */
  budgetMs: number
  /** Whether this slice may start index rebuilds and vacuums; the deploy never does. */
  maintenance: boolean
  throttle?: Partial<RetirementThrottle>
}

/**
 * One budgeted slice of the Search retirement under the `0029` journal name. A slice that finishes
 * retirement and maintenance is journaled with its superseded names; any other slice throws
 * `ScriptMigrationDeferred`, so the runner leaves it unrecorded and the next slice resumes the saved
 * cursor and maintenance checkpoints.
 */
export function searchRetirementSlice(options: SearchRetirementSliceOptions): ScriptMigration {
  return {
    name: '0029_retire_all_search_embeddings',
    supersedes: [retireSearchEmbeddingsMigration.name, maintainSearchRetirementMigration.name],
    async up(sql) {
      const deadline = performance.now() + options.budgetMs
      const retirement = await retireSearchEmbeddings(sql, {
        deadline,
        throttle: options.throttle,
      })
      if (retirement === 'deferred') {
        throw new ScriptMigrationDeferred('Search retirement continues in the background runner')
      }
      const maintenance = await maintainSearchRetirement(sql, {
        deadline: options.maintenance ? deadline : Number.NEGATIVE_INFINITY,
      })
      if (maintenance === 'deferred') {
        throw new ScriptMigrationDeferred('Search retirement maintenance waits for its window')
      }
    },
  }
}

/** Supersedes single-KB retirement receipts so every deployment receives the expanded cleanup. */
export const retireAllSearchEmbeddingsMigration = searchRetirementSlice({
  budgetMs: DEPLOY_RETIREMENT_BUDGET_MS,
  maintenance: false,
})

/**
 * The background runner: `--budget-minutes` bounds the slice (default: run to completion) and
 * `--maintenance` lets it start index rebuilds and vacuums. Journals only a completed cleanup.
 */
if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      'budget-minutes': { type: 'string' },
      maintenance: { type: 'boolean', default: false },
    },
  })
  const budgetMinutes = values['budget-minutes']
  const budgetMs =
    budgetMinutes === undefined ? Number.POSITIVE_INFINITY : Number(budgetMinutes) * 60_000
  if (!(budgetMs > 0)) throw new Error('--budget-minutes must be a positive number')
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is required for Search retirement')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    const { runScriptMigrations } = await import('@sim/db/script-migrations/index')
    await runScriptMigrations(sql, [
      searchRetirementSlice({ budgetMs, maintenance: values.maintenance }),
    ])
  } finally {
    await sql.end()
  }
}
