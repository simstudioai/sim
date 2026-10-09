import {
  assertProjectBackfillDatabase,
  assignProjectBackfillBatch,
  discoverProjectBackfill,
  ProjectBackfillBusy,
  ProjectBackfillConflict,
  projectBackfillDatabaseId,
  readProjectGroupingReviews,
  verifyProjectBackfill,
} from '@sim/db/maintenance/project-backfill'
import { enforceProjectMembership } from '@sim/db/maintenance/project-enforcement'
import { countPendingProjectArchiveRepairs } from '@sim/db/maintenance/project-repairs'
import type { ScriptMigration } from '@sim/db/script-migrations/types'
import { createLogger } from '@sim/logger'
import { describeError, getTransientDatabaseFailure } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'

const logger = createLogger('ProjectMembershipMigration')
function retryable(error: unknown): boolean {
  const failure = getTransientDatabaseFailure(error)
  return failure === 'capacity' || failure === 'conflict'
}
const MAX_DURATION_MS = 20 * 60_000

/** Commits bounded assignments before validation and contraction; retry discovers only remaining work. */
export const projectMembershipMigration: ScriptMigration = {
  name: '0031_project_membership',
  async up(sql) {
    if (sql.options.max !== 1)
      throw new Error('Project migration requires the runner single-session connection')
    await sql.unsafe("SET statement_timeout = '60s'")
    await sql.unsafe("SET lock_timeout = '250ms'")
    const [lock] = await sql`SELECT pg_backend_pid() AS pid,
      pg_try_advisory_lock(hashtextextended('sim:project-backfill-operator', 0)) AS acquired`
    if (!lock.acquired)
      throw new Error('Project preparation is still running; retry after it finishes')
    async function assertSession() {
      const [state] = await sql`SELECT pg_backend_pid() AS pid, EXISTS (
        SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted
          AND classid = ((hashtextextended('sim:project-backfill-operator',0) >> 32) & 4294967295)::oid
          AND objid = (hashtextextended('sim:project-backfill-operator',0) & 4294967295)::oid
          AND objsubid = 1) AS held`
      if (state.pid !== lock.pid || !state.held)
        throw new Error('Project migration session was lost; rerun to resume')
    }
    try {
      await assertProjectBackfillDatabase(sql, true)
      if (await countPendingProjectArchiveRepairs(sql)) {
        throw new Error(
          'Project archive cleanup is incomplete; resume repair with the original manifest before retrying'
        )
      }
      const reviewPath = process.env.PROJECT_BACKFILL_REVIEW_PATH
      const reviewUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
      if (reviewPath && !reviewUrl)
        throw new Error('Reviewed Project migration requires its database URL')
      const databaseId = reviewUrl ? projectBackfillDatabaseId(reviewUrl) : 'migration-runner'
      const reviews = reviewPath ? await readProjectGroupingReviews(reviewPath, databaseId) : []
      const manifest = await discoverProjectBackfill(sql, databaseId, reviews)
      if (manifest.conflicts.length || manifest.repairs.length) {
        logger.error('Project preparation requires operator remediation', {
          conflicts: manifest.conflicts.slice(0, 50),
          conflictCount: manifest.conflicts.length,
          archiveRepairs: manifest.repairs.length,
        })
        throw new ProjectBackfillConflict(
          'Resolve Project conflicts and archive/provider repairs with backfill-projects.ts plan/repair before retrying'
        )
      }
      const pending = manifest.families.map((family) => ({ family, attempts: 0 }))
      const failed: string[] = []
      const started = performance.now()
      let batchSize = 50
      let assigned = 0
      let batches = 0
      for (let position = 0; position < pending.length; ) {
        if (performance.now() - started > MAX_DURATION_MS || batches >= 10_000) {
          throw new Error(
            'Project backfill scheduling budget exhausted; rerun to resume committed progress'
          )
        }
        await assertSession()
        const items = [pending[position++]]
        if (items[0].family.members.length === 1 && items[0].attempts === 0) {
          while (
            items.length < batchSize &&
            position < pending.length &&
            pending[position].family.members.length === 1 &&
            pending[position].attempts === 0
          ) {
            items.push(pending[position++])
          }
        }
        const batchStarted = performance.now()
        batches++
        try {
          const result = await assignProjectBackfillBatch(
            sql,
            items.map((item) => item.family)
          )
          assigned += result.assigned
          const elapsedMs = performance.now() - batchStarted
          if (elapsedMs > 250) batchSize = Math.max(1, Math.floor(batchSize / 2))
          logger.info('Project migration batch committed', {
            ...result,
            assigned,
            batches,
            elapsedMs,
            batchSize,
          })
        } catch (error) {
          if (
            !(error instanceof ProjectBackfillBusy) &&
            !(error instanceof ProjectBackfillConflict) &&
            !retryable(error)
          )
            throw error
          await assertSession()
          for (const item of items) {
            if (!(error instanceof ProjectBackfillConflict) && ++item.attempts < 3)
              pending.push(item)
            else failed.push(item.family.rootId)
          }
          logger.warn('Project migration batch deferred', {
            roots: items.map((item) => item.family.rootId),
            error: describeError(error),
          })
          await sleep(backoffWithJitter(items[0].attempts, null, { baseMs: 250, maxMs: 1000 }))
        }
        await sleep(100)
      }
      if (failed.length) {
        logger.error('Project families still need retry or reconciliation', {
          count: failed.length,
          roots: failed.slice(0, 50),
        })
        throw new ProjectBackfillConflict(
          'Project backfill incomplete; resolve contention or changed families and rerun'
        )
      }
      await assertSession()
      const remaining = await discoverProjectBackfill(sql, databaseId, reviews)
      if (remaining.conflicts.length || remaining.repairs.length || remaining.families.length)
        throw new ProjectBackfillConflict(
          'Project evidence changed during preparation; rediscover and rerun'
        )
      const counts = await verifyProjectBackfill(sql)
      logger.info('Project migration verification', counts)
      if (Object.values(counts).some((count) => count !== 0)) {
        throw new ProjectBackfillConflict(
          'Project validation failed; reconcile the reported invariants before enforcement'
        )
      }
      for (let attempt = 0; ; attempt++) {
        await assertSession()
        try {
          await enforceProjectMembership(sql)
          break
        } catch (error) {
          if (attempt >= 2 || !retryable(error)) throw error
          logger.warn('Project enforcement deferred by contention', {
            error: describeError(error),
            attempt,
          })
          await sleep(backoffWithJitter(attempt, null, { baseMs: 250, maxMs: 1000 }))
        }
      }
      await assertSession()
      logger.info('Project backfill and enforcement complete', { assigned, batches })
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtextextended('sim:project-backfill-operator', 0))`
      await sql.unsafe('SET statement_timeout = 0')
      await sql.unsafe('SET lock_timeout = 0')
    }
  },
}
