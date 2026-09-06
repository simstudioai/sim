import { db } from '@sim/db'
import { knowledgeConnector } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { SYNC_LOCK_HEARTBEAT_INTERVAL_MS } from '@/lib/knowledge/connectors/sync-limits'

/**
 * Raised when a run discovers mid-flight that it no longer holds its sync lock.
 *
 * Stops it doing hours of further work whose terminal write would be rejected,
 * and — more importantly — stops it writing documents concurrently with the
 * replacement run that took the lock.
 */
export class SyncLockLostException extends Error {
  constructor(connectorId: string) {
    super(`Sync lock for connector ${connectorId} was reclaimed during sync`)
    this.name = 'SyncLockLostException'
  }
}

/**
 * Matches the connector row only while this run still holds its sync lock.
 *
 * `status = 'syncing'` alone is not enough: it asserts that *a* run holds the
 * lock, not that *this* run does. Once the scheduler reclaims a stale lock and
 * dispatches a replacement, the replacement sets `syncing` again — so the
 * original run would match, overwrite the replacement's in-flight state and the
 * reclaim's bookkeeping, and then reject the replacement's own write as
 * superseded. The dead run wins and the live one loses, which is worse than the
 * unguarded last-write-wins it replaced.
 *
 * `syncLockToken` is written in the same CAS that takes the lock, so matching it
 * proves the lock is still this run's. `status` is kept alongside as defence in
 * depth and to cover a user pausing the connector mid-run.
 *
 * Guards every write a run makes to its own connector row: both terminal paths
 * and the mid-run heartbeat. The failure path needs it as much as the success
 * path — a reclaimed run's failure would double-increment a counter the sweep
 * already advanced and overwrite its backoff with a shorter one — and reusing it
 * for the heartbeat is what turns a beat into an ownership probe.
 */
export function stillHoldsSyncLock(connectorId: string, syncLockToken: string) {
  return and(holdsSyncLockToken(connectorId, syncLockToken), connectorIsLive())
}

/** The archived/deleted half of {@link stillHoldsSyncLock}. */
export function connectorIsLive() {
  return and(isNull(knowledgeConnector.archivedAt), isNull(knowledgeConnector.deletedAt))
}

/**
 * Ownership only: this run still holds the lock, regardless of whether the
 * connector has since been archived or deleted.
 *
 * The heartbeat guards on this rather than on {@link stillHoldsSyncLock} so a
 * connector deleted mid-sync does not read as lock loss. It would otherwise
 * raise `SyncLockLostException` before `checkSyncTargetPresence` ever ran, skipping
 * the leftover-document cleanup that `ConnectorDeletedException` performs and
 * leaving the sync-log row `started` until the sweep mislabelled it. Deletion is
 * the liveness check's verdict to reach, not the heartbeat's.
 */
export function holdsSyncLockToken(connectorId: string, syncLockToken: string) {
  return and(
    eq(knowledgeConnector.id, connectorId),
    eq(knowledgeConnector.status, 'syncing'),
    eq(knowledgeConnector.syncLockToken, syncLockToken)
  )
}

/** Connector statuses a scheduler may start an automatic run from. */
export const RUNNABLE_CONNECTOR_STATUSES = ['active', 'error'] as const

/**
 * The statuses a run may take the lock from.
 *
 * An allowlist rather than `ne(status, 'syncing')`, because the queue outlives
 * the decision to sync: a connector paused or disabled *after* its run was
 * queued still had a task in flight, and a bare not-syncing test let that task
 * lock the row and then write its own terminal status over the pause. This CAS
 * is the single point where a run decides to start, so it is where the refusal
 * belongs — the dispatch-side guards cannot see a status change that happens
 * after they ran.
 */
export const LOCKABLE_CONNECTOR_STATUSES = ['active', 'error', 'pending'] as const

/**
 * The connector row a run writes when it takes the sync lock.
 *
 * `syncLockToken` is set here, in the same statement as `status`, so ownership
 * and the lock are established atomically — a token written afterwards would
 * leave a window where a terminal write could not identify its own run.
 *
 * `syncLockLeaseAt` opens the lease at the same instant. It is deliberately not
 * `updatedAt`: the reaper reads the lease, and `updatedAt` moves on every
 * unrelated write to the row, so a config edit on a wedged connector used to
 * renew the lock it was meant to recover.
 */
export function buildSyncLockAcquisition(syncLogId: string, now: Date) {
  return {
    status: 'syncing' as const,
    syncLockToken: syncLogId,
    syncLockLeaseAt: now,
    updatedAt: now,
  }
}

/**
 * Whether a running sync is due to refresh its lock.
 *
 * Time-based rather than batch-count-based: batches vary hugely in cost, so an
 * every-N-batches beat would fire constantly on small documents and barely at
 * all on large ones — exactly the runs that need it.
 */
export function shouldHeartbeatSyncLock(
  nowMs: number,
  lastBeatMs: number,
  intervalMs: number = SYNC_LOCK_HEARTBEAT_INTERVAL_MS
): boolean {
  return nowMs - lastBeatMs >= intervalMs
}

/**
 * Extends the connector's lock lease to prove this run is still working, so the
 * scheduler's stale-lock reclaim does not treat a slow-but-live sync as dead.
 *
 * Writes `syncLockLeaseAt` alone and deliberately leaves `updatedAt` untouched:
 * a beat says nothing about the row's contents, and the two columns had to be
 * separated so an unrelated write could stop passing for a heartbeat.
 *
 * Guarded on the run's own lock, so it doubles as an ownership probe: a false
 * return means the lock was reclaimed and this run must stop rather than keep
 * writing alongside its replacement.
 */
async function writeSyncHeartbeat(
  condition: ReturnType<typeof holdsSyncLockToken>
): Promise<boolean> {
  const beat = await db
    .update(knowledgeConnector)
    .set({ syncLockLeaseAt: new Date() })
    .where(condition)
    .returning({ id: knowledgeConnector.id })

  return beat.length > 0
}

export async function heartbeatSyncLock(
  connectorId: string,
  syncLockToken: string
): Promise<boolean> {
  return writeSyncHeartbeat(holdsSyncLockToken(connectorId, syncLockToken))
}

/**
 * Extends the lease only while this run owns a live connector. Destructive
 * follow-up work uses this stricter probe immediately before dispatch so a run
 * reclaimed after its transaction cannot enqueue alongside its replacement.
 */
export async function heartbeatLiveSyncLock(
  connectorId: string,
  syncLockToken: string
): Promise<boolean> {
  return writeSyncHeartbeat(stillHoldsSyncLock(connectorId, syncLockToken))
}

/**
 * The lease a running sync holds on its connector row, as the sync stages see
 * it. The stages never build a lock predicate or a heartbeat themselves, so an
 * engine that leases a different column set supplies its own implementation
 * and the stages stay agnostic about which lock they run under.
 */
export interface SyncRunLease {
  /** Matches the connector row only while this run still owns a live connector. */
  stillHeld: () => ReturnType<typeof stillHoldsSyncLock>
  /**
   * Refreshes the lease if the interval has elapsed, and aborts the run if it
   * has been reclaimed. Called at the top of every unbounded loop in a sync —
   * the time gate makes each call nearly free, so placement only has to
   * guarantee that no unbounded phase runs without reaching one.
   */
  beatIfDue: () => Promise<void>
  /**
   * The stricter probe taken immediately before destructive dispatch: extends
   * the lease only while the connector is still live, and aborts otherwise.
   */
  beatLive: () => Promise<void>
}

/** The lease a document write proves before it lands, as the run that makes it holds it. */
export type SyncWriteLease = Pick<SyncRunLease, 'stillHeld'>

/**
 * Proves, inside the write's own transaction, that the run still owns the
 * connector. A heartbeat taken before the batch only says the lease was held
 * then; the hydration and storage work between it and the row write can
 * outlast the lease. The share lock keeps the scheduler's reclaim from landing
 * until this write commits, and a row that no longer matches aborts the write
 * instead of landing stale content over the replacement run's.
 */
export async function assertSyncLeaseHeldInTx(
  tx: Pick<typeof db, 'select'>,
  connectorId: string,
  lease: SyncWriteLease
): Promise<void> {
  const [held] = await tx
    .select({ id: knowledgeConnector.id })
    .from(knowledgeConnector)
    .where(lease.stillHeld())
    .for('share')
  if (!held) throw new SyncLockLostException(connectorId)
}

/**
 * The lease of the content sync engine, held through `syncLockToken`. The
 * heartbeat clock is seeded at lock acquisition, which opened `syncLockLeaseAt`.
 */
export function createContentSyncLease(connectorId: string, syncLogId: string): SyncRunLease {
  let lastHeartbeatAtMs = Date.now()
  return {
    stillHeld: () => stillHoldsSyncLock(connectorId, syncLogId),
    beatIfDue: async () => {
      if (!shouldHeartbeatSyncLock(Date.now(), lastHeartbeatAtMs)) return
      if (!(await heartbeatSyncLock(connectorId, syncLogId))) {
        throw new SyncLockLostException(connectorId)
      }
      lastHeartbeatAtMs = Date.now()
    },
    beatLive: async () => {
      if (!(await heartbeatLiveSyncLock(connectorId, syncLogId))) {
        throw new SyncLockLostException(connectorId)
      }
      lastHeartbeatAtMs = Date.now()
    },
  }
}

/**
 * The connector statuses a members-mode run may be queued from or take its
 * lease in. The same reasoning as {@link LOCKABLE_CONNECTOR_STATUSES}: the
 * queue outlives the decision to sync, so a connector paused after its member
 * run was dispatched still had a task in flight, and a lease CAS that ignored
 * `status` let that task crawl a paused connector. `pending` is absent because
 * the member lease never coexists with the content queue's entry.
 */
export const MEMBER_LOCKABLE_CONNECTOR_STATUSES = ['active', 'error'] as const

/**
 * Ownership only, for the members-mode lease: this run still holds the
 * member-sync lock, whether or not the connector is still live. The member
 * engine keeps its own lease columns so neither engine can ever misread the
 * other's; `kc_sync_lock_exclusive_check` guarantees they never coexist.
 */
export function holdsMemberSyncLockToken(connectorId: string, memberSyncLockToken: string) {
  return and(
    eq(knowledgeConnector.id, connectorId),
    eq(knowledgeConnector.memberSyncStatus, 'running'),
    eq(knowledgeConnector.memberSyncLockToken, memberSyncLockToken)
  )
}

/** Matches the connector row only while this members-mode run owns a live connector. */
export function stillHoldsMemberSyncLock(connectorId: string, memberSyncLockToken: string) {
  return and(holdsMemberSyncLockToken(connectorId, memberSyncLockToken), connectorIsLive())
}

async function writeMemberSyncHeartbeat(
  condition: ReturnType<typeof holdsMemberSyncLockToken>
): Promise<boolean> {
  const beat = await db
    .update(knowledgeConnector)
    .set({ memberSyncLockLeaseAt: new Date() })
    .where(condition)
    .returning({ id: knowledgeConnector.id })

  return beat.length > 0
}

/**
 * The lease of the members-mode engine, held through `memberSyncLockToken`.
 * Same shape and same guarantees as {@link createContentSyncLease}, over the
 * member columns.
 */
export function createMemberSyncLease(connectorId: string, runId: string): SyncRunLease {
  let lastHeartbeatAtMs = Date.now()
  return {
    stillHeld: () => stillHoldsMemberSyncLock(connectorId, runId),
    beatIfDue: async () => {
      if (!shouldHeartbeatSyncLock(Date.now(), lastHeartbeatAtMs)) return
      if (!(await writeMemberSyncHeartbeat(holdsMemberSyncLockToken(connectorId, runId)))) {
        throw new SyncLockLostException(connectorId)
      }
      lastHeartbeatAtMs = Date.now()
    },
    beatLive: async () => {
      if (!(await writeMemberSyncHeartbeat(stillHoldsMemberSyncLock(connectorId, runId)))) {
        throw new SyncLockLostException(connectorId)
      }
      lastHeartbeatAtMs = Date.now()
    },
  }
}
