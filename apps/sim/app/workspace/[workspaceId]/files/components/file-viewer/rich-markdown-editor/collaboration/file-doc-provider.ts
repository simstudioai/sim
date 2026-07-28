import {
  FILE_DOC_EVENTS,
  FILE_DOC_MESSAGE_TYPE,
  type JoinFileDocError,
  type JoinFileDocSuccess,
  type SeedRequestPayload,
  toFileDocBytes,
} from '@sim/realtime-protocol/file-doc'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { ObservableV2 } from 'lib0/observable'
import type { Socket } from 'socket.io-client'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import type * as Y from 'yjs'

/**
 * Events emitted by {@link FileDocProvider}.
 * - `synced`: the first full document sync with the server completed.
 * - `seed-request`: the server elected this client to seed the document's initial
 *   content from the file's stored markdown (the editor does the import, guarded
 *   by the CRDT `initialContentLoaded` flag).
 * - `join-error`: the server rejected the join (e.g. lost write access).
 */
interface FileDocProviderEvents {
  synced: (synced: boolean) => void
  'seed-request': () => void
  'join-error': (error: JoinFileDocError) => void
}

/**
 * How long to wait for a first document sync before giving up. If the realtime server is
 * unreachable (offline, server down, socket never connects) the provider would otherwise never
 * sync and the editor would sit blank and read-only forever. On this deadline the provider latches
 * fatal and surfaces a non-retryable `join-error` — the exact path a fatal rejection uses — so the
 * editor falls back to showing the file's stored content read-only. Generous enough to clear a slow
 * connect; a socket that connects at all syncs well within it (SyncStep2 for a fresh doc is cheap).
 */
const CONNECT_DEADLINE_MS = 12_000

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
   * Latched `true` when the server elects this client to seed the document. The
   * `seed-request` event is transient and can fire before a consumer subscribes,
   * so consumers read this flag on subscription rather than relying on the event.
   */
  shouldSeed = false
  /**
   * The latched non-retryable join rejection, or `null`. Like {@link shouldSeed},
   * the `join-error` event is transient and can fire before a consumer subscribes,
   * so consumers read this on subscription to detect a fatal failure they missed.
   */
  joinError: JoinFileDocError | null = null

  private disposed = false
  /** Set on a non-retryable join rejection (e.g. lost write access) so the
   * provider stops attempting to (re)join until the owner tears it down. */
  private fatal = false
  /** Deadline for the first sync; fires the offline fallback if the server is never reached. */
  private connectTimer: ReturnType<typeof setTimeout> | null = null

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
    socket.on(FILE_DOC_EVENTS.SEED_REQUEST, this.handleSeedRequest)
    socket.on('connect', this.handleConnect)
    doc.on('update', this.handleDocUpdate)
    awareness.on('update', this.handleAwarenessUpdate)

    if (socket.connected) this.join()

    // Arm the offline fallback: if no first sync arrives before the deadline, give up (below).
    this.connectTimer = setTimeout(this.handleConnectDeadline, CONNECT_DEADLINE_MS)
  }

  /**
   * The first sync never arrived within {@link CONNECT_DEADLINE_MS} — the realtime server is
   * unreachable. Latch fatal (so a late reconnect can't sync server state in and merge-duplicate the
   * content the editor is about to seed locally) and surface a synthetic non-retryable join-error, so
   * the owner falls back to the read-only, non-collaborative view exactly as it does for a real
   * fatal rejection. No-op if we already synced, already failed fatally, or were torn down.
   */
  private handleConnectDeadline = () => {
    this.connectTimer = null
    if (this.synced || this.fatal || this.disposed) return
    const error: JoinFileDocError = {
      fileId: this.fileId,
      error: 'Realtime connection timed out',
      code: 'CONNECT_TIMEOUT',
      retryable: false,
    }
    this.fatal = true
    this.joinError = error
    this.emit('join-error', [error])
  }

  private clearConnectTimer() {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  /** Join the room, binding our client id so the server only accepts awareness we own. */
  private join = () => {
    if (this.fatal) return
    this.socket.emit(FILE_DOC_EVENTS.JOIN, { fileId: this.fileId, clientId: this.doc.clientID })
  }

  /**
   * Re-join after a (re)connect. The server re-registers the room before acking,
   * so the sync/awareness exchange is deferred to {@link handleJoinSuccess}.
   */
  private handleConnect = () => {
    if (this.fatal) return
    this.setSynced(false)
    this.join()
  }

  /**
   * Handle the join ack. The server registers the room before acking, so an earlier
   * send could be dropped — the initial sync + local awareness exchange begins here.
   */
  private handleJoinSuccess = (data: JoinFileDocSuccess) => {
    if (data.fileId !== this.fileId) return
    this.sendSyncStep1()
    this.sendLocalAwareness()
  }

  /**
   * Handle a join rejection. A non-retryable rejection (access denied, invalid)
   * won't succeed on retry, so latch {@link fatal} to stop (re)joining and let the
   * owner fall back to the non-collaborative view.
   */
  private handleJoinError = (data: JoinFileDocError) => {
    if (data.fileId !== this.fileId) return
    if (data.retryable === false) {
      this.fatal = true
      this.joinError = data
      this.clearConnectTimer()
    }
    this.emit('join-error', [data])
  }

  private handleSeedRequest = (data: SeedRequestPayload) => {
    if (data.fileId !== this.fileId) return
    this.shouldSeed = true
    this.emit('seed-request', [])
  }

  private handleMessage = (data: unknown) => {
    // Once we've given up (a non-retryable rejection, or the connect deadline lapsed and the editor
    // fell back to a read-only local seed), ignore ALL inbound frames. A late SyncStep2 arriving
    // after the deadline would otherwise merge the server's state into the already-seeded doc —
    // duplicating content — and flip `synced` true, which un-gates autosave and would persist the
    // duplicate back to the real file. `fatal` guarding (re)join alone is not enough; it must also
    // stop applying sync here.
    if (this.fatal) return
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
    // Updates we applied from the server carry `this` as origin — don't echo them.
    if (origin === this) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
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
    if (origin === this) return
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
    if (synced) this.clearConnectTimer()
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
    this.clearConnectTimer()

    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'provider-destroy')

    this.socket.emit(FILE_DOC_EVENTS.LEAVE, { fileId: this.fileId })
    this.socket.off(FILE_DOC_EVENTS.MESSAGE, this.handleMessage)
    this.socket.off(FILE_DOC_EVENTS.JOIN_SUCCESS, this.handleJoinSuccess)
    this.socket.off(FILE_DOC_EVENTS.JOIN_ERROR, this.handleJoinError)
    this.socket.off(FILE_DOC_EVENTS.SEED_REQUEST, this.handleSeedRequest)
    this.socket.off('connect', this.handleConnect)
    this.doc.off('update', this.handleDocUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)

    super.destroy()
  }
}
