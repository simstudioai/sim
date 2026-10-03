import { createLogger } from '@sim/logger'
import { ROOM_MEMBERSHIP_ACTIONS, satisfiesRoomMembership } from '@sim/platform-authz/room-policy'
import type { AccessRevokedBroadcast } from '@sim/realtime-protocol/events'
import {
  parseRoomName,
  ROOM_TYPES,
  type RoomRef,
  type RoomType,
  roomName,
} from '@sim/realtime-protocol/rooms'
import { sleep } from '@sim/utils/helpers'
import {
  evictSocketFromRoom,
  runRoomEvictionHandler,
  setEvictionCleanupSink,
} from '@/handlers/room-eviction'
import type { AuthenticatedSocket } from '@/middleware/auth'
import { ROLE_REVALIDATION_TTL_MS, resolveCurrentRoomPermission } from '@/middleware/permissions'
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
 * Fallback consumed by {@link resolveCurrentRoomPermission} only on a transient DB
 * failure with a cold cache, where resolving to a permission that KEEPS the socket
 * (never eviction) is the safe outcome during an outage. It is the room's own
 * membership level, so it satisfies that room's requirement exactly — a static
 * `'read'` would have evicted every file-doc socket (which needs `write`) on a cold
 * cache blip. The scan deliberately does not read presence for a per-socket
 * join-time role: that would put a Redis dependency inside the security-critical
 * scan lane, and the fallback's only job is to be permissive.
 */
function fallbackRoleFor(type: RoomType): string {
  return ROOM_MEMBERSHIP_ACTIONS[type]
}

/**
 * Room types whose membership is mirrored in the room manager's (Redis) presence
 * state, and therefore need a presence removal + rebroadcast after an eviction.
 * The workspace-files / workspace-tables invalidation rooms carry no presence at
 * all, and a file-doc room's roster is pod-local in-memory state reconciled by its
 * registered eviction handler — neither has anything for the cleanup lane to do.
 */
const PRESENCE_ROOM_TYPES: ReadonlySet<RoomType> = new Set<RoomType>([
  ROOM_TYPES.WORKFLOW,
  ROOM_TYPES.TABLE,
])

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
  room: RoomRef
  /** The Socket.IO room name — the key the socket actually holds. */
  name: string
  socket: AuthenticatedSocket
  userId: string
}

/**
 * Collects this pod's authenticated sockets paired with EVERY room each has
 * joined, in stable socket order.
 *
 * Rooms are derived from the socket's own `rooms` set (pod-local, no Redis
 * round-trips). A socket may occupy several rooms of different types at once
 * (workflow canvas, workspace-files browser, table, file-doc), all on the same io
 * — so each name is decoded with {@link parseRoomName} and swept as its own type.
 * Decoding (rather than assuming workflow) is what makes this safe: a namespaced
 * `type:id` name resolves to the right resource, so it is authorized against that
 * resource's workspace instead of resolving a bogus workflow permission.
 *
 * Only local sockets are evaluated — sockets are sticky to a pod, so every socket
 * is swept by exactly one pod using that pod's warm role cache (mirroring the
 * per-pod reasoning of the write-path cache).
 */
function collectScanTargets(io: IRoomManager['io']): ScanTarget[] {
  const targets: ScanTarget[] = []
  for (const socket of io.sockets.sockets.values()) {
    const authed = socket as AuthenticatedSocket
    if (!authed.userId) continue
    for (const name of socket.rooms) {
      if (name === socket.id) continue
      const ref = parseRoomName(name)
      if (!ref) continue
      targets.push({ room: ref, name, socket: authed, userId: authed.userId })
    }
  }
  return targets
}

/**
 * Starts a per-pod loop that re-validates every connected socket's workspace
 * permission — for EVERY room type it occupies — and evicts sockets whose access
 * no longer satisfies the room, closing the gap left by the join-only access
 * check. Without it, a member removed or downgraded mid-session keeps live
 * collaborative access (including durable document writes) for the whole lifetime
 * of an already-open socket.
 *
 * Blip-safety: eviction fires *only* when {@link resolveCurrentRoomPermission}
 * resolves to a permission that does not satisfy the room's membership level,
 * which happens solely for a successful DB result (no access, or a level below
 * the room's requirement) or a previously-recorded revocation reused across a
 * failure. A transient DB error against a still-authorized (or freshly-joined)
 * user resolves to the last-known or the room's own fallback level, so a database
 * blip never evicts anyone.
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
   * Round-robin cursor: the `${socketId}:${roomName}` key of the last target
   * the previous pass processed. Each pass resumes after it, so a fixed prefix
   * of hanging authorization checks can never starve the sockets behind it —
   * every target is examined within a bounded number of passes.
   */
  let scanCursorKey: string | null = null

  /**
   * Presence cleanups owed for evicted sockets, keyed `${socketId}:${roomName}`.
   * Every eviction from a presence-backed room enqueues here (the evicted socket
   * has already left the Socket.IO room, so membership scans will never see it
   * again); the cleanup lane drains the queue until each removal is confirmed, so
   * remaining collaborators do not keep a stale presence entry.
   */
  const pendingCleanups = new Map<string, { socketId: string; room: RoomRef }>()

  async function cleanupEvictedSocket(socketId: string, room: RoomRef): Promise<void> {
    const name = roomName(room)
    const key = `${socketId}:${name}`
    try {
      // A fully-disconnected socket already had its presence removed by the
      // disconnect handler (removeSocketFromAllRooms), so there is nothing left to
      // clean. Dropping here also keeps the boolean removeUserFromRoom below from
      // reporting a false "not a member" for an already-gone entry and retrying it
      // forever (the pre-generalization manager returned the target on a no-op).
      if (!io.sockets.sockets.get(socketId)) {
        pendingCleanups.delete(key)
        return
      }

      // Unlike removeUserFromRoom, this read does not swallow transport errors,
      // so a Redis outage lands in the catch below and defers the cleanup. The
      // lookup is per room TYPE (a socket holds at most one room of each), so a
      // socket that also sits in an unrelated room type is unaffected.
      const currentRoom = await roomManager.getRoomForSocket(socketId, room.type)
      const currentRoomId = currentRoom?.id ?? null
      if (currentRoomId !== null && currentRoomId !== room.id) {
        // The socket has since moved to a different room of this type that it can
        // still access; that join's room switch already removed this room's
        // presence entry, so there is nothing stale left to clean here.
        pendingCleanups.delete(key)
        return
      }

      // Synchronous re-join guard with no awaits before the removal: if the
      // socket legitimately re-joined this room after the eviction (access
      // restored), that join re-added its presence — removal would erase it.
      if (io.sockets.sockets.get(socketId)?.rooms.has(name)) {
        pendingCleanups.delete(key)
        return
      }

      // A null mapping here is the normal case (the socket's mapping key may have
      // expired) and does NOT mean "skip" — the eviction still removes the presence
      // entry from the known target room via the explicit ref below.
      const removed = await roomManager.removeUserFromRoom(room, socketId)
      if (!removed) {
        // `false` conflates two outcomes: the entry was already gone (a no-op), or a
        // transport error the manager swallowed. Only retry when the socket is still mapped
        // to THIS room — then a false result is a genuine, deferrable failure. When a healthy
        // getRoomForSocket above returned no workflow mapping (`currentWorkflowId === null`),
        // the presence entry is already gone, so the cleanup is complete: dropping it avoids
        // re-enqueuing a still-connected socket forever. (A real Redis outage throws at
        // getRoomForSocket and is deferred by the outer catch, never reaching here.)
        if (currentRoomId === room.id) {
          throw new Error('room-state removal not confirmed')
        }
        pendingCleanups.delete(key)
        return
      }

      await roomManager.broadcastPresenceUpdate(room)
      pendingCleanups.delete(key)
    } catch (error) {
      pendingCleanups.set(key, { socketId, room })
      logger.warn(
        `Room-state cleanup failed for evicted socket ${socketId} on ${name}; will retry next sweep`,
        error
      )
    }
  }

  async function drainPendingCleanups(): Promise<void> {
    for (const [, { socketId, room }] of pendingCleanups) {
      await cleanupEvictedSocket(socketId, room)
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

  // Handler-initiated evictions (the per-frame gates) hand failed presence cleanups
  // here: they have already left the Socket.IO room, so the scan can no longer
  // rediscover them, and this lane is the only thing that retries.
  setEvictionCleanupSink((socketId, room) => {
    pendingCleanups.set(`${socketId}:${roomName(room)}`, { socketId, room })
    launchCleanups()
  })

  function revokeSocket(socket: AuthenticatedSocket, room: RoomRef, name: string): void {
    // Security-critical, pod-local, and synchronous: stop this socket receiving
    // room broadcasts immediately, and drop the handler-local state that would
    // otherwise still accept its frames (a file-doc socket's room binding is what
    // gates its document writes). Redis presence cleanup is only ENQUEUED here —
    // the cleanup lane performs that work, so eviction never blocks on it.
    if (room.type === ROOM_TYPES.WORKFLOW) {
      // Workflow keeps its historical wire event and payload shape, which existing
      // clients key off `workflowId`; every other type shares the generic path.
      const payload: AccessRevokedBroadcast = {
        workflowId: room.id,
        message: 'Your access to this workflow has been revoked',
        timestamp: Date.now(),
      }
      socket.emit('access-revoked', payload)
      socket.leave(name)
      runRoomEvictionHandler(socket.id, room, io)
      logger.info(`Revoked live access for user ${socket.userId} on ${name} (socket ${socket.id})`)
    } else {
      evictSocketFromRoom(socket, room, 'Your access to this resource has been revoked', io)
    }

    if (PRESENCE_ROOM_TYPES.has(room.type)) {
      pendingCleanups.set(`${socket.id}:${name}`, { socketId: socket.id, room })
    }
  }

  async function scanMemberships(): Promise<void> {
    const targets = collectScanTargets(io)
    if (targets.length === 0) return

    let startIndex = 0
    if (scanCursorKey !== null) {
      const cursorIndex = targets.findIndex(
        ({ socket, name }) => `${socket.id}:${name}` === scanCursorKey
      )
      if (cursorIndex !== -1) {
        startIndex = (cursorIndex + 1) % targets.length
      }
    }

    const deadline = Date.now() + SCAN_PASS_BUDGET_MS

    for (let offset = 0; offset < targets.length; offset++) {
      const { room, name, socket, userId } = targets[(startIndex + offset) % targets.length]

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
          resolveCurrentRoomPermission(userId, room, fallbackRoleFor(room.type)),
          sleep(Math.min(SCAN_SOCKET_TIMEOUT_MS, remainingBudget)).then(() => SCAN_TIMED_OUT),
        ])
        // {@link SCAN_TIMED_OUT} is the only symbol this race can yield; matching on
        // the type narrows it out of the permission comparison below.
        if (typeof role === 'symbol') {
          logger.warn(
            `Authorization check timed out for user ${userId} on ${name}; skipping this pass`
          )
        } else if (!satisfiesRoomMembership(role, room.type)) {
          // Covers both revocation (`null`) and downgrade below the level this room
          // requires — a member dropped to `read` may keep a table room but not the
          // collaborative document editor, exactly as at join time.
          revokeSocket(socket, room, name)
        }
      } catch (error) {
        // Never evict on an unexpected error — only a definitive resolved permission
        // evicts, so a failure here leaves the socket's access intact.
        logger.warn(
          `Access re-validation failed for user ${userId} on ${name}; leaving membership intact`,
          error
        )
      } finally {
        scanCursorKey = `${socket.id}:${name}`
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
    stop: () => {
      clearInterval(timer)
      setEvictionCleanupSink(null)
    },
    runOnce,
  }
}
