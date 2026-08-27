import { createLogger } from '@sim/logger'
import type { Sql } from 'postgres'
import type { ScriptMigration } from './types'

const logger = createLogger('WelResidualCostTotalBackfill')

export const WEL_RESIDUAL_COST_TOTAL_BATCH_SIZE = 500

/**
 * Safety valve for a store that keeps reporting progress: each batch must
 * shrink the candidate set (projected rows no longer match `cost_total IS
 * NULL`), so hitting this bound means the store is broken, not the data big.
 */
const MAX_BATCHES = 10_000

export interface WelResidualCostTotalBackfillStore {
  /** Projects one bounded batch of candidates and reports rows changed. */
  projectBatch(limit: number): Promise<number>
}

interface WelResidualCostTotalBackfillOptions {
  batchSize?: number
}

/**
 * Projects the residual `workflow_execution_logs.cost` json totals into
 * `cost_total`/`models_used`, batch by batch, until no candidates remain.
 */
export async function backfillWelResidualCostTotal(
  store: WelResidualCostTotalBackfillStore,
  options: WelResidualCostTotalBackfillOptions = {}
): Promise<number> {
  const batchSize = options.batchSize ?? WEL_RESIDUAL_COST_TOTAL_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Residual cost_total backfill batch size must be a positive integer')
  }

  let projected = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const changed = await store.projectBatch(batchSize)
    if (changed === 0) return projected
    projected += changed
  }
  throw new Error('Residual cost_total backfill did not converge; candidate set is not shrinking')
}

/**
 * Same candidate filter and projection as the 0220 procedure that introduced
 * `cost_total`: a numeric `cost->>'total'` fills `cost_total`, and the
 * `cost->'models'` keys fill `models_used`. Rows whose json lacks a numeric
 * total have nothing to project and stay untouched.
 */
export function createPostgresWelResidualCostTotalBackfillStore(
  sql: Sql
): WelResidualCostTotalBackfillStore {
  return {
    async projectBatch(limit) {
      const result = await sql`
        WITH candidates AS (
          SELECT id FROM workflow_execution_logs
          WHERE cost_total IS NULL
            AND cost ? 'total'
            AND (cost->>'total') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          LIMIT ${limit}
        )
        UPDATE workflow_execution_logs wel
        SET cost_total = NULLIF(wel.cost->>'total', '')::numeric,
            models_used = CASE
              WHEN jsonb_typeof(wel.cost->'models') = 'object'
              THEN ARRAY(SELECT jsonb_object_keys(wel.cost->'models'))
              ELSE wel.models_used
            END
        FROM candidates
        WHERE wel.id = candidates.id
      `
      return result.count
    },
  }
}

/**
 * The 0220 backfill projected every then-existing legacy `cost` json into
 * `cost_total`; a transition-window writer path added a handful of rows after
 * it ran with the json but no projection (verified on the prod replica
 * 2026-08-26: ~23 of 4.77M rows carry a numeric total with `cost_total` NULL).
 * This projects those stragglers so the pending `cost` DROP (see the
 * contract-pending marker on the column) abandons nothing that `cost_total`
 * should hold. The contract PR that drops `cost` must delete this entry from
 * the registry in the same change — it reads the column.
 */
export const backfillWelResidualCostTotalMigration: ScriptMigration = {
  name: '0009_backfill_wel_residual_cost_total',
  async up(sql) {
    const projected = await backfillWelResidualCostTotal(
      createPostgresWelResidualCostTotalBackfillStore(sql)
    )
    logger.info(`Residual cost_total backfill complete: ${projected} row(s) projected.`)
  },
}
