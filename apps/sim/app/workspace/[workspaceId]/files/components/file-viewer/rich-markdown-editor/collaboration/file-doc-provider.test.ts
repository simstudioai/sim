/**
 * @vitest-environment node
 */
import {
  FILE_DOC_EVENTS,
  FILE_DOC_LIMITS,
  FILE_DOC_MESSAGE_TYPE,
  FILE_DOC_SCHEMA_VERSION,
  FILE_DOC_SEED,
  FILE_DOC_TIMEOUTS,
  type FileDocUpdateAck,
} from '@sim/realtime-protocol/file-doc'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import type { Socket } from 'socket.io-client'
import { describe, expect, it, vi } from 'vitest'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { AGENT_STREAM_ORIGIN } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/apply-streamed-markdown'
import { FileDocProvider } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/file-doc-provider'
import { PendingFileDocUpdateJournal } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/pending-update-journal'

const journalStorage = vi.hoisted(() => new Map<string, unknown>())

vi.mock('idb-keyval', () => ({
  get: vi.fn((key: string) => journalStorage.get(key)),
  update: vi.fn((key: string, updater: (value: unknown) => unknown) => {
    journalStorage.set(key, updater(journalStorage.get(key)))
  }),
  del: vi.fn((key: string) => {
    journalStorage.delete(key)
  }),
}))

const UPDATE_BATCH_TEST_WINDOW_MS = 100

/** A minimal fake Socket.IO client whose server→client events can be fired in tests. */
function createSocket(connected = true) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const emit = vi.fn()
  const timeout = vi.fn((delay: number) => ({
    emit(
      event: string,
      payload: unknown,
      acknowledge: (error: Error | null, ack?: FileDocUpdateAck) => void
    ) {
      const timer = setTimeout(() => acknowledge(new Error('operation has timed out')), delay)
      emit(event, payload, (error: Error | null, ack?: FileDocUpdateAck) => {
        clearTimeout(timer)
        acknowledge(error, ack)
      })
    },
  }))
  const socket = {
    connected,
    emit,
    timeout,
    on(event: string, cb: (...args: unknown[]) => void) {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(cb)
    },
    off(event: string, cb: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(cb)
    },
  }
  const fire = (event: string, ...args: unknown[]) => {
    if (event === 'connect') socket.connected = true
    if (event === 'disconnect') socket.connected = false
    for (const cb of listeners.get(event) ?? []) cb(...args)
  }
  return { socket: socket as unknown as Socket, emit, fire, timeout }
}

function createProvider(connected = true) {
  const { socket, emit, fire, timeout } = createSocket(connected)
  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  const provider = new FileDocProvider(socket, 'file-1', doc, awareness)
  return { provider, doc, awareness, emit, fire, timeout }
}

function acceptJoin(
  fire: (event: string, ...args: unknown[]) => void,
  clientId: number,
  docId?: string,
  acknowledgedUpdates = true
) {
  fire(FILE_DOC_EVENTS.JOIN_SUCCESS, {
    fileId: 'file-1',
    clientId,
    docId,
    acknowledgedUpdates: acknowledgedUpdates ? true : undefined,
  })
}

/** Messages emitted to the server, decoded to their `{ type, bytes }`. */
function emittedMessages(emit: ReturnType<typeof vi.fn>) {
  return emit.mock.calls
    .filter(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    .map(([, payload]) => payload as Uint8Array)
}

function syncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
  syncProtocol.writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

describe('FileDocProvider', () => {
  it('joins immediately with its client id when the socket is already connected', () => {
    const { doc, emit } = createProvider(true)
    expect(emit).toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, {
      fileId: 'file-1',
      clientId: doc.clientID,
      schemaVersion: FILE_DOC_SCHEMA_VERSION,
    })
  })

  it('waits for connect before joining when the socket is offline', () => {
    const { emit, fire } = createProvider(false)
    expect(emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, expect.anything())
    fire('connect')
    expect(emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN,
      expect.objectContaining({ fileId: 'file-1' })
    )
  })

  it('exchanges sync only after JOIN_SUCCESS', () => {
    const { doc, emit, fire } = createProvider(true)
    emit.mockClear()
    expect(emittedMessages(emit)).toHaveLength(0)

    acceptJoin(fire, doc.clientID)

    // A sync step 1 (type tag 0) is sent to exchange state with the server.
    const messages = emittedMessages(emit)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages[0][0]).toBe(FILE_DOC_MESSAGE_TYPE.SYNC)
  })

  it('ignores inbound sync until the current join is accepted', () => {
    const { provider, doc, fire } = createProvider(true)
    const serverDoc = new Y.Doc()
    serverDoc.getText('default').insert(0, 'server content')
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeSyncStep2(encoder, serverDoc)
    const frame = encoding.toUint8Array(encoder)

    fire(FILE_DOC_EVENTS.MESSAGE, frame)

    expect(provider.synced).toBe(false)
    expect(doc.getText('default').toString()).toBe('')

    acceptJoin(fire, doc.clientID)
    fire(FILE_DOC_EVENTS.MESSAGE, frame)

    expect(provider.synced).toBe(true)
    expect(doc.getText('default').toString()).toBe('server content')
  })

  it('does not send local updates before the current join is accepted', () => {
    const { doc, emit } = createProvider(true)
    emit.mockClear()

    doc.getText('default').insert(0, 'retained locally')

    expect(emittedMessages(emit)).toHaveLength(0)
    expect(doc.getText('default').toString()).toBe('retained locally')
  })

  it('does not send local awareness before the current join is accepted', () => {
    const { awareness, emit } = createProvider(true)
    emit.mockClear()

    awareness.setLocalStateField('user', { name: 'Ada' })

    expect(emittedMessages(emit)).toHaveLength(0)
  })

  it('ignores a join ack for a different file', () => {
    const { doc, emit, fire } = createProvider(true)
    emit.mockClear()

    fire(FILE_DOC_EVENTS.JOIN_SUCCESS, { fileId: 'other-file', clientId: doc.clientID })

    // No sync/awareness exchange starts for a file this provider does not own.
    expect(emittedMessages(emit)).toHaveLength(0)
  })

  it('scopes join acknowledgements to the matching provider on a shared socket', () => {
    const { socket, fire } = createSocket(true)
    const firstDoc = new Y.Doc()
    const secondDoc = new Y.Doc()
    const first = new FileDocProvider(
      socket,
      'file-1',
      firstDoc,
      new awarenessProtocol.Awareness(firstDoc)
    )
    const second = new FileDocProvider(
      socket,
      'file-1',
      secondDoc,
      new awarenessProtocol.Awareness(secondDoc)
    )
    const serverDoc = new Y.Doc()
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeSyncStep2(encoder, serverDoc)
    const frame = encoding.toUint8Array(encoder)

    acceptJoin(fire, firstDoc.clientID)
    fire(FILE_DOC_EVENTS.MESSAGE, frame)

    expect(first.synced).toBe(true)
    expect(second.synced).toBe(false)

    acceptJoin(fire, secondDoc.clientID)
    fire(FILE_DOC_EVENTS.MESSAGE, frame)

    expect(second.synced).toBe(true)
    first.destroy()
    second.destroy()
  })

  /**
   * A tab that outlived its room can be offered a DIFFERENT document for the same file. Yjs would union
   * the two — the file twice, on both sides, and the relay persists it — and there is no un-merge. So
   * the sync must not happen at all; the fatal path leaves the editor read-only on what it already
   * shows, and a reload binds a fresh document.
   */
  it('refuses to sync into a document it does not recognize', () => {
    const { provider, doc, emit, fire } = createProvider(true)
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-original')
    const joinError = vi.fn()
    provider.on('join-error', joinError)
    emit.mockClear()

    acceptJoin(fire, doc.clientID, 'doc-rebuilt')

    expect(emittedMessages(emit)).toHaveLength(0)
    expect(provider.synced).toBe(false)
    expect(provider.joinError).toMatchObject({ code: 'DOCUMENT_REPLACED', retryable: false })
    expect(joinError).toHaveBeenCalledTimes(1)
  })

  it('fails closed when a seeded legacy tab has no identity but the server does', () => {
    const { provider, doc, emit, fire } = createProvider(true)
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
    emit.mockClear()

    acceptJoin(fire, doc.clientID, 'doc-current')

    expect(emittedMessages(emit)).toHaveLength(0)
    expect(provider.joinError).toMatchObject({ code: 'DOCUMENT_REPLACED', retryable: false })
  })

  it('syncs when the room holds the document it already has', () => {
    const { doc, emit, fire } = createProvider(true)
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-original')
    emit.mockClear()

    acceptJoin(fire, doc.clientID, 'doc-original')

    expect(emittedMessages(emit).length).toBeGreaterThan(0)
  })

  it('syncs when either side carries no identity (a fresh doc, or a room seeded before identities)', () => {
    const fresh = createProvider(true)
    fresh.emit.mockClear()
    acceptJoin(fresh.fire, fresh.doc.clientID, 'doc-rebuilt')
    expect(emittedMessages(fresh.emit).length).toBeGreaterThan(0)

    const unnamedRoom = createProvider(true)
    unnamedRoom.doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-original')
    unnamedRoom.emit.mockClear()
    acceptJoin(unnamedRoom.fire, unnamedRoom.doc.clientID)
    expect(emittedMessages(unnamedRoom.emit).length).toBeGreaterThan(0)
  })

  it('applies a server sync step 2 and becomes synced', () => {
    const { provider, doc, fire } = createProvider(true)
    const synced = vi.fn()
    provider.on('synced', synced)
    acceptJoin(fire, doc.clientID)

    const serverDoc = new Y.Doc()
    serverDoc.getText('default').insert(0, 'hello world')
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeSyncStep2(encoder, serverDoc)
    fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))

    expect(doc.getText('default').toString()).toBe('hello world')
    expect(provider.synced).toBe(true)
    expect(synced).toHaveBeenCalledWith(true)
  })

  it('routes local differences through the acknowledged channel instead of the sync handshake', async () => {
    const { socket, emit, fire } = createSocket(true)
    const doc = new Y.Doc()
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    doc.getText('default').insert(0, 'local')
    const provider = new FileDocProvider(
      socket,
      'file-1',
      doc,
      new awarenessProtocol.Awareness(doc)
    )
    acceptJoin(fire, doc.clientID, 'doc-1')
    emit.mockClear()

    fire(FILE_DOC_EVENTS.MESSAGE, syncStep1Frame(new Y.Doc()))

    const syncReplies = emittedMessages(emit).filter((message) => {
      const decoder = decoding.createDecoder(message)
      decoding.readVarUint(decoder)
      return decoding.readVarUint(decoder) === syncProtocol.messageYjsSyncStep2
    })
    expect(syncReplies).toHaveLength(0)
    await vi.waitFor(() => {
      expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(true)
    })
    const updatePayload = emit.mock.calls.find(
      ([event]) => event === FILE_DOC_EVENTS.UPDATE
    )?.[1] as {
      update: Uint8Array
    }
    const serverDoc = new Y.Doc()
    Y.applyUpdate(serverDoc, updatePayload.update)
    expect(serverDoc.getText('default').toString()).toBe('local')
    serverDoc.destroy()
    provider.destroy()
  })

  it('keeps standard Yjs sync behavior with an older relay during a rolling deployment', () => {
    const { doc, emit, fire } = createProvider(true)
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    doc.getText('default').insert(0, 'local')
    acceptJoin(fire, doc.clientID, 'doc-1', false)
    emit.mockClear()

    fire(FILE_DOC_EVENTS.MESSAGE, syncStep1Frame(new Y.Doc()))
    doc.getText('default').insert(5, ' edit')

    const messages = emittedMessages(emit)
    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
  })

  it('does not enable acknowledged updates unless the relay also supplies a document identity', () => {
    const { doc, emit, fire } = createProvider(true)
    doc.getText('default').insert(0, 'local')
    acceptJoin(fire, doc.clientID, undefined, true)
    emit.mockClear()

    fire(FILE_DOC_EVENTS.MESSAGE, syncStep1Frame(new Y.Doc()))

    expect(emittedMessages(emit).length).toBeGreaterThan(0)
    expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
  })

  it('uses ordinary Yjs synchronization without stale unload protection on a no-ACK relay', () => {
    const browserWindow = new EventTarget()
    vi.stubGlobal('window', browserWindow)
    const { provider, doc, awareness, emit, fire } = createProvider(true)
    const serverDoc = new Y.Doc()
    const unloadIsPrevented = () => {
      const event = new Event('beforeunload', { cancelable: true })
      Object.defineProperty(event, 'returnValue', { value: '', writable: true })
      browserWindow.dispatchEvent(event)
      return event.defaultPrevented
    }
    try {
      doc.getText('default').insert(0, 'before join')
      expect(unloadIsPrevented()).toBe(true)
      acceptJoin(fire, doc.clientID, undefined, false)
      expect(unloadIsPrevented()).toBe(false)

      fire('disconnect')
      doc.getText('default').insert(11, ' and offline')
      expect(unloadIsPrevented()).toBe(false)
      fire('connect')
      acceptJoin(fire, doc.clientID, undefined, false)
      emit.mockClear()
      fire(FILE_DOC_EVENTS.MESSAGE, syncStep1Frame(serverDoc))

      for (const message of emittedMessages(emit)) {
        const decoder = decoding.createDecoder(message)
        decoding.readVarUint(decoder)
        syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), serverDoc, null)
      }
      expect(serverDoc.getText('default').toString()).toBe('before join and offline')
      expect(unloadIsPrevented()).toBe(false)
      expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
    } finally {
      provider.destroy()
      awareness.destroy()
      doc.destroy()
      serverDoc.destroy()
      vi.unstubAllGlobals()
    }
  })

  it('recovers an unacknowledged edit after a tab restart and clears it only after acceptance', async () => {
    journalStorage.clear()
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const serverDoc = new Y.Doc()
    const serverConfig = serverDoc.getMap(FILE_DOC_SEED.configMap)
    serverConfig.set(FILE_DOC_SEED.docIdKey, 'doc-1')
    serverConfig.set(FILE_DOC_SEED.flag, true)
    serverDoc.getText('default').insert(0, 'base')

    const firstSocket = createSocket(true)
    const firstDoc = new Y.Doc()
    Y.applyUpdate(firstDoc, Y.encodeStateAsUpdate(serverDoc))
    const firstProvider = new FileDocProvider(
      firstSocket.socket,
      'file-1',
      firstDoc,
      new awarenessProtocol.Awareness(firstDoc),
      scope
    )
    acceptJoin(firstSocket.fire, firstDoc.clientID, 'doc-1')
    firstSocket.emit.mockClear()
    firstDoc.getText('default').insert(4, ' local')
    await vi.waitFor(() => {
      expect(firstSocket.emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(
        true
      )
    })
    firstProvider.destroy()

    const secondSocket = createSocket(true)
    const secondDoc = new Y.Doc()
    const secondProvider = new FileDocProvider(
      secondSocket.socket,
      'file-1',
      secondDoc,
      new awarenessProtocol.Awareness(secondDoc),
      scope
    )
    acceptJoin(secondSocket.fire, secondDoc.clientID, 'doc-1')
    const syncEncoder = encoding.createEncoder()
    encoding.writeVarUint(syncEncoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeSyncStep2(syncEncoder, serverDoc)
    secondSocket.fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(syncEncoder))

    await vi.waitFor(() => {
      expect(secondDoc.getText('default').toString()).toBe('base local')
      expect(secondSocket.emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(
        true
      )
    })
    const updateCall = secondSocket.emit.mock.calls.find(
      ([event]) => event === FILE_DOC_EVENTS.UPDATE
    )
    const payload = updateCall?.[1] as { updateId: string }
    const acknowledge = updateCall?.[2] as (error: Error | null, ack: FileDocUpdateAck) => void
    Y.applyUpdate(serverDoc, (updateCall?.[1] as { update: Uint8Array }).update)
    acknowledge(null, { status: 'accepted', updateId: payload.updateId })

    const journal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
    await vi.waitFor(async () => {
      await expect(journal.load()).resolves.toBeNull()
    })

    vi.useFakeTimers()
    try {
      secondSocket.fire('disconnect')
      secondSocket.fire('connect')
      secondSocket.emit.mockClear()
      acceptJoin(secondSocket.fire, secondDoc.clientID, 'doc-1')
      secondSocket.fire(FILE_DOC_EVENTS.MESSAGE, syncStep1Frame(serverDoc))
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
      expect(secondSocket.emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(
        false
      )
    } finally {
      vi.useRealTimers()
    }
    secondProvider.destroy()
    serverDoc.destroy()
  })

  it('batches local document edits into the acknowledged update channel', async () => {
    const { doc, emit, fire } = createProvider(true)
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    acceptJoin(fire, doc.clientID, 'doc-1')
    emit.mockClear()

    doc.getText('default').insert(0, 'x')

    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledWith(
        FILE_DOC_EVENTS.UPDATE,
        expect.objectContaining({ fileId: 'file-1', docId: 'doc-1' }),
        expect.any(Function)
      )
    })
    expect(emittedMessages(emit)).toHaveLength(0)
  })

  it('serializes journal flushes so an edit made during storage never becomes stranded', async () => {
    vi.useFakeTimers()
    const firstSave = Promise.withResolvers<{
      pendingUpdate: Uint8Array
      status: 'saved'
    }>()
    let saveCalls = 0
    let firstPendingUpdate: Uint8Array | null = null
    const save = vi
      .spyOn(PendingFileDocUpdateJournal.prototype, 'save')
      .mockImplementation(async (_docId, pendingUpdate) => {
        saveCalls += 1
        if (saveCalls === 1) {
          firstPendingUpdate = pendingUpdate
          return firstSave.promise
        }
        return { pendingUpdate, status: 'saved' }
      })
    try {
      const { socket, emit, fire } = createSocket(true)
      const doc = new Y.Doc()
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
      const provider = new FileDocProvider(
        socket,
        'file-1',
        doc,
        new awarenessProtocol.Awareness(doc),
        { workspaceId: 'workspace-1', userId: 'user-1' }
      )
      acceptJoin(fire, doc.clientID, 'doc-1')
      await vi.advanceTimersByTimeAsync(0)
      emit.mockClear()

      doc.getText('default').insert(0, 'first')
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
      doc.getText('default').insert(5, ' second')
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
      expect(save).toHaveBeenCalledOnce()

      firstSave.resolve({
        pendingUpdate: firstPendingUpdate!,
        status: 'saved',
      })
      await vi.advanceTimersByTimeAsync(0)
      const firstUpdate = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.UPDATE)
      const firstPayload = firstUpdate?.[1] as { updateId: string }
      const acknowledge = firstUpdate?.[2] as (error: Error | null, ack: FileDocUpdateAck) => void
      acknowledge(null, { status: 'accepted', updateId: firstPayload.updateId })
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)

      expect(save).toHaveBeenCalledTimes(2)
      expect(emit.mock.calls.filter(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toHaveLength(2)
      provider.destroy()
    } finally {
      save.mockRestore()
      vi.useRealTimers()
    }
  })

  it('retries an unacknowledged update with the same idempotency key', async () => {
    vi.useFakeTimers()
    try {
      const { provider, doc, emit, fire, timeout } = createProvider(true)
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
      acceptJoin(fire, doc.clientID, 'doc-1')
      emit.mockClear()

      doc.getText('default').insert(0, 'kept until acknowledged')
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
      const first = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.UPDATE)
      expect(first).toBeDefined()
      expect(timeout).toHaveBeenCalledWith(FILE_DOC_TIMEOUTS.updateAckMs)

      await vi.advanceTimersByTimeAsync(FILE_DOC_TIMEOUTS.updateAckMs + 2_000)
      const updates = emit.mock.calls.filter(([event]) => event === FILE_DOC_EVENTS.UPDATE)
      expect(updates.length).toBeGreaterThan(1)
      expect((updates[1][1] as { updateId: string }).updateId).toBe(
        (first?.[1] as { updateId: string }).updateId
      )
      provider.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejoins before retrying an update rejected because the room membership went stale', async () => {
    vi.useFakeTimers()
    try {
      const { provider, doc, emit, fire } = createProvider(true)
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
      acceptJoin(fire, doc.clientID, 'doc-1')
      emit.mockClear()
      doc.getText('default').insert(0, 'edit')
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
      const first = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.UPDATE)
      const payload = first?.[1] as { updateId: string }
      const acknowledge = first?.[2] as (error: Error | null, ack: FileDocUpdateAck) => void

      acknowledge(null, {
        status: 'rejected',
        updateId: payload.updateId,
        code: 'NOT_JOINED',
        retryable: true,
      })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.JOIN)).toBe(true)

      emit.mockClear()
      acceptJoin(fire, doc.clientID, 'doc-1')
      expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(true)
      provider.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores expired acknowledgements after the provider is destroyed', async () => {
    vi.useFakeTimers()
    const { provider, doc, awareness, emit, fire, timeout } = createProvider(true)
    try {
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
      acceptJoin(fire, doc.clientID, 'doc-1')
      doc.getText('default').insert(0, 'pending')
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
      expect(timeout).toHaveBeenCalledWith(FILE_DOC_TIMEOUTS.updateAckMs)

      provider.destroy()
      emit.mockClear()
      await vi.advanceTimersByTimeAsync(FILE_DOC_TIMEOUTS.updateAckMs + 6_000)
      expect(emit).not.toHaveBeenCalled()
    } finally {
      provider.destroy()
      awareness.destroy()
      doc.destroy()
      vi.useRealTimers()
    }
  })

  it('preserves pending acknowledged edits across a downgrade without calling legacy sync an acceptance', async () => {
    vi.useFakeTimers()
    journalStorage.clear()
    const browserWindow = new EventTarget()
    vi.stubGlobal('window', browserWindow)
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const journal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
    const clear = vi.spyOn(PendingFileDocUpdateJournal.prototype, 'clear')
    const { socket, emit, fire } = createSocket(true)
    const doc = new Y.Doc()
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
    const awareness = new awarenessProtocol.Awareness(doc)
    const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
    const serverDoc = new Y.Doc()
    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(doc))
    const unloadIsPrevented = () => {
      const event = new Event('beforeunload', { cancelable: true })
      Object.defineProperty(event, 'returnValue', { value: '', writable: true })
      browserWindow.dispatchEvent(event)
      return event.defaultPrevented
    }
    try {
      acceptJoin(fire, doc.clientID, 'doc-1')
      await vi.advanceTimersByTimeAsync(0)
      doc.getText('default').insert(0, 'pending acknowledged edit')
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
      const first = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.UPDATE)
      const firstPayload = first?.[1] as { updateId: string }
      expect(first).toBeDefined()

      fire('disconnect')
      fire('connect')
      acceptJoin(fire, doc.clientID, 'doc-1', false)
      await vi.advanceTimersByTimeAsync(0)
      emit.mockClear()
      fire(FILE_DOC_EVENTS.MESSAGE, syncStep1Frame(serverDoc))
      for (const message of emittedMessages(emit)) {
        const decoder = decoding.createDecoder(message)
        decoding.readVarUint(decoder)
        syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), serverDoc, null)
      }
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
      syncProtocol.writeSyncStep2(encoder, serverDoc)
      fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
      await vi.advanceTimersByTimeAsync(FILE_DOC_TIMEOUTS.updateAckMs + 6_000)

      expect(serverDoc.getText('default').toString()).toBe('pending acknowledged edit')
      expect(provider.synced).toBe(true)
      expect(unloadIsPrevented()).toBe(true)
      expect(await journal.load('doc-1')).not.toBeNull()
      expect(clear).not.toHaveBeenCalled()
      expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)

      fire('disconnect')
      fire('connect')
      acceptJoin(fire, doc.clientID, 'doc-1')
      await vi.advanceTimersByTimeAsync(0)
      const retry = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.UPDATE)
      expect(retry?.[1]).toMatchObject({ updateId: firstPayload.updateId })
      const acknowledge = retry?.[2] as (error: Error | null, ack: FileDocUpdateAck) => void
      acknowledge(null, { status: 'accepted', updateId: firstPayload.updateId })
      await vi.advanceTimersByTimeAsync(0)
      expect(unloadIsPrevented()).toBe(false)
      expect(await journal.load('doc-1')).toBeNull()
    } finally {
      provider.destroy()
      awareness.destroy()
      doc.destroy()
      serverDoc.destroy()
      clear.mockRestore()
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('protects a recovered pending journal even when the new relay has no acknowledged channel', async () => {
    journalStorage.clear()
    const browserWindow = new EventTarget()
    vi.stubGlobal('window', browserWindow)
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const journal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
    const recoveredDoc = new Y.Doc()
    recoveredDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    recoveredDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
    recoveredDoc.getText('default').insert(0, 'recover me')
    const update = Y.encodeStateAsUpdate(recoveredDoc)
    await journal.save('doc-1', update, update)
    const { socket, fire } = createSocket(true)
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
    try {
      acceptJoin(fire, doc.clientID, 'doc-1', false)
      await vi.waitFor(() => expect(doc.getText('default').toString()).toBe('recover me'))
      const event = new Event('beforeunload', { cancelable: true })
      Object.defineProperty(event, 'returnValue', { value: '', writable: true })
      browserWindow.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(await journal.load('doc-1')).not.toBeNull()
    } finally {
      provider.destroy()
      awareness.destroy()
      doc.destroy()
      recoveredDoc.destroy()
      vi.unstubAllGlobals()
    }
  })

  it('journals an edit made while disconnected before page teardown', async () => {
    journalStorage.clear()
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const { socket, emit, fire } = createSocket(true)
    const doc = new Y.Doc()
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    const provider = new FileDocProvider(
      socket,
      'file-1',
      doc,
      new awarenessProtocol.Awareness(doc),
      scope
    )
    acceptJoin(fire, doc.clientID, 'doc-1')
    emit.mockClear()
    fire('disconnect')

    doc.getText('default').insert(0, 'offline edit')

    const journal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
    await vi.waitFor(async () => {
      await expect(journal.load('doc-1')).resolves.not.toBeNull()
    })
    expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
    provider.destroy()
  })

  it('preserves pending recovery through page teardown and destroy', async () => {
    journalStorage.clear()
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const { socket, fire } = createSocket(true)
    const doc = new Y.Doc()
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    const provider = new FileDocProvider(
      socket,
      'file-1',
      doc,
      new awarenessProtocol.Awareness(doc),
      scope
    )
    acceptJoin(fire, doc.clientID, 'doc-1')
    fire('disconnect')
    doc.getText('default').insert(0, 'preserve me')
    const journal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
    await vi.waitFor(async () => expect(await journal.load('doc-1')).not.toBeNull())

    ;(provider as unknown as { handlePageHide: () => void }).handlePageHide()
    provider.destroy()

    const stored = await journal.load('doc-1')
    expect(stored).not.toBeNull()
    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, stored!.recoverySnapshot!)
    Y.applyUpdate(recovered, stored!.pendingUpdate)
    expect(recovered.getText('default').toString()).toBe('preserve me')
    recovered.destroy()
    doc.destroy()
  })

  it('hydrates the complete local draft before reporting a replaced document', async () => {
    journalStorage.clear()
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const oldDoc = new Y.Doc()
    oldDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'old-doc')
    oldDoc.getText('default').insert(0, 'complete draft')
    const recoverySnapshot = Y.encodeStateAsUpdate(oldDoc)
    const stateVector = Y.encodeStateVector(oldDoc)
    oldDoc.getText('default').insert('complete draft'.length, ' plus pending')
    const pendingUpdate = Y.encodeStateAsUpdate(oldDoc, stateVector)
    await new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' }).save(
      'old-doc',
      pendingUpdate,
      recoverySnapshot
    )
    const { socket, emit, fire } = createSocket(true)
    const doc = new Y.Doc()
    const provider = new FileDocProvider(
      socket,
      'file-1',
      doc,
      new awarenessProtocol.Awareness(doc),
      scope
    )

    acceptJoin(fire, doc.clientID, 'current-doc')

    await vi.waitFor(() => expect(provider.joinError).toMatchObject({ code: 'DOCUMENT_REPLACED' }))
    expect(doc.getText('default').toString()).toBe('complete draft plus pending')
    expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
    provider.destroy()
    oldDoc.destroy()
  })

  it('never falls back to a different document identity when loading local recovery', async () => {
    journalStorage.clear()
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const oldDoc = new Y.Doc()
    oldDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-old')
    oldDoc.getText('default').insert(0, 'old draft')
    const oldSnapshot = Y.encodeStateAsUpdate(oldDoc)
    await new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' }).save(
      'doc-old',
      oldSnapshot,
      oldSnapshot
    )

    const { socket, fire } = createSocket(true)
    const currentDoc = new Y.Doc()
    currentDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-current')
    currentDoc.getText('default').insert(0, 'current content')
    const provider = new FileDocProvider(
      socket,
      'file-1',
      currentDoc,
      new awarenessProtocol.Awareness(currentDoc),
      scope
    )
    acceptJoin(fire, currentDoc.clientID, 'doc-current')

    await vi.waitFor(() => expect(provider.joinError).toBeNull())
    expect(currentDoc.getText('default').toString()).toBe('current content')
    await expect(
      new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' }).load('doc-old')
    ).resolves.not.toBeNull()
    provider.destroy()
    currentDoc.destroy()
    oldDoc.destroy()
  })

  it('fails terminally without partially applying a malformed local recovery record', async () => {
    const load = vi.spyOn(PendingFileDocUpdateJournal.prototype, 'load').mockResolvedValue({
      docId: 'doc-1',
      recoverySnapshot: null,
      pendingUpdate: new Uint8Array([255]),
      updatedAt: Date.now(),
    })
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const { socket, emit, fire } = createSocket(true)
    const doc = new Y.Doc()
    const provider = new FileDocProvider(
      socket,
      'file-1',
      doc,
      new awarenessProtocol.Awareness(doc),
      scope
    )
    acceptJoin(fire, doc.clientID, 'doc-1')

    await vi.waitFor(() => expect(provider.joinError).toMatchObject({ code: 'INVALID_UPDATE' }))
    expect(doc.getText('default').toString()).toBe('')
    expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
    provider.destroy()
    doc.destroy()
    load.mockRestore()
  })

  it('ignores an obsolete schema rejection when recovery finishes after reconnecting', async () => {
    const recovery = Promise.withResolvers<null>()
    const load = vi
      .spyOn(PendingFileDocUpdateJournal.prototype, 'load')
      .mockReturnValue(recovery.promise)
    const { socket, emit, fire } = createSocket(true)
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    const provider = new FileDocProvider(socket, 'file-1', doc, awareness, {
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
    try {
      fire(FILE_DOC_EVENTS.JOIN_SUCCESS, {
        fileId: 'file-1',
        clientId: doc.clientID,
        schemaVersion: FILE_DOC_SCHEMA_VERSION + 1,
      })
      fire('disconnect')
      fire('connect')
      acceptJoin(fire, doc.clientID)
      emit.mockClear()
      recovery.resolve(null)

      await vi.waitFor(() => expect(emittedMessages(emit).length).toBeGreaterThan(0))
      expect(provider.joinError).toBeNull()
    } finally {
      provider.destroy()
      awareness.destroy()
      doc.destroy()
      load.mockRestore()
    }
  })

  it('fails closed when hydration buffers more than its bounded message count', async () => {
    const load = vi
      .spyOn(PendingFileDocUpdateJournal.prototype, 'load')
      .mockReturnValue(new Promise(() => {}))
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const { socket, fire } = createSocket(true)
    const doc = new Y.Doc()
    const provider = new FileDocProvider(
      socket,
      'file-1',
      doc,
      new awarenessProtocol.Awareness(doc),
      scope
    )
    acceptJoin(fire, doc.clientID, 'doc-1')
    const message = syncStep1Frame(new Y.Doc())

    for (let index = 0; index < 129; index += 1) {
      fire(FILE_DOC_EVENTS.MESSAGE, message)
    }

    expect(provider.joinError).toMatchObject({ code: 'HYDRATION_BUFFER_OVERFLOW' })
    provider.destroy()
    load.mockRestore()
  })

  it('fails closed when hydration buffers more than its bounded byte budget', () => {
    const load = vi
      .spyOn(PendingFileDocUpdateJournal.prototype, 'load')
      .mockReturnValue(new Promise(() => {}))
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const { socket, fire } = createSocket(true)
    const doc = new Y.Doc()
    const provider = new FileDocProvider(
      socket,
      'file-1',
      doc,
      new awarenessProtocol.Awareness(doc),
      scope
    )
    acceptJoin(fire, doc.clientID, 'doc-1')

    fire(FILE_DOC_EVENTS.MESSAGE, new Uint8Array(FILE_DOC_LIMITS.updateBytes * 2 + 1))

    expect(provider.joinError).toMatchObject({ code: 'HYDRATION_BUFFER_OVERFLOW' })
    provider.destroy()
    doc.destroy()
    load.mockRestore()
  })

  it('makes an older different-file provider terminal before unscoped frames can cross documents', async () => {
    const { socket, emit, fire } = createSocket(true)
    const firstDoc = new Y.Doc()
    const firstProvider = new FileDocProvider(
      socket,
      'file-1',
      firstDoc,
      new awarenessProtocol.Awareness(firstDoc)
    )
    acceptJoin(fire, firstDoc.clientID)

    const secondDoc = new Y.Doc()
    const secondProvider = new FileDocProvider(
      socket,
      'file-2',
      secondDoc,
      new awarenessProtocol.Awareness(secondDoc)
    )
    expect(firstProvider.joinError).toMatchObject({ code: 'DOCUMENT_REPLACED' })
    fire(FILE_DOC_EVENTS.JOIN_SUCCESS, {
      fileId: 'file-2',
      clientId: secondDoc.clientID,
      acknowledgedUpdates: true,
    })
    await vi.waitFor(() => expect(emittedMessages(emit).length).toBeGreaterThan(0))

    const remote = new Y.Doc()
    remote.getText('default').insert(0, 'second-file content')
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(remote))
    fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))

    expect(firstDoc.getText('default').toString()).toBe('')
    expect(secondDoc.getText('default').toString()).toBe('second-file content')
    firstProvider.destroy()
    secondProvider.destroy()
    firstDoc.destroy()
    secondDoc.destroy()
    remote.destroy()
  })

  it('stops editing while the complete local recovery snapshot cannot be persisted', async () => {
    vi.useFakeTimers()
    const save = vi
      .spyOn(PendingFileDocUpdateJournal.prototype, 'save')
      .mockImplementation(async (_docId, pendingUpdate) => ({
        pendingUpdate,
        status: 'limit-exceeded',
      }))
    try {
      const { socket, emit, fire } = createSocket(true)
      const doc = new Y.Doc()
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
      const provider = new FileDocProvider(
        socket,
        'file-1',
        doc,
        new awarenessProtocol.Awareness(doc),
        { workspaceId: 'workspace-1', userId: 'user-1' }
      )
      acceptJoin(fire, doc.clientID, 'doc-1')
      emit.mockClear()

      doc.getText('default').insert(0, 'must remain downloadable')
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)

      expect(provider.joinError).toMatchObject({ code: 'PENDING_UPDATE_LIMIT' })
      expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
      provider.destroy()
    } finally {
      save.mockRestore()
      vi.useRealTimers()
    }
  })

  it.each(['saved', 'unavailable'] as const)(
    'warns before unloading pending edits and continues acknowledged saves when storage is %s',
    async (status) => {
      vi.useFakeTimers()
      journalStorage.clear()
      const browserWindow = new EventTarget()
      vi.stubGlobal('window', browserWindow)
      const save = vi
        .spyOn(PendingFileDocUpdateJournal.prototype, 'save')
        .mockImplementation(async (_docId, pendingUpdate) => ({ pendingUpdate, status }))
      const unloadIsPrevented = () => {
        const event = new Event('beforeunload', { cancelable: true })
        Object.defineProperty(event, 'returnValue', { value: '', writable: true })
        browserWindow.dispatchEvent(event)
        return event.defaultPrevented
      }
      try {
        const { socket, emit, fire } = createSocket(true)
        const doc = new Y.Doc()
        doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
        const awareness = new awarenessProtocol.Awareness(doc)
        const provider = new FileDocProvider(socket, 'file-1', doc, awareness, {
          workspaceId: 'workspace-1',
          userId: 'user-1',
        })
        acceptJoin(fire, doc.clientID, 'doc-1')
        await vi.advanceTimersByTimeAsync(0)
        expect(unloadIsPrevented()).toBe(false)

        doc.getText('default').insert(0, 'pending edit')
        expect(unloadIsPrevented()).toBe(true)
        await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
        expect(provider.joinError).toBeNull()
        const update = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.UPDATE)
        expect(update).toBeDefined()
        const payload = update?.[1] as { updateId: string }
        const acknowledge = update?.[2] as (error: Error | null, ack: FileDocUpdateAck) => void
        expect(unloadIsPrevented()).toBe(true)
        acknowledge(null, { status: 'accepted', updateId: payload.updateId })
        expect(unloadIsPrevented()).toBe(false)

        doc.getText('default').insert(0, 'another ')
        expect(unloadIsPrevented()).toBe(true)
        provider.destroy()
        expect(unloadIsPrevented()).toBe(false)
        awareness.destroy()
        doc.destroy()
      } finally {
        save.mockRestore()
        vi.unstubAllGlobals()
        vi.useRealTimers()
      }
    }
  )

  it('keeps retrying sync without fatally timing out a previously healthy reconnect', async () => {
    vi.useFakeTimers()
    try {
      const { provider, doc, emit, fire } = createProvider(true)
      acceptJoin(fire, doc.clientID, 'doc-1')
      const serverDoc = new Y.Doc()
      const config = serverDoc.getMap(FILE_DOC_SEED.configMap)
      config.set(FILE_DOC_SEED.docIdKey, 'doc-1')
      config.set(FILE_DOC_SEED.flag, true)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
      syncProtocol.writeSyncStep2(encoder, serverDoc)
      fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
      expect(provider.synced).toBe(true)

      emit.mockClear()
      fire('disconnect')
      fire('connect')
      expect(emit.mock.calls.filter(([event]) => event === FILE_DOC_EVENTS.JOIN)).toHaveLength(1)
      acceptJoin(fire, doc.clientID, 'doc-1')

      await vi.advanceTimersByTimeAsync(FILE_DOC_TIMEOUTS.readinessDeadlineMs)
      expect(provider.joinError).toBeNull()
      expect(emittedMessages(emit).length).toBeGreaterThan(1)
      provider.destroy()
      serverDoc.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries an accepted sync handshake that never receives a response', async () => {
    vi.useFakeTimers()
    try {
      const { provider, doc, emit, fire } = createProvider(true)
      acceptJoin(fire, doc.clientID)
      emit.mockClear()

      await vi.advanceTimersByTimeAsync(6_000)

      expect(emittedMessages(emit).length).toBeGreaterThan(1)
      expect(provider.joinError).toBeNull()
      provider.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('tags agent-streamed edits as SYNC_NO_PERSIST so the relay skips the durable persist', () => {
    const { doc, emit, fire } = createProvider(true)
    acceptJoin(fire, doc.clientID)
    emit.mockClear()

    // An agent-streamed frame is applied under AGENT_STREAM_ORIGIN; it must still reach the server (peers
    // see it live) but as SYNC_NO_PERSIST, so the relay fans it out without treating it as a user edit.
    doc.transact(() => doc.getText('default').insert(0, 'agent'), AGENT_STREAM_ORIGIN)

    const messages = emittedMessages(emit)
    expect(messages.length).toBe(1)
    expect(messages[0][0]).toBe(FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST)
  })

  it('does not echo updates it applied from the server', () => {
    const { provider, doc, emit, fire } = createProvider(true)
    acceptJoin(fire, doc.clientID)
    emit.mockClear()

    const serverDoc = new Y.Doc()
    serverDoc.getText('default').insert(0, 'remote')
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(serverDoc))
    fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))

    // The applied remote update must not be re-emitted back to the server.
    expect(emittedMessages(emit)).toHaveLength(0)
    expect(provider.doc.getText('default').toString()).toBe('remote')
  })

  it('sends local awareness (cursor/selection) changes', () => {
    const { awareness, doc, emit, fire } = createProvider(true)
    acceptJoin(fire, doc.clientID)
    emit.mockClear()

    awareness.setLocalStateField('user', { name: 'Ada', color: '#f783ac' })

    const messages = emittedMessages(emit)
    expect(messages.some((m) => m[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS)).toBe(true)
  })

  it('reseeds a cleared awareness so a reused instance can publish again', () => {
    const { socket, emit, fire } = createSocket(true)
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    // Simulate a prior provider teardown having cleared the local state — after
    // this, y-protocols' setLocalStateField is a permanent no-op, so the caret
    // extension could never publish the local user/cursor on a reused instance.
    awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], 'prior-destroy')
    expect(awareness.getLocalState()).toBeNull()

    // Constructing a provider on the reused, cleared awareness must restore it.
    new FileDocProvider(socket, 'file-1', doc, awareness)
    expect(awareness.getLocalState()).not.toBeNull()

    acceptJoin(fire, doc.clientID)
    emit.mockClear()
    // The caret extension setting the user field must now actually publish.
    awareness.setLocalStateField('user', { name: 'Ada', color: '#f783ac' })
    expect(emittedMessages(emit).some((m) => m[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS)).toBe(true)
  })

  it('does not forward awareness it applied from the server', () => {
    const { doc, emit, fire } = createProvider(true)
    acceptJoin(fire, doc.clientID)
    emit.mockClear()

    const remoteDoc = new Y.Doc()
    remoteDoc.clientID = 8888
    const remoteAwareness = new awarenessProtocol.Awareness(remoteDoc)
    remoteAwareness.setLocalStateField('user', { name: 'Remote' })
    const update = awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [8888])
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.AWARENESS)
    encoding.writeVarUint8Array(encoder, update)
    fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))

    // The remote peer's awareness (client 8888, not ours) must not be re-published.
    expect(emittedMessages(emit).some((m) => m[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS)).toBe(false)
  })

  it('stops attempting to join and latches joinError after a non-retryable error', () => {
    const { provider, emit, fire } = createProvider(true)
    emit.mockClear()

    const error = {
      fileId: 'file-1',
      error: 'Access denied',
      code: 'ACCESS_DENIED',
      retryable: false,
    }
    fire(FILE_DOC_EVENTS.JOIN_ERROR, error)
    fire('connect')

    expect(emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, expect.anything())
    // Latched so a consumer subscribing after the event can still detect the failure.
    expect(provider.joinError).toEqual(error)
  })

  it('becomes terminal when a durable replacement invalidates its document generation', () => {
    const { provider, doc, emit, fire } = createProvider(true)
    const onError = vi.fn()
    provider.on('join-error', onError)

    fire(FILE_DOC_EVENTS.INVALIDATED, {
      fileId: 'file-1',
      message: 'This file changed outside the editor. Reload to continue editing.',
    })

    expect(provider.joinError).toMatchObject({
      code: 'DOCUMENT_REPLACED',
      retryable: false,
    })
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DOCUMENT_REPLACED', retryable: false })
    )

    emit.mockClear()
    fire('connect')
    fire(FILE_DOC_EVENTS.MESSAGE, syncStep1Frame(new Y.Doc()))
    expect(emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, expect.anything())
    expect(doc.getText('default').toString()).toBe('')
  })

  it('scopes join errors to the matching provider on a shared socket', () => {
    const { socket, fire } = createSocket(true)
    const firstDoc = new Y.Doc()
    const secondDoc = new Y.Doc()
    const first = new FileDocProvider(
      socket,
      'file-1',
      firstDoc,
      new awarenessProtocol.Awareness(firstDoc)
    )
    const second = new FileDocProvider(
      socket,
      'file-1',
      secondDoc,
      new awarenessProtocol.Awareness(secondDoc)
    )
    const error = {
      fileId: 'file-1',
      clientId: firstDoc.clientID,
      error: 'Access denied',
      code: 'ACCESS_DENIED',
      retryable: false,
    }

    fire(FILE_DOC_EVENTS.JOIN_ERROR, error)

    expect(first.joinError).toEqual(error)
    expect(second.joinError).toBeNull()
    first.destroy()
    second.destroy()
  })

  it('retries a retryable join error without waiting for another socket reconnect', () => {
    vi.useFakeTimers()
    try {
      const { emit, fire } = createProvider(true)
      emit.mockClear()

      fire(FILE_DOC_EVENTS.JOIN_ERROR, {
        fileId: 'file-1',
        error: 'Realtime unavailable',
        code: 'ROOM_MANAGER_UNAVAILABLE',
        retryable: true,
      })

      expect(emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, expect.anything())
      vi.advanceTimersByTime(1_000)
      expect(emit).toHaveBeenCalledWith(
        FILE_DOC_EVENTS.JOIN,
        expect.objectContaining({ fileId: 'file-1' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a scheduled join retry after a successful join', () => {
    vi.useFakeTimers()
    try {
      const { doc, emit, fire } = createProvider(true)
      fire(FILE_DOC_EVENTS.JOIN_ERROR, {
        fileId: 'file-1',
        error: 'Realtime unavailable',
        code: 'ROOM_MANAGER_UNAVAILABLE',
        retryable: true,
      })
      vi.advanceTimersByTime(1_000)
      acceptJoin(fire, doc.clientID)
      emit.mockClear()

      vi.advanceTimersByTime(10_000)

      expect(emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets synced and rejoins on a reconnect', () => {
    const { provider, doc, emit, fire } = createProvider(true)
    acceptJoin(fire, doc.clientID)
    // Become synced.
    const serverDoc = new Y.Doc()
    serverDoc.getText('default').insert(0, 'hi')
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeSyncStep2(encoder, serverDoc)
    fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
    expect(provider.synced).toBe(true)
    emit.mockClear()

    // A reconnect must drop synced and re-issue JOIN so the doc re-syncs.
    fire('connect')

    expect(provider.synced).toBe(false)
    expect(emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN,
      expect.objectContaining({ fileId: 'file-1' })
    )
  })

  it('resets synced immediately when the socket disconnects', () => {
    const { provider, doc, fire } = createProvider(true)
    acceptJoin(fire, doc.clientID)
    const synced = vi.fn()
    provider.on('synced', synced)
    const serverDoc = new Y.Doc()
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeSyncStep2(encoder, serverDoc)
    fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
    expect(provider.synced).toBe(true)

    const remoteDoc = new Y.Doc()
    remoteDoc.clientID = 8888
    const remoteAwareness = new awarenessProtocol.Awareness(remoteDoc)
    remoteAwareness.setLocalStateField('user', { name: 'Remote' })
    const awarenessEncoder = encoding.createEncoder()
    encoding.writeVarUint(awarenessEncoder, FILE_DOC_MESSAGE_TYPE.AWARENESS)
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [remoteDoc.clientID])
    )
    fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(awarenessEncoder))
    expect(provider.awareness.getStates().has(remoteDoc.clientID)).toBe(true)
    synced.mockClear()

    fire('disconnect', 'transport close')

    expect(provider.synced).toBe(false)
    expect(synced).toHaveBeenCalledWith(false)
    expect(provider.awareness.getStates().has(remoteDoc.clientID)).toBe(false)
  })

  it('drops offline awareness emissions and republishes the latest state after rejoining', () => {
    const { awareness, doc, emit, fire } = createProvider(true)
    acceptJoin(fire, doc.clientID)
    fire('disconnect', 'transport close')
    emit.mockClear()

    awareness.setLocalStateField('user', { name: 'Ada' })
    awareness.setLocalStateField('selection', { anchor: 4, head: 4 })

    expect(emittedMessages(emit)).toHaveLength(0)

    fire('connect')
    expect(emittedMessages(emit)).toHaveLength(0)
    acceptJoin(fire, doc.clientID)

    expect(
      emittedMessages(emit).some((message) => message[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS)
    ).toBe(true)
  })

  it('cancels a scheduled join retry on disconnect', () => {
    vi.useFakeTimers()
    try {
      const { emit, fire } = createProvider(true)
      fire(FILE_DOC_EVENTS.JOIN_ERROR, {
        fileId: 'file-1',
        error: 'Realtime unavailable',
        code: 'ROOM_MANAGER_UNAVAILABLE',
        retryable: true,
      })
      fire('disconnect', 'transport close')
      emit.mockClear()

      vi.advanceTimersByTime(10_000)

      expect(emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a scheduled join retry when destroyed', () => {
    vi.useFakeTimers()
    try {
      const { provider, emit, fire } = createProvider(true)
      fire(FILE_DOC_EVENTS.JOIN_ERROR, {
        fileId: 'file-1',
        error: 'Realtime unavailable',
        code: 'ROOM_MANAGER_UNAVAILABLE',
        retryable: true,
      })
      provider.destroy()
      emit.mockClear()

      vi.advanceTimersByTime(10_000)

      expect(emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves the room and detaches on destroy', () => {
    const { provider, doc, emit } = createProvider(true)
    emit.mockClear()

    provider.destroy()

    expect(emit).toHaveBeenCalledWith(FILE_DOC_EVENTS.LEAVE, { fileId: 'file-1' })
    // After destroy, local edits are no longer forwarded.
    emit.mockClear()
    doc.getText('default').insert(0, 'y')
    expect(emittedMessages(emit)).toHaveLength(0)
  })

  it('leaves the room only when the LAST provider for a file on a shared socket is destroyed', () => {
    // Two surfaces in one tab (Files editor + embedded chat panel) share one socket and both open the
    // same file. Tearing the first down must NOT strand the second — the server drops the socket from
    // the room on any LEAVE, so LEAVE may fire only when the last provider goes away.
    const { socket, emit, fire } = createSocket(true)
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const first = new FileDocProvider(
      socket,
      'shared-file',
      docA,
      new awarenessProtocol.Awareness(docA)
    )
    const second = new FileDocProvider(
      socket,
      'shared-file',
      docB,
      new awarenessProtocol.Awareness(docB)
    )
    fire(FILE_DOC_EVENTS.JOIN_SUCCESS, {
      fileId: 'shared-file',
      clientId: docA.clientID,
    })
    fire(FILE_DOC_EVENTS.JOIN_SUCCESS, {
      fileId: 'shared-file',
      clientId: docB.clientID,
    })
    emit.mockClear()

    first.destroy()
    expect(
      emittedMessages(emit).some((message) => message[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS)
    ).toBe(true)
    expect(emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.LEAVE, expect.anything())

    second.destroy()
    expect(emit).toHaveBeenCalledWith(FILE_DOC_EVENTS.LEAVE, { fileId: 'shared-file' })
  })

  it('scopes the shared-membership refcount per file (a sibling file leaves independently)', () => {
    const { socket, emit } = createSocket(true)
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const fileA = new FileDocProvider(socket, 'file-a', docA, new awarenessProtocol.Awareness(docA))
    const fileB = new FileDocProvider(socket, 'file-b', docB, new awarenessProtocol.Awareness(docB))
    emit.mockClear()

    fileA.destroy()
    // A different file's sole provider still leaves immediately.
    expect(emit).toHaveBeenCalledWith(FILE_DOC_EVENTS.LEAVE, { fileId: 'file-a' })
    expect(emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.LEAVE, { fileId: 'file-b' })

    fileB.destroy()
    expect(emit).toHaveBeenCalledWith(FILE_DOC_EVENTS.LEAVE, { fileId: 'file-b' })
  })

  it('gives up with a non-retryable join-error when the first sync never arrives (offline)', () => {
    vi.useFakeTimers()
    try {
      const { provider, emit, fire } = createProvider(false) // socket never connects
      const onError = vi.fn()
      provider.on('join-error', onError)

      vi.advanceTimersByTime(12_000)

      // Surfaces the same non-retryable rejection the fatal path uses, so the editor falls back to
      // showing the file read-only.
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'READINESS_TIMEOUT', retryable: false })
      )
      expect(provider.joinError).toEqual(
        expect.objectContaining({ code: 'READINESS_TIMEOUT', retryable: false })
      )
      // Latched fatal: a later connect must not re-join (which could sync server state in and
      // duplicate the locally-seeded content).
      emit.mockClear()
      fire('connect')
      expect(emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fire the fallback once the doc is synced AND seeded', () => {
    vi.useFakeTimers()
    try {
      const { provider, doc, fire } = createProvider(true)
      const onError = vi.fn()
      provider.on('join-error', onError)

      // The initial sync brings BOTH content and the server seed flag before the deadline.
      acceptJoin(fire, doc.clientID)
      const remote = new Y.Doc()
      remote.getText('default').insert(0, 'hi')
      remote.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
      syncProtocol.writeSyncStep2(encoder, remote)
      fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
      expect(provider.synced).toBe(true)

      vi.advanceTimersByTime(12_000)
      expect(onError).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fires the fallback when the doc synced but the server seed never landed', () => {
    vi.useFakeTimers()
    try {
      const { provider, doc, fire } = createProvider(true)
      const onError = vi.fn()
      provider.on('join-error', onError)

      // The socket syncs an empty doc, but the server-side seed never arrives (its build persistently
      // failed) — `synced` is true yet `initialContentLoaded` is never set.
      acceptJoin(fire, doc.clientID)
      const remote = new Y.Doc()
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
      syncProtocol.writeSyncStep2(encoder, remote)
      fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
      expect(provider.synced).toBe(true)

      vi.advanceTimersByTime(12_000)

      // The readiness deadline still fires → the editor falls back to the stored content read-only,
      // and `synced` is dropped so the `synced && seeded` gate stays closed (read-only, not editable).
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'READINESS_TIMEOUT', retryable: false })
      )
      expect(provider.synced).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a late SyncStep2 that arrives after the readiness deadline (no merge, stays gated)', () => {
    vi.useFakeTimers()
    try {
      const { provider, doc, fire } = createProvider(true)
      acceptJoin(fire, doc.clientID)

      // Deadline lapses with no first sync → fatal fallback (editor falls back to a read-only seed).
      vi.advanceTimersByTime(12_000)
      expect(provider.joinError).toEqual(expect.objectContaining({ code: 'READINESS_TIMEOUT' }))

      // A delayed SyncStep2 finally arrives. Applying it would merge server content into the
      // already-seeded doc (duplication) and flip synced→true (un-gating autosave), so it MUST be
      // dropped once fatal.
      const remote = new Y.Doc()
      remote.getText('default').insert(0, 'server content')
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
      syncProtocol.writeSyncStep2(encoder, remote)
      fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))

      expect(provider.synced).toBe(false)
      expect(doc.getText('default').toString()).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })
})
