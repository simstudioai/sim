import { createLogger } from '@sim/logger'
import { authorizeRoom } from '@sim/platform-authz/rooms'
import {
  FILE_DOC_EVENTS,
  FILE_DOC_MESSAGE_TYPE,
  FILE_DOC_SEED,
  type JoinFileDocPayload,
  type LeaveFileDocPayload,
} from '@sim/realtime-protocol/file-doc'
import { ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import type { Server } from 'socket.io'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('FileDocHandlers')

/**
 * Collaborative document editing (live carets + text selection) for a single
 * file's rich-text editor. This is the standard Yjs "websocket server" relay —
 * an authoritative in-memory {@link Y.Doc} + {@link awarenessProtocol.Awareness}
 * per file — carried over the shared, already-authenticated Socket.IO connection
 * and the room abstraction, rather than a separate ws server. Clients speak the
 * `y-protocols` sync + awareness protocols; the server applies and relays them.
 *
 * No durable Yjs state is kept yet: the document lives only while at least one
 * collaborator is connected, and is re-seeded from the file's stored markdown on
 * the next cold open (the markdown, saved by a client through the content API, is
 * the durable source of truth). Durable Yjs snapshots are a separate follow-up.
 *
 * Single-writer assumption: the authoritative {@link Y.Doc} is held in this
 * process's memory, so correctness assumes one realtime replica per file (Helm
 * pins `realtime.replicaCount: 1`). Horizontal scaling would need a shared Yjs
 * backend (y-redis / Hocuspocus) — out of scope here.
 */
interface FileDocRoom {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  /** socketId → the awareness clientIDs it controls, cleared on its disconnect. */
  controlledIds: Map<string, Set<number>>
  /** The socket elected to seed initial content, or `null` if unseeded/unelected. */
  seederSocketId: string | null
}

/** Live documents keyed by Socket.IO room name. Module-global: one Y.Doc per file. */
const fileDocRooms = new Map<string, FileDocRoom>()
/** socketId → its current file-doc room name (a socket edits at most one doc). */
const socketToRoomName = new Map<string, string>()

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

const fileDocRoom = (fileId: string): RoomRef => ({
  type: ROOM_TYPES.WORKSPACE_FILE_DOC,
  id: fileId,
})

/**
 * A `y-protocols` transaction/awareness origin is the emitting socket id (a
 * string) when it came from a client, and something else (`null` / `'local'` /
 * `'timeout'`) for server-internal changes. Returns the socket id to exclude
 * from a relay, or `null` to broadcast to the whole room.
 */
function originSocketId(origin: unknown): string | null {
  return typeof origin === 'string' ? origin : null
}

function broadcast(io: Server, name: string, payload: Uint8Array, exceptSocketId: string | null) {
  const channel = exceptSocketId ? io.to(name).except(exceptSocketId) : io.to(name)
  channel.emit(FILE_DOC_EVENTS.MESSAGE, payload)
}

/** Whether the client has recorded that it seeded the document's initial content. */
function isDocSeeded(doc: Y.Doc): boolean {
  return doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag) === true
}

function toUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return null
}

/**
 * Get (or lazily create) the authoritative document for a room, wiring the two
 * relay handlers exactly once: document updates and awareness changes are
 * broadcast to the room, excluding the origin socket (it already applied them).
 */
function getOrCreateRoom(io: Server, name: string): FileDocRoom {
  const existing = fileDocRooms.get(name)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  // The server holds no cursor of its own; it only relays clients' awareness.
  awareness.setLocalState(null)

  const room: FileDocRoom = { doc, awareness, controlledIds: new Map(), seederSocketId: null }
  fileDocRooms.set(name, room)

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeUpdate(encoder, update)
    broadcast(io, name, encoding.toUint8Array(encoder), originSocketId(origin))
  })

  awareness.on('update', ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
    const from = originSocketId(origin)
    if (from) {
      const controlled = room.controlledIds.get(from)
      if (controlled) {
        for (const id of added) controlled.add(id)
        for (const id of removed) controlled.delete(id)
      }
    }
    const changed = added.concat(updated, removed)
    if (changed.length === 0) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed)
    )
    broadcast(io, name, encoding.toUint8Array(encoder), from)
  })

  return room
}

function emitJoinError(
  socket: AuthenticatedSocket,
  fileId: unknown,
  error: string,
  code: string,
  retryable: boolean
) {
  socket.emit(FILE_DOC_EVENTS.JOIN_ERROR, {
    fileId: typeof fileId === 'string' ? fileId : '',
    error,
    code,
    retryable,
  })
}

function handleMessage(socket: AuthenticatedSocket, data: unknown) {
  const name = socketToRoomName.get(socket.id)
  if (!name) return
  const room = fileDocRooms.get(name)
  if (!room) return

  const bytes = toUint8Array(data)
  if (!bytes) return

  const decoder = decoding.createDecoder(bytes)
  const messageType = decoding.readVarUint(decoder)

  switch (messageType) {
    case FILE_DOC_MESSAGE_TYPE.SYNC: {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
      // `socket.id` is the transaction origin, so the doc's `update` handler
      // excludes this sender when relaying the applied update to the room.
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, socket.id)
      // A reply longer than the 1-byte type tag is a sync step 2 (or step 1)
      // destined for the sender only; applied updates fan out via `doc.on`.
      if (encoding.length(encoder) > 1) {
        socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
      }
      break
    }
    case FILE_DOC_MESSAGE_TYPE.AWARENESS: {
      awarenessProtocol.applyAwarenessUpdate(
        room.awareness,
        decoding.readVarUint8Array(decoder),
        socket.id
      )
      break
    }
    default:
      logger.warn('Unknown file-doc message type', { messageType })
  }
}

/**
 * Remove a socket from its file-doc room: clear its awareness state (so its caret
 * disappears for everyone else), free the seeder election if it left before
 * seeding, and drop the room's document when the last collaborator leaves.
 * Exported for the disconnect handler; safe to call for a socket in no room.
 */
export function cleanupFileDocForSocket(socketId: string, io: Server): void {
  const name = socketToRoomName.get(socketId)
  if (!name) return
  socketToRoomName.delete(socketId)

  const room = fileDocRooms.get(name)
  if (!room) return

  const controlled = room.controlledIds.get(socketId)
  room.controlledIds.delete(socketId)
  if (controlled && controlled.size > 0) {
    // Fires the awareness `update` handler with a non-socket origin → the removal
    // is broadcast to every remaining client, so the departed caret vanishes.
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(controlled), null)
  }

  // If the elected seeder left before it seeded, free the election so the next
  // joiner seeds — otherwise the document would stay permanently empty.
  if (room.seederSocketId === socketId && !isDocSeeded(room.doc)) {
    room.seederSocketId = null
  }

  // Drop the document + awareness once idle so no memory is held for a file with
  // no active editors; a later joiner re-creates and re-seeds it.
  if (room.controlledIds.size === 0) {
    room.awareness.destroy()
    room.doc.destroy()
    fileDocRooms.delete(name)
  }
}

/**
 * Registers the collaborative file-document handlers on a socket. Room id is the
 * file id; joining requires workspace `write` (editing a document). Mirrors the
 * workspace-files join shape (auth → readiness → validate → authorize → join),
 * then runs the Yjs sync/awareness handshake.
 */
export function setupWorkspaceFileDocHandlers(
  socket: AuthenticatedSocket,
  roomManager: IRoomManager
) {
  const io = roomManager.io

  socket.on(FILE_DOC_EVENTS.JOIN, async ({ fileId }: JoinFileDocPayload) => {
    try {
      const userId = socket.userId
      const userName = socket.userName

      if (!userId || !userName) {
        emitJoinError(socket, fileId, 'Authentication required', 'AUTHENTICATION_REQUIRED', false)
        return
      }
      if (!roomManager.isReady()) {
        emitJoinError(socket, fileId, 'Realtime unavailable', 'ROOM_MANAGER_UNAVAILABLE', true)
        return
      }
      if (typeof fileId !== 'string' || fileId.length === 0) {
        emitJoinError(socket, fileId, 'Invalid file id', 'INVALID_PAYLOAD', false)
        return
      }

      const room = fileDocRoom(fileId)
      const name = roomName(room)

      let authorized: Awaited<ReturnType<typeof authorizeRoom>>
      try {
        authorized = await authorizeRoom({ userId, room, action: 'write' })
      } catch (error) {
        logger.warn(`Error authorizing file-doc room for ${userId}:`, error)
        emitJoinError(
          socket,
          fileId,
          'Failed to verify workspace access',
          'VERIFY_ACCESS_FAILED',
          true
        )
        return
      }
      if (!authorized.allowed) {
        emitJoinError(
          socket,
          fileId,
          authorized.status === 404 ? 'File not found' : 'Access denied to file',
          authorized.status === 404 ? 'NOT_FOUND' : 'ACCESS_DENIED',
          false
        )
        return
      }

      // Switched documents on the same socket — leave the previous one first (a
      // socket edits at most one document). A duplicate join of the SAME room
      // falls through and simply re-runs the sync handshake, idempotently.
      const currentName = socketToRoomName.get(socket.id)
      if (currentName && currentName !== name) {
        socket.leave(currentName)
        cleanupFileDocForSocket(socket.id, io)
      }

      const entry = getOrCreateRoom(io, name)
      if (!entry.controlledIds.has(socket.id)) entry.controlledIds.set(socket.id, new Set())
      socketToRoomName.set(socket.id, name)
      socket.join(name)

      // Elect exactly one seeder for an unseeded document, so its initial content
      // is imported from the stored markdown once and never duplicated.
      const shouldSeed = !isDocSeeded(entry.doc) && entry.seederSocketId === null
      if (shouldSeed) entry.seederSocketId = socket.id

      socket.emit(FILE_DOC_EVENTS.JOIN_SUCCESS, { fileId, shouldSeed })

      // Begin the sync handshake: send the server's state (sync step 1). The
      // client replies with its updates and requests the server's in return.
      const syncEncoder = encoding.createEncoder()
      encoding.writeVarUint(syncEncoder, FILE_DOC_MESSAGE_TYPE.SYNC)
      syncProtocol.writeSyncStep1(syncEncoder, entry.doc)
      socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(syncEncoder))

      // Send existing awareness so the new client immediately sees others' carets.
      const states = entry.awareness.getStates()
      if (states.size > 0) {
        const awarenessEncoder = encoding.createEncoder()
        encoding.writeVarUint(awarenessEncoder, FILE_DOC_MESSAGE_TYPE.AWARENESS)
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(entry.awareness, Array.from(states.keys()))
        )
        socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(awarenessEncoder))
      }

      logger.info(`User ${userId} joined file-doc room ${fileId} (seed=${shouldSeed})`)
    } catch (error) {
      logger.error('Error joining file-doc room:', error)
      try {
        socket.leave(roomName(fileDocRoom(fileId)))
        cleanupFileDocForSocket(socket.id, io)
      } catch {}
      emitJoinError(socket, fileId, 'Failed to join file document', 'JOIN_FAILED', true)
    }
  })

  socket.on(FILE_DOC_EVENTS.MESSAGE, (data: unknown) => handleMessage(socket, data))

  socket.on(FILE_DOC_EVENTS.LEAVE, (payload?: LeaveFileDocPayload) => {
    try {
      const name = socketToRoomName.get(socket.id)
      if (!name) return
      // Scope the leave to the named file when provided: a deferred leave from a
      // prior document must not evict the socket from one it has since opened.
      if (payload?.fileId && roomName(fileDocRoom(payload.fileId)) !== name) return
      socket.leave(name)
      cleanupFileDocForSocket(socket.id, io)
    } catch (error) {
      logger.error('Error leaving file-doc room:', error)
    }
  })
}
