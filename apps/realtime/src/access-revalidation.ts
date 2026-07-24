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
 * Non-null fallback used only when a socket has no presence entry to read its
 * join-time role from. It is consumed by {@link resolveCurrentWorkflowRole} only
 * on a transient DB failure with a cold cache, where returning a non-null role
 * (never eviction) is the safe outcome during an outage.
 */
const FALLBACK_ROLE = 'read'

export interface AccessRevalidationSweep {
  /** Stop the periodic sweep (clears the interval). */
  stop: () => void
  /** Run a single sweep pass. Exposed for deterministic testing. */
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
 */
export function startAccessRevalidationSweep(roomManager: IRoomManager): AccessRevalidationSweep {
  const io = roomManager.io
  let running = false

  /**
   * Evictions whose room-state cleanup failed transiently, keyed
   * `${socketId}:${workflowId}`. The evicted socket has already left the
   * Socket.IO room, so membership scans will never see it again — these are
   * retried at the start of every sweep pass until they succeed, so remaining
   * collaborators do not keep a stale presence entry for the evicted socket.
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

      const removed = await roomManager.removeUserFromRoom(socketId, workflowId)
      if (removed === null && currentWorkflowId !== null) {
        // The Redis manager swallows transport errors into null — a live
        // mapping with no reported removal means the removal did not happen.
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

  async function retryPendingCleanups(): Promise<void> {
    for (const [key, { socketId, workflowId }] of pendingCleanups) {
      const liveSocket = io.sockets.sockets.get(socketId)
      if (liveSocket?.rooms.has(workflowId)) {
        // The socket re-joined legitimately after the eviction (access was
        // restored); that join re-added its presence entry, so there is
        // nothing stale left to clean and removal would erase live presence.
        pendingCleanups.delete(key)
        continue
      }
      await cleanupEvictedSocket(socketId, workflowId)
    }
  }

  async function revokeSocket(socket: AuthenticatedSocket, workflowId: string): Promise<void> {
    // Security-critical, pod-local, and synchronous: stop this socket receiving
    // room broadcasts immediately, before any async bookkeeping that could fail.
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

    // Cleanup failure never restores access (the socket already left the room);
    // it defers to pendingCleanups and is retried on subsequent passes.
    await cleanupEvictedSocket(socket.id, workflowId)
  }

  async function runOnce(): Promise<void> {
    await retryPendingCleanups()

    const memberships = collectLocalMemberships(io)

    for (const [workflowId, sockets] of memberships) {
      // One presence read per active workflow supplies each socket's join-time
      // role as the transient-failure fallback (a fallback never evicts).
      const fallbackBySocket = new Map<string, string>()
      try {
        const presence = await roomManager.getWorkflowUsers(workflowId)
        for (const entry of presence) {
          fallbackBySocket.set(entry.socketId, entry.role)
        }
      } catch (error) {
        logger.warn(`Failed to load presence for ${workflowId}; using default fallback role`, error)
      }

      for (const socket of sockets) {
        const userId = socket.userId
        if (!userId) continue

        try {
          const fallbackRole = fallbackBySocket.get(socket.id) ?? FALLBACK_ROLE
          const role = await resolveCurrentWorkflowRole(userId, workflowId, fallbackRole)
          if (role === null) {
            await revokeSocket(socket, workflowId)
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

  const timer = setInterval(() => {
    if (running) {
      logger.warn('Skipping access re-validation sweep; previous sweep still running')
      return
    }
    running = true
    runOnce()
      .catch((error) => logger.error('Access re-validation sweep failed', error))
      .finally(() => {
        running = false
      })
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
