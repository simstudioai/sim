import { createLogger } from '@sim/logger'
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { getWorkflowState } from '@/database/operations'
import { resolveAvatarUrl } from '@/handlers/avatar'
import type { AuthenticatedSocket } from '@/middleware/auth'
import { resolveCurrentWorkflowRole, verifyWorkflowAccess } from '@/middleware/permissions'
import { type IRoomManager, type UserPresence, workflowRoom as wf } from '@/rooms'

const logger = createLogger('WorkflowHandlers')

export function setupWorkflowHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  // Monotonic per-socket generation: each JOIN/LEAVE bumps it synchronously on arrival, and a
  // queued or in-flight op that finds a newer generation aborts — a fast workflow switch A→B thus
  // cancels A the instant B arrives.
  let joinGeneration = 0
  // Serialize this socket's room mutations (JOIN + LEAVE) so their multi-step async Redis commits
  // can never interleave: two concurrent joins would otherwise race on the single-valued
  // socket→room map (a late addUserToRoom clobbering a newer join's entry, leaving the socket a
  // ghost in the old room and receiving its operation broadcasts). This matches the sibling
  // handlers (tables, file-doc, workspace-files).
  let opChain: Promise<void> = Promise.resolve()

  socket.on('join-workflow', ({ workflowId, tabSessionId }) => {
    const joinAttempt = (joinGeneration += 1)
    opChain = opChain
      .then(() => runJoin(workflowId, tabSessionId, joinAttempt))
      .catch((error) => logger.error('Error joining workflow:', error))
    // Returned so callers awaiting this op (e.g. tests) can await its completion; Socket.IO
    // ignores a handler's return value.
    return opChain
  })

  async function runJoin(
    workflowId: string,
    tabSessionId: string | undefined,
    joinAttempt: number
  ) {
    // True once this JOIN has been superseded — a newer JOIN/LEAVE bumped joinGeneration, or the
    // socket disconnected. Because ops are serialized, no other op mutates room state while this
    // one runs, so only two checks are needed: skip a superseded queued op (here), and one final
    // check right before the membership commit.
    const superseded = () => joinGeneration !== joinAttempt || socket.disconnected
    if (superseded()) return
    try {
      const userId = socket.userId
      const userName = socket.userName

      if (!userId || !userName) {
        logger.warn(`Join workflow rejected: Socket ${socket.id} not authenticated`)
        socket.emit('join-workflow-error', {
          workflowId,
          error: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED',
          retryable: false,
        })
        return
      }

      if (!roomManager.isReady()) {
        logger.warn(`Join workflow rejected: Room manager unavailable`)
        socket.emit('join-workflow-error', {
          workflowId,
          error: 'Realtime unavailable',
          code: 'ROOM_MANAGER_UNAVAILABLE',
          retryable: true,
        })
        return
      }

      logger.info(`Join workflow request from ${userId} (${userName}) for workflow ${workflowId}`)

      // Verify workflow access
      let userRole: string
      try {
        const accessInfo = await verifyWorkflowAccess(userId, workflowId)
        if (!accessInfo.hasAccess) {
          logger.warn(`User ${userId} (${userName}) denied access to workflow ${workflowId}`)
          socket.emit('join-workflow-error', {
            workflowId,
            error: 'Access denied to workflow',
            code: 'ACCESS_DENIED',
            retryable: false,
          })
          return
        }
        userRole = accessInfo.role || 'read'
      } catch (error) {
        logger.warn(`Error verifying workflow access for ${userId}:`, error)
        socket.emit('join-workflow-error', {
          workflowId,
          error: 'Failed to verify workflow access',
          code: 'VERIFY_WORKFLOW_ACCESS_FAILED',
          retryable: true,
        })
        return
      }

      // Leave current workflow room if in one
      const currentRoom = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.WORKFLOW)
      if (currentRoom) {
        socket.leave(currentRoom.id)
        await roomManager.removeUserFromRoom(currentRoom, socket.id)
        await roomManager.broadcastPresenceUpdate(currentRoom)
      }

      // Keep this above Redis socket key TTL (1h) so a normal idle user is not evicted too aggressively.
      const STALE_THRESHOLD_MS = 75 * 60 * 1000
      const now = Date.now()
      const existingUsers = await roomManager.getRoomUsers(wf(workflowId))
      let liveSocketIds = new Set<string>()
      let canCheckLiveness = false

      try {
        const liveSockets = await roomManager.io.in(workflowId).fetchSockets()
        liveSocketIds = new Set(liveSockets.map((liveSocket) => liveSocket.id))
        canCheckLiveness = true
      } catch (error) {
        logger.warn(
          `Skipping stale cleanup for ${workflowId} due to live socket lookup failure`,
          error
        )
      }

      for (const existingUser of existingUsers) {
        try {
          if (existingUser.socketId === socket.id) {
            continue
          }

          const isSameTab = Boolean(
            existingUser.userId === userId &&
              tabSessionId &&
              existingUser.tabSessionId === tabSessionId
          )

          if (isSameTab) {
            logger.info(
              `Cleaning up socket ${existingUser.socketId} for user ${existingUser.userId} (same tab)`
            )
            await roomManager.removeUserFromRoom(wf(workflowId), existingUser.socketId)
            await roomManager.io.in(existingUser.socketId).socketsLeave(workflowId)
            continue
          }

          if (!canCheckLiveness || liveSocketIds.has(existingUser.socketId)) {
            continue
          }

          const isStaleByActivity =
            now - (existingUser.lastActivity || existingUser.joinedAt || 0) > STALE_THRESHOLD_MS
          if (!isStaleByActivity) {
            continue
          }

          logger.info(
            `Cleaning up socket ${existingUser.socketId} for user ${existingUser.userId} (stale activity)`
          )
          await roomManager.removeUserFromRoom(wf(workflowId), existingUser.socketId)
          await roomManager.io.in(existingUser.socketId).socketsLeave(workflowId)
        } catch (error) {
          logger.warn(`Best-effort cleanup failed for socket ${existingUser.socketId}`, error)
        }
      }

      // Resolve the avatar before the critical section below. It is the only
      // await that used to sit between socket.join and addUserToRoom, and a sweep
      // eviction in that gap would socketsLeave the socket while its presence
      // mapping did not yet exist — cleanupEvictedSocket would find nothing to
      // remove, then this join would write presence for a socket already out of
      // the room (a ghost collaborator until the stale sweep). Hoisting it keeps
      // the whole re-auth -> socket.join -> addUserToRoom section await-free.
      const avatarUrl = await resolveAvatarUrl(socket, userId)

      // Re-authorize immediately before joining: the access-revalidation sweep
      // may have evicted this socket while the awaits above were in flight, and
      // its eviction is recorded in the shared role cache before it runs — so a
      // revoked user resolves to null here. The resolver is single-flighted per
      // (user, workflow), so this read cannot race the sweep's and overwrite a
      // recorded revocation with a stale role; and no awaits sit between this
      // check and addUserToRoom (avatar resolution is hoisted above), so a sweep
      // eviction cannot interleave inside the join and be reversed by it.
      const currentRole = await resolveCurrentWorkflowRole(userId, workflowId, userRole)
      if (currentRole === null) {
        logger.warn(
          `User ${userId} (${userName}) lost access to workflow ${workflowId} before join completed`
        )
        socket.emit('join-workflow-error', {
          workflowId,
          error: 'Access denied to workflow',
          code: 'ACCESS_DENIED',
          retryable: false,
        })
        return
      }
      userRole = currentRole

      // Final re-check before the membership commit: a LEAVE or a newer JOIN enqueued during the
      // awaits above bumped the generation, or the socket disconnected. Abort before registering.
      // (This guards against a superseding op; the avatar hoist above guards against the off-chain
      // access-revalidation sweep, which does not bump the generation.)
      if (superseded()) return

      // Join the new room
      socket.join(workflowId)

      // Create presence entry
      const userPresence: UserPresence = {
        userId,
        room: wf(workflowId),
        userName,
        socketId: socket.id,
        tabSessionId,
        joinedAt: Date.now(),
        lastActivity: Date.now(),
        role: userRole,
        avatarUrl,
      }

      // Add user to room
      await roomManager.addUserToRoom(wf(workflowId), socket.id, userPresence)

      // Get current presence list for the join acknowledgment
      const presenceUsers = await roomManager.getRoomUsers(wf(workflowId))

      // Get workflow state
      const workflowState = await getWorkflowState(workflowId)

      // Send join success with presence list (client waits for this to confirm join)
      socket.emit('join-workflow-success', {
        workflowId,
        socketId: socket.id,
        presenceUsers,
      })

      // Send workflow state
      socket.emit('workflow-state', workflowState)

      // Broadcast presence update to all users in the room
      await roomManager.broadcastPresenceUpdate(wf(workflowId))

      const uniqueUserCount = await roomManager.getUniqueUserCount(wf(workflowId))
      logger.info(
        `User ${userId} (${userName}) joined workflow ${workflowId}. Room now has ${uniqueUserCount} unique users.`
      )
    } catch (error) {
      logger.error('Error joining workflow:', error)
      // Always roll back a partial join: cleanup keys off the socket→room map, so a `socket.join`
      // that landed without a matching `addUserToRoom` (a throw in between) would otherwise strand
      // the socket in the Socket.IO room, unreclaimable by any later op. Safe even when superseded —
      // serialization means the newer op hasn't committed yet, so this touches only this join's own
      // room state, never the newer op's.
      socket.leave(workflowId)
      await roomManager.removeUserFromRoom(wf(workflowId), socket.id)
      const isReady = roomManager.isReady()
      socket.emit('join-workflow-error', {
        workflowId,
        error: isReady ? 'Failed to join workflow' : 'Realtime unavailable',
        code: isReady ? 'JOIN_WORKFLOW_FAILED' : 'ROOM_MANAGER_UNAVAILABLE',
        retryable: true,
      })
    }
  }

  socket.on('leave-workflow', () => {
    // A leave always cancels any in-flight/queued join for this socket (the client emits it with no
    // payload — there is no partial-switch case as there is for tables). Bumped synchronously here,
    // before the teardown is enqueued, so it cancels a running join at its next generation check.
    joinGeneration += 1
    opChain = opChain
      .then(() => runLeave())
      .catch((error) => logger.error('Error leaving workflow:', error))
    return opChain
  })

  async function runLeave() {
    try {
      if (!roomManager.isReady()) return
      const room = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.WORKFLOW)
      // The room ref alone is sufficient to leave; no session lookup is gated in front of it, so an
      // idle user whose 1h session key expired (while the 24h room mapping is still live) can still
      // leave cleanly instead of being stranded as a ghost until disconnect.
      if (!room) return
      socket.leave(room.id)
      await roomManager.removeUserFromRoom(room, socket.id)
      await roomManager.broadcastPresenceUpdate(room)
      logger.info(`User ${socket.userId} (${socket.userName}) left workflow ${room.id}`)
    } catch (error) {
      logger.error('Error leaving workflow:', error)
    }
  }
}
