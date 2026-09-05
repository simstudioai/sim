import {
  ROOM_ACCESS_REVOKED_EVENT,
  type RoomAccessRevokedBroadcast,
} from '@sim/realtime-protocol/events'
import {
  FILE_DOC_EVENTS,
  FILE_DOC_LIMITS,
  FILE_DOC_MESSAGE_TYPE,
  FILE_DOC_SCHEMA_VERSION,
  FILE_DOC_SEED,
  FILE_DOC_TIMEOUTS,
  type FileDocInvalidated,
  type FileDocUpdateAck,
  type FileDocUpdatePayload,
  type JoinFileDocError,
  type JoinFileDocSuccess,
  toFileDocBytes,
} from '@sim/realtime-protocol/file-doc'
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { generateShortId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { ObservableV2 } from 'lib0/observable'
import type { Socket } from 'socket.io-client'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { AGENT_STREAM_ORIGIN } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/apply-streamed-markdown'
import { PendingFileDocUpdateJournal } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/pending-update-journal'

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
const UPDATE_BATCH_MS = 50
const UPDATE_RETRY_BASE_MS = 250
const UPDATE_RETRY_MAX_MS = 5_000
const MAX_HYDRATION_MESSAGES = 128
const MAX_HYDRATION_BYTES = FILE_DOC_LIMITS.updateBytes * 2
const RECOVERY_ORIGIN = Symbol('file-doc-recovery')

function hasYjsUpdateContent(update: Uint8Array): boolean {
  const decoded = Y.decodeUpdate(update)
  return decoded.structs.length > 0 || decoded.ds.clients.size > 0
}

interface FileDocProviderScope {
  workspaceId: string
  userId: string
}

interface PendingClientUpdate {
  updateId: string
  update: Uint8Array
}

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
  /** Socket.IO carries unscoped Yjs frames, so opening a different file terminalizes providers for the
   * previous file; multiple providers for the same file may coexist. */
  private static readonly activeProviders = new WeakMap<
    Socket,
    { fileId: string; providers: Set<FileDocProvider> }
  >()

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
  private updateMode: 'negotiating' | 'legacy' | 'acknowledged' = 'negotiating'
  private joinPending = false
  private joinRetryAttempt = 0
  private joinRetryTimer: ReturnType<typeof setTimeout> | null = null
  private joinAckTimer: ReturnType<typeof setTimeout> | null = null
  private syncRetryTimer: ReturnType<typeof setTimeout> | null = null
  private syncRetryAttempt = 0
  private joinHydrating = false
  private connectionGeneration = 0
  private bufferedMessages: Uint8Array[] = []
  private bufferedMessageBytes = 0
  private pendingUpdateBatch: Uint8Array[] = []
  private inFlightUpdate: PendingClientUpdate | null = null
  private updateBatchTimer: ReturnType<typeof setTimeout> | null = null
  private updateRetryTimer: ReturnType<typeof setTimeout> | null = null
  private updateRetryAttempt = 0
  private updateFlushInProgress = false
  private recoveryApplied = false
  private recoveryQueued = false
  private beforeUnloadProtected = false
  private readonly journal: PendingFileDocUpdateJournal | null
  private readonly journalLoad: ReturnType<PendingFileDocUpdateJournal['load']>

  constructor(
    private readonly socket: Socket,
    private readonly fileId: string,
    readonly doc: Y.Doc,
    readonly awareness: awarenessProtocol.Awareness,
    scope?: FileDocProviderScope
  ) {
    super()

    this.journal = scope ? new PendingFileDocUpdateJournal({ ...scope, fileId: this.fileId }) : null
    this.journalLoad = this.journal?.load(this.docId()) ?? Promise.resolve(null)
    this.registerActiveProvider()

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
    socket.on(FILE_DOC_EVENTS.INVALIDATED, this.handleInvalidated)
    socket.on(ROOM_ACCESS_REVOKED_EVENT, this.handleAccessRevoked)
    socket.on('connect', this.handleConnect)
    socket.on('disconnect', this.handleDisconnect)
    doc.on('update', this.handleDocUpdate)
    awareness.on('update', this.handleAwarenessUpdate)
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.handlePageHide)
    // Watch the seed flag so reaching "seeded" (server seed applied) can clear the readiness deadline.
    doc.getMap(FILE_DOC_SEED.configMap).observe(this.handleConfigChange)

    // Count this provider against the shared socket's membership of the file's room, so the room is
    // left only when the last provider for this file tears down (see {@link releaseRoomMembership}).
    retainRoomMembership(socket, fileId)

    if (socket.connected) this.join()

    // Arm the fallback: if we don't reach readiness (synced + seeded) before the deadline, give up.
    this.armReadinessDeadline()
  }

  /** Whether the server seed has recorded the initial content on the doc. */
  private isSeeded(): boolean {
    return this.doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag) === true
  }

  /** Clear the readiness deadline once the editor is usable (synced AND seeded). */
  private handleConfigChange = () => {
    if (this.synced && this.isSeeded()) this.clearReadinessTimer()
    if (this.updateMode === 'acknowledged' && this.docId() && this.pendingUpdateBatch.length > 0) {
      this.scheduleUpdateFlush(0)
    }
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

  private armReadinessDeadline() {
    this.clearReadinessTimer()
    this.readinessTimer = setTimeout(this.handleReadinessDeadline, READINESS_DEADLINE_MS)
  }

  private clearJoinRetryTimer() {
    if (this.joinRetryTimer !== null) {
      clearTimeout(this.joinRetryTimer)
      this.joinRetryTimer = null
    }
  }

  private clearJoinAckTimer() {
    if (this.joinAckTimer !== null) {
      clearTimeout(this.joinAckTimer)
      this.joinAckTimer = null
    }
  }

  private clearSyncRetryTimer() {
    if (this.syncRetryTimer !== null) {
      clearTimeout(this.syncRetryTimer)
      this.syncRetryTimer = null
    }
  }

  private clearUpdateTimers() {
    if (this.updateBatchTimer !== null) clearTimeout(this.updateBatchTimer)
    if (this.updateRetryTimer !== null) clearTimeout(this.updateRetryTimer)
    this.updateBatchTimer = null
    this.updateRetryTimer = null
  }

  /** Join the room, binding our client id so the server only accepts awareness we own. */
  private join = () => {
    if (this.fatal || this.disposed || !this.socket.connected || this.joinPending) return
    this.joinPending = true
    this.clearJoinAckTimer()
    this.joinAckTimer = setTimeout(() => {
      this.joinAckTimer = null
      if (!this.joinPending || this.fatal || this.disposed) return
      this.joinPending = false
      this.joinAccepted = false
      this.setSynced(false)
      this.scheduleJoinRetry()
    }, FILE_DOC_TIMEOUTS.joinAckMs)
    this.socket.emit(FILE_DOC_EVENTS.JOIN, {
      fileId: this.fileId,
      clientId: this.doc.clientID,
      schemaVersion: FILE_DOC_SCHEMA_VERSION,
    })
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
    this.connectionGeneration += 1
    this.clearJoinRetryTimer()
    this.clearSyncRetryTimer()
    this.syncRetryAttempt = 0
    this.joinAccepted = false
    this.joinPending = false
    this.joinRetryAttempt = 0
    this.setSynced(false)
    this.join()
  }

  private handleDisconnect = () => {
    this.connectionGeneration += 1
    this.clearBufferedMessages()
    this.clearJoinRetryTimer()
    this.clearJoinAckTimer()
    this.clearSyncRetryTimer()
    if (this.updateRetryTimer !== null) clearTimeout(this.updateRetryTimer)
    this.updateRetryTimer = null
    this.joinAccepted = false
    this.joinHydrating = false
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
    this.clearJoinAckTimer()
    this.joinPending = false
    this.joinRetryAttempt = 0
    this.clearJoinRetryTimer()
    if (data.acknowledgedUpdates === true && data.docId !== undefined) {
      this.updateMode = 'acknowledged'
    }
    this.joinHydrating = true
    const generation = this.connectionGeneration
    if (!this.journal) {
      this.finishAcceptJoin(data, generation, null)
      return
    }
    void this.journalLoad.then((recovered) => {
      this.finishAcceptJoin(data, generation, recovered)
    })
  }

  private finishAcceptJoin(
    data: JoinFileDocSuccess,
    generation: number,
    recovered: Awaited<ReturnType<PendingFileDocUpdateJournal['load']>>
  ): void {
    if (
      this.disposed ||
      this.fatal ||
      !this.socket.connected ||
      generation !== this.connectionGeneration ||
      !this.joinHydrating
    )
      return

    const serverSchemaVersion = data.schemaVersion ?? 1
    if (serverSchemaVersion !== FILE_DOC_SCHEMA_VERSION) {
      this.failFatally(
        'This document version is not supported; refresh to continue editing',
        'SCHEMA_VERSION_MISMATCH'
      )
      return
    }

    if (recovered !== null && !this.recoveryApplied) {
      const validationDoc = new Y.Doc()
      try {
        if (recovered.recoverySnapshot) {
          Y.applyUpdate(validationDoc, recovered.recoverySnapshot)
        }
        Y.applyUpdate(validationDoc, recovered.pendingUpdate)
      } catch {
        this.failFatally('The local recovery copy is damaged.', 'INVALID_UPDATE')
        return
      } finally {
        validationDoc.destroy()
      }
      try {
        if (recovered.recoverySnapshot) {
          Y.applyUpdate(this.doc, recovered.recoverySnapshot, RECOVERY_ORIGIN)
        }
        Y.applyUpdate(this.doc, recovered.pendingUpdate, RECOVERY_ORIGIN)
      } catch {
        this.failFatally('The local recovery copy could not be restored.', 'INVALID_UPDATE')
        return
      }
      this.recoveryApplied = true
    }

    const local = this.docId()
    if (
      (data.docId !== undefined &&
        ((local !== undefined && data.docId !== local) ||
          (local === undefined && this.isSeeded()))) ||
      (recovered !== null && data.docId !== recovered.docId)
    ) {
      this.failFatally(
        'This document was reloaded on the server; refresh to continue editing',
        'DOCUMENT_REPLACED'
      )
      return
    }

    const updateMode =
      data.acknowledgedUpdates === true && data.docId !== undefined ? 'acknowledged' : 'legacy'
    /** Pre-negotiation deltas stay in Y.Doc for legacy sync; existing recovery is never acknowledged here. */
    if (updateMode === 'legacy' && this.updateMode === 'negotiating') this.pendingUpdateBatch = []
    this.updateMode = updateMode

    if (recovered !== null && !this.recoveryQueued) {
      this.queuePendingUpdate(recovered.pendingUpdate)
      this.recoveryQueued = true
    }
    this.updateBeforeUnloadProtection()

    this.joinHydrating = false
    this.joinAccepted = true
    this.sendSyncStep1()
    this.scheduleSyncRetry()
    this.sendLocalAwareness()
    const bufferedMessages = this.bufferedMessages
    this.clearBufferedMessages()
    for (const message of bufferedMessages) this.applyMessage(message)
    if (this.updateMode === 'acknowledged') {
      if (this.inFlightUpdate) this.sendInFlightUpdate()
      else if (this.pendingUpdateBatch.length > 0) this.scheduleUpdateFlush(0)
    }
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
    this.clearBufferedMessages()
    this.joinError = error
    void this.persistPendingSnapshot()
    this.clearReadinessTimer()
    this.clearJoinRetryTimer()
    this.clearUpdateTimers()
    this.clearSyncRetryTimer()
    this.joinAccepted = false
    this.joinPending = false
    this.joinHydrating = false
    this.clearJoinAckTimer()
    this.setSynced(false)
    this.emit('join-error', [error])
  }

  private registerActiveProvider(): void {
    const active = FileDocProvider.activeProviders.get(this.socket)
    if (active?.fileId === this.fileId) {
      active.providers.add(this)
      return
    }
    if (active) {
      for (const provider of active.providers) {
        provider.failFatally(
          'Another file was opened in this tab. Reload this file to resume editing it.',
          'DOCUMENT_REPLACED'
        )
      }
    }
    FileDocProvider.activeProviders.set(this.socket, {
      fileId: this.fileId,
      providers: new Set([this]),
    })
  }

  private unregisterActiveProvider(): void {
    const active = FileDocProvider.activeProviders.get(this.socket)
    if (active?.fileId !== this.fileId) return
    active.providers.delete(this)
    if (active.providers.size === 0) FileDocProvider.activeProviders.delete(this.socket)
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
    this.joinHydrating = false
    this.clearJoinAckTimer()
    if (data.retryable === false) {
      this.fatal = true
      this.joinError = data
      void this.persistPendingSnapshot()
      this.clearReadinessTimer()
      this.clearJoinRetryTimer()
      this.clearUpdateTimers()
      this.clearSyncRetryTimer()
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

  private handleInvalidated = (data: FileDocInvalidated) => {
    if (data.fileId !== this.fileId) return
    this.failFatally(data.message, 'DOCUMENT_REPLACED')
  }

  private handleMessage = (data: unknown) => {
    // Once we've given up (a non-retryable rejection, or the connect deadline lapsed and the editor
    // fell back to a read-only local seed), ignore ALL inbound frames. A late SyncStep2 arriving
    // after the deadline would otherwise merge the server's state into the already-seeded doc —
    // duplicating content — and flip `synced` true, which un-gates autosave and would persist the
    // duplicate back to the real file. `fatal` guarding (re)join alone is not enough; it must also
    // stop applying sync here.
    if (this.fatal) return
    if (this.joinHydrating) {
      const bytes = toFileDocBytes(data)
      if (!bytes) return
      if (
        this.bufferedMessages.length >= MAX_HYDRATION_MESSAGES ||
        this.bufferedMessageBytes + bytes.byteLength > MAX_HYDRATION_BYTES
      ) {
        this.failFatally(
          'Realtime document hydration exceeded its safety limit',
          'HYDRATION_BUFFER_OVERFLOW'
        )
        return
      }
      const buffered = new Uint8Array(bytes)
      this.bufferedMessages.push(buffered)
      this.bufferedMessageBytes += buffered.byteLength
      return
    }
    if (!this.joinAccepted) return
    this.applyMessage(data)
  }

  private applyMessage(data: unknown) {
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
          const response = encoding.toUint8Array(encoder)
          if (this.updateMode === 'acknowledged' && syncType === syncProtocol.messageYjsSyncStep1) {
            const responseDecoder = decoding.createDecoder(response)
            decoding.readVarUint(responseDecoder)
            decoding.readVarUint(responseDecoder)
            const update = new Uint8Array(decoding.readVarUint8Array(responseDecoder))
            if (hasYjsUpdateContent(update)) {
              this.queuePendingUpdate(update)
              this.scheduleUpdateFlush(0)
            }
          } else {
            this.socket.emit(FILE_DOC_EVENTS.MESSAGE, response)
          }
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
    if (this.fatal || origin === this || origin === RECOVERY_ORIGIN) return
    // Agent-streamed frames must reach peers (so a collaborator sees the stream live) but must NOT be
    // treated by the server as a durable user edit — the copilot's final `edit_content` write is the
    // authoritative persist. Tag them so the relay applies + fans out but skips persist bookkeeping.
    if (origin === AGENT_STREAM_ORIGIN) {
      if (!this.joinAccepted || !this.socket.connected) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST)
      syncProtocol.writeUpdate(encoder, update)
      this.socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
      return
    }

    if (!this.joinAccepted) {
      if (this.updateMode !== 'legacy') this.queuePendingUpdate(update)
      if (this.updateMode === 'acknowledged') this.scheduleUpdateFlush(UPDATE_BATCH_MS)
      return
    }

    if (this.updateMode !== 'acknowledged') {
      if (!this.socket.connected) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
      syncProtocol.writeUpdate(encoder, update)
      this.socket.emit(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
      return
    }

    this.queuePendingUpdate(update)
    this.scheduleUpdateFlush(UPDATE_BATCH_MS)
  }

  private queuePendingUpdate(update: Uint8Array): void {
    this.pendingUpdateBatch.push(update)
    this.updateBeforeUnloadProtection()
  }

  private scheduleUpdateFlush(delay: number) {
    if (this.updateBatchTimer !== null || this.updateFlushInProgress || this.disposed || this.fatal)
      return
    this.updateBatchTimer = setTimeout(() => {
      this.updateBatchTimer = null
      void this.flushPendingUpdates()
    }, delay)
  }

  private async flushPendingUpdates(): Promise<void> {
    if (
      this.updateMode !== 'acknowledged' ||
      this.pendingUpdateBatch.length === 0 ||
      this.disposed ||
      this.fatal
    )
      return
    const docId = this.docId()
    if (!docId) return

    this.updateFlushInProgress = true
    try {
      const update = Y.mergeUpdates(this.pendingUpdateBatch)
      this.pendingUpdateBatch = []
      const journalUpdate = this.inFlightUpdate
        ? Y.mergeUpdates([this.inFlightUpdate.update, update])
        : update
      const saved = await this.journal?.save(docId, journalUpdate, Y.encodeStateAsUpdate(this.doc))
      if (this.disposed || this.fatal) {
        this.queuePendingUpdate(update)
        return
      }
      if (saved?.status === 'limit-exceeded') {
        this.queuePendingUpdate(update)
        this.failFatally('Local edits exceeded the safe recovery limit.', 'PENDING_UPDATE_LIMIT')
        return
      }
      const durableUpdate = saved?.pendingUpdate ?? update

      if (this.inFlightUpdate) {
        this.queuePendingUpdate(update)
        return
      }
      this.inFlightUpdate = { updateId: generateShortId(), update: durableUpdate }
      this.updateRetryAttempt = 0
      this.sendInFlightUpdate()
    } finally {
      this.updateFlushInProgress = false
      this.updateBeforeUnloadProtection()
      if (this.pendingUpdateBatch.length > 0 && !this.inFlightUpdate) {
        this.scheduleUpdateFlush(0)
      }
    }
  }

  private sendInFlightUpdate() {
    const pending = this.inFlightUpdate
    const docId = this.docId()
    if (
      !pending ||
      !docId ||
      this.updateMode !== 'acknowledged' ||
      this.disposed ||
      this.fatal ||
      !this.socket.connected ||
      !this.joinAccepted
    )
      return

    const generation = this.connectionGeneration
    const payload: FileDocUpdatePayload = {
      fileId: this.fileId,
      docId,
      updateId: pending.updateId,
      update: pending.update,
    }
    this.socket
      .timeout(FILE_DOC_TIMEOUTS.updateAckMs)
      .emit(FILE_DOC_EVENTS.UPDATE, payload, (error: Error | null, ack?: FileDocUpdateAck) => {
        if (this.disposed || this.fatal || this.inFlightUpdate !== pending) return
        if (error) {
          if (generation === this.connectionGeneration) this.scheduleUpdateRetry()
          return
        }
        if (ack) this.handleUpdateAck(ack)
      })
  }

  private handleUpdateAck(ack: FileDocUpdateAck) {
    const pending = this.inFlightUpdate
    if (!pending || ack.updateId !== pending.updateId || this.disposed || this.fatal) return

    if (ack.status === 'accepted') {
      const docId = this.docId()
      this.inFlightUpdate = null
      this.updateRetryAttempt = 0
      this.updateBeforeUnloadProtection()
      if (this.pendingUpdateBatch.length > 0) this.scheduleUpdateFlush(0)
      else if (!this.updateFlushInProgress && docId) void this.journal?.clear(docId, pending.update)
      return
    }

    if (!ack.retryable) {
      const message =
        ack.code === 'ACCESS_REVOKED'
          ? 'Your access to this document has been revoked'
          : 'This document changed while this tab was disconnected; refresh to continue editing'
      this.failFatally(message, ack.code)
      return
    }
    if (ack.code === 'NOT_JOINED') {
      this.setSynced(false)
      this.joinAccepted = false
      this.joinPending = false
      this.clearSyncRetryTimer()
      this.scheduleJoinRetry()
      return
    }
    this.scheduleUpdateRetry()
  }

  private scheduleUpdateRetry() {
    if (this.updateRetryTimer !== null || this.disposed || this.fatal || !this.socket.connected)
      return
    this.updateRetryAttempt += 1
    this.updateRetryTimer = setTimeout(
      () => {
        this.updateRetryTimer = null
        this.sendInFlightUpdate()
      },
      backoffWithJitter(this.updateRetryAttempt, null, {
        baseMs: UPDATE_RETRY_BASE_MS,
        maxMs: UPDATE_RETRY_MAX_MS,
      })
    )
  }

  private pendingJournalUpdate(): Uint8Array | null {
    const updates = [
      ...(this.inFlightUpdate ? [this.inFlightUpdate.update] : []),
      ...this.pendingUpdateBatch,
    ]
    return updates.length > 0 ? Y.mergeUpdates(updates) : null
  }

  private persistPendingSnapshot(): Promise<void> | undefined {
    const update = this.pendingJournalUpdate()
    const docId = this.docId()
    if (!update || !docId || !this.journal) return
    return this.journal.save(docId, update, Y.encodeStateAsUpdate(this.doc)).then(() => undefined)
  }

  private handlePageHide = () => {
    void this.persistPendingSnapshot()
  }

  private handleBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault()
    event.returnValue = ''
  }

  private updateBeforeUnloadProtection(): void {
    if (typeof window === 'undefined') return
    const shouldProtect =
      !this.disposed &&
      (this.pendingUpdateBatch.length > 0 ||
        this.inFlightUpdate !== null ||
        this.updateFlushInProgress)
    if (shouldProtect === this.beforeUnloadProtected) return
    this.beforeUnloadProtected = shouldProtect
    if (shouldProtect) window.addEventListener('beforeunload', this.handleBeforeUnload)
    else window.removeEventListener('beforeunload', this.handleBeforeUnload)
  }

  private clearBufferedMessages(): void {
    this.bufferedMessages = []
    this.bufferedMessageBytes = 0
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

  private scheduleSyncRetry() {
    this.clearSyncRetryTimer()
    if (this.synced || this.fatal || this.disposed || !this.socket.connected || !this.joinAccepted)
      return
    this.syncRetryAttempt += 1
    this.syncRetryTimer = setTimeout(
      () => {
        this.syncRetryTimer = null
        if (this.synced || this.fatal || this.disposed || !this.joinAccepted) return
        this.sendSyncStep1()
        this.scheduleSyncRetry()
      },
      backoffWithJitter(this.syncRetryAttempt, null, {
        baseMs: 1_000,
        maxMs: JOIN_RETRY_MAX_MS,
      })
    )
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
    if (synced) {
      this.clearSyncRetryTimer()
      this.syncRetryAttempt = 0
    }
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
    void this.persistPendingSnapshot()
    this.disposed = true
    this.updateBeforeUnloadProtection()
    this.unregisterActiveProvider()
    this.clearReadinessTimer()
    this.clearJoinRetryTimer()
    this.clearJoinAckTimer()
    this.clearSyncRetryTimer()
    this.clearUpdateTimers()
    this.clearBufferedMessages()
    this.joinPending = false

    // Publish our final awareness removal while this provider is still admitted. A co-mounted sibling
    // keeps the socket in the room, so LEAVE cannot clear this provider's caret on its behalf.
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'provider-destroy')
    this.joinAccepted = false

    // Only actually leave the room when this was the last provider for the file on the shared socket —
    // otherwise a sibling surface (e.g. the Files editor vs. the embedded chat panel) would be stranded.
    if (releaseRoomMembership(this.socket, this.fileId)) {
      this.socket.emit(FILE_DOC_EVENTS.LEAVE, { fileId: this.fileId })
    }
    this.socket.off(FILE_DOC_EVENTS.MESSAGE, this.handleMessage)
    this.socket.off(FILE_DOC_EVENTS.JOIN_SUCCESS, this.handleJoinSuccess)
    this.socket.off(FILE_DOC_EVENTS.JOIN_ERROR, this.handleJoinError)
    this.socket.off(FILE_DOC_EVENTS.INVALIDATED, this.handleInvalidated)
    this.socket.off(ROOM_ACCESS_REVOKED_EVENT, this.handleAccessRevoked)
    this.socket.off('connect', this.handleConnect)
    this.socket.off('disconnect', this.handleDisconnect)
    this.doc.off('update', this.handleDocUpdate)
    this.doc.getMap(FILE_DOC_SEED.configMap).unobserve(this.handleConfigChange)
    this.awareness.off('update', this.handleAwarenessUpdate)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.handlePageHide)

    super.destroy()
  }
}
