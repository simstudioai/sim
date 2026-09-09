import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { acquireLock, extendLock, releaseLock } from '@/lib/core/config/redis'

const logger = createLogger('TableCascadeLock')

/** Lock TTL. Crashed pods release within this many seconds. */
const LOCK_TTL_SECONDS = 30
/** Heartbeat cadence. ~3x within TTL — tolerates two missed beats. */
const HEARTBEAT_INTERVAL_MS = 10_000

/** Single source of truth for the cascade-lock key shape. The lock arbitrates
 *  ownership of a row's full workflow-group cascade — only the owner advances
 *  the row through its eligible groups. */
export function cascadeLockKey(tableId: string, rowId: string): string {
  return `table:cascade:${tableId}:${rowId}`
}

/**
 * Run `fn` while holding the row's cascade lock, with a heartbeat extending
 * the TTL every 10s so a crashed pod releases the lock in ≤30s. `ownerId`
 * must be unique per holder (typically the cell-task's `executionId`) so
 * `releaseLock` does compare-and-delete and can't accidentally drop another
 * owner's lock.
 *
 * Returns `'acquired'` after `fn` resolves, or `'contended'` if another
 * task already holds the lock — `fn` is NOT invoked in that case. The
 * caller decides what to do on contention (cell-task bails; resume worker
 * still writes the resumed-group's terminal state but skips the cascade).
 *
 * NOTE: when Redis is unavailable, `acquireLock` returns `true` as a
 * single-replica fallback — concurrent cell-tasks would all "acquire" and
 * run in parallel. The cell-write SQL guard mitigates double-writes but
 * doesn't prevent duplicate workflow executions.
 */
export async function withCascadeLock<T>(
  tableId: string,
  rowId: string,
  ownerId: string,
  fn: () => Promise<T>
): Promise<{ status: 'acquired'; result: T } | { status: 'contended' }> {
  const key = cascadeLockKey(tableId, rowId)
  const acquired = await acquireLock(key, ownerId, LOCK_TTL_SECONDS, {
    /**
     * A client-side timeout does not mean Redis declined the SET — the command
     * can still be sitting in the offline queue and take the lock once the
     * connection completes, leaving the row's cascade held for the full TTL by
     * an owner that already threw, with no heartbeat and no release. Every other
     * cell task for that row then reads `contended` and bails on the silent
     * path, so one stalled connection quietly drops later cells too.
     *
     * Both preconditions hold here: `ownerId` is the cell task's `executionId`,
     * unique to this holder, and a throw means `fn` never runs, so freeing a
     * lock this call may have taken cannot cut under a caller still working.
     */
    reclaimOnFailure: true,
  })
  if (!acquired) return { status: 'contended' }

  const heartbeat = setInterval(() => {
    extendLock(key, ownerId, LOCK_TTL_SECONDS).catch((err) => {
      logger.warn(`Heartbeat refresh failed for ${key}`, { error: toError(err).message })
    })
  }, HEARTBEAT_INTERVAL_MS)

  try {
    const result = await fn()
    return { status: 'acquired', result }
  } finally {
    clearInterval(heartbeat)
    await releaseLock(key, ownerId).catch((err) => {
      logger.warn(`Lock release failed for ${key}`, { error: toError(err).message })
    })
  }
}
