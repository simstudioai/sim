import { db } from '@sim/db'
import { type ScimConnectionSettings, scimConnection } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'
import {
  autoMapPermissionGroupByName,
  settleMappedPermissionGroupsExplicit,
} from '@/ee/scim/lib/projection/auto-map'
import {
  PROJECTION_BATCH_SIZE,
  reconcileUsersProjectionInBatches,
} from '@/ee/scim/lib/projection/reconcile-user'
import { listScimGroupsForReconcile } from '@/ee/scim/lib/repository/groups'
import { listScimUserIds } from '@/ee/scim/lib/repository/users'
import { pruneScimRequestLog } from '@/ee/scim/lib/request-log'

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
 * The cron fires hourly and stamps `reconciledAt` at the end of a pass, so a
 * connection is due on the next tick only if this interval is comfortably
 * shorter than the cron period; an interval equal to it would skip every other
 * tick. Fifty minutes keeps the once-an-hour guarantee the docs make.
 */
const RECONCILE_INTERVAL_MS = 50 * 60 * 1000

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

/** Whether this run still holds the connection; a run past the TTL may have been superseded. */
async function holdsLease(connectionId: string, runId: string): Promise<boolean> {
  const [row] = await db
    .select({ token: scimConnection.reconcileLockToken })
    .from(scimConnection)
    .where(and(eq(scimConnection.id, connectionId), eq(scimConnection.status, 'active')))
    .limit(1)
  return row?.token === runId
}

/** Matches existing groups before projecting users, so enabling matching does not require a directory rename. */
async function reconcileExistingGroupNames(
  connection: { id: string; organizationId: string },
  runId: string
): Promise<boolean> {
  let cursor: string | undefined
  for (;;) {
    const batch = await db.transaction(async (tx) => {
      await acquireOrganizationMutationLock(tx, connection.organizationId)
      const [fresh] = await tx
        .select({
          status: scimConnection.status,
          token: scimConnection.reconcileLockToken,
          settings: scimConnection.settings,
        })
        .from(scimConnection)
        .where(eq(scimConnection.id, connection.id))
        .limit(1)
      if (fresh?.status !== 'active' || fresh.token !== runId) return { stopped: true }
      if (!fresh.settings.autoMapPermissionGroupsByName) return { stopped: false }

      const groups = await listScimGroupsForReconcile(tx, {
        connectionId: connection.id,
        afterOrderKey: cursor,
        limit: PROJECTION_BATCH_SIZE,
      })
      for (const group of groups) {
        const mapped = await autoMapPermissionGroupByName(tx, {
          organizationId: connection.organizationId,
          scimGroupId: group.id,
          displayName: group.displayName,
        })
        if (mapped === 'mapped') {
          await settleMappedPermissionGroupsExplicit(tx, {
            organizationId: connection.organizationId,
            scimGroupId: group.id,
          })
        }
      }
      return { stopped: false, cursor: groups.at(-1)?.orderKey }
    })
    if (batch.stopped) return false
    if (!batch.cursor) return true
    cursor = batch.cursor
  }
}

/** Releases the lease; the watermark advances only when the pass finished, so a failed batch is retried next hour. */
async function releaseLease(
  connectionId: string,
  runId: string,
  completed: boolean
): Promise<void> {
  await db
    .update(scimConnection)
    .set({
      reconcileLockToken: null,
      reconcileLeaseAt: null,
      ...(completed ? { reconciledAt: new Date() } : {}),
    })
    .where(and(eq(scimConnection.id, connectionId), eq(scimConnection.reconcileLockToken, runId)))
}

/** Connections whose last sweep is older than the interval, oldest first. */
async function findConnectionsDueForReconcile(limit: number): Promise<
  Array<{
    id: string
    organizationId: string
    settings: ScimConnectionSettings
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
  settings: ScimConnectionSettings
}): Promise<ScimReconcileReport | null> {
  /**
   * A lapsed organization's credentials are refused at authentication; its
   * projection must not keep being re-applied by the scheduler either.
   */
  if (!(await isScimEntitledForOrganization(connection.organizationId))) return null

  const runId = generateId()
  if (!(await acquireLease(connection.id, runId))) return null

  const report: ScimReconcileReport = {
    connectionId: connection.id,
    reconciledUsers: 0,
    grantsAdded: 0,
    grantsRemoved: 0,
  }

  let completed = false
  try {
    /** Pruned before the pass, so a connection whose pass keeps failing still keeps its log bounded. */
    await pruneScimRequestLog(connection.id)
    if (
      connection.settings.autoMapPermissionGroupsByName &&
      !(await reconcileExistingGroupNames(connection, runId))
    ) {
      return null
    }
    let cursor: string | undefined
    for (;;) {
      const page = await listScimUserIds(db, {
        connectionId: connection.id,
        ...(cursor ? { afterOrderKey: cursor } : {}),
        limit: PROJECTION_BATCH_SIZE,
      })
      if (page.length === 0) break
      if (!(await holdsLease(connection.id, runId))) {
        logger.warn('Directory reconciliation stopped: the lease was taken over', {
          connectionId: connection.id,
        })
        return null
      }

      /**
       * Settings are read per batch rather than from the row the due query
       * returned: an administrator may change them while a long pass runs, and
       * projecting a later batch with the old settings would then stamp the
       * connection as reconciled against a policy it no longer has.
       */
      const [fresh] = await db
        .select({ settings: scimConnection.settings })
        .from(scimConnection)
        .where(eq(scimConnection.id, connection.id))
        .limit(1)

      const delta = await reconcileUsersProjectionInBatches({
        connectionId: connection.id,
        organizationId: connection.organizationId,
        scimUserIds: page.map((row) => row.id),
        settings: fresh?.settings ?? connection.settings,
      })
      report.reconciledUsers += page.length
      report.grantsAdded += delta.added.length + delta.raised.length
      report.grantsRemoved += delta.removed.length
      cursor = page[page.length - 1].orderKey
    }

    completed = true
    if (report.grantsAdded > 0 || report.grantsRemoved > 0) {
      logger.warn('Directory reconciliation corrected drift', report)
    }
    return report
  } finally {
    await releaseLease(connection.id, runId, completed)
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
