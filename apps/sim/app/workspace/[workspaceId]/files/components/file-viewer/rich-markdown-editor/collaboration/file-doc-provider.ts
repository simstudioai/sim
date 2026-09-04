import {
  ROOM_ACCESS_REVOKED_EVENT,
  type RoomAccessRevokedBroadcast,
} from '@sim/realtime-protocol/events'
import {
  FILE_DOC_EVENTS,
  FILE_DOC_MESSAGE_TYPE,
  FILE_DOC_SEED,
  FILE_DOC_TIMEOUTS,
  type JoinFileDocError,
  type JoinFileDocSuccess,
  toFileDocBytes,
} from '@sim/realtime-protocol/file-doc'
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { backoffWithJitter } from '@sim/utils/retry'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { ObservableV2 } from 'lib0/observable'
import type { Socket } from 'socket.io-client'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import type * as Y from 'yjs'
import { AGENT_STREAM_ORIGIN } from './apply-streamed-markdown'

/**
 * Events emitted by {@link FileDocProvider}.
 * - `synced`: the first full document sync with the server completed.
 * - `join-error`: the server rejected the join (e.g. lost write access).
 */
interface FileDocProviderEvents {
  synced: (synced: boolean) => void
  'join-error': (error: JoinFileDocError) => void
}

/**
 * How long to wait to reach a USABLE editor — connected, synced, AND seeded (`initialContentLoaded`
 * set by the server seed) — before giving up. It guards two failure modes with one timer:
 * - the realtime server is unreachable, so the first sync never arrives; and
 * - the socket syncs an empty doc but the server-side seed never lands (its build persistently fails
 *   / exhausts its retries), which `synced` alone would wrongly treat as "connected, all good".
 *
 * On the deadline the provider latches fatal and surfaces a non-retryable `join-error` — the exact
 * path a fatal rejection uses — so the editor falls back to showing the file's stored content
 * read-only instead of a permanently blank pane. Generous enough to clear a slow connect + seed
 * round-trip; a healthy cold open reaches readiness well within it. Shared with (and must exceed) the
 * relay's seed-fetch timeout — see `FILE_DOC_TIMEOUTS` and its ordering test.
 */
const READINESS_DEADLINE_MS = FILE_DOC_TIMEOUTS.readinessDeadlineMs
const JOIN_RETRY_BASE_MS = 500
const JOIN_RETRY_MAX_MS = 5_000

/**
 * Live-provider counts per file, per shared socket. Two surfaces in one tab (the Files editor and the
 * embedded chat resource panel) share ONE Socket.IO connection, so both a first and a second provider
 * for the same file JOIN the same room over that socket. The server's `leave(name)` drops the socket
 * from the room outright — no membership refcount — so the FIRST provider's `destroy()` would strand
 * the second (still-mounted) one: no more content or presence updates. Keyed by the {@link Socket}
 * OBJECT (stable across reconnects, unlike `socket.id`), so the count survives a reconnect.
 *
 * The single-provider case is unchanged: the count goes `0 → 1 → 0` and `LEAVE` fires exactly as
 * before. `LEAVE` is emitted only when the LAST provider for a file on a socket tears down.
 */
const roomJoinCounts = new WeakMap<Socket, Map<string, number>>()

/** Record another live provider for `fileId` on `socket` (called at construction). */
function retainRoomMembership(socket: Socket, fileId: string): void {
  let counts = roomJoinCounts.get(socket)
  if (!counts) {
    counts = new Map()
    roomJoinCounts.set(socket, counts)
  }
  counts.set(fileId, (counts.get(fileId) ?? 0) + 1)
}

/**
 * Drop one live provider for `fileId` on `socket` (called at teardown). Returns `true` when this was
 * the last one — i.e. the caller should emit `LEAVE` so the socket leaves the room.
 */
function releaseRoomMembership(socket: Socket, fileId: string): boolean {
  const counts = roomJoinCounts.get(socket)
  const next = (counts?.get(fileId) ?? 1) - 1
  if (next > 0) {
    counts?.set(fileId, next)
    return false
  }
  counts?.delete(fileId)
  return true
}

/**
 * The client half of the collaborative file-document protocol: a Yjs provider
 * that carries document sync + awareness over the shared, already-authenticated
 * Socket.IO connection (the server relay lives in
 * `apps/realtime/src/handlers/file-doc.ts`). It is the Socket.IO analogue of
 * `y-websocket`'s `WebsocketProvider` — the same `y-protocols` message framing —
 * so TipTap's `Collaboration` (bound to {@link doc}) and `CollaborationCaret`
 * (bound to this provider's {@link awareness}) work unmodified.
 *
 * The document and awareness are owned by the caller (the hook) and are NOT
 * destroyed here, so the provider can be torn down and rebuilt (e.g. on a socket
 * reconnect) without discarding local edits.
 */
export class FileDocProvider extends ObservableV2<FileDocProviderEvents> {
  synced = false
  /**
   * The latched non-retryable join rejection, or `null`. The `join-error` event is
   * transient and can fire before a consumer subscribes,
   * so consumers read this on subscription to detect a fatal failure they missed.
   */
  joinError: JoinFileDocError | null = null

  private disposed = false
  /** Set on a non-retryable join rejection (e.g. lost write access) so the
   * provider stops attempting to (re)join until the owner tears it down. */
  private fatal = false
  /** Deadline for reaching readiness (synced + seeded); fires the fallback if it is never reached. */
  private readinessTimer: ReturnType<typeof setTimeout> | null = null
  private joinAccepted = false
  private joinPending = false
  private joinRetryAttempt = 0
  private joinRetryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly socket: Socket,
    private readonly fileId: string,
    readonly doc: Y.Doc,
    readonly awareness: awarenessProtocol.Awareness
  ) {
    super()

    // Restore an empty local awareness state if it has been cleared. A fresh
    // Awareness starts with `{}`, but a *reused* one whose local state was removed
    // (a prior provider's `destroy()` clears it, and so does `Awareness.destroy()`)
    // returns `null` here — and y-protocols' `setLocalStateField` is a no-op while
    // the local state is `null`. The editor binds CollaborationCaret to this exact
    // awareness for its whole life, so without this reseed a remount (e.g. React
    // StrictMode's mount→unmount→mount, which re-runs the provider effect on the
    // same instance) would leave the caret extension unable to ever publish the
    // local user/cursor — remote peers would see no caret or selection, even though
    // document sync (which does not depend on local awareness) keeps working.
    if (awareness.getLocalState() === null) awareness.setLocalState({})

    socket.on(FILE_DOC_EVENTS.MESSAGE, this.handleMessage)
    socket.on(FILE_DOC_EVENTS.JOIN_SUCCESS, this.handleJoinSuccess)
    socket.on(FILE_DOC_EVENTS.JOIN_ERROR, this.handleJoinError)
    socket.on(ROOM_ACCESS_REVOKED_EVENT, this.handleAccessRevoked)
    socket.on('connect', this.handleConnect)
    socket.on('disconnect', this.handleDisconnect)
    doc.on('update', this.handleDocUpdate)
    awareness.on('update', this.handleAwarenessUpdate)
    // Watch the seed flag so reaching "seeded" (server seed applied) can clear the readiness deadline.
    doc.getMap(FILE_DOC_SEED.configMap).observe(this.handleConfigChange)

    // Count this provider against the shared socket's membership of the file's room, so the room is
    // left only when the last provider for this file tears down (see {@link releaseRoomMembership}).
    retainRoomMembership(socket, fileId)

    if (socket.connected) this.join()

    // Arm the fallback: if we don't reach readiness (synced + seeded) before the deadline, give up.
    this.readinessTimer = setTimeout(this.handleReadinessDeadline, READINESS_DEADLINE_MS)
  }

  /** Whether the server seed has recorded the initial content on the doc. */
  private isSeeded(): boolean {
    return this.doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag) === true
  }

  /** Clear the readiness deadline once the editor is usable (synced AND seeded). */
  private handleConfigChange = () => {
    if (this.synced && this.isSeeded()) this.clearReadinessTimer()
  }

  /**
   * Readiness was never reached within {@link READINESS_DEADLINE_MS} — either the realtime server is
   * unreachable (never synced) or it synced but the server-side seed never landed (synced yet
   * unseeded). Reset `synced` (so the editor gates read-only), latch fatal (so a late reconnect or
   * seed can't sync server state in and merge-duplicate the content the editor is about to render
   * locally), and surface a synthetic non-retryable join-error — the exact path a fatal rejection
   * uses — so the owner falls back to the read-only view of the file's stored content instead of a
   * blank pane. No-op if we already reached readiness, already failed fatally, or were torn down.
   */
  private handleReadinessDeadline = () => {
    this.readinessTimer = null
    if (this.synced && this.isSeeded()) return
    // Dropping `synced` (see {@link failFatally}) is what keeps the editor's `synced && seeded` gate
    // closed, so the fallback renders the stored content read-only rather than becoming editable on a
    // document the server never seeded.
    this.failFatally('Realtime document was not ready in time', 'READINESS_TIMEOUT')
  }

  private clearReadinessTimer() {
    if (this.readinessTimer !== null) {
      clearTimeout(this.readinessTimer)
      this.readinessTimer = null
    }
  }

  private clearJoinRetryTimer() {
    if (this.joinRetryTimer !== null) {
      clearTimeout(this.joinRetryTimer)
      this.joinRetryTimer = null
    }
  }

  /** Join the room, binding our client id so the server only accepts awareness we own. */
  private join = () => {
    if (this.fatal || this.disposed || !this.socket.connected || this.joinPending) return
    this.joinPending = true
    this.socket.emit(FILE_DOC_EVENTS.JOIN, { fileId: this.fileId, clientId: this.doc.clientID })
  }

  private scheduleJoinRetry() {
    this.clearJoinRetryTimer()
    if (this.fatal || this.disposed || !this.socket.connected) return
    this.joinRetryAttempt += 1
    this.joinRetryTimer = setTimeout(
      () => {
        this.joinRetryTimer = null
        this.join()
      },
      backoffWithJitter(this.joinRetryAttempt, null, {
        baseMs: JOIN_RETRY_BASE_MS,
        maxMs: JOIN_RETRY_MAX_MS,
      })
    )
  }

  /**
   * Re-join after a (re)connect. The server re-registers the room before acking,
   * so the sync/awareness exchange is deferred to {@link handleJoinSuccess}.
   */
  private handleConnect = () => {
    if (this.fatal) return
    this.clearJoinRetryTimer()
    this.joinAccepted = false
    this.joinPending = false
    this.joinRetryAttempt = 0
    this.setSynced(false)
    this.join()
  }

  private handleDisconnect = () => {
    this.clearJoinRetryTimer()
    this.joinAccepted = false
    this.joinPending = false
    this.setSynced(false)

    const remoteClientIds = [...this.awareness.getStates().keys()].filter(
      (clientId) => clientId !== this.doc.clientID
    )
    if (remoteClientIds.length > 0) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        remoteClientIds,
        'provider-disconnect'
      )
    }
  }

  /**
   * Handle the join ack. The server registers the room before acking, so an earlier
   * send could be dropped — the initial sync + local awareness exchange begins here.
   *
   * Unless the room holds a DIFFERENT document than ours. Two documents built from the same markdown
   * are not the same document to Yjs — their items carry different client ids — so syncing one into the
   * other appends the file to itself, on both sides, and the server persists the result. A document is
   * rebuilt only when the room AND the shared stream are both gone (a tab that slept through it), which
   * is precisely when a stale tab reconnects. There is no way to un-merge afterwards, so the sync never
   * happens: take the fatal path, which leaves the editor read-only on the content it already shows.
   * A reload binds a fresh document and recovers.
   */
  private handleJoinSuccess = (data: JoinFileDocSuccess) => {
    if (
      data.fileId !== this.fileId ||
      !this.joinPending ||
      (data.clientId !== undefined && data.clientId !== this.doc.clientID)
    )
      return
    this.joinPending = false
    this.joinRetryAttempt = 0
    this.clearJoinRetryTimer()
    const local = this.docId()
    if (local !== undefined && data.docId !== undefined && data.docId !== local) {
      this.failFatally(
        'This document was reloaded on the server; refresh to continue editing',
        'DOCUMENT_REPLACED'
      )
      return
    }
    this.joinAccepted = true
    this.sendSyncStep1()
    this.sendLocalAwareness()
  }

  /** The identity of the document we hold, once the server seed has named one. */
  private docId(): string | undefined {
    const docId = this.doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)
    return typeof docId === 'string' ? docId : undefined
  }

  /**
   * Give up on this document, non-retryably: latch fatal so nothing more is applied or relayed, drop
   * `synced` so the editor's gate closes, and surface the rejection to the owner (which falls back to a
   * read-only view of the stored content).
   */
  private failFatally(message: string, code: string) {
    if (this.fatal || this.disposed) return
    const error: JoinFileDocError = {
      fileId: this.fileId,
      error: message,
      code,
      retryable: false,
    }
    this.fatal = true
    this.joinError = error
    this.clearReadinessTimer()
    this.clearJoinRetryTimer()
    this.joinAccepted = false
    this.joinPending = false
    this.setSynced(false)
    this.emit('join-error', [error])
  }

  /**
   * Handle a join rejection. A non-retryable rejection (access denied, invalid)
   * won't succeed on retry, so latch {@link fatal} to stop (re)joining and let the
   * owner fall back to the non-collaborative view.
   */
  private handleJoinError = (data: JoinFileDocError) => {
    if (
      data.fileId !== this.fileId ||
      !this.joinPending ||
      (data.clientId !== undefined && data.clientId !== this.doc.clientID)
    )
      return
    this.joinAccepted = false
    this.joinPending = false
    if (data.retryable === false) {
      this.fatal = true
      this.joinError = data
      this.clearReadinessTimer()
      this.clearJoinRetryTimer()
      this.setSynced(false)
    } else {
      this.setSynced(false)
      this.scheduleJoinRetry()
    }
    this.emit('join-error', [data])
  }

  /**
   * The server evicted this socket from the document because the user's workspace
   * access was revoked or downgraded below `write` mid-session. Nothing sent from
   * here would be applied any more, so take the same path as a non-retryable
   * rejection: latch fatal (stop re-joining, stop applying inbound frames) and drop
   * `synced`, so the editor falls back to the read-only view of the stored content
   * instead of silently accepting keystrokes that go nowhere.
   */
  private handleAccessRevoked = (data: RoomAccessRevokedBroadcast) => {
    if (data.room?.type !== ROOM_TYPES.WORKSPACE_FILE_DOC || data.room.id !== this.fileId) return
    this.failFatally(data.message, 'ACCESS_REVOKED')
  }

  private handleMessage = (data: unknown) => {
    // Once we've given up (a non-retryable rejection, or the connect deadline lapsed and the editor
    // fell back to a read-only local seed), ignore ALL inbound frames. A late SyncStep2 arriving
    // after the deadline would otherwise merge the server's state into the already-seeded doc —
    // duplicating content — and flip `synced` true, which un-gates autosave and would persist the
    // duplicate back to the real file. `fatal` guarding (re)join alone is not enough; it must also
    // stop applying sync here.
    if (this.fatal || !this.joinAccepted) return
    const bytes = toFileDocBytes(data)
    if (!bytes) return

    const decoder = decoding.createDecoder(bytes)
    const messageType = decoding.readVarUint(decoder)

    switch (messageType) {
      case FILE_DOC_MESSAGE_TYPE.SYNC: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
        // `this` is the transaction origin, so our own `doc.on('update')` skips
        // re-sending updates we just applied from the server.
        const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this)
        if (encoding.length(encoder) > 1) {
          this.socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
        }
        if (syncType === syncProtocol.messageYjsSyncStep2 && !this.synced) this.setSynced(true)
        break
      }
      case FILE_DOC_MESSAGE_TYPE.AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this
        )
        break
      }
    }
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Once fatal (a non-retryable rejection, or the readiness deadline lapsed), the editor may render
    // the stored content into the doc locally as its read-only fallback. Never relay those local
    // writes — the server never seeded this doc, so echoing them would push unseeded content to peers
    // (and each fallen-back client would do so, union-duplicating). A fatal client is fully local.
    if (this.fatal || !this.joinAccepted || !this.socket.connected) return
    // Updates we applied from the server carry `this` as origin — don't echo them.
    if (origin === this) return
    // Agent-streamed frames must reach peers (so a collaborator sees the stream live) but must NOT be
    // treated by the server as a durable user edit — the copilot's final `edit_content` write is the
    // authoritative persist. Tag them so the relay applies + fans out but skips persist bookkeeping.
    const messageType =
      origin === AGENT_STREAM_ORIGIN
        ? FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST
        : FILE_DOC_MESSAGE_TYPE.SYNC
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageType)
    syncProtocol.writeUpdate(encoder, update)
    this.socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
  }

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    // Only ever publish OUR OWN awareness. Remote changes (origin === this) were
    // applied from the server; and a local `Awareness` also emits 30s `timeout`
    // removals for remote peers — forwarding either would be a frame for a client
    // id we don't own, which the server (correctly) rejects. Filter to our own id
    // so honest traffic never trips the ownership guard.
    // Socket.IO buffers emits while disconnected and flushes them before the reconnect callback can
    // rejoin this room. Suppress those stale frames; the accepted join republishes the latest state.
    if (origin === this || this.fatal || !this.joinAccepted || !this.socket.connected) return
    const localId = this.doc.clientID
    const changed = [...added, ...updated, ...removed].filter((id) => id === localId)
    if (changed.length === 0) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
    )
    this.socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
  }

  private sendSyncStep1() {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    this.socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
  }

  private sendLocalAwareness() {
    if (this.awareness.getLocalState() === null) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
    )
    this.socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
  }

  private setSynced(synced: boolean) {
    if (this.synced === synced) return
    this.synced = synced
    // Readiness needs synced AND seeded; only clear the deadline when both hold (the seed may have
    // arrived first, or may still be pending — `handleConfigChange` clears it if seeded arrives later).
    if (synced && this.isSeeded()) this.clearReadinessTimer()
    this.emit('synced', [synced])
  }

  /**
   * Tear down the provider: leave the room, clear our awareness (so peers drop our
   * caret immediately rather than after the server's 30s timeout), and detach all
   * listeners. The document and awareness objects are the caller's and are left intact.
   */
  destroy() {
    if (this.disposed) {
      super.destroy()
      return
    }
    this.disposed = true
    this.clearReadinessTimer()
    this.clearJoinRetryTimer()
    this.joinAccepted = false
    this.joinPending = false

    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'provider-destroy')

    // Only actually leave the room when this was the last provider for the file on the shared socket —
    // otherwise a sibling surface (e.g. the Files editor vs. the embedded chat panel) would be stranded.
    if (releaseRoomMembership(this.socket, this.fileId)) {
      this.socket.emit(FILE_DOC_EVENTS.LEAVE, { fileId: this.fileId })
    }
    this.socket.off(FILE_DOC_EVENTS.MESSAGE, this.handleMessage)
    this.socket.off(FILE_DOC_EVENTS.JOIN_SUCCESS, this.handleJoinSuccess)
    this.socket.off(FILE_DOC_EVENTS.JOIN_ERROR, this.handleJoinError)
    this.socket.off(ROOM_ACCESS_REVOKED_EVENT, this.handleAccessRevoked)
    this.socket.off('connect', this.handleConnect)
    this.socket.off('disconnect', this.handleDisconnect)
    this.doc.off('update', this.handleDocUpdate)
    this.doc.getMap(FILE_DOC_SEED.configMap).unobserve(this.handleConfigChange)
    this.awareness.off('update', this.handleAwarenessUpdate)

    super.destroy()
  }
}
