import { createLogger } from '@sim/logger'
import type { AccessRevokedBroadcast } from '@sim/realtime-protocol/events'
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

export interface AccessRevalidationSweep {
  /** Stop the periodic sweep (clears the interval). */
  stop: () => void
  /** Run one full scan + cleanup pass sequentially. Exposed for deterministic testing. */
  runOnce: () => Promise<void>
}

/**
 * Groups this pod's local sockets by the workflow room each has joined.
 *
 * The workflow room is derived from the socket's own `rooms` set (pod-local, no
 * Redis round-trips): a socket joins exactly one workflow room, so its rooms are
 * `{ ownSocketId, workflowId }`. Only local sockets are evaluated — sockets are
 * sticky to a pod, so every socket is swept by exactly one pod using that pod's
 * warm role cache (mirroring the per-pod reasoning of the write-path cache).
 */
function collectLocalMemberships(io: IRoomManager['io']): Map<string, AuthenticatedSocket[]> {
  const byWorkflow = new Map<string, AuthenticatedSocket[]>()
  for (const socket of io.sockets.sockets.values()) {
    const authed = socket as AuthenticatedSocket
    if (!authed.userId) continue
    for (const room of socket.rooms) {
      if (room === socket.id) continue
      const existing = byWorkflow.get(room)
      if (existing) existing.push(authed)
      else byWorkflow.set(room, [authed])
    }
  }
  return byWorkflow
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
 * enforcement on subsequent ticks.
 */
export function startAccessRevalidationSweep(roomManager: IRoomManager): AccessRevalidationSweep {
  const io = roomManager.io
  let scanRunning = false
  let cleanupRunning = false

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
    const memberships = collectLocalMemberships(io)

    for (const [workflowId, sockets] of memberships) {
      for (const socket of sockets) {
        const userId = socket.userId
        if (!userId) continue

        try {
          const role = await resolveCurrentWorkflowRole(userId, workflowId, FALLBACK_ROLE)
          if (role === null) {
            revokeSocket(socket, workflowId)
          }
        } catch (error) {
          // Never evict on an unexpected error — only a definitive `null` role
          // evicts, so a failure here leaves the socket's access intact.
          logger.warn(
            `Access re-validation failed for user ${userId} on workflow ${workflowId}; leaving membership intact`,
            error
          )
        }
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
