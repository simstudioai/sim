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
 *
 * @module
 */
import { createLogger } from '@sim/logger'
import {
  FILE_DOC_EVENTS,
  FILE_DOC_MESSAGE_TYPE,
  FILE_DOC_SEED,
  type FileDocPresenceUser,
  type JoinFileDocPayload,
  type LeaveFileDocPayload,
  toFileDocBytes,
} from '@sim/realtime-protocol/file-doc'
import { ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import type { Server } from 'socket.io'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { resolveAvatarUrl } from '@/handlers/avatar'
import { fetchFileDocSeed } from '@/handlers/file-doc-seed'
import { resolveRoomJoinAuth } from '@/handlers/room-join-auth'
import type { AuthenticatedSocket } from '@/middleware/auth'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('FileDocHandlers')

/** A socket's presence ownership within a room. */
interface FileDocOwner {
  /**
   * The awareness clientID the socket declared at join. It owns exactly this one
   * and may only publish/remove awareness for it, so an authenticated peer cannot
   * forge or clear another collaborator's presence.
   */
  clientId: number
  /** The owning user — used to tell a reconnect (same user reusing its Yjs client
   * id) from a spoof (a different user binding a peer's id). */
  userId: string
  /** Server-authenticated display identity for the presence roster (from the socket's
   *  session, never the client-set awareness — so a peer cannot spoof it). */
  userName: string
  avatarUrl: string | null
}

interface FileDocRoom {
  /** The `workspace_files.id` this room edits. */
  fileId: string
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  /** socketId → its presence ownership. */
  owners: Map<string, FileDocOwner>
  /** True once the server-side seed fetch has started, so concurrent joins don't each fetch.
   * Reset on a fetch FAILURE so a later join can retry (a genuinely empty file stays empty). */
  serverSeedStarted: boolean
}

/** Live documents keyed by Socket.IO room name. Module-global: one Y.Doc per file. */
const fileDocRooms = new Map<string, FileDocRoom>()
/** socketId → its current file-doc room name (a socket edits at most one doc). */
const socketToRoomName = new Map<string, string>()
/**
 * socketId → a monotonic join generation. A JOIN bumps it on arrival and, after
 * the async authorization, proceeds only if the generation is still its own — so
 * a newer JOIN (a fast document switch) or a disconnect (which drops the entry in
 * cleanup) that occurred during authorization aborts the now-stale JOIN. Without
 * this, an out-of-order authorize completion could bind the socket to the wrong
 * document, or a disconnect-during-authorize could register a dead socket and
 * leak its room.
 */
const joinGeneration = new Map<string, number>()

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

/**
 * Broadcast the room's collaborator roster to everyone in it, for the avatar stack. One entry
 * PER SESSION (socket) — the client excludes its own socket and dedupes the remainder per user
 * for display, so a second tab of the same account still registers as present (mirroring the
 * canvas presence model). Deduping here instead would drop the current user's other sessions
 * asymmetrically (only one socket survives), so each client could never reliably self-exclude.
 * Identity comes from each owner's server-authenticated session — never the client-set awareness
 * — so a peer cannot spoof or suppress an entry.
 */
function broadcastFileDocPresence(io: Server, name: string, room: FileDocRoom) {
  const users: FileDocPresenceUser[] = []
  for (const [socketId, owner] of room.owners) {
    users.push({
      socketId,
      userId: owner.userId,
      userName: owner.userName,
      avatarUrl: owner.avatarUrl,
    })
  }
  io.to(name).emit(FILE_DOC_EVENTS.PRESENCE, { fileId: room.fileId, users })
}

/** Whether the client has recorded that it seeded the document's initial content. */
function isDocSeeded(doc: Y.Doc): boolean {
  return doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag) === true
}

/**
 * Decode the client IDs an awareness update carries, without applying it, to
 * check a frame only touches its sender's own presence. Mirrors the wire format
 * of `awarenessProtocol.encodeAwarenessUpdate`: a count, then per client a
 * varUint id, a varUint clock, and a varString state.
 */
function awarenessUpdateClientIds(update: Uint8Array): number[] {
  const decoder = decoding.createDecoder(update)
  const count = decoding.readVarUint(decoder)
  const ids: number[] = []
  for (let i = 0; i < count; i++) {
    ids.push(decoding.readVarUint(decoder))
    decoding.readVarUint(decoder) // clock
    decoding.readVarUint8Array(decoder) // state bytes — advanced past, only ids matter
  }
  return ids
}

/**
 * Drop a room's document + awareness once it has no owners, so an idle file holds no memory.
 * A later joiner re-creates and re-seeds it from the file's current markdown.
 */
function destroyRoomIfIdle(name: string) {
  const room = fileDocRooms.get(name)
  if (!room || room.owners.size > 0) return
  room.awareness.destroy()
  room.doc.destroy()
  fileDocRooms.delete(name)
}

/** How many times a single room re-attempts a failed seed fetch before leaving it to the next join. */
const MAX_SEED_ATTEMPTS = 3

/**
 * Seed a room's document server-side, once. On the first join the relay asks the app to build the
 * seed (the file's current markdown → Yjs, through the exact editor engine) and applies it — which
 * fires `doc.on('update')` and relays the seeded content to every connected client. No client is
 * elected to import content, so there is no seed handshake, deadline, or re-election.
 *
 * Recovery, because the client's readiness gate (`synced && initialContentLoaded`) never flips until
 * the doc is seeded:
 * - **Genuinely empty/missing file** → the app returns `null`; mark the doc seeded so clients reach
 *   readiness instead of waiting forever. This is safe: `buildFileDocSeed` throws — it does not
 *   return `null` — on a read error, so `null` means the file truly has no content to lose.
 * - **Transport failure** → retry a bounded number of times against the *live* room with backoff, so
 *   already-connected clients recover without needing a fresh join; on final failure the guard is
 *   released so a later join re-attempts.
 *
 * `isDocSeeded` is the only "already handled" guard needed: content is only ever written to the doc
 * alongside the seed flag (by this seed, or by a client's offline fallback which sets both), so a doc
 * carrying real content is always already seeded and short-circuits here. A fresh client does NOT
 * pollute the doc first — `@tiptap/y-tiptap` deliberately never writes the editor's default empty
 * paragraph to Yjs (it diffs against `createAndFill()` and renders nothing when unchanged), and real
 * edits are gated behind readiness — so an unseeded doc is genuinely empty and safe to seed. (An
 * earlier state-vector "emptiness" check here was both unnecessary and wrong: it skipped the seed on
 * any non-empty state vector, which would have stranded a client unseeded had anything ever synced
 * ahead of the seed.) After each `await`, re-verify the room is still the live, unseeded room: the
 * last owner may have left (`destroyRoomIfIdle` destroyed the doc) or a client's sync may have seeded
 * it in flight.
 */
async function ensureServerSeed(
  name: string,
  room: FileDocRoom,
  workspaceId: string
): Promise<void> {
  if (room.serverSeedStarted || isDocSeeded(room.doc)) return
  room.serverSeedStarted = true

  for (let attempt = 1; attempt <= MAX_SEED_ATTEMPTS; attempt++) {
    try {
      const update = await fetchFileDocSeed(workspaceId, room.fileId)
      if (fileDocRooms.get(name) !== room || isDocSeeded(room.doc)) return
      if (update) Y.applyUpdate(room.doc, update)
      else room.doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
      return
    } catch (error) {
      // Stop retrying a room that emptied out (or was replaced) during the failed attempt.
      const alive = fileDocRooms.get(name) === room && room.owners.size > 0
      if (attempt >= MAX_SEED_ATTEMPTS || !alive) {
        logger.warn(
          `Server seed failed for file ${room.fileId} (workspace ${workspaceId}) after ${attempt} attempt(s); a later join will retry`,
          error
        )
        room.serverSeedStarted = false
        return
      }
      await sleep(backoffWithJitter(attempt, null))
    }
  }
}

/**
 * Get (or lazily create) the authoritative document for a room, wiring the two
 * relay handlers exactly once: document updates and awareness changes are
 * broadcast to the room, excluding the origin socket (it already applied them).
 */
function getOrCreateRoom(io: Server, ref: RoomRef): FileDocRoom {
  const name = roomName(ref)
  const existing = fileDocRooms.get(name)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  // The server holds no cursor of its own; it only relays clients' awareness.
  awareness.setLocalState(null)

  const room: FileDocRoom = {
    fileId: ref.id,
    doc,
    awareness,
    owners: new Map(),
    serverSeedStarted: false,
  }
  fileDocRooms.set(name, room)

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeUpdate(encoder, update)
    broadcast(io, name, encoding.toUint8Array(encoder), originSocketId(origin))
  })

  awareness.on('update', ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
    const changed = added.concat(updated, removed)
    if (changed.length === 0) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed)
    )
    broadcast(io, name, encoding.toUint8Array(encoder), originSocketId(origin))
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

  const bytes = toFileDocBytes(data)
  if (!bytes) return

  // A malformed frame from any client must never escape as a process-level
  // exception; drop it and keep the relay running.
  try {
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
        const update = decoding.readVarUint8Array(decoder)
        // Enforce presence ownership: a socket may only publish/remove awareness
        // for the clientID it bound at join, so a peer cannot spoof or clear
        // another collaborator's caret.
        const owned = room.owners.get(socket.id)?.clientId
        if (owned === undefined || awarenessUpdateClientIds(update).some((id) => id !== owned)) {
          logger.warn('Dropping awareness frame for an unowned client id', { socketId: socket.id })
          return
        }
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, socket.id)
        break
      }
      default:
        logger.warn('Unknown file-doc message type', { messageType })
    }
  } catch (error) {
    logger.warn('Dropping malformed file-doc frame', { socketId: socket.id, error })
  }
}

/**
 * Remove a socket from its file-doc room: clear its awareness state (so its caret
 * disappears for everyone else) and drop the room's document when the last
 * collaborator leaves.
 * Exported for the disconnect handler; safe to call for a socket in no room.
 */
export function cleanupFileDocForSocket(socketId: string, io: Server, endOfLife = false): void {
  // The join-generation counter is monotonic for the socket's WHOLE life and must survive a room
  // switch/leave: resetting it here would let the next join reuse a low number that a still
  // in-flight earlier join also holds, so that stale join passes the generation guard and rebinds
  // the socket to the wrong document. Drop it ONLY when the socket is truly gone (disconnect),
  // which is also the only place the map would otherwise leak. An in-flight join is already
  // aborted on disconnect by the `socket.disconnected` check, and on a switch by a newer join
  // bumping the generation — neither needs this delete.
  if (endOfLife) joinGeneration.delete(socketId)

  const name = socketToRoomName.get(socketId)
  if (!name) return
  socketToRoomName.delete(socketId)

  const room = fileDocRooms.get(name)
  if (!room) return

  const owner = room.owners.get(socketId)
  room.owners.delete(socketId)
  if (owner !== undefined) {
    // Fires the awareness `update` handler with a non-socket origin → the removal
    // is broadcast to every remaining client, so the departed caret vanishes.
    awarenessProtocol.removeAwarenessStates(room.awareness, [owner.clientId], null)
    // Refresh the roster for whoever remains (server-authenticated identity).
    broadcastFileDocPresence(io, name, room)
  }

  destroyRoomIfIdle(name)
}

/**
 * Registers the collaborative file-document handlers on a socket. Room id is the
 * file id; joining requires workspace `write` (editing a document). Mirrors the
 * workspace-files join shape (auth → readiness → validate → authorize → join),
 * then runs the Yjs sync/awareness handshake.
 *
 * The avatar roster is derived from this room's own `owners` map and broadcast as
 * `FILE_DOC_EVENTS.PRESENCE` — NOT the Redis-backed room-manager presence the workflow /
 * table rooms use — because the file-doc room already owns an authoritative in-memory Y.Doc
 * pinned to a single replica, so the session identity is right here with no extra store.
 */
export function setupWorkspaceFileDocHandlers(
  socket: AuthenticatedSocket,
  roomManager: IRoomManager
) {
  const io = roomManager.io
  // The file this socket currently intends to edit (set when a join starts). A leave targeting it
  // — or an unscoped leave — advances the join generation to cancel an in-flight join, so a join
  // awaiting authorization can't complete after the client left and register a ghost owner. A
  // leave for a DIFFERENT file must NOT cancel it (a document switch), mirroring workspace-files.
  let currentFileId: string | null = null

  socket.on(FILE_DOC_EVENTS.JOIN, async ({ fileId, clientId }: JoinFileDocPayload) => {
    // Hoisted so the catch can tell whether this join was superseded (a switch to another file)
    // before surfacing a retryable error for the abandoned one.
    let generation: number | undefined
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
      if (
        typeof fileId !== 'string' ||
        fileId.length === 0 ||
        // A Yjs clientID is a uint32; reject NaN/Infinity/negative/non-integer so a malformed id
        // can't become a bogus ownership key.
        !Number.isInteger(clientId) ||
        clientId < 0
      ) {
        emitJoinError(socket, fileId, 'Invalid join payload', 'INVALID_PAYLOAD', false)
        return
      }

      // Claim this JOIN's generation before the async authorize below, and record the file the
      // socket now intends to edit so a leave for it can cancel this join if it's still in-flight.
      generation = (joinGeneration.get(socket.id) ?? 0) + 1
      joinGeneration.set(socket.id, generation)
      currentFileId = fileId

      const room = fileDocRoom(fileId)
      const name = roomName(room)

      const authorized = await resolveRoomJoinAuth({
        userId,
        room,
        action: 'write',
        logger,
        logLabel: `file-doc room for ${userId}`,
        messages: {
          verifyFailed: 'Failed to verify workspace access',
          notFound: 'File not found',
          accessDenied: 'Access denied to file',
        },
        emitError: ({ error, code, retryable }) =>
          emitJoinError(socket, fileId, error, code, retryable),
      })
      if (!authorized) return

      // Server-authenticated identity for the presence roster (never trusts the client-set
      // awareness). Resolved here so the generation guard below also covers this await.
      const avatarUrl = await resolveAvatarUrl(socket, userId)

      // Abort a JOIN superseded during authorization/identity resolution: the socket
      // disconnected, or a newer JOIN (a document switch) bumped the generation. Registering
      // here would leak a dead socket's room or bind the socket to the wrong document.
      if (socket.disconnected || joinGeneration.get(socket.id) !== generation) return

      const entry = getOrCreateRoom(io, room)

      // A client id must be owned by at most one user, or a peer could bind an active
      // collaborator's id and pass the per-frame ownership check to spoof/clear its caret.
      // Distinguish a reconnect from a spoof by the owning user: the same user reclaiming its
      // own client id (a dropped socket reconnecting reuses the Yjs client id, and its prior
      // socket may not be cleaned up yet) takes over the stale binding; a DIFFERENT user is
      // rejected. This runs BEFORE any teardown of the socket's current binding below, so a
      // rejected rebind — even during a document switch — leaves the socket's existing document
      // and caret untouched.
      for (const [otherSid, owner] of entry.owners) {
        if (owner.clientId !== clientId || otherSid === socket.id) continue
        if (owner.userId !== userId) {
          emitJoinError(socket, fileId, 'Client id already in use', 'CLIENT_ID_IN_USE', false)
          return
        }
        // Fully evict the stale prior socket of the same user — owner + caret AND its room
        // mapping + Socket.IO membership — so it can no longer send document (sync) frames:
        // handleMessage's SYNC path gates on socketToRoomName, not owners. Done inline rather
        // than via cleanupFileDocForSocket, which could destroyRoomIfIdle the room we're joining.
        entry.owners.delete(otherSid)
        awarenessProtocol.removeAwarenessStates(entry.awareness, [owner.clientId], null)
        socketToRoomName.delete(otherSid)
        io.in(otherSid).socketsLeave(name)
      }

      // Only now that the rebind is guaranteed to succeed, leave a previously-joined document if
      // switching (a socket edits at most one). A duplicate join of the SAME room falls through
      // and simply re-runs the sync handshake, idempotently.
      const currentName = socketToRoomName.get(socket.id)
      if (currentName && currentName !== name) {
        socket.leave(currentName)
        cleanupFileDocForSocket(socket.id, io)
      }

      // Accepted: a same socket rebinding to a NEW client id clears its old caret
      // so it doesn't linger as a ghost after the binding is overwritten.
      const previous = entry.owners.get(socket.id)
      if (previous !== undefined && previous.clientId !== clientId) {
        awarenessProtocol.removeAwarenessStates(entry.awareness, [previous.clientId], null)
      }

      entry.owners.set(socket.id, { clientId, userId, userName, avatarUrl })
      socketToRoomName.set(socket.id, name)
      socket.join(name)

      socket.emit(FILE_DOC_EVENTS.JOIN_SUCCESS, { fileId })
      // Server-authenticated roster → everyone in the room, including this joiner.
      broadcastFileDocPresence(io, name, entry)

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

      // Seed the document server-side (once). Fire-and-forget: the join completes immediately and
      // the seed relays to this socket via `doc.on('update')` the moment it lands.
      if (authorized.workspaceId) void ensureServerSeed(name, entry, authorized.workspaceId)

      logger.info(`User ${userId} joined file-doc room ${fileId}`)
    } catch (error) {
      logger.error('Error joining file-doc room:', error)
      try {
        const name = roomName(fileDocRoom(fileId))
        socket.leave(name)
        // Roll back ONLY this join's target room. cleanupFileDocForSocket keys off socketToRoomName,
        // which — if the join failed before rebinding to the target (e.g. a switch that threw during
        // client-id reclaim) — still points at the socket's PRIOR, valid document. Running it then
        // would tear down a document the socket is validly in. So only run it when the binding
        // already points at the target; otherwise the socket never registered as an owner of this
        // room and the only leftover is a freshly-created empty room, dropped below.
        if (socketToRoomName.get(socket.id) === name) cleanupFileDocForSocket(socket.id, io)
        destroyRoomIfIdle(name)
      } catch {}
      // Suppress the client-facing error when this join was already superseded (a switch to another
      // file, or a disconnect): the rollback above still ran, but a retryable error naming the
      // abandoned file could make a client re-join it and cancel the newer one (matches the sibling
      // handlers).
      if (
        socket.disconnected ||
        (generation !== undefined && joinGeneration.get(socket.id) !== generation)
      )
        return
      emitJoinError(socket, fileId, 'Failed to join file document', 'JOIN_FAILED', true)
    }
  })

  socket.on(FILE_DOC_EVENTS.MESSAGE, (data: unknown) => handleMessage(socket, data))

  socket.on(FILE_DOC_EVENTS.LEAVE, (payload?: LeaveFileDocPayload) => {
    try {
      // Cancel an in-flight join whose file the client is now leaving (or an unscoped leave): a
      // join still awaiting authorization would otherwise complete after the client left, register
      // as an owner, and broadcast a ghost collaborator until disconnect. Guard on the current
      // file intent so a stale/deferred leave for a DIFFERENT file can't abort the join the client
      // has since switched to (bumping the generation blindly caused that regression in #5941).
      if (!payload?.fileId || payload.fileId === currentFileId) {
        joinGeneration.set(socket.id, (joinGeneration.get(socket.id) ?? 0) + 1)
        currentFileId = null
      }
      // Tear down membership only for a REGISTERED room; a leave that raced ahead of an in-flight
      // join (nothing registered yet) has already cancelled it above.
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
