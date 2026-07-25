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

  private disposed = false
  /** Set on a non-retryable join rejection (e.g. lost write access) so the
   * provider stops attempting to (re)join until the owner tears it down. */
  private fatal = false

  constructor(
    private readonly socket: Socket,
    private readonly fileId: string,
    readonly doc: Y.Doc,
    readonly awareness: awarenessProtocol.Awareness
  ) {
    super()

    socket.on(FILE_DOC_EVENTS.MESSAGE, this.handleMessage)
    socket.on(FILE_DOC_EVENTS.JOIN_SUCCESS, this.handleJoinSuccess)
    socket.on(FILE_DOC_EVENTS.JOIN_ERROR, this.handleJoinError)
    socket.on(FILE_DOC_EVENTS.SEED_REQUEST, this.handleSeedRequest)
    socket.on('connect', this.handleConnect)
    doc.on('update', this.handleDocUpdate)
    awareness.on('update', this.handleAwarenessUpdate)

    if (socket.connected) this.join()
  }

  private join = () => {
    if (this.fatal) return
    // Bind our client id at join so the server only accepts awareness we own.
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

  private handleJoinSuccess = (data: JoinFileDocSuccess) => {
    if (data.fileId !== this.fileId) return
    // We are now a member of the room, so it is safe to send messages (an earlier
    // send could be dropped: the server registers the room before this ack).
    this.sendSyncStep1()
    this.sendLocalAwareness()
  }

  private handleJoinError = (data: JoinFileDocError) => {
    if (data.fileId !== this.fileId) return
    // A non-retryable rejection (access denied, invalid) won't succeed on retry;
    // stop (re)joining and let the owner fall back to the non-collaborative view.
    if (data.retryable === false) this.fatal = true
    this.emit('join-error', [data])
  }

  private handleSeedRequest = (data: SeedRequestPayload) => {
    if (data.fileId !== this.fileId) return
    this.shouldSeed = true
    this.emit('seed-request', [])
  }

  private handleMessage = (data: unknown) => {
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
        // The first sync step 2 marks the document fully synced with the server.
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
    this.emit('synced', [synced])
  }

  /**
   * Tear down the provider: leave the room, clear our awareness (so our caret
   * disappears for everyone else), and detach all listeners. The document and
   * awareness objects are the caller's and are left intact.
   */
  destroy() {
    if (this.disposed) {
      super.destroy()
      return
    }
    this.disposed = true

    // Clear our local awareness so peers drop our caret immediately, rather than
    // waiting for the server's 30s awareness timeout.
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
