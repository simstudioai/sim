import { createLogger } from '@sim/logger'
import type { AccessRevokedBroadcast } from '@sim/realtime-protocol/events'
import { sleep } from '@sim/utils/helpers'
import type { AuthenticatedSocket } from '@/middleware/auth'
import { ROLE_REVALIDATION_TTL_MS, resolveCurrentWorkflowRole } from '@/middleware/permissions'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('AccessRevalidation')

/**
 * How often each pod re-validates live read access for its connected sockets.
 *
 * Coupled to {@link ROLE_REVALIDATION_TTL_MS} — the same per-pod role cache and
 * TTL that already bound *write* revocation — so a collaborator whose workspace
 * permission is removed loses live *reads* within a comparable window instead of
 * retaining them until they disconnect. Detection latency is one cache TTL plus
 * up to one sweep interval (the sweep keeps seeing the cached non-null role
 * until it expires), so ~30s typical and bounded well under a minute worst case.
 */
export const ACCESS_REVALIDATION_SWEEP_INTERVAL_MS = ROLE_REVALIDATION_TTL_MS

/**
 * Non-null fallback consumed by {@link resolveCurrentWorkflowRole} only on a
 * transient DB failure with a cold cache, where returning a non-null role
 * (never eviction) is the safe outcome during an outage. The scan deliberately
 * does not read presence for a per-socket join-time role: that would put a
 * Redis dependency inside the security-critical scan lane, and the fallback's
 * only job is to be non-null.
 */
const FALLBACK_ROLE = 'read'

/**
 * Upper bound on a single socket's authorization check inside the scan. A DB
 * query that hangs (wedged connection, exhausted pool, network partition) must
 * not wedge the scan lane — on timeout the socket is skipped for this pass
 * (never evicted) and re-checked next pass, where the single-flighted
 * resolution is re-raced and acted on once it finally settles.
 */
const SCAN_SOCKET_TIMEOUT_MS = 5_000

/**
 * Hard budget for one whole scan pass, deliberately below
 * {@link ACCESS_REVALIDATION_SWEEP_INTERVAL_MS} so `scanRunning` can never
 * starve subsequent ticks: a pass that runs out of budget ends early and the
 * remaining sockets are evaluated on the next pass.
 */
const SCAN_PASS_BUDGET_MS = 20_000

const SCAN_TIMED_OUT = Symbol('scan-timed-out')

export interface AccessRevalidationSweep {
  /** Stop the periodic sweep (clears the interval). */
  stop: () => void
  /** Run one full scan + cleanup pass sequentially. Exposed for deterministic testing. */
  runOnce: () => Promise<void>
}

interface ScanTarget {
  workflowId: string
  socket: AuthenticatedSocket
  userId: string
}

/**
 * Collects this pod's authenticated sockets with the workflow room each has
 * joined, in stable socket order.
 *
 * The workflow room is derived from the socket's own `rooms` set (pod-local, no
 * Redis round-trips): a socket joins exactly one workflow room, so its rooms are
 * `{ ownSocketId, workflowId }`. Only local sockets are evaluated — sockets are
 * sticky to a pod, so every socket is swept by exactly one pod using that pod's
 * warm role cache (mirroring the per-pod reasoning of the write-path cache).
 */
function collectScanTargets(io: IRoomManager['io']): ScanTarget[] {
  const targets: ScanTarget[] = []
  for (const socket of io.sockets.sockets.values()) {
    const authed = socket as AuthenticatedSocket
    if (!authed.userId) continue
    for (const room of socket.rooms) {
      if (room === socket.id) continue
      targets.push({ workflowId: room, socket: authed, userId: authed.userId })
    }
  }
  return targets
}

/**
 * Starts a per-pod loop that re-validates every connected socket's workspace
 * role and evicts sockets whose access has been revoked, closing the read-side
 * gap left by the join-only access check.
 *
 * Blip-safety: eviction fires *only* when {@link resolveCurrentWorkflowRole}
 * returns `null`, which happens solely for a successful DB "no access" result or
 * a previously-recorded revocation reused across a failure. A transient DB error
 * against a still-authorized (or freshly-joined) user resolves to the last-known
 * or fallback role, so a database blip never evicts anyone.
 *
 * Liveness: the loop runs as two independently-guarded lanes. The security scan
 * (local sockets + DB role checks + emit/leave) touches no Redis at all; the
 * best-effort room-state cleanup (Redis presence) runs in its own lane. A Redis
 * outage — including commands that hang in the client's offline queue rather
 * than failing — can therefore stall only presence cleanup, never revocation
 * enforcement on subsequent ticks. Within the scan, every authorization wait is
 * bounded ({@link SCAN_SOCKET_TIMEOUT_MS}) and the whole pass has a hard budget
 * below the interval ({@link SCAN_PASS_BUDGET_MS}), so a hanging DB query can
 * delay a socket's re-check but can never wedge the scan lane itself.
 */
export function startAccessRevalidationSweep(roomManager: IRoomManager): AccessRevalidationSweep {
  const io = roomManager.io
  let scanRunning = false
  let cleanupRunning = false
  /**
   * Round-robin cursor: the `${socketId}:${workflowId}` key of the last target
   * the previous pass processed. Each pass resumes after it, so a fixed prefix
   * of hanging authorization checks can never starve the sockets behind it —
   * every target is examined within a bounded number of passes.
   */
  let scanCursorKey: string | null = null

  /**
   * Room-state cleanups owed for evicted sockets, keyed
   * `${socketId}:${workflowId}`. Every eviction enqueues here (the evicted
   * socket has already left the Socket.IO room, so membership scans will never
   * see it again); the cleanup lane drains the queue until each removal is
   * confirmed, so remaining collaborators do not keep a stale presence entry.
   */
  const pendingCleanups = new Map<string, { socketId: string; workflowId: string }>()

  async function cleanupEvictedSocket(socketId: string, workflowId: string): Promise<void> {
    const key = `${socketId}:${workflowId}`
    try {
      // Unlike removeUserFromRoom, this read does not swallow transport errors,
      // so a Redis outage lands in the catch below and defers the cleanup.
      const currentWorkflowId = await roomManager.getWorkflowIdForSocket(socketId)
      if (currentWorkflowId !== null && currentWorkflowId !== workflowId) {
        // The socket has since moved to a different workflow it can still
        // access; that join's room switch already removed this room's presence
        // entry, so there is nothing stale left to clean here.
        pendingCleanups.delete(key)
        return
      }

      // Synchronous re-join guard with no awaits before the removal: if the
      // socket legitimately re-joined this room after the eviction (access
      // restored), that join re-added its presence — removal would erase it.
      if (io.sockets.sockets.get(socketId)?.rooms.has(workflowId)) {
        pendingCleanups.delete(key)
        return
      }

      const removed = await roomManager.removeUserFromRoom(socketId, workflowId)
      if (removed === null) {
        // The sweep always passes the target room, and both managers report a
        // performed removal by returning it — the Redis manager swallows
        // transport errors into null, so null means the removal did not happen
        // (even when the socket's mapping keys have already expired).
        throw new Error('room-state removal not confirmed')
      }

      await roomManager.broadcastPresenceUpdate(workflowId)
      pendingCleanups.delete(key)
    } catch (error) {
      pendingCleanups.set(key, { socketId, workflowId })
      logger.warn(
        `Room-state cleanup failed for evicted socket ${socketId} on ${workflowId}; will retry next sweep`,
        error
      )
    }
  }

  async function drainPendingCleanups(): Promise<void> {
    for (const [, { socketId, workflowId }] of pendingCleanups) {
      await cleanupEvictedSocket(socketId, workflowId)
    }
  }

  /**
   * Launches the cleanup lane unless it is already running or has nothing to
   * do. Never awaited by the scan lane: a Redis command hanging in the client's
   * offline queue stalls only this lane, never revocation enforcement.
   */
  function launchCleanups(): void {
    if (cleanupRunning || pendingCleanups.size === 0) {
      return
    }
    cleanupRunning = true
    drainPendingCleanups()
      .catch((error) => logger.error('Deferred eviction cleanup failed', error))
      .finally(() => {
        cleanupRunning = false
      })
  }

  function revokeSocket(socket: AuthenticatedSocket, workflowId: string): void {
    // Security-critical, pod-local, and synchronous: stop this socket receiving
    // room broadcasts immediately. Room-state cleanup is only enqueued here —
    // the cleanup lane performs the Redis work, so eviction never blocks on it.
    const payload: AccessRevokedBroadcast = {
      workflowId,
      message: 'Your access to this workflow has been revoked',
      timestamp: Date.now(),
    }
    socket.emit('access-revoked', payload)
    socket.leave(workflowId)

    logger.info(
      `Revoked live access for user ${socket.userId} on workflow ${workflowId} (socket ${socket.id})`
    )

    pendingCleanups.set(`${socket.id}:${workflowId}`, { socketId: socket.id, workflowId })
  }

  async function scanMemberships(): Promise<void> {
    const targets = collectScanTargets(io)
    if (targets.length === 0) return

    let startIndex = 0
    if (scanCursorKey !== null) {
      const cursorIndex = targets.findIndex(
        ({ socket, workflowId }) => `${socket.id}:${workflowId}` === scanCursorKey
      )
      if (cursorIndex !== -1) {
        startIndex = (cursorIndex + 1) % targets.length
      }
    }

    const deadline = Date.now() + SCAN_PASS_BUDGET_MS

    for (let offset = 0; offset < targets.length; offset++) {
      const { workflowId, socket, userId } = targets[(startIndex + offset) % targets.length]

      const remainingBudget = deadline - Date.now()
      if (remainingBudget <= 0) {
        logger.warn(
          'Access re-validation scan budget exhausted; remaining sockets defer to the next pass'
        )
        return
      }

      try {
        // Bounded wait: a hanging authorization query skips this socket for
        // the pass instead of wedging the scan lane. The single-flighted
        // resolution keeps running in the background and is re-raced when the
        // rotation returns to this socket, so it is acted on once it settles.
        const role = await Promise.race([
          resolveCurrentWorkflowRole(userId, workflowId, FALLBACK_ROLE),
          sleep(Math.min(SCAN_SOCKET_TIMEOUT_MS, remainingBudget)).then(() => SCAN_TIMED_OUT),
        ])
        if (role === SCAN_TIMED_OUT) {
          logger.warn(
            `Authorization check timed out for user ${userId} on workflow ${workflowId}; skipping this pass`
          )
        } else if (role === null) {
          revokeSocket(socket, workflowId)
        }
      } catch (error) {
        // Never evict on an unexpected error — only a definitive `null` role
        // evicts, so a failure here leaves the socket's access intact.
        logger.warn(
          `Access re-validation failed for user ${userId} on workflow ${workflowId}; leaving membership intact`,
          error
        )
      } finally {
        scanCursorKey = `${socket.id}:${workflowId}`
      }
    }
  }

  async function runOnce(): Promise<void> {
    await scanMemberships()
    if (!cleanupRunning && pendingCleanups.size > 0) {
      cleanupRunning = true
      try {
        await drainPendingCleanups()
      } finally {
        cleanupRunning = false
      }
    }
  }

  const timer = setInterval(() => {
    if (scanRunning) {
      logger.warn('Skipping access re-validation scan; previous scan still running')
    } else {
      scanRunning = true
      scanMemberships()
        .catch((error) => logger.error('Access re-validation scan failed', error))
        .finally(() => {
          scanRunning = false
          // Freshly-enqueued evictions get their cleanup promptly rather than
          // waiting a full interval.
          launchCleanups()
        })
    }
    launchCleanups()
  }, ACCESS_REVALIDATION_SWEEP_INTERVAL_MS)

  // Do not keep the process alive solely for this timer.
  timer.unref?.()

  logger.info(
    `Access re-validation sweep started (every ${ACCESS_REVALIDATION_SWEEP_INTERVAL_MS}ms)`
  )

  return {
    stop: () => clearInterval(timer),
    runOnce,
  }
}
