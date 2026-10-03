/**
 * Collaborative document editing (live carets + text selection) for a single
 * file's rich-text editor. This is the standard Yjs "websocket server" relay —
 * an authoritative in-memory {@link Y.Doc} + {@link awarenessProtocol.Awareness}
 * per file — carried over the shared, already-authenticated Socket.IO connection
 * and the room abstraction, rather than a separate ws server. Clients speak the
 * `y-protocols` sync + awareness protocols; the server applies and relays them.
 *
 * Multi-replica safe. The in-memory {@link Y.Doc} is NOT authoritative on its own — every task
 * converges on one CRDT per file through the shared Redis-Streams backend in {@link file-doc-store}:
 * each applied update is published to the file's stream and every task's tailer applies it to its own
 * doc and fans it out to its own clients, so two tasks can never split-brain. Consequently doc-sync
 * messages are broadcast LOCALLY ({@link io.local}) and cross-task delivery rides the stream — NOT the
 * Socket.IO adapter (that would double-deliver). Awareness/presence stay on the adapter: they are
 * ephemeral and need neither convergence nor replay. When `REDIS_URL` is unset the store is disabled
 * and this falls back to the original single-replica behavior (local doc, local seed, local fan-out).
 *
 * Durability: the live doc is projected back to the file's markdown server-side — debounced while it is
 * edited and flushed when the last collaborator leaves — via the app's `/persist` endpoint (the app
 * owns the conversion engine). This replaces the editor's client autosave, closing the copilot
 * clobber-window, and the Redis stream is the crash buffer between flushes. The markdown file remains
 * the long-term source of truth; the Redis stream is ephemeral (TTL'd, heartbeat-refreshed while live).
 *
 * @module
 */
import { createLogger } from '@sim/logger'
import { ROOM_MEMBERSHIP_ACTIONS, satisfiesRoomMembership } from '@sim/platform-authz/room-policy'
import {
  FILE_DOC_EVENTS,
  FILE_DOC_LEGACY_SCHEMA_VERSION,
  FILE_DOC_LIMITS,
  FILE_DOC_MESSAGE_TYPE,
  FILE_DOC_SCHEMA_VERSION,
  FILE_DOC_SEED,
  FILE_DOC_TIMEOUTS,
  type FileDocPresenceUser,
  type FileDocUpdateAck,
  type FileDocUpdatePayload,
  type JoinFileDocPayload,
  type LeaveFileDocPayload,
  toFileDocBytes,
} from '@sim/realtime-protocol/file-doc'
import { ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import type { Server } from 'socket.io'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { resolveAvatarUrl } from '@/handlers/avatar'
import { fetchFileDocMerge, fetchFileDocPersist, fetchFileDocSeed } from '@/handlers/file-doc-app'
import {
  FileDocInvalidatedError,
  getFileDocStore,
  REDIS_AGENT_ORIGIN,
  REDIS_ORIGIN,
  REDIS_SNAPSHOT_ORIGIN,
} from '@/handlers/file-doc-store'
import { evictSocketFromRoom, registerRoomEvictionHandler } from '@/handlers/room-eviction'
import { resolveRoomJoinAuth } from '@/handlers/room-join-auth'
import type { AuthenticatedSocket } from '@/middleware/auth'
import { peekRoomPermission, resolveCurrentRoomPermission } from '@/middleware/permissions'
import type { IRoomManager } from '@/rooms'

const logger = createLogger('FileDocHandlers')

/**
 * The transaction origin the server stamps on a SEED apply, so `doc.on('update')` can broadcast + share
 * it (peers still need the seed) but skip the debounced persist — the seed IS the file's current
 * content, so writing it straight back would only churn a redundant blob version.
 */
const SEED_ORIGIN = Symbol('file-doc-seed')

/** Debounce window for the server-side project-to-markdown persist while a doc is actively edited. */
const PERSIST_DEBOUNCE_MS = 5_000
/** Max-wait cap on the persist debounce: a CONTINUOUS edit burst keeps resetting the 5s debounce and
 * would otherwise never persist until an idle pause, so force a flush at least this often — bounding how
 * many edits are unpersisted (in the stream only) if the task dies mid-burst. */
const PERSIST_MAX_WAIT_MS = 20_000
/** On a FINAL (last-leave/shutdown) flush the version read is the last chance to resolve the If-Match
 * before the room is torn down; a transient Redis blip yielding no version would otherwise defer and
 * strand the session's edits in the TTL'd stream. The version is cluster-wide and heartbeat-refreshed, so
 * a brief bounded retry recovers a blip without stalling teardown (a genuinely-unset version never
 * appears, so a long wait buys nothing). */
const FINAL_VERSION_RETRIES = 2
const FINAL_VERSION_RETRY_MS = 100

/** Cross-task merge lock. The TTL must exceed the whole critical section it guards — stream fold +
 * `fetchFileDocMerge` (bounded at `mergeRequestMs`) + the awaited publish — so the lock never expires
 * mid-merge and lets a second task race the same base; hence `mergeRequestMs` plus generous headroom.
 * The waiter retries at {@link MERGE_LOCK_RETRY_MS} for LONGER than the TTL, so a live holder always
 * releases (or a dead holder's lock expires) within the window. Release is compare-and-delete on an
 * ownership token, so even a pathological over-TTL hold never deletes another task's re-acquired lock. */
const MERGE_LOCK_TTL_MS = FILE_DOC_TIMEOUTS.mergeRequestMs + 5_000
const MERGE_LOCK_RETRY_MS = 200
const MERGE_LOCK_RETRIES = Math.ceil(
  (MERGE_LOCK_TTL_MS + FILE_DOC_TIMEOUTS.mergeRequestMs) / MERGE_LOCK_RETRY_MS
)

/**
 * How long after the last agent frame a client is still treated as "actively streaming" (so a durable
 * merge defers to it). Comfortably longer than the gap between agent frames (per-rAF to the client's
 * reparse throttle) so brief throttle pauses don't flip it off mid-stream, yet short enough that the
 * final durable merge — which lands as a near-noop once the client has streamed everything — isn't
 * deferred for long after the stream ends.
 */
const AGENT_STREAM_FLAG_TTL_MS = 10_000

/** One presence ownership within a room: a (socket, clientID) pair. */
interface FileDocOwner {
  /**
   * An awareness clientID this socket declared at join. The socket may only publish/remove awareness
   * for a clientID it owns, so an authenticated peer cannot forge or clear another collaborator's
   * presence. A single socket can own SEVERAL clientIDs at once — the shared workspace socket hosts one
   * provider per mounted collaborative view, so e.g. the chat file preview and the standalone Files
   * editor for the same file each bind their own Yjs clientID over the one socket. The election that
   * picks a single agent-stream writer depends on every such provider's awareness propagating, so
   * ownership is tracked per clientID, not one-per-socket (which would drop the later joiner's frames).
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
  /** socketId → (clientId → its presence ownership). A socket owns one entry per collaborative provider
   * it mounted for this file (see {@link FileDocOwner}); an empty inner map is never kept. */
  owners: Map<string, Map<number, FileDocOwner>>
  /**
   * The in-flight server seed for this room, or `null`. Concurrent joins await THIS promise rather
   * than each starting a fetch — and, unlike a "started" boolean, awaiting it is what lets a second
   * joiner be served a document that is already seeded instead of an empty one. Cleared when it
   * settles, so a failed seed is re-attempted by a later join (a genuinely empty file stays empty).
   */
  seeding: Promise<void> | null
  /** The workspace this file belongs to, captured at join — needed to persist back to markdown. */
  workspaceId: string | null
  /** The last collaborator to edit here, for persist attribution (blob metadata) only. */
  lastEditorUserId: string | null
  /**
   * True once a genuine edit (a user edit — local OR a peer's, relayed via the tailer) has been applied
   * here AFTER seeding. Persistence is gated on it so a doc that was only seeded is NEVER projected back
   * over the file: the seed is captured from possibly-stale markdown and must not clobber a concurrent
   * external write, whereas real edits are not otherwise durable and must be persisted by whichever task
   * is last to leave — even one that only tailed the edits.
   */
  edited: boolean
  /** Whether this room has observed its doc become seeded — so a post-seed update counts as an edit but
   * the seed transition itself does not. See the `doc.on('update')` edit-tracking below. */
  seededObserved: boolean
  /** The pending debounced persist timer, if any. */
  persistTimer: ReturnType<typeof setTimeout> | null
  /** Absolute time (ms) by which a debounced persist must fire even under continuous editing (the
   * max-wait cap); null when no persist is pending. */
  persistDeadline: number | null
  /**
   * The durable file version (its `updatedAt`, epoch ms) this live doc is known to be synced to — set
   * on seed, advanced when a durable write is merged in (apply-edit) and on each successful persist. It
   * is the `If-Match` token {@link flushPersist} sends so a persist can never clobber an out-of-band
   * edit the live doc hasn't incorporated. `null` before the first seed (persist writes unconditionally).
   */
  syncedVersion: number | null
  /**
   * Epoch ms until which a client is treated as actively streaming an agent edit into this doc —
   * refreshed on every agent frame ({@link AGENT_SYNC_ORIGIN}/{@link REDIS_AGENT_ORIGIN}). While it is in
   * the future, a durable {@link applyMarkdownToLiveFileDoc} merge DEFERS its content diff to that client
   * (which applies the same content into the shared doc), preventing the two-writer duplication; the merge
   * still records the durable version. The single-replica counterpart of the cluster-wide
   * {@link FileDocStore.isAgentStreaming} flag. `0` when no agent stream is active.
   */
  agentStreamingUntil: number
  /**
   * Resolves once this room's doc reflects the file's shared stream (see {@link FileDocStore.catchUp}).
   * Rejects when replay cannot complete so the join fails closed rather than serving partial state.
   */
  hydrated: Promise<void>
  /**
   * How many joins are currently preparing this room. A room is created by the first join and has no
   * owner until that join commits, so without this a concurrent last-leave would tear down the very
   * document being assembled. A room with a join in flight is not idle.
   */
  pendingJoins: number
  /** Acknowledged updates currently waiting for their durable stream append. */
  pendingUpdates: number
}

/** Live documents keyed by Socket.IO room name. Module-global: one Y.Doc per file. */
const fileDocRooms = new Map<string, FileDocRoom>()
const pendingFileDocPersists = new Set<Promise<void>>()
const pendingFileDocUpdates = new Set<Promise<void>>()
/** socketId → its current file-doc room name (a socket edits at most one doc). */
const socketToRoomName = new Map<string, string>()
/**
 * socketId → a monotonic file-intent generation. Switching files or leaving the
 * intended file advances it; co-mounted providers joining the same file share it.
 * After async authorization, a join proceeds only while its generation is current,
 * preventing an out-of-order completion from binding the socket to the wrong file.
 */
const joinGeneration = new Map<string, number>()
const MAX_YJS_CLIENT_ID = 0xffff_ffff

function isYjsClientId(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_YJS_CLIENT_ID
  )
}

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

const fileDocRoom = (fileId: string): RoomRef => ({
  type: ROOM_TYPES.WORKSPACE_FILE_DOC,
  id: fileId,
})

/** Pending admissions receive invalidations here, never document or presence frames. */
export function fileDocAdmissionRoom(fileId: string): string {
  return `file-doc-admission:${fileId}`
}

/**
 * A `y-protocols` transaction/awareness origin is the emitting socket id (a
 * string) when it came from a client, and something else (`null` / `'local'` /
 * `'timeout'`) for server-internal changes. Returns the socket id to exclude
 * from a relay, or `null` to broadcast to the whole room.
 */
interface ClientUpdateOrigin {
  kind: 'client-update'
  socketId: string
}

const MAX_CLIENT_UPDATE_ID_LENGTH = 128

function clientUpdateOrigin(socketId: string): ClientUpdateOrigin {
  return { kind: 'client-update', socketId }
}

function isClientUpdateOrigin(origin: unknown): origin is ClientUpdateOrigin {
  return (
    typeof origin === 'object' &&
    origin !== null &&
    (origin as Partial<ClientUpdateOrigin>).kind === 'client-update' &&
    typeof (origin as Partial<ClientUpdateOrigin>).socketId === 'string'
  )
}

function originSocketId(origin: unknown): string | null {
  if (typeof origin === 'string') return origin
  return isClientUpdateOrigin(origin) ? origin.socketId : null
}

/**
 * The transaction origin stamped on an agent-streamed frame (a {@link FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST}
 * apply). A non-string sentinel, so `originSocketId` returns `null` for it and the update never triggers
 * `edited`/`schedulePersist` (the copilot's final `edit_content` write is the durable persist). Unlike a
 * client edit, it is marked so peers do not treat it as a durable user edit. The emitting provider no-ops
 * on its own echo because the operations are already applied locally.
 */
const AGENT_SYNC_ORIGIN = Symbol('file-doc-agent-sync')
/** Maximum legacy framed message size: raw update budget plus small Yjs framing headroom. */
const MAX_LEGACY_FRAME_BYTES = FILE_DOC_LIMITS.updateBytes + 64

/**
 * Checks the inner update before readSyncMessage mutates the room: the legacy outer-frame limit
 * includes framing headroom, which must not allow an update too large for the shared stream.
 */
function hasOversizedLegacyUpdate(bytes: Uint8Array): boolean {
  const decoder = decoding.createDecoder(bytes)
  const messageType = decoding.readVarUint(decoder)
  if (
    messageType !== FILE_DOC_MESSAGE_TYPE.SYNC &&
    messageType !== FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST
  ) {
    return false
  }
  const syncType = decoding.readVarUint(decoder)
  if (syncType !== syncProtocol.messageYjsSyncStep2 && syncType !== syncProtocol.messageYjsUpdate) {
    return false
  }
  return decoding.readVarUint8Array(decoder).byteLength > FILE_DOC_LIMITS.updateBytes
}

/**
 * Broadcast an AWARENESS frame to the room ACROSS tasks via the Socket.IO Redis adapter. Awareness
 * (cursors/selection) is ephemeral and needs no convergence or replay, so the adapter's cross-task
 * fan-out is exactly right for it.
 */
function broadcast(io: Server, name: string, payload: Uint8Array, exceptSocketId: string | null) {
  const channel = exceptSocketId ? io.to(name).except(exceptSocketId) : io.to(name)
  channel.emit(FILE_DOC_EVENTS.MESSAGE, payload)
}

/**
 * Broadcast a DOC-SYNC frame to this task's LOCAL clients only. Cross-task delivery rides the shared
 * Redis stream (each task's tailer applies the update and runs its OWN local fan-out), so using the
 * adapter here would double-deliver and amplify. With no adapter (single-pod dev) `io.local` is the
 * whole room, so behavior is unchanged.
 */
function broadcastLocal(
  io: Server,
  name: string,
  payload: Uint8Array,
  exceptSocketId: string | null
) {
  const channel = exceptSocketId ? io.local.to(name).except(exceptSocketId) : io.local.to(name)
  channel.emit(FILE_DOC_EVENTS.MESSAGE, payload)
}

/**
 * Schedule a debounced server-side persist of the live doc back to durable markdown. Coalesces rapid
 * edits; a no-op until the room knows its workspace (set at join). A {@link PERSIST_MAX_WAIT_MS}
 * max-wait caps the debounce so a continuous burst still persists periodically. The final flush on
 * last-disconnect is separate ({@link flushPersist} with `final`).
 */
function schedulePersist(name: string, room: FileDocRoom): void {
  if (!room.workspaceId || !room.lastEditorUserId) return
  const now = Date.now()
  if (room.persistDeadline === null) room.persistDeadline = now + PERSIST_MAX_WAIT_MS
  if (room.persistTimer) clearTimeout(room.persistTimer)
  const delay = Math.max(0, Math.min(PERSIST_DEBOUNCE_MS, room.persistDeadline - now))
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null
    room.persistDeadline = null
    void flushPersist(name, room, false)
  }, delay)
}

/**
 * Project the live doc to markdown and write it durably via the app. `final` (last collaborator
 * leaving) always writes; a debounced mid-edit flush first claims a best-effort cross-task dedup WINDOW
 * (a TTL key that just expires, so at most ~one persist per window cluster-wide) so concurrent tasks
 * editing the same file don't each write a redundant blob version. Best-effort: never throws (a failure
 * is retried on the next debounce; the stream holds the state meanwhile).
 *
 * Persists the AUTHORITATIVE shared state (the stream), not this task's local doc: a copilot merge — or
 * a peer's edit — published by another task may not be integrated into `room.doc` yet (and the stream
 * holds content even when THIS task's doc was never locally seeded), so a last-disconnect flush can't
 * clobber the durable file with a lagging projection. The local doc is captured SYNCHRONOUSLY as a
 * fallback before any await, so a `void flushPersist(name, room, true)` fired immediately before the
 * caller destroys `room.doc` never encodes a destroyed doc, and the disabled path stays authoritative.
 */
function flushPersist(name: string, room: FileDocRoom, final: boolean): Promise<void> {
  const pending = persistRoom(name, room, final).finally(() =>
    pendingFileDocPersists.delete(pending)
  )
  pendingFileDocPersists.add(pending)
  return pending
}

async function persistRoom(name: string, room: FileDocRoom, final: boolean): Promise<void> {
  // Never project a doc no user actually edited back over the file (see {@link FileDocRoom.edited}).
  if (!room.edited || !room.workspaceId || !room.lastEditorUserId) return
  const store = getFileDocStore()
  const generation = docIdOf(room.doc)
  const workspaceId = room.workspaceId
  const userId = room.lastEditorUserId
  // Synchronous fallback capture — before any await, since the caller may destroy `room.doc` the moment
  // this yields. Only meaningful once seeded; used only when the authoritative stream state is absent.
  const localState = isDocSeeded(room.doc) ? Y.encodeStateAsUpdate(room.doc) : null

  // Capture the AUTHORITATIVE doc state: the shared stream when enabled (a copilot merge or a peer's
  // edit published by another task may not be integrated into THIS task's `room.doc` yet), else the
  // local snapshot. Re-read each attempt so a post-reconcile retry projects the converged state.
  const captureState = async (): Promise<Uint8Array | null> => {
    if (!store.enabled) {
      // Single-pod: re-read the live doc so a post-reconcile retry projects the CONVERGED state, not the
      // snapshot captured before the reconcile mutated it (which — with the version already advanced —
      // would let the If-Match pass and clobber the reconciled edit). Fall back to that snapshot once the
      // room is torn down (last-leave), where the doc is gone and there is nothing left to reconcile.
      return fileDocRooms.get(name) === room && isDocSeeded(room.doc)
        ? Y.encodeStateAsUpdate(room.doc)
        : localState
    }
    try {
      return (await store.getStreamState(name)) ?? localState
    } catch (streamError) {
      if (streamError instanceof FileDocInvalidatedError) throw streamError
      // A transient Redis read must NOT drop the write when we already hold a valid local snapshot —
      // else the last-disconnect flush loses the session's edits as the room is torn down. But once a
      // reconcile has run, `localState` is NULLED (it predates the merged-in out-of-band edit), so a
      // failed read then correctly THROWS and aborts rather than clobbering with the stale snapshot.
      if (!localState) throw streamError
      logger.warn(`Stream state unavailable for file ${room.fileId}; persisting local snapshot`, {
        error: getErrorMessage(streamError),
      })
      return localState
    }
  }
  // The If-Match token: the freshest synced version known — max of the cluster value (Redis) and the
  // room's, so a lagging fire-and-forget `setSyncedVersion` can't let a stale read shadow a newer local
  // value (versions are monotonic epoch-ms). Cached back into the room so a later transient Redis failure
  // — or a peer-seeded/tail-only task that never set it locally — still resolves it. `undefined` if unknown.
  const currentVersion = async (): Promise<number | undefined> => {
    const shared = store.enabled ? await store.getSyncedVersion(name) : null
    const best = Math.max(shared ?? 0, room.syncedVersion ?? 0)
    if (best > 0) room.syncedVersion = best
    return best > 0 ? best : undefined
  }

  try {
    if (!(await store.isDocumentGenerationCurrent(name, generation))) return
    if (!final && !(await store.tryClaimPersistWindow(name, FILE_DOC_TIMEOUTS.persistRequestMs))) {
      if (fileDocRooms.get(name) === room) schedulePersist(name, room)
      return
    }

    // The If-Match token: the durable content version the live doc is synced to.
    let ifMatch = await currentVersion()
    // FINAL flush = last chance before teardown: if the version read momentarily fails (Redis blip) for a
    // peer-seeded/tail-only task that never cached it, retry briefly rather than defer and strand the
    // edits in the TTL'd stream (the version is cluster-wide + heartbeat-refreshed). Bounded — a genuinely
    // unset version never appears, and the flush must not stall teardown.
    for (
      let i = 0;
      ifMatch === undefined && final && store.enabled && i < FINAL_VERSION_RETRIES;
      i++
    ) {
      await sleep(FINAL_VERSION_RETRY_MS)
      ifMatch = await currentVersion()
    }

    // Persist under optimistic concurrency (RFC 7232 If-Match): the write commits only if the file is
    // still at the version the live doc synced from, so a projection can never silently clobber an
    // out-of-band edit. A single attempt — on conflict we STOP rather than retry (see below).
    const docState = await captureState()
    if (!docState) return // nothing seeded/authoritative to persist yet
    if (!(await store.isDocumentGenerationCurrent(name, generation))) return
    const result = await fetchFileDocPersist(workspaceId, room.fileId, userId, docState, ifMatch)
    if (result.status === 'missing') return // the file was deleted; nothing to write
    if (result.status === 'deferred') {
      // No version token available (momentarily — a Redis blip on a peer-seeded task). Leave the edits in
      // the stream; a later persist writes them once the version is re-established.
      logger.warn(`Persist deferred for file ${room.fileId} (no synced version available yet)`)
      return
    }
    if (result.status === 'persisted') {
      room.syncedVersion = Math.max(room.syncedVersion ?? 0, result.version)
      // AWAITED, unlike every other version write: the room's own copy dies with the room, so this
      // cluster key is the only record that survives a teardown or a process restart. Fire-and-forget
      // here means a task that exits in the moments after a write comes back holding a version older
      // than the file's, and — since a conflict neither writes nor advances the token — never persists
      // that document again. One round trip after a blob write is not a cost worth that.
      await store.setSyncedVersion(name, result.version, generation)
      return
    }
    /**
     * External writes commit before merging into the stream. Retrying or advancing the synced
     * version here could overwrite content not yet merged; leave the durable file authoritative
     * until the merge advances the version, then let a later flush persist the converged state.
     */
    logger.warn(
      `Persist conflict for file ${room.fileId}; durable content advanced out-of-band, left authoritative`
    )
  } catch (error) {
    logger.warn(`Persist failed for file ${room.fileId}`, {
      error: getErrorMessage(error),
    })
  }
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
  // One entry PER SOCKET (session), not per clientID: a socket's several providers are the same
  // authenticated user, so any of its owners carries the identity; the client dedupes per user for the
  // avatar stack (see the roster comment above). An empty inner map is never stored, so `owner` exists.
  for (const [socketId, clientMap] of room.owners) {
    const owner = clientMap.values().next().value
    if (!owner) continue
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

/** The identity of the document this doc holds ({@link FILE_DOC_SEED.docIdKey}), if it carries one. */
function docIdOf(doc: Y.Doc): string | undefined {
  const docId = doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)
  return typeof docId === 'string' ? docId : undefined
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
 * Drop a room's document + awareness once it has no owners on THIS task, so an idle file holds no
 * memory. Before dropping, flush the converged doc back to durable markdown (the last collaborator on
 * this task leaving) and detach from the shared stream. A later joiner re-creates it — catching up
 * from the stream if the doc is still live on another task, or re-seeding from markdown otherwise.
 *
 * A room being PREPARED for a join is not idle even though it has no owners yet: tearing it down there
 * would drop the hydration/seed that join is waiting on, and the join would have to start over.
 */
function destroyRoomIfIdle(name: string) {
  const room = fileDocRooms.get(name)
  if (!room || room.owners.size > 0 || room.pendingJoins > 0 || room.pendingUpdates > 0) return
  room.persistDeadline = null
  if (room.persistTimer) {
    clearTimeout(room.persistTimer)
    room.persistTimer = null
  }
  // Final durable flush BEFORE teardown — `flushPersist` encodes the doc synchronously (before the
  // destroy below) and awaits the write in the background. Best-effort; never throws.
  void flushPersist(name, room, true)
  getFileDocStore().detachRoom(name)
  room.awareness.destroy()
  room.doc.destroy()
  fileDocRooms.delete(name)
}

/**
 * Drop a seeded in-memory generation after an out-of-band durable replacement. It must not flush: the
 * durable replacement is newer, and persisting this superseded document would only create a conflict.
 * Existing clients are removed from the room before the next join creates and seeds a fresh document.
 */
function discardInvalidatedRoom(name: string, io: Server): void {
  const room = fileDocRooms.get(name)
  if (!room) return
  room.persistDeadline = null
  if (room.persistTimer) clearTimeout(room.persistTimer)
  room.persistTimer = null
  for (const socketId of room.owners.keys()) {
    if (socketToRoomName.get(socketId) === name) socketToRoomName.delete(socketId)
    io.in(socketId).socketsLeave(name)
  }
  getFileDocStore().detachRoom(name)
  room.awareness.destroy()
  room.doc.destroy()
  fileDocRooms.delete(name)
}

/**
 * Flush every open, edited room's converged doc to durable markdown, AWAITING the writes. Called on
 * graceful shutdown (rolling deploy / scale-in) so edits since the last debounce aren't left only in the
 * ephemeral stream — the per-socket disconnect flush is fire-and-forget and would race `process.exit`.
 * Best-effort and bounded by each persist's own timeout; never throws. Rooms are NOT torn down here (the
 * process is exiting); only their durable state is secured.
 */
export async function flushAllFileDocRooms(): Promise<void> {
  await Promise.all([...pendingFileDocUpdates])
  const flushes: Promise<void>[] = []
  for (const [name, room] of fileDocRooms) {
    if (room.edited) flushes.push(flushPersist(name, room, true))
  }
  await Promise.all([...pendingFileDocPersists, ...flushes])
}

/**
 * Waits for shared hydration and authoritative seeding before joining; failures must not expose
 * an editable partial document.
 */
async function ensureRoomReady(
  name: string,
  room: FileDocRoom,
  workspaceId: string | null
): Promise<void> {
  await room.hydrated
  // The room can be dropped and re-created while the catch-up is in flight (a fast open→close); the
  // join re-checks identity after this and abandons a stale room rather than serving from it.
  if (fileDocRooms.get(name) !== room) return
  if (!workspaceId) throw new Error(`File document ${room.fileId} has no workspace context`)
  await ensureServerSeed(name, room, workspaceId)
  if (fileDocRooms.get(name) === room && !isDocSeeded(room.doc)) {
    throw new Error(`File document ${room.fileId} could not be seeded`)
  }
}

/**
 * Share one authoritative seed attempt across concurrent joins so none observes an unseeded doc.
 * Clear settled attempts to allow retry after transient failures. Existing empty files have a named
 * seed; a missing file must fail admission rather than create an editable blank room.
 */
function ensureServerSeed(name: string, room: FileDocRoom, workspaceId: string): Promise<void> {
  if (isDocSeeded(room.doc)) return Promise.resolve()
  room.seeding ??= runServerSeed(name, room, workspaceId).finally(() => {
    room.seeding = null
  })
  return room.seeding
}

/**
 * Whichever task wins the seed lock writes the seed; the others must end up holding the SAME seed
 * before they serve anyone. They pull it, on this cadence, rather than waiting for the tailer to push
 * it: a join's readiness may not depend on an asynchronous subscriber, because when that delivery is
 * late or lost the client sits on an empty document until its readiness deadline lapses and the file
 * opens read-only. Bounded by the longest a legitimate seed can take (the winner's own fetch bound),
 * which stays inside the client's readiness deadline — see {@link FILE_DOC_TIMEOUTS}.
 */
const SEED_WAIT_RETRY_MS = 150

class FileDocNotFoundError extends Error {}

async function runServerSeed(name: string, room: FileDocRoom, workspaceId: string): Promise<void> {
  const store = getFileDocStore()
  const deadline = Date.now() + FILE_DOC_TIMEOUTS.seedRequestMs
  while (fileDocRooms.get(name) === room && !isDocSeeded(room.doc)) {
    // Exactly one task across the cluster builds the seed; the others receive it via the stream (the
    // fix for split-brain seeding). Returns a lock token here (single-pod: a sentinel token).
    const token = await store.shouldSeed(name)
    if (token) {
      await seedUnderLock(name, room, workspaceId, token)
      return
    }
    // No token: a peer holds the lock with its fetch in flight, or the stream is already seeded (which
    // includes a PRIOR room for this same file whose seed landed after we read the stream). Either way
    // the seed can only appear in the stream, so read it rather than wait to be told.
    await store.catchUp(name)
    if (isDocSeeded(room.doc) || Date.now() >= deadline) return
    await sleep(SEED_WAIT_RETRY_MS)
  }
}

/** Fetch, publish, and apply the seed while holding the cluster's seed lock for this file. */
async function seedUnderLock(
  name: string,
  room: FileDocRoom,
  workspaceId: string,
  token: string
): Promise<void> {
  const store = getFileDocStore()
  // Release the lock on EVERY exit from here (one `finally`, impossible to leak).
  try {
    const seed = await fetchFileDocSeed(workspaceId, room.fileId)
    if (fileDocRooms.get(name) !== room || isDocSeeded(room.doc)) return
    if (!seed) throw new FileDocNotFoundError('File not found')
    /**
     * Publish before local apply: the atomic empty-stream append, not the expiring lock, prevents
     * independent Yjs histories from entering the same room.
     */
    const didSeed = await store.seedIfEmpty(name, seed.update, seed.version)
    /**
     * Record only our winning seed's version before the readiness guard: the tailer may already have
     * applied it during the append, but persistence still needs the matching local version.
     */
    if (didSeed) {
      const live = fileDocRooms.get(name)
      if (live) live.syncedVersion = Math.max(live.syncedVersion ?? 0, seed.version)
    }
    if (fileDocRooms.get(name) !== room || isDocSeeded(room.doc)) return
    if (didSeed) {
      Y.applyUpdate(room.doc, seed.update, SEED_ORIGIN)
    } else {
      // A peer won the atomic append: we must NOT apply our own — a second, different-client-id seed IS
      // the split-brain. Read THEIRS out of the stream instead of waiting for the tailer to deliver it,
      // so this room is seeded by the time the caller is told it is ready.
      await store.catchUp(name)
    }
  } catch (error) {
    if (error instanceof FileDocNotFoundError) throw error
    logger.warn(`Server seed failed for file ${room.fileId} (workspace ${workspaceId})`, error)
  } finally {
    await store.releaseSeedLock(name, token)
  }
}

/** Serializes live merges per file so overlapping calls never race the same doc (see below). */
const fileDocMergeChains = new Map<string, Promise<unknown>>()

/**
 * How a merge is positioned on the file's version line — mirrors the sim-side `LiveFileDocMergeOrder`
 * wire field. A durable `version` is checked (applied only if newer than the doc's current version) AND
 * recorded as the synced version.
 */
interface MergeOrder {
  version?: number
}

/**
 * Apply new markdown into a file's LIVE collaborative document (Stage C — copilot writing into an open
 * doc). Ships the document's current state to the app to build a minimal Yjs diff, applies it — which
 * fires `doc.on('update')` and relays the merge to every connected editor, reconciled with any
 * concurrent user edits — and reports whether it landed.
 *
 * Merges for the same file are SERIALIZED — within a task by the {@link fileDocMergeChains} promise
 * chain, and ACROSS tasks by a Redis merge lock (below) — so each diff is computed against the previous
 * merge's result, never the same stale base concurrently.
 *
 * Multi-task: the diff is computed against, and published to, the file's SHARED stream state — so the
 * merge reaches the live doc no matter which task holds it (the apply-edit HTTP call can land on any
 * task). Every task's tailer then applies it and fans it out to its own clients. Because the merge
 * always lands in the stream while the stream exists, the stream can never go stale relative to a
 * copilot direct file write.
 *
 * Returns `'no-live-room'` when there is no shared state to merge against (no doc is or was recently
 * live): the caller (copilot) writes the file directly and the next open seeds from that markdown.
 * Returns `'merge-unavailable'` when the cross-task merge lock could not be acquired (transient
 * contention, not an absent stream) — the caller likewise falls back to a direct write, but a persist
 * reconcile treats it distinctly (retry later) rather than as "nothing to reconcile into".
 */
export function applyMarkdownToLiveFileDoc(
  fileId: string,
  markdown: string,
  order: MergeOrder = {}
): Promise<'applied' | 'no-live-room' | 'merge-unavailable' | 'stale'> {
  const name = roomName(fileDocRoom(fileId))
  return serializeFileDocMutation(name, () => mergeMarkdownIntoRoom(name, fileId, markdown, order))
}

function serializeFileDocMutation<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const prior = fileDocMergeChains.get(name) ?? Promise.resolve()
  const run = prior
    .catch(() => {})
    .then(operation)
    .finally(() => {
      if (fileDocMergeChains.get(name) === run) fileDocMergeChains.delete(name)
    })
  fileDocMergeChains.set(name, run)
  return run
}

async function acquireFileDocMergeSlot(name: string): Promise<string | null> {
  const store = getFileDocStore()
  let token = await store.acquireMergeSlot(name, MERGE_LOCK_TTL_MS)
  for (let i = 0; !token && i < MERGE_LOCK_RETRIES; i++) {
    await sleep(MERGE_LOCK_RETRY_MS)
    token = await store.acquireMergeSlot(name, MERGE_LOCK_TTL_MS)
  }
  return token
}

/** Serializes and version-orders an unsupported durable replacement with live Markdown merges. */
export function invalidateLiveFileDocument(
  fileId: string,
  version: number
): Promise<{ status: 'applied'; docId?: string } | { status: 'stale' }> {
  const name = roomName(fileDocRoom(fileId))
  return serializeFileDocMutation(name, async () => {
    const store = getFileDocStore()
    const token = await acquireFileDocMergeSlot(name)
    if (!token) throw new Error('Live document invalidation slot is temporarily unavailable')
    try {
      if ((fileDocRooms.get(name)?.syncedVersion ?? 0) > version) return { status: 'stale' }
      return await store.invalidateDocument(name, version)
    } finally {
      await store.releaseMergeSlot(name, token)
    }
  })
}

async function mergeMarkdownIntoRoom(
  name: string,
  fileId: string,
  markdown: string,
  { version }: MergeOrder
): Promise<'applied' | 'no-live-room' | 'merge-unavailable' | 'stale'> {
  const store = getFileDocStore()

  // The durable version this merge carries is now incorporated in the live doc — record it (cluster-wide
  // in Redis for multi-task, plus this task's room) so the persist If-Match guard treats this write as
  // synced rather than an out-of-band conflict. AWAITED so the version is durable before the merge lock
  // releases, so the next lock holder's staleness check (below) reads a consistent value.
  const recordVersion = async (generation?: string) => {
    if (version === undefined) return
    const room = fileDocRooms.get(name)
    // Never regress the token: merges/seeds/persists all write it, so a lower value arriving out of
    // order must not shadow a higher one the doc already incorporates (the Redis side is guarded
    // identically by SET_VERSION_IF_NEWER_SCRIPT).
    if (room && (generation === undefined || docIdOf(room.doc) === generation)) {
      room.syncedVersion = Math.max(room.syncedVersion ?? 0, version)
    }
    await store.setSyncedVersion(name, version, generation)
  }

  // Order this merge on the file's version line, where `current` is the durable version the doc already
  // incorporates. `version` is a DB-monotonic `contentUpdatedAt` value (no wall-clock), so ordering is
  // immune to clock skew: a durable `version` is stale if it is NOT strictly newer than `current` — a
  // newer durable write already landed (possibly on another process, out of dispatch order); applying its
  // older markdown would regress the doc while the monotonic token stays high. A merge with no `version`
  // is never stale (legacy, unordered).
  const isStale = (current: number): boolean => {
    if (version !== undefined) return version <= current
    return false
  }

  if (store.enabled) {
    // Serialize merges to this file ACROSS tasks — the per-file chain above only covers this process.
    // Two copilot edits to the same file landing on different tasks must not diff the SAME shared base
    // and publish conflicting full-document rewrites. Retry LONGER than the lock TTL, so a live holder
    // always releases (or its lock expires) first and we acquire — never merging against a shared base
    // while a peer holds the lock. If somehow still unavailable, skip the live merge (copilot's durable
    // file write stands) rather than race.
    const token = await acquireFileDocMergeSlot(name)
    if (!token) {
      logger.warn(`Merge lock unavailable for file ${fileId}; skipping live merge`)
      return 'merge-unavailable'
    }
    try {
      // Staleness is checked under the lock against the cluster-wide synced version, so a durable merge
      // that lost the race to a newer one (on any process) is dropped rather than regressing the doc.
      const shared = await store.getSyncedVersion(name)
      const current = Math.max(shared ?? 0, fileDocRooms.get(name)?.syncedVersion ?? 0)
      if (isStale(current)) return 'stale'
      const generation = await store.getDocumentGeneration(name)
      // Defer to an actively-streaming client: it is applying this SAME agent edit into the shared doc
      // frame-by-frame, so also publishing a whole-document merge here would double-write the content (the
      // client's private shadow never observes this merge, so it re-inserts what we added → duplication).
      // Still record the durable version so the persist If-Match stays correct; the client owns the bytes,
      // and once streaming stops the flag clears and the final durable merge lands as a near-noop.
      if (await store.isAgentStreaming(name)) {
        await recordVersion(generation)
        return 'applied'
      }
      // Compute the diff against the committed SHARED state and PUBLISH it — every task with the doc
      // live (including this one, via its own tailer) applies it and fans it out to its clients, so the
      // merge reaches the live doc no matter which task the apply-edit call landed on. An empty stream
      // means no doc is (or was recently) live → nothing to merge into. AWAIT the publish so the diff is
      // durably in the stream before we release the lock (else the next task would diff a stale base).
      const base = await store.getStreamState(name, generation)
      if (!base) return 'no-live-room'
      const diff = await fetchFileDocMerge(fileId, base, markdown)
      await store.publishAndWait(name, diff, generation)
      await recordVersion(generation)
      return 'applied'
    } finally {
      await store.releaseMergeSlot(name, token)
    }
  }

  // Single-replica fallback: apply straight to the local authoritative doc.
  const room = fileDocRooms.get(name)
  if (!room || room.owners.size === 0 || !isDocSeeded(room.doc)) return 'no-live-room'
  if (isStale(room.syncedVersion ?? 0)) return 'stale'
  // Defer to an actively-streaming client (see the multi-replica branch above) — it applies this agent
  // edit itself, so merging it here too would double-write. Record the version; skip the content merge.
  if (room.agentStreamingUntil > Date.now()) {
    await recordVersion()
    return 'applied'
  }
  const update = await fetchFileDocMerge(fileId, Y.encodeStateAsUpdate(room.doc), markdown)
  // The room may have been dropped while the diff was being built; never touch a destroyed doc.
  if (fileDocRooms.get(name) !== room) return 'no-live-room'
  // No transaction origin → `doc.on('update')` relays to the WHOLE room (every editor sees copilot).
  Y.applyUpdate(room.doc, update)
  await recordVersion()
  return 'applied'
}

/**
 * Get (or lazily create) the authoritative document for a room, wiring the two
 * relay handlers exactly once: document updates and awareness changes are
 * broadcast to the room.
 */
function getOrCreateRoom(io: Server, ref: RoomRef): FileDocRoom {
  const name = roomName(ref)
  const existing = fileDocRooms.get(name)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  // The server holds no cursor of its own; it only relays clients' awareness.
  awareness.setLocalState(null)

  // Started BEFORE the room is registered so no join can observe a room without its hydration handle.
  const hydrated = getFileDocStore().attachRoom(name, doc)
  const room: FileDocRoom = {
    fileId: ref.id,
    doc,
    awareness,
    owners: new Map(),
    seeding: null,
    workspaceId: null,
    lastEditorUserId: null,
    edited: false,
    seededObserved: false,
    persistTimer: null,
    persistDeadline: null,
    syncedVersion: null,
    agentStreamingUntil: 0,
    hydrated,
    pendingJoins: 0,
    pendingUpdates: 0,
  }
  // Register synchronously BEFORE the async catch-up so a concurrent join sees this room, not a second.
  fileDocRooms.set(name, room)

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeUpdate(encoder, update)
    // Fan out to every client on THIS task, including the origin socket. One shared Socket.IO connection
    // can host multiple providers for this file; excluding the whole socket would strand the sibling
    // provider's distinct Y.Doc. Yjs updates are idempotent, and the originating provider applies its
    // echo with the provider as transaction origin, so it does not send the update again. Cross-task
    // delivery rides the shared stream, where every task's tailer runs its own local fan-out.
    broadcastLocal(io, name, encoding.toUint8Array(encoder), null)
    // Share every locally-originated update to the stream so peers converge. Skip updates that already
    // came FROM the stream (REDIS_ORIGIN / REDIS_SNAPSHOT_ORIGIN / REDIS_AGENT_ORIGIN) and SEED_ORIGIN —
    // the seed is published EXPLICITLY and AWAITED under the seed lock (so it lands before the lock
    // releases), which a fire-and-forget publish here couldn't guarantee. An agent-streamed frame
    // (AGENT_SYNC_ORIGIN) is published WITH the agent marker so peer tasks tail it as REDIS_AGENT_ORIGIN
    // and never mark the doc edited on it (see the edit-tracker below).
    if (
      origin !== REDIS_ORIGIN &&
      origin !== REDIS_SNAPSHOT_ORIGIN &&
      origin !== REDIS_AGENT_ORIGIN &&
      origin !== SEED_ORIGIN &&
      !isClientUpdateOrigin(origin)
    )
      getFileDocStore().publish(name, update, origin === AGENT_SYNC_ORIGIN)
    // A locally-originated agent frame (this task's stream leader) means a client is applying this agent
    // edit itself. Refresh the "actively streaming" markers so a durable `applyMarkdownToLiveFileDoc`
    // merge defers to that client instead of double-writing the same content (the two-writer
    // duplication). Both are TTL'd, so they self-clear once frames stop and the final durable merge then
    // lands as a near-noop. Only AGENT_SYNC_ORIGIN is handled: the in-memory marker is read solely by the
    // single-replica merge branch (where every agent frame is AGENT_SYNC_ORIGIN), and the cluster flag is
    // read cluster-wide, so a peer task tailing REDIS_AGENT_ORIGIN never needs to set either.
    if (origin === AGENT_SYNC_ORIGIN) {
      room.agentStreamingUntil = Date.now() + AGENT_STREAM_FLAG_TTL_MS
      void getFileDocStore().markAgentStreaming(name, AGENT_STREAM_FLAG_TTL_MS)
    }
    // Edit tracking for persistence. Mark the doc dirty on any update applied AFTER it was seeded — a
    // local user edit (socket origin) OR a peer's edit relayed via the tailer (REDIS_ORIGIN) — so
    // whichever task is last to leave persists real edits, even one that only tailed them. A compaction
    // snapshot on catch-up (REDIS_SNAPSHOT_ORIGIN) also counts: it folds real edits into one frame, so a
    // fresh task catching up purely from it must not treat the doc as unedited. The seed transition
    // itself is never counted, so a seeded-but-unedited doc is never projected back over the file. An
    // agent-streamed frame ({@link FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST}) is never counted anywhere: on
    // the ORIGINATING task it applies under {@link AGENT_SYNC_ORIGIN}, and across replicas it is published
    // WITH the agent marker so PEER tasks tail it as REDIS_AGENT_ORIGIN — neither is in the edited set
    // below. So a transient startup-race duplicate between two stream leaders is never eligible for
    // persistence; the copilot's durable `edit_content` write remains the sole authority over file bytes.
    const seededBefore = room.seededObserved
    if (isDocSeeded(room.doc)) room.seededObserved = true
    if (
      originSocketId(origin) ||
      origin === REDIS_SNAPSHOT_ORIGIN ||
      (seededBefore && origin === REDIS_ORIGIN)
    )
      room.edited = true
    // Debounce a persist for LOCAL user edits only (peers debounce their own).
    if (originSocketId(origin)) schedulePersist(name, room)
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
  clientId: unknown,
  error: string,
  code: string,
  retryable: boolean
) {
  const normalizedClientId = isYjsClientId(clientId) ? clientId : undefined
  socket.emit(FILE_DOC_EVENTS.JOIN_ERROR, {
    fileId: typeof fileId === 'string' ? fileId : '',
    clientId: normalizedClientId,
    error,
    code,
    retryable,
  })
}

/**
 * The permission occupying a file-doc room requires — `write`, since the room IS
 * the collaborative editor. Sourced from the shared map so the join check, the
 * per-frame gate below, and the re-validation sweep can never drift apart.
 */
const FILE_DOC_ACTION = ROOM_MEMBERSHIP_ACTIONS[ROOM_TYPES.WORKSPACE_FILE_DOC]

/**
 * Per-frame authorization for a socket's inbound document/awareness frames.
 *
 * Room membership alone is NOT a standing right to write: a collaborator removed
 * from the workspace — or downgraded to `read` — must stop landing durable edits on
 * an already-open socket, without waiting for the next re-validation sweep. This is
 * the synchronous half of that enforcement; the sweep is the asynchronous half.
 *
 * Reads the shared role cache without awaiting, because this sits on the Yjs relay
 * hot path (one call per keystroke-sized frame). Three outcomes:
 *  - fresh cached permission that satisfies `write` → accept.
 *  - fresh cached permission that does NOT → drop the frame and evict immediately.
 *  - nothing fresh cached (TTL lapsed) → accept this frame and kick off a background
 *    refresh, so the very next frames are gated on an authoritative read. Accepting
 *    is correct rather than lax: the entry was authoritative when written and every
 *    join records one, so the exposure is bounded by the same TTL the workflow
 *    write-path has always had, and the sweep evicts independently.
 */
function isFileDocWriteAllowed(socket: AuthenticatedSocket, io: Server, name: string): boolean {
  const userId = socket.userId
  const fileId = fileDocRooms.get(name)?.fileId
  if (!userId || !fileId) return false

  const room = fileDocRoom(fileId)
  const cached = peekRoomPermission(userId, room)
  if (cached === undefined) {
    // Single-flighted, so a burst of frames triggers at most one query.
    void resolveCurrentRoomPermission(userId, room, FILE_DOC_ACTION).catch(() => {})
    return true
  }
  if (satisfiesRoomMembership(cached, ROOM_TYPES.WORKSPACE_FILE_DOC)) return true

  logger.warn(
    `Dropping file-doc frame from user ${userId} whose access to file ${fileId} no longer permits writing`
  )
  // Evicting (not just dropping the frame) is what makes this stick: the registered
  // eviction handler clears `socketToRoomName`, and every inbound frame is gated on
  // that binding — so the socket cannot apply another document update even if it
  // keeps sending them.
  evictSocketFromRoom(socket, room, 'Your access to this document has been revoked', io)
  return false
}

/**
 * Reconciles this handler's pod-local state when the access re-validation sweep
 * evicts a socket from a file-doc room (the sweep has already emitted the
 * revocation and left the Socket.IO room). Scoped to the evicted room so a socket
 * that has since switched documents keeps the one it legitimately holds.
 */
registerRoomEvictionHandler(ROOM_TYPES.WORKSPACE_FILE_DOC, (socketId, room, io) => {
  if (socketToRoomName.get(socketId) !== roomName(room)) return
  cleanupFileDocForSocket(socketId, io)
})

function handleMessage(socket: AuthenticatedSocket, io: Server, data: unknown) {
  const name = socketToRoomName.get(socket.id)
  if (!name) return
  const room = fileDocRooms.get(name)
  if (!room) return
  if (!isFileDocWriteAllowed(socket, io, name)) return

  const bytes = toFileDocBytes(data)
  if (!bytes) return
  if (bytes.byteLength > MAX_LEGACY_FRAME_BYTES) {
    logger.warn('Dropping an oversized legacy file-doc frame', {
      socketId: socket.id,
      bytes: bytes.byteLength,
    })
    return
  }

  // A malformed frame from any client must never escape as a process-level
  // exception; drop it and keep the relay running.
  try {
    if (hasOversizedLegacyUpdate(bytes)) {
      logger.warn('Dropping a legacy file-doc update outside the durable stream budget', {
        socketId: socket.id,
        bytes: bytes.byteLength,
      })
      return
    }
    const decoder = decoding.createDecoder(bytes)
    const messageType = decoding.readVarUint(decoder)

    switch (messageType) {
      case FILE_DOC_MESSAGE_TYPE.SYNC: {
        // Attribute a server-side persist of the resulting edit to the actual editor (blob metadata). A
        // socket's providers are all the same user, so any owner's userId identifies the editor.
        const editor = room.owners.get(socket.id)?.values().next().value?.userId
        if (editor) room.lastEditorUserId = editor
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
      case FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST: {
        // An agent-streamed frame: apply + fan out to the room (so a collaborator sees the stream live) but
        // do NOT treat it as a durable user edit. Unlike SYNC, we do NOT set `lastEditorUserId`, and the
        // apply uses {@link AGENT_SYNC_ORIGIN} (a non-string sentinel) so `originSocketId` is `null` in
        // `doc.on('update')` — skipping `edited`/`schedulePersist`, and broadcasting to the WHOLE room
        // (including the sender socket, so a same-socket sibling provider stays live). The copilot's final
        // `edit_content` write remains the authoritative durable persist.
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, AGENT_SYNC_ORIGIN)
        if (encoding.length(encoder) > 1) {
          socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
        }
        break
      }
      case FILE_DOC_MESSAGE_TYPE.AWARENESS: {
        const update = decoding.readVarUint8Array(decoder)
        // Enforce presence ownership: a socket may only publish/remove awareness for a clientID it bound
        // at join, so a peer cannot spoof or clear another collaborator's caret. A socket can own SEVERAL
        // clientIDs (one per mounted provider), so the frame is accepted only if EVERY id it carries is
        // owned by this socket.
        const owned = room.owners.get(socket.id)
        if (owned === undefined || awarenessUpdateClientIds(update).some((id) => !owned.has(id))) {
          logger.warn('Dropping awareness frame for an unowned client id', {
            socketId: socket.id,
          })
          return
        }
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, socket.id)
        break
      }
      default:
        logger.warn('Unknown file-doc message type', { messageType })
    }
  } catch (error) {
    logger.warn('Dropping malformed file-doc frame', {
      socketId: socket.id,
      error,
    })
  }
}

async function handleClientUpdate(
  socket: AuthenticatedSocket,
  io: Server,
  data: unknown,
  acknowledge: (result: FileDocUpdateAck) => void
): Promise<void> {
  const reject = (
    code: Extract<FileDocUpdateAck, { status: 'rejected' }>['code'],
    retryable: boolean,
    updateId?: string
  ) => acknowledge({ status: 'rejected', code, retryable, updateId })

  if (typeof data !== 'object' || data === null) {
    reject('INVALID_UPDATE', false)
    return
  }

  const candidate = data as Partial<FileDocUpdatePayload>
  const update = toFileDocBytes(candidate.update)
  if (
    typeof candidate.fileId !== 'string' ||
    candidate.fileId.length === 0 ||
    typeof candidate.docId !== 'string' ||
    candidate.docId.length === 0 ||
    typeof candidate.updateId !== 'string' ||
    candidate.updateId.length === 0 ||
    candidate.updateId.length > MAX_CLIENT_UPDATE_ID_LENGTH ||
    !update ||
    update.byteLength === 0 ||
    update.byteLength > FILE_DOC_LIMITS.updateBytes
  ) {
    reject('INVALID_UPDATE', false, candidate.updateId)
    return
  }

  const name = socketToRoomName.get(socket.id)
  if (!name || name !== roomName(fileDocRoom(candidate.fileId))) {
    reject('NOT_JOINED', true, candidate.updateId)
    return
  }
  const room = fileDocRooms.get(name)
  if (!room) {
    reject('NOT_JOINED', true, candidate.updateId)
    return
  }
  if (!isFileDocWriteAllowed(socket, io, name)) {
    reject('ACCESS_REVOKED', false, candidate.updateId)
    return
  }
  if (docIdOf(room.doc) !== candidate.docId) {
    reject('DOCUMENT_REPLACED', false, candidate.updateId)
    return
  }

  const validationDoc = new Y.Doc()
  try {
    Y.applyUpdate(validationDoc, update)
  } catch (error) {
    logger.warn('Dropping malformed acknowledged file-doc update', {
      socketId: socket.id,
      fileId: candidate.fileId,
      updateId: candidate.updateId,
      error,
    })
    reject('INVALID_UPDATE', false, candidate.updateId)
    return
  } finally {
    validationDoc.destroy()
  }

  const editor = room.owners.get(socket.id)?.values().next().value?.userId
  if (editor) room.lastEditorUserId = editor
  room.pendingUpdates += 1
  try {
    const store = getFileDocStore()
    await store.publishClientUpdateAndWait(name, candidate.updateId, update, candidate.docId)
    if (
      !(await store.isDocumentGenerationCurrent(name, candidate.docId)) ||
      fileDocRooms.get(name) !== room
    ) {
      throw new FileDocInvalidatedError()
    }
    Y.applyUpdate(room.doc, update, clientUpdateOrigin(socket.id))
    room.edited = true
    schedulePersist(name, room)
    acknowledge({ status: 'accepted', updateId: candidate.updateId })
  } catch (error) {
    if (error instanceof FileDocInvalidatedError) {
      reject('DOCUMENT_REPLACED', false, candidate.updateId)
      return
    }
    logger.error('Failed to accept acknowledged file-doc update', {
      socketId: socket.id,
      fileId: candidate.fileId,
      updateId: candidate.updateId,
      error,
    })
    reject('TEMPORARY_FAILURE', true, candidate.updateId)
  } finally {
    room.pendingUpdates -= 1
    destroyRoomIfIdle(name)
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

  // The socket may own several clientIDs (one per provider it mounted for this file); drop them ALL.
  // The client only emits LEAVE / disconnects once its LAST provider for the file tears down, so a
  // per-socket cleanup here is correct — an earlier single-provider unmount already cleared its own
  // caret via its awareness removal.
  const clientMap = room.owners.get(socketId)
  room.owners.delete(socketId)
  if (clientMap !== undefined && clientMap.size > 0) {
    // Fires the awareness `update` handler with a non-socket origin → the removals
    // are broadcast to every remaining client, so the departed carets vanish.
    awarenessProtocol.removeAwarenessStates(room.awareness, [...clientMap.keys()], null)
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
  /** Co-mounted providers share invalidation membership until their last admission settles. */
  const pendingMemberships = new Map<string, number>()

  socket.on(FILE_DOC_EVENTS.JOIN, async (payload: JoinFileDocPayload) => {
    const { fileId, clientId } = payload
    // Hoisted so the catch can tell whether this join was superseded (a switch to another file)
    // before surfacing a retryable error for the abandoned one.
    let generation: number | undefined
    let registered = false
    try {
      const userId = socket.userId
      const userName = socket.userName

      if (!userId || !userName) {
        emitJoinError(
          socket,
          fileId,
          clientId,
          'Authentication required',
          'AUTHENTICATION_REQUIRED',
          false
        )
        return
      }
      if (!roomManager.isReady()) {
        emitJoinError(
          socket,
          fileId,
          clientId,
          'Realtime unavailable',
          'ROOM_MANAGER_UNAVAILABLE',
          true
        )
        return
      }
      if (
        typeof fileId !== 'string' ||
        fileId.length === 0 ||
        // A Yjs clientID is a uint32; reject malformed values before they can become ownership keys.
        !isYjsClientId(clientId)
      ) {
        emitJoinError(socket, fileId, clientId, 'Invalid join payload', 'INVALID_PAYLOAD', false)
        return
      }
      if ((payload.schemaVersion ?? FILE_DOC_LEGACY_SCHEMA_VERSION) !== FILE_DOC_SCHEMA_VERSION) {
        emitJoinError(
          socket,
          fileId,
          clientId,
          'This document version is not supported',
          'SCHEMA_VERSION_MISMATCH',
          false
        )
        return
      }

      // A generation represents the socket's intended FILE, not an individual provider. Co-mounted
      // providers for the same file must be allowed to join concurrently; switching files advances the
      // generation so every in-flight join for the old file is cancelled together.
      if (currentFileId !== fileId) {
        generation = (joinGeneration.get(socket.id) ?? 0) + 1
        joinGeneration.set(socket.id, generation)
        currentFileId = fileId
      } else {
        generation = joinGeneration.get(socket.id) ?? 0
      }

      const room = fileDocRoom(fileId)
      const name = roomName(room)
      const admissionName = fileDocAdmissionRoom(fileId)

      const authorized = await resolveRoomJoinAuth({
        userId,
        room,
        action: FILE_DOC_ACTION,
        logger,
        logLabel: `file-doc room for ${userId}`,
        messages: {
          verifyFailed: 'Failed to verify workspace access',
          notFound: 'File not found',
          accessDenied: 'Access denied to file',
        },
        emitError: ({ error, code, retryable }) =>
          emitJoinError(socket, fileId, clientId, error, code, retryable),
      })
      if (!authorized) return

      // Server-authenticated identity for the presence roster (never trusts the client-set
      // awareness). Resolved here so the generation guard below also covers this await.
      const avatarUrl = await resolveAvatarUrl(socket, userId)

      const store = getFileDocStore()
      const existing = fileDocRooms.get(name)
      if (
        existing &&
        isDocSeeded(existing.doc) &&
        !(await store.isDocumentGenerationCurrent(name, docIdOf(existing.doc))) &&
        fileDocRooms.get(name) === existing
      ) {
        discardInvalidatedRoom(name, io)
      }

      const entry = getOrCreateRoom(io, room)
      // The workspace the server-side persist writes back to — and what the seed is built from, so it
      // must be captured BEFORE the room is prepared below.
      if (authorized.workspaceId) entry.workspaceId = authorized.workspaceId

      // Hold the room open across the awaits below: it has no owner until this join commits, so a
      // concurrent last-leave would otherwise tear down the very document being prepared.
      entry.pendingJoins += 1
      let subscribed = false
      const isCurrentJoin = () =>
        !socket.disconnected &&
        joinGeneration.get(socket.id) === generation &&
        fileDocRooms.get(name) === entry
      const canRegisterJoin = () => {
        if (!isCurrentJoin()) return false
        const permission = peekRoomPermission(userId, room)
        if (satisfiesRoomMembership(permission ?? null, ROOM_TYPES.WORKSPACE_FILE_DOC)) return true
        emitJoinError(
          socket,
          fileId,
          clientId,
          'File access changed while joining',
          permission === undefined ? 'JOIN_FAILED' : 'ACCESS_DENIED',
          permission === undefined
        )
        return false
      }
      try {
        // A client is attached to a WHOLE document or to nothing. A room assembles itself from the
        // shared stream and the server seed, and both land in the same Y.Doc that fans every update out
        // to its room — so a socket attached mid-assembly is not sent the document, it is sent the
        // document's history, and it watches that replay on screen (reload right after moving a block
        // and the block moves again in front of you). Waiting here is what makes the handshake below
        // authoritative: the client's first sync IS the finished document, in one message.
        await ensureRoomReady(name, entry, entry.workspaceId)

        // Re-check access immediately before registering, mirroring the workflow join: the
        // access re-validation sweep records a revocation BEFORE it evicts, so a join that
        // authorized just before the revocation must not complete afterwards and re-bind
        // the socket to the document. This RE-RESOLVES rather than peeking the cache — a
        // peek treats an expired entry as unknown and fails open, which a join stalled
        // longer than the cache TTL would slip straight through. Normally a cache hit (this
        // join's own authorize just warmed it), so it costs no extra query.
        const currentPermission = await resolveCurrentRoomPermission(userId, room, FILE_DOC_ACTION)
        if (!satisfiesRoomMembership(currentPermission, ROOM_TYPES.WORKSPACE_FILE_DOC)) {
          logger.warn(
            `User ${userId} lost write access to file ${fileId} before the join completed`
          )
          emitJoinError(socket, fileId, clientId, 'Access denied to file', 'ACCESS_DENIED', false)
          return
        }
        if (!isCurrentJoin()) return

        /**
         * Watch invalidations before checking the generation, including broadcasts from another
         * replica. Pending clients must not receive document or presence frames before authorization.
         */
        pendingMemberships.set(name, (pendingMemberships.get(name) ?? 0) + 1)
        subscribed = true
        await socket.join(admissionName)
        const joinedVersion =
          Math.max(entry.syncedVersion ?? 0, (await store.getSyncedVersion(name)) ?? 0) || undefined
        /** Adapter membership can wait; resolve access again before checking the final generation. */
        const finalPermission = await resolveCurrentRoomPermission(userId, room, FILE_DOC_ACTION)
        if (!satisfiesRoomMembership(finalPermission, ROOM_TYPES.WORKSPACE_FILE_DOC)) {
          emitJoinError(socket, fileId, clientId, 'Access denied to file', 'ACCESS_DENIED', false)
          return
        }
        const currentDocument = await store.isDocumentGenerationCurrent(name, docIdOf(entry.doc))
        if (!isCurrentJoin()) return
        if (!currentDocument) {
          emitJoinError(
            socket,
            fileId,
            clientId,
            'Document changed while joining',
            'JOIN_FAILED',
            true
          )
          return
        }
        if (!canRegisterJoin()) return
        await socket.join(name)
        /** Adapter joins can wait; recheck access and liveness before ownership or synchronization. */
        if (!canRegisterJoin()) return

        // A client id must be owned by at most one user, or a peer could bind an active
        // collaborator's id and pass the per-frame ownership check to spoof/clear its caret.
        // Distinguish a reconnect from a spoof by the owning user: the same user reclaiming its
        // own client id (a dropped socket reconnecting reuses the Yjs client id, and its prior
        // socket may not be cleaned up yet) takes over the stale binding; a DIFFERENT user is
        // rejected. This runs BEFORE any teardown of the socket's current binding below, so a
        // rejected rebind — even during a document switch — leaves the socket's existing document
        // and caret untouched.
        for (const [otherSid, clientMap] of entry.owners) {
          if (otherSid === socket.id) continue
          const owner = clientMap.get(clientId)
          if (owner === undefined) continue
          if (owner.userId !== userId) {
            emitJoinError(
              socket,
              fileId,
              clientId,
              'Client id already in use',
              'CLIENT_ID_IN_USE',
              false
            )
            return
          }
          // Same user reclaiming its client id on a stale prior socket: evict just THAT clientID's
          // binding + caret from the old socket. If that leaves the old socket with no providers, also
          // drop its room mapping + Socket.IO membership so it can no longer send document (sync) frames
          // (handleMessage's SYNC path gates on socketToRoomName, not owners); an old socket that still
          // hosts OTHER providers keeps them. Done inline rather than via cleanupFileDocForSocket, which
          // could destroyRoomIfIdle the room we're joining.
          clientMap.delete(clientId)
          awarenessProtocol.removeAwarenessStates(entry.awareness, [clientId], null)
          if (clientMap.size === 0) {
            entry.owners.delete(otherSid)
            socketToRoomName.delete(otherSid)
            io.in(otherSid).socketsLeave(name)
          }
        }

        // Only now that the rebind is guaranteed to succeed, leave a previously-joined document if
        // switching (a socket edits at most one). A duplicate join of the SAME room falls through
        // and simply re-runs the sync handshake, idempotently.
        const currentName = socketToRoomName.get(socket.id)
        if (currentName && currentName !== name) {
          socket.leave(currentName)
          cleanupFileDocForSocket(socket.id, io)
        }

        // ADD this provider's clientID to the socket's ownership set (do NOT overwrite a sibling
        // provider on the same socket — that lone-owner overwrite is exactly what dropped the chat
        // preview's awareness when the Files editor co-mounted). A re-JOIN of the same clientID is
        // idempotent. A single provider that later unmounts clears its own caret via its awareness
        // removal; the whole set is dropped on the socket's LEAVE/disconnect (the client emits LEAVE
        // only after its LAST provider for the file tears down).
        let clientMap = entry.owners.get(socket.id)
        if (clientMap === undefined) {
          clientMap = new Map<number, FileDocOwner>()
          entry.owners.set(socket.id, clientMap)
        }
        clientMap.set(clientId, { clientId, userId, userName, avatarUrl })
        socketToRoomName.set(socket.id, name)
        registered = true

        // Attribution for the server-side persist, refreshed to the actual editor on each edit in
        // `handleMessage`.
        entry.lastEditorUserId = userId

        // Name the document this room holds, so a client that still carries a DIFFERENT one (its room
        // outlived by a document rebuilt in its place) can refuse to merge instead of unioning two
        // documents into the file twice over. Read after readiness — before it, the room has no doc yet.
        socket.emit(FILE_DOC_EVENTS.JOIN_SUCCESS, {
          fileId,
          clientId,
          docId: docIdOf(entry.doc),
          version: joinedVersion,
          schemaVersion: FILE_DOC_SCHEMA_VERSION,
          ...(store.enabled ? { acknowledgedUpdates: true as const } : {}),
        })
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

        logger.info(`User ${userId} joined file-doc room ${fileId}`)
      } finally {
        entry.pendingJoins -= 1
        // A join that returned without registering may have left behind the room it created; drop it
        // if nothing else claimed it. A no-op once this join committed (the room then has an owner).
        destroyRoomIfIdle(name)
        if (subscribed) {
          const remaining = (pendingMemberships.get(name) ?? 1) - 1
          if (remaining > 0) pendingMemberships.set(name, remaining)
          else {
            pendingMemberships.delete(name)
            await socket.leave(admissionName)
            if (socketToRoomName.get(socket.id) !== name) await socket.leave(name)
          }
        }
      }
    } catch (error) {
      logger.error('Error joining file-doc room:', error)
      try {
        const name = roomName(fileDocRoom(fileId))
        /**
         * Roll back ownership only if this attempt committed it. A failed provisional admission must
         * preserve a previous file's binding and any co-mounted provider already in the target room.
         */
        if (registered && socketToRoomName.get(socket.id) === name) {
          socket.leave(name)
          cleanupFileDocForSocket(socket.id, io)
        }
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
      if (error instanceof FileDocNotFoundError) {
        emitJoinError(socket, fileId, clientId, 'File not found', 'NOT_FOUND', false)
      } else {
        emitJoinError(socket, fileId, clientId, 'Failed to join file document', 'JOIN_FAILED', true)
      }
    }
  })

  socket.on(FILE_DOC_EVENTS.MESSAGE, (data: unknown) => handleMessage(socket, io, data))

  socket.on(
    FILE_DOC_EVENTS.UPDATE,
    (data: unknown, acknowledge?: (result: FileDocUpdateAck) => void) => {
      if (typeof acknowledge !== 'function') return
      const pending = handleClientUpdate(socket, io, data, acknowledge)
        .catch((error) => logger.error('Unhandled acknowledged file-doc update failure:', error))
        .finally(() => pendingFileDocUpdates.delete(pending))
      pendingFileDocUpdates.add(pending)
    }
  )

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
