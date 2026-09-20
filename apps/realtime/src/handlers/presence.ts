import { createLogger } from '@sim/logger'
import type { CursorPosition, PresenceSelection } from '@sim/realtime-protocol/events'
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('PresenceHandlers')

/** Longest accepted selection id — real ids are UUIDs/short ids; this bounds a hostile payload. */
const MAX_SELECTION_ID_LENGTH = 200

/** The selection kinds a client may publish, mirroring {@link PresenceSelection}. */
const SELECTION_TYPES = new Set<PresenceSelection['type']>(['block', 'edge', 'none'])

/**
 * Validate + whitelist an untrusted peer's cursor before it is stored and rebroadcast.
 * Returns the normalized position — `null` for a legitimately cleared cursor — or
 * `undefined` for anything malformed, so the caller drops it. Only `x`/`y` survive, so a
 * hostile client can't amplify an oversized object through the room or the presence record.
 */
function normalizeCursor(cursor: unknown): CursorPosition | null | undefined {
  if (cursor === null) return null
  if (typeof cursor !== 'object') return undefined
  const candidate = cursor as { x?: unknown; y?: unknown }
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return undefined
  return { x: candidate.x as number, y: candidate.y as number }
}

/**
 * Validate + whitelist an untrusted peer's selection before it is stored and rebroadcast.
 * Returns the normalized selection, or `undefined` for anything malformed, so the caller
 * drops it. A cleared selection is expressed as `type: 'none'`, not `null`. Rebuilding from
 * a fixed field set means unexpected keys can't ride along into the shared presence record.
 */
function normalizeSelection(selection: unknown): PresenceSelection | undefined {
  if (typeof selection !== 'object' || selection === null) return undefined
  const candidate = selection as { type?: unknown; id?: unknown }
  if (!SELECTION_TYPES.has(candidate.type as PresenceSelection['type'])) return undefined
  if (
    candidate.id !== undefined &&
    (typeof candidate.id !== 'string' || candidate.id.length > MAX_SELECTION_ID_LENGTH)
  ) {
    return undefined
  }
  return {
    type: candidate.type as PresenceSelection['type'],
    ...(typeof candidate.id === 'string' ? { id: candidate.id } : {}),
  }
}

export function setupPresenceHandlers(socket: AuthenticatedSocket, roomManager: IRoomManager) {
  socket.on('cursor-update', async ({ cursor: rawCursor }: { cursor: unknown }) => {
    try {
      // Drop a malformed/oversized cursor from an untrusted peer before it is stored or
      // rebroadcast (`undefined` = invalid; `null` = a legitimately cleared cursor).
      const cursor = normalizeCursor(rawCursor)
      if (cursor === undefined) return

      const room = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.WORKFLOW)
      const session = await roomManager.getUserSession(socket.id)

      if (!room || !session) return

      await roomManager.updateUserActivity(room, socket.id, { cursor })

      // Broadcast to other users in the room (workflow room name is the bare id)
      socket.to(room.id).emit('cursor-update', {
        socketId: socket.id,
        userId: session.userId,
        userName: session.userName,
        avatarUrl: session.avatarUrl,
        cursor,
      })
    } catch (error) {
      logger.error(`Error handling cursor update for socket ${socket.id}:`, error)
    }
  })

  socket.on('selection-update', async ({ selection: rawSelection }: { selection: unknown }) => {
    try {
      // Drop a malformed/oversized selection from an untrusted peer before it is stored
      // or rebroadcast.
      const selection = normalizeSelection(rawSelection)
      if (selection === undefined) return

      const room = await roomManager.getRoomForSocket(socket.id, ROOM_TYPES.WORKFLOW)
      const session = await roomManager.getUserSession(socket.id)

      if (!room || !session) return

      await roomManager.updateUserActivity(room, socket.id, { selection })

      // Broadcast to other users in the room (workflow room name is the bare id)
      socket.to(room.id).emit('selection-update', {
        socketId: socket.id,
        userId: session.userId,
        userName: session.userName,
        avatarUrl: session.avatarUrl,
        selection,
      })
    } catch (error) {
      logger.error(`Error handling selection update for socket ${socket.id}:`, error)
    }
  })
}
