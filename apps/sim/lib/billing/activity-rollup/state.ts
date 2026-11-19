import { db } from '@sim/db'
import {
  activityRollupBlocked,
  activityRollupDirty,
  activityRollupInflight,
  activityRollupState,
  workflowActivityHourly,
} from '@sim/db/schema'
import { and, eq, gt, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import { HOUR_MS, msInterval } from '@/lib/billing/activity-rollup/source'
import type { DbTransaction } from '@/lib/db/types'

/**
 * Bump when what a stored cell means changes. A pass on newer code resets the rollup and backfills
 * it again; a pass on older code then idles, and reads on either use the rollup only when its
 * version is their own.
 */
export const ACTIVITY_ROLLUP_VERSION = 1

export const WORKFLOW_ROLLUP_ID = 'workflow'

/** Longer than a pass's budget and the statement that may still be running past it. */
const LEASE_MS = 3 * 60 * 1000

/**
 * How long the rollup may go without a completed pass before it is rebuilt. Marks are written only
 * while a pass completed within this window, so a rollup left unmaintained longer can have missed deletes and
 * reopened runs, and its late-end scan would have a backlog to catch up on: rebuilding is the only
 * way back to exact. Reads stop using it sooner, once its newest hour is six hours old.
 */
export const MAINTENANCE_GAP_MS = 6 * HOUR_MS

export type ActivityRollupState = typeof activityRollupState.$inferSelect

/** Progress a pass may move, each as a value or as SQL evaluated by the update. */
type StateChanges = {
  [K in Exclude<keyof ActivityRollupState, 'id' | 'leaseOwner'>]?: ActivityRollupState[K] | SQL
}

export async function readRollupState(
  executor: Pick<DbTransaction, 'select'> = db
): Promise<ActivityRollupState | null> {
  const [state] = await executor
    .select()
    .from(activityRollupState)
    .where(eq(activityRollupState.id, WORKFLOW_ROLLUP_ID))
    .limit(1)
  return state ?? null
}

/**
 * Takes the pass lease, creating the state row on first use, so two passes never run at once:
 * Trigger.dev runs one at a time, but an inline pass and a Trigger.dev pass can meet while a
 * deployment changes how it runs them. Returns the state, or null when another pass holds it.
 *
 * Every pass releases the lease on its way out, so one taken over after it expired belonged to a
 * pass that died holding it (killed, or out of memory) and is counted as a failed pass, like one
 * that threw. A lease left behind for any other reason (its release failing) counts the same way,
 * which at worst backs off a deferred hour one failure early.
 */
export async function acquireLease(owner: string): Promise<ActivityRollupState | null> {
  await db
    .insert(activityRollupState)
    .values({ id: WORKFLOW_ROLLUP_ID, version: ACTIVITY_ROLLUP_VERSION })
    .onConflictDoNothing()
  const [state] = await db
    .update(activityRollupState)
    .set({
      leaseOwner: owner,
      leaseExpiresAt: sql`now() + ${msInterval(LEASE_MS)}`,
      failedPasses: sql`${activityRollupState.failedPasses} + CASE WHEN ${activityRollupState.leaseOwner} IS NULL THEN 0 ELSE 1 END`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(activityRollupState.id, WORKFLOW_ROLLUP_ID),
        or(
          isNull(activityRollupState.leaseExpiresAt),
          lt(activityRollupState.leaseExpiresAt, sql`now()`),
          eq(activityRollupState.leaseOwner, owner)
        )
      )
    )
    .returning()
  return state ?? null
}

export async function releaseLease(owner: string): Promise<void> {
  await db
    .update(activityRollupState)
    .set({ leaseOwner: null, leaseExpiresAt: null })
    .where(
      and(eq(activityRollupState.id, WORKFLOW_ROLLUP_ID), eq(activityRollupState.leaseOwner, owner))
    )
}

/**
 * Updates the state only while `owner` still holds a live lease, inside the caller's transaction
 * when one is given, so a pass whose lease lapsed can never move progress another pass now owns.
 * Progress (`requireCoverage`) moves only while both ends of the coverage are set: coverage
 * cleared under a running pass (a manual reset) then rolls the hour's write back instead of
 * leaving one end set and the other null. Throws when the update matched nothing.
 */
export async function updateLeasedState(
  owner: string,
  changes: StateChanges,
  executor: Pick<DbTransaction, 'update'> = db,
  { requireCoverage = false }: { requireCoverage?: boolean } = {}
): Promise<ActivityRollupState> {
  const [state] = await executor
    .update(activityRollupState)
    .set({ ...changes, updatedAt: sql`now()` })
    .where(
      and(
        eq(activityRollupState.id, WORKFLOW_ROLLUP_ID),
        eq(activityRollupState.leaseOwner, owner),
        gt(activityRollupState.leaseExpiresAt, sql`now()`),
        requireCoverage ? isNotNull(activityRollupState.coverageStart) : undefined,
        requireCoverage ? isNotNull(activityRollupState.freshThrough) : undefined
      )
    )
    .returning()
  if (!state) throw new Error('Activity rollup lease lost or coverage reset during the pass')
  return state
}

/**
 * Moves the maintenance heartbeat to now only if it is still within the gap by the database's
 * clock, the clock writers use to decide whether to mark, in the same statement. Null means it had
 * expired (writers may already have skipped marks), so the caller must rebuild instead of renewing
 * it. Throws when the lease is gone.
 */
export async function refreshHeartbeat(owner: string): Promise<ActivityRollupState | null> {
  const [state] = await db
    .update(activityRollupState)
    .set({ maintainedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(activityRollupState.id, WORKFLOW_ROLLUP_ID),
        eq(activityRollupState.leaseOwner, owner),
        gt(activityRollupState.leaseExpiresAt, sql`now()`),
        gt(activityRollupState.maintainedAt, sql`now() - ${msInterval(MAINTENANCE_GAP_MS)}`)
      )
    )
    .returning()
  if (state) return state
  const current = await readRollupState()
  if (current?.leaseOwner !== owner) throw new Error('Activity rollup lease lost')
  return null
}

/**
 * Pushes the lease out to cover work that may run past the pass's budget (a retry of an hour too
 * heavy to read), while `owner` still holds it.
 */
export async function extendLease(owner: string, ms: number): Promise<void> {
  await updateLeasedState(owner, { leaseExpiresAt: sql`now() + ${msInterval(ms)}` })
}

/**
 * Starts the rollup over at this code's version: every read on any version stops using it at once
 * (coverage is cleared), every piece of progress (backfill, late-end scan, blocked hours, the
 * maintenance heartbeat) is forgotten, and the queues are dropped. Cells are dropped by
 * {@link truncateRollupBatch} before the coverage starts again.
 */
export async function resetRollup(owner: string): Promise<ActivityRollupState> {
  return db.transaction(async (tx) => {
    const state = await updateLeasedState(
      owner,
      {
        version: ACTIVITY_ROLLUP_VERSION,
        coverageStart: null,
        freshThrough: null,
        backfillCompletedAt: null,
        lastEndScan: null,
        housekeepingAt: null,
        maintainedAt: null,
      },
      tx
    )
    await tx.delete(activityRollupDirty)
    await tx.delete(activityRollupInflight)
    await tx.delete(activityRollupBlocked)
    return state
  })
}

const TRUNCATE_BATCH_ROWS = 20_000

/**
 * Deletes one batch of stored cells while the rollup has no coverage. Returns whether any were
 * left to delete. Batched so a large rollup is emptied without one long-running delete.
 */
export async function truncateRollupBatch(): Promise<boolean> {
  const deleted = await db.execute(sql`
    DELETE FROM ${workflowActivityHourly} WHERE ctid = ANY(ARRAY(
      SELECT ctid FROM ${workflowActivityHourly} LIMIT ${TRUNCATE_BATCH_ROWS}
    ))
  `)
  return deleted.count > 0
}
