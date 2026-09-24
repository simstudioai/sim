#!/usr/bin/env bun

/**
 * Reinstalls exactly the Tin triggers `disable-tin-projection.ts` dropped, from the migrations that
 * own them rather than a copy of their SQL:
 *
 * 1. `installProjection` from `0019_tin_keyword_projection` re-creates the Tin functions and the
 *    `embedding_keyword_tin_sync` and `knowledge_base_keyword_tin_sync` triggers.
 * 2. `installKnowledgeProjectionAsync` from `0024_knowledge_projection_async` re-guards
 *    `embedding_keyword_tin_sync` with the deferred-projection `WHEN` and re-creates
 *    `embedding_keyword_tin_source_acl_set`, and re-installs the (unchanged, idempotent) marking.
 *
 * Triggers write rows only for chunks written after they exist, so the projection is refilled with
 * `--backfill`, which runs the same keyset backfill `0019` runs (`backfillProjection`). It inserts
 * row by row into the live Tin index; for a large refill it is faster to drop the index first and
 * let `bun packages/db/script-migrations/0019_tin_keyword_projection.ts` rebuild it afterwards.
 *
 * Usage:
 *   DATABASE_URL=<migrations-role-dsn> bun apps/sim/scripts/dormant-org-search/restore-tin-projection.ts            # dry run
 *   DATABASE_URL=<migrations-role-dsn> bun apps/sim/scripts/dormant-org-search/restore-tin-projection.ts --execute [--backfill]
 *
 * Exit codes: 0 done, 1 failed or refused.
 */

import { parseArgs } from 'node:util'
import {
  backfillProjection,
  installProjection,
} from '@sim/db/script-migrations/0019_tin_keyword_projection'
import { installKnowledgeProjectionAsync } from '@sim/db/script-migrations/0024_knowledge_projection_async'
import { retryOnLockTimeout } from '@sim/db/scripts/lock-timeout-retry'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { Sql } from 'postgres'
import { connectMigrationRole, resolveExecuteFlag } from '@/scripts/dormant-org-search/cli'
import {
  postgresTinProjectionDatabase,
  TIN_TRIGGERS,
  type TinProjectionDatabase,
} from '@/scripts/dormant-org-search/disable-tin-projection'

const logger = createLogger('RestoreTinProjection')

const INSTALL_RETRY = {
  budgetMs: 20 * 60_000,
  backoff: { baseMs: 2_000, maxMs: 30_000 },
} as const

/** The migration steps the restore runs, injectable so the order is testable without a database. */
export interface TinRestoreSteps {
  installProjection(): Promise<void>
  installKnowledgeProjectionAsync(): Promise<void>
  backfillProjection(): Promise<number>
}

export interface RestoreTinProjectionResult {
  executed: boolean
  backfilled: number | null
}

/**
 * Refuses where `tin` is not installed, since the Tin triggers would then write rows no index
 * serves; otherwise reinstalls the triggers in migration order and optionally backfills.
 */
export async function restoreTinProjection(
  database: TinProjectionDatabase,
  steps: TinRestoreSteps,
  options: { execute: boolean; backfill: boolean }
): Promise<RestoreTinProjectionResult> {
  const before = await database.readState()
  const missing = TIN_TRIGGERS.filter(
    (trigger) => !before.triggers.some((present) => present.name === trigger.name)
  )
  logger.info('Tin projection state', {
    installed: before.triggers.map((trigger) => trigger.name),
    missing: missing.map((trigger) => trigger.name),
    hasRows: before.hasRows,
    functionsInstalled: before.functionsInstalled,
  })
  if (!before.functionsInstalled) {
    throw new Error(
      'The Tin functions are not installed here; run 0019_tin_keyword_projection directly instead'
    )
  }
  if (!options.execute) {
    logger.info('Dry run: would reinstall the Tin triggers from 0019 and 0024', {
      backfill: options.backfill,
    })
    return { executed: false, backfilled: null }
  }
  await steps.installProjection()
  await steps.installKnowledgeProjectionAsync()
  const after = await database.readState()
  const stillMissing = TIN_TRIGGERS.filter(
    (trigger) => !after.triggers.some((present) => present.name === trigger.name)
  )
  if (stillMissing.length > 0) {
    throw new Error(
      `Tin triggers missing after restore: ${stillMissing.map((trigger) => trigger.name).join(', ')}`
    )
  }
  logger.info('Tin triggers reinstalled', {
    triggers: after.triggers.map((trigger) => trigger.name),
  })
  if (!options.backfill) {
    logger.warn(
      'Existing chunks are not projected until a backfill runs; rerun with --execute --backfill'
    )
    return { executed: true, backfilled: null }
  }
  const backfilled = await steps.backfillProjection()
  logger.info('Tin projection backfilled', { rows: backfilled })
  return { executed: true, backfilled }
}

/** The migrations' own functions, on the migrations role's connection. */
export function migrationTinRestoreSteps(sql: Sql): TinRestoreSteps {
  return {
    installProjection: () =>
      retryOnLockTimeout(() => installProjection(sql), {
        ...INSTALL_RETRY,
        onRetry: ({ attempt, delayMs }) =>
          logger.warn('Tin trigger install waited out its lock timeout; retrying', {
            attempt,
            retryInMs: Math.round(delayMs),
          }),
      }),
    installKnowledgeProjectionAsync: () => installKnowledgeProjectionAsync(sql),
    backfillProjection: () => backfillProjection(sql),
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      backfill: { type: 'boolean' },
    },
    strict: true,
  })
  const execute = resolveExecuteFlag(values)
  const sql = connectMigrationRole()
  try {
    await restoreTinProjection(
      postgresTinProjectionDatabase(sql, { retryBudgetMs: INSTALL_RETRY.budgetMs }),
      migrationTinRestoreSteps(sql),
      { execute, backfill: values.backfill === true }
    )
  } finally {
    await sql.end()
  }
}

if (import.meta.main) {
  main().then(
    () => process.exit(0),
    (error) => {
      logger.error('Restoring the Tin projection failed', toError(error))
      process.exit(1)
    }
  )
}
