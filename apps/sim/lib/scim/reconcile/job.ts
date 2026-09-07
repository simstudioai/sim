import { db } from '@sim/db'
import { scimConnection } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { isScimEnabled } from '@/lib/core/config/env-flags'
import { reconcileUserProjection } from '@/lib/scim/projection/reconcile-user'
import { listScimUserIds } from '@/lib/scim/repository/users'
import { pruneScimRequestLog } from '@/lib/scim/request-log'

const logger = createLogger('ScimReconcile')

/**
 * The scheduled drift pass.
 *
 * Group mappings are applied when membership changes, so in the ordinary case
 * this finds nothing. It exists for the cases where the ordinary path could not
 * finish: a post-commit effect that failed, a manual change made while
 * managed-membership locking was off, or a mapping edited against a target that
 * was concurrently deleted. Re-running the projection is idempotent, so a pass
 * that finds nothing writes nothing.
 */

/** How long a claimed lease is honored before another run may take it over. */
const LEASE_TTL_MS = 15 * 60 * 1000

/**
 * How often a connection is swept when nothing else triggers it.
 *
 * The cron fires hourly; each connection is picked up once this interval has
 * passed since its last sweep, oldest first. Drift is rare and corrected on the
 * next membership change anyway, so a few passes a day is plenty without
 * re-walking every tenant every hour.
 */
const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Users reconciled per transaction, so no single one holds locks for long. */
const BATCH_SIZE = 200

export interface ScimReconcileReport {
  connectionId: string
  reconciledUsers: number
  grantsAdded: number
  grantsRemoved: number
}

/**
 * Claims a connection with a single conditional update.
 *
 * The compare-and-set is the claim: two schedulers racing produce one winner,
 * because only one `UPDATE` can match a row whose lease is free or stale.
 */
async function acquireLease(connectionId: string, runId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - LEASE_TTL_MS)
  const claimed = await db
    .update(scimConnection)
    .set({ reconcileLockToken: runId, reconcileLeaseAt: new Date() })
    .where(
      and(
        eq(scimConnection.id, connectionId),
        eq(scimConnection.status, 'active'),
        or(
          isNull(scimConnection.reconcileLockToken),
          lt(scimConnection.reconcileLeaseAt, staleBefore)
        )
      )
    )
    .returning({ id: scimConnection.id })
  return claimed.length > 0
}

async function releaseLease(connectionId: string, runId: string): Promise<void> {
  await db
    .update(scimConnection)
    .set({ reconcileLockToken: null, reconcileLeaseAt: null, reconciledAt: new Date() })
    .where(and(eq(scimConnection.id, connectionId), eq(scimConnection.reconcileLockToken, runId)))
}

/** Connections whose last sweep is older than the interval, oldest first. */
async function findConnectionsDueForReconcile(limit: number): Promise<
  Array<{
    id: string
    organizationId: string
    settings: (typeof scimConnection.$inferSelect)['settings']
  }>
> {
  const dueBefore = new Date(Date.now() - RECONCILE_INTERVAL_MS)
  return db
    .select({
      id: scimConnection.id,
      organizationId: scimConnection.organizationId,
      settings: scimConnection.settings,
    })
    .from(scimConnection)
    .where(
      and(
        eq(scimConnection.status, 'active'),
        or(isNull(scimConnection.reconciledAt), lt(scimConnection.reconciledAt, dueBefore))
      )
    )
    .orderBy(sql`${scimConnection.reconciledAt} asc nulls first`)
    .limit(limit)
}

export async function reconcileConnection(connection: {
  id: string
  organizationId: string
  settings: (typeof scimConnection.$inferSelect)['settings']
}): Promise<ScimReconcileReport | null> {
  /**
   * A lapsed organization's credentials are refused at authentication; its
   * projection must not keep being re-applied by the scheduler either.
   */
  if (!(await isOrganizationFeatureEntitled(connection.organizationId, isScimEnabled))) return null

  const runId = generateId()
  if (!(await acquireLease(connection.id, runId))) return null

  const report: ScimReconcileReport = {
    connectionId: connection.id,
    reconciledUsers: 0,
    grantsAdded: 0,
    grantsRemoved: 0,
  }

  try {
    let cursor: string | undefined
    for (;;) {
      const page = await listScimUserIds(db, {
        connectionId: connection.id,
        ...(cursor ? { afterOrderKey: cursor } : {}),
        limit: BATCH_SIZE,
      })
      if (page.length === 0) break

      await db.transaction(async (tx) => {
        for (const row of page) {
          const delta = await reconcileUserProjection(tx, {
            connectionId: connection.id,
            organizationId: connection.organizationId,
            scimUserId: row.id,
            settings: connection.settings,
          })
          report.reconciledUsers += 1
          report.grantsAdded += delta.added.length + delta.raised.length
          report.grantsRemoved += delta.removed.length
        }
      })
      cursor = page[page.length - 1].orderKey
    }

    await pruneScimRequestLog(connection.id)
    if (report.grantsAdded > 0 || report.grantsRemoved > 0) {
      logger.warn('Directory reconciliation corrected drift', report)
    }
    return report
  } finally {
    await releaseLease(connection.id, runId)
  }
}

export interface ScimReconcileSweep {
  connections: number
  reconciledUsers: number
  grantsAdded: number
  grantsRemoved: number
}

export async function runScimReconcileSweep(maxConnections = 200): Promise<ScimReconcileSweep> {
  const due = await findConnectionsDueForReconcile(maxConnections)
  const sweep: ScimReconcileSweep = {
    connections: 0,
    reconciledUsers: 0,
    grantsAdded: 0,
    grantsRemoved: 0,
  }

  for (const connection of due) {
    try {
      const report = await reconcileConnection(connection)
      if (!report) continue
      sweep.connections += 1
      sweep.reconciledUsers += report.reconciledUsers
      sweep.grantsAdded += report.grantsAdded
      sweep.grantsRemoved += report.grantsRemoved
    } catch (error) {
      /** One tenant's failure must not stop the sweep for the others. */
      logger.error('Directory reconciliation failed for a connection', {
        connectionId: connection.id,
        error,
      })
    }
  }

  return sweep
}
