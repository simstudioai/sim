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
import { update as updateJournalStorage } from 'idb-keyval'
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

  it('protects only unsent changes when a legacy relay provides no document identity', () => {
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
      doc.getText('default').insert(11, ' online')
      expect(unloadIsPrevented()).toBe(false)

      fire('disconnect')
      doc.getText('default').insert(18, ' and offline')
      expect(unloadIsPrevented()).toBe(true)
      fire('connect')
      acceptJoin(fire, doc.clientID, undefined, false)
      emit.mockClear()
      fire(FILE_DOC_EVENTS.MESSAGE, syncStep1Frame(serverDoc))

      for (const message of emittedMessages(emit)) {
        const decoder = decoding.createDecoder(message)
        decoding.readVarUint(decoder)
        syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), serverDoc, null)
      }
      expect(serverDoc.getText('default').toString()).toBe('before join online and offline')
      expect(unloadIsPrevented()).toBe(true)
      expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
    } finally {
      provider.destroy()
      awareness.destroy()
      doc.destroy()
      serverDoc.destroy()
      vi.unstubAllGlobals()
    }
  })

  it.each(['acknowledged', 'legacy-offline', 'legacy-rejoining'] as const)(
    'recovers an unacknowledged %s edit after restart and clears it only after acceptance',
    async (mode) => {
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
      acceptJoin(firstSocket.fire, firstDoc.clientID, 'doc-1', mode === 'acknowledged')
      await vi.waitFor(() => expect(emittedMessages(firstSocket.emit).length).toBeGreaterThan(0))
      if (mode !== 'acknowledged') firstSocket.fire('disconnect')
      if (mode === 'legacy-rejoining') firstSocket.fire('connect')
      firstSocket.emit.mockClear()
      firstDoc.getText('default').insert(4, ' local')
      const firstJournal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
      await vi.waitFor(async () => {
        expect(await firstJournal.load('doc-1')).not.toBeNull()
      })
      expect(firstSocket.emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(
        mode === 'acknowledged'
      )
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
        expect(
          secondSocket.emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)
        ).toBe(true)
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
        expect(
          secondSocket.emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)
        ).toBe(false)
      } finally {
        vi.useRealTimers()
      }
      secondProvider.destroy()
      firstDoc.destroy()
      secondDoc.destroy()
      serverDoc.destroy()
    }
  )

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
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
      expect(save).toHaveBeenCalledTimes(2)
      const recovered = new Y.Doc()
      Y.applyUpdate(recovered, save.mock.calls[0][2])
      expect(recovered.getText('default').toString()).toBe('first')
      Y.applyUpdate(recovered, save.mock.calls[1][1])
      expect(recovered.getText('default').toString()).toBe('first second')
      recovered.destroy()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(save).toHaveBeenCalledTimes(2)
      const firstUpdate = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.UPDATE)
      const firstPayload = firstUpdate?.[1] as { updateId: string }
      const acknowledge = firstUpdate?.[2] as (error: Error | null, ack: FileDocUpdateAck) => void
      acknowledge(null, { status: 'accepted', updateId: firstPayload.updateId })
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)

      expect(save).toHaveBeenCalledTimes(3)
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

  it.each(['pagehide', 'destroy'] as const)(
    'preserves new edits over malformed recovery on %s before joining',
    async (lifecycle) => {
      vi.useFakeTimers()
      journalStorage.clear()
      const browserWindow = new EventTarget()
      vi.stubGlobal('window', browserWindow)
      const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
      const journal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
      const { socket, emit } = createSocket(false)
      const doc = new Y.Doc()
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
      const snapshot = Y.encodeStateAsUpdate(doc)
      const invalid = new Uint8Array([255])
      await journal.save('doc-1', invalid, snapshot)
      const awareness = new awarenessProtocol.Awareness(doc)
      const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
      const restored = new Y.Doc()
      try {
        doc.getText('default').insert(0, 'edits before reconnecting')

        if (lifecycle === 'pagehide') browserWindow.dispatchEvent(new Event('pagehide'))
        else provider.destroy()
        await vi.advanceTimersByTimeAsync(0)

        const recovered = await journal.load('doc-1')
        expect(recovered).not.toBeNull()
        Y.applyUpdate(restored, recovered!.recoverySnapshot!)
        Y.applyUpdate(restored, recovered!.pendingUpdate)
        expect(restored.getText('default').toString()).toBe('edits before reconnecting')
        expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
        expect([...journalStorage.values()]).toEqual([
          expect.objectContaining({
            documents: expect.arrayContaining([
              expect.objectContaining({
                pendingUpdate: invalid,
                recoverySnapshot: snapshot,
                quarantined: true,
              }),
            ]),
          }),
        ])
      } finally {
        provider.destroy()
        await vi.advanceTimersByTimeAsync(0)
        awareness.destroy()
        doc.destroy()
        restored.destroy()
        vi.useRealTimers()
        vi.unstubAllGlobals()
      }
    }
  )

  it('reopens the current generation without installing an incompatible recovery draft', async () => {
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
    for (let mount = 0; mount < 3; mount++) {
      const { socket, emit, fire } = createSocket(true)
      const doc = new Y.Doc()
      const awareness = new awarenessProtocol.Awareness(doc)
      const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
      acceptJoin(fire, doc.clientID, 'current-doc')

      await vi.waitFor(() => expect(emittedMessages(emit).length).toBeGreaterThan(0))
      expect(provider.joinError).toBeNull()
      expect(doc.getText('default').toString()).toBe('')
      expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
      provider.destroy()
      awareness.destroy()
      doc.destroy()
    }
    const retained = await new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' }).load(
      'old-doc'
    )
    expect(retained?.pendingUpdate).toEqual(pendingUpdate)
    expect(retained?.recoverySnapshot).toEqual(recoverySnapshot)
    oldDoc.destroy()
  })

  it.each([false, true])(
    'does not install disk recovery without a negotiated identity (local identity: %s)',
    async (hasLocalIdentity) => {
      journalStorage.clear()
      const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
      const draft = new Y.Doc()
      draft.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'old-doc')
      draft.getText('default').insert(0, 'retained draft')
      const snapshot = Y.encodeStateAsUpdate(draft)
      const journal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
      await journal.save('old-doc', snapshot, snapshot)
      const { socket, emit, fire } = createSocket(true)
      const doc = new Y.Doc()
      if (hasLocalIdentity) Y.applyUpdate(doc, snapshot)
      const awareness = new awarenessProtocol.Awareness(doc)
      const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
      acceptJoin(fire, doc.clientID, undefined, false)

      await vi.waitFor(() => expect(emittedMessages(emit).length).toBeGreaterThan(0))
      expect(provider.joinError).toBeNull()
      expect(doc.getText('default').toString()).toBe(hasLocalIdentity ? 'retained draft' : '')
      expect(await journal.load('old-doc')).not.toBeNull()
      provider.destroy()
      awareness.destroy()
      doc.destroy()
      draft.destroy()
    }
  )

  it('admits the final online batch before leaving while its relay publication is still pending', () => {
    const { socket, emit, fire } = createSocket(true)
    const serverDoc = new Y.Doc()
    serverDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(serverDoc))
    const awareness = new awarenessProtocol.Awareness(doc)
    const provider = new FileDocProvider(socket, 'file-1', doc, awareness)
    acceptJoin(fire, doc.clientID, 'doc-1')
    let joined = true
    const publications: Array<() => void> = []
    emit.mockImplementation((event, payload, acknowledge) => {
      if (event === FILE_DOC_EVENTS.LEAVE) joined = false
      if (event !== FILE_DOC_EVENTS.UPDATE) return
      expect(joined).toBe(true)
      publications.push(() => {
        Y.applyUpdate(serverDoc, payload.update)
        acknowledge(null, { status: 'accepted', updateId: payload.updateId })
      })
    })

    doc.getText('default').insert(0, 'last edit')
    provider.destroy()

    expect(joined).toBe(false)
    expect(publications).toHaveLength(1)
    expect(serverDoc.getText('default').toString()).toBe('')
    publications[0]()
    expect(serverDoc.getText('default').toString()).toBe('last edit')
    awareness.destroy()
    doc.destroy()
    serverDoc.destroy()
  })

  it('does not send an oversized aggregate batch during teardown', () => {
    const { provider, doc, awareness, emit, fire } = createProvider(true)
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    acceptJoin(fire, doc.clientID, 'doc-1')
    const bytes = new Uint8Array(FILE_DOC_LIMITS.updateBytes / 2)
    doc.getArray<Uint8Array>('binary').insert(0, [bytes])
    doc.getArray<Uint8Array>('binary').insert(1, [bytes])
    emit.mockClear()

    provider.destroy()

    expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
    awareness.destroy()
    doc.destroy()
  })

  it.each(['destroy', 'file-switch'] as const)(
    'drains an edit being journaled and later edits before %s',
    async (navigation) => {
      vi.useFakeTimers()
      journalStorage.clear()
      const storageGate = Promise.withResolvers<void>()
      vi.mocked(updateJournalStorage).mockImplementationOnce(async (key, updater) => {
        await storageGate.promise
        journalStorage.set(String(key), updater(journalStorage.get(String(key))))
      })
      const clear = vi.spyOn(PendingFileDocUpdateJournal.prototype, 'clear')
      const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
      const { socket, emit, fire } = createSocket(true)
      const serverDoc = new Y.Doc()
      serverDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
      const doc = new Y.Doc()
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(serverDoc))
      const awareness = new awarenessProtocol.Awareness(doc)
      const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
      const nextDoc = new Y.Doc()
      const nextAwareness = new awarenessProtocol.Awareness(nextDoc)
      let nextProvider: FileDocProvider | undefined
      try {
        acceptJoin(fire, doc.clientID, 'doc-1')
        await vi.advanceTimersByTimeAsync(0)
        doc.getText('default').insert(0, 'first')
        await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
        doc.getText('default').insert(5, ' second')
        emit.mockClear()
        if (navigation === 'file-switch') {
          nextProvider = new FileDocProvider(socket, 'file-2', nextDoc, nextAwareness, scope)
        }
        provider.destroy()
        awareness.destroy()
        doc.destroy()

        const updateIndex = emit.mock.calls.findIndex(([event]) => event === FILE_DOC_EVENTS.UPDATE)
        const membershipEvent =
          navigation === 'file-switch' ? FILE_DOC_EVENTS.JOIN : FILE_DOC_EVENTS.LEAVE
        const membershipIndex = emit.mock.calls.findIndex(([event]) => event === membershipEvent)
        expect(updateIndex).toBeGreaterThanOrEqual(0)
        expect(updateIndex).toBeLessThan(membershipIndex)
        const [, payload, acknowledge] = emit.mock.calls[updateIndex]
        Y.applyUpdate(serverDoc, payload.update)
        expect(serverDoc.getText('default').toString()).toBe('first second')
        acknowledge(null, { status: 'accepted', updateId: payload.updateId })
        expect(clear).not.toHaveBeenCalled()
        storageGate.resolve()
        await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
        expect(clear).toHaveBeenCalledOnce()
        expect(
          await new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' }).load('doc-1')
        ).toBeNull()
        expect(emit.mock.calls.filter(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toHaveLength(
          1
        )
      } finally {
        storageGate.resolve()
        provider.destroy()
        nextProvider?.destroy()
        awareness.destroy()
        doc.destroy()
        nextAwareness.destroy()
        nextDoc.destroy()
        serverDoc.destroy()
        clear.mockRestore()
        vi.useRealTimers()
      }
    }
  )

  it.each(['accepted', 'rejected', 'timeout'] as const)(
    'retains the final combined draft until its own %s acknowledgment',
    async (outcome) => {
      vi.useFakeTimers()
      journalStorage.clear()
      const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
      const journal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
      const { socket, emit, fire } = createSocket(true)
      const serverDoc = new Y.Doc()
      serverDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
      const doc = new Y.Doc()
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(serverDoc))
      const awareness = new awarenessProtocol.Awareness(doc)
      const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
      try {
        acceptJoin(fire, doc.clientID, 'doc-1')
        await vi.advanceTimersByTimeAsync(0)
        doc.getText('default').insert(0, 'first')
        await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
        const first = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.UPDATE)
        expect(first).toBeDefined()
        doc.getText('default').insert(5, ' second')
        provider.destroy()
        const updates = emit.mock.calls.filter(([event]) => event === FILE_DOC_EVENTS.UPDATE)
        expect(updates).toHaveLength(2)
        const [, finalPayload, finalAcknowledge] = updates[1]
        expect(finalPayload.updateId).not.toBe(first?.[1].updateId)
        Y.applyUpdate(serverDoc, finalPayload.update)
        expect(serverDoc.getText('default').toString()).toBe('first second')
        first?.[2](null, { status: 'accepted', updateId: first[1].updateId })
        await vi.advanceTimersByTimeAsync(0)
        expect(await journal.load('doc-1')).not.toBeNull()
        if (outcome === 'accepted') {
          finalAcknowledge(null, { status: 'accepted', updateId: finalPayload.updateId })
        } else if (outcome === 'rejected') {
          finalAcknowledge(null, {
            status: 'rejected',
            updateId: finalPayload.updateId,
            retryable: false,
            code: 'ACCESS_REVOKED',
          })
        }
        await vi.advanceTimersByTimeAsync(FILE_DOC_TIMEOUTS.updateAckMs + 6_000)
        const recovery = await journal.load('doc-1')
        if (outcome === 'accepted') expect(recovery).toBeNull()
        else expect(recovery?.pendingUpdate).toEqual(finalPayload.update)
        expect(emit.mock.calls.filter(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toHaveLength(
          2
        )
      } finally {
        provider.destroy()
        awareness.destroy()
        doc.destroy()
        serverDoc.destroy()
        vi.useRealTimers()
      }
    }
  )

  it.each(['disconnected', 'invalidated', 'not-joined'] as const)(
    'keeps the final draft local when %s',
    async (state) => {
      vi.useFakeTimers()
      journalStorage.clear()
      const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
      const { socket, emit, fire } = createSocket(true)
      const doc = new Y.Doc()
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
      const awareness = new awarenessProtocol.Awareness(doc)
      const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
      try {
        if (state !== 'not-joined') {
          acceptJoin(fire, doc.clientID, 'doc-1')
          await vi.advanceTimersByTimeAsync(0)
        }
        doc.getText('default').insert(0, 'retained draft')
        if (state === 'disconnected') fire('disconnect')
        if (state === 'invalidated') {
          fire(FILE_DOC_EVENTS.INVALIDATED, { fileId: 'file-1', message: 'Replaced' })
        }
        emit.mockClear()
        provider.destroy()
        await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
        expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
        expect(emittedMessages(emit)).toHaveLength(0)
        expect(
          await new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' }).load('doc-1')
        ).not.toBeNull()
      } finally {
        provider.destroy()
        awareness.destroy()
        doc.destroy()
        vi.useRealTimers()
      }
    }
  )

  it('delivers a rejoined legacy batch before leaving without treating it as acknowledged', async () => {
    vi.useFakeTimers()
    journalStorage.clear()
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const { socket, emit, fire } = createSocket(true)
    const serverDoc = new Y.Doc()
    serverDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(serverDoc))
    const awareness = new awarenessProtocol.Awareness(doc)
    const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
    try {
      acceptJoin(fire, doc.clientID, 'doc-1', false)
      await vi.advanceTimersByTimeAsync(0)
      fire('disconnect')
      doc.getText('default').insert(0, 'legacy draft')
      fire('connect')
      acceptJoin(fire, doc.clientID, 'doc-1', false)
      await vi.advanceTimersByTimeAsync(0)
      emit.mockClear()
      provider.destroy()
      const frame = emittedMessages(emit)[0]
      const decoder = decoding.createDecoder(frame)
      expect(decoding.readVarUint(decoder)).toBe(FILE_DOC_MESSAGE_TYPE.SYNC)
      syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), serverDoc, null)
      expect(serverDoc.getText('default').toString()).toBe('legacy draft')
      expect(
        emit.mock.calls.findIndex(([event]) => event === FILE_DOC_EVENTS.MESSAGE)
      ).toBeLessThan(emit.mock.calls.findIndex(([event]) => event === FILE_DOC_EVENTS.LEAVE))
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
      expect(
        await new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' }).load('doc-1')
      ).not.toBeNull()
      expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
    } finally {
      provider.destroy()
      awareness.destroy()
      doc.destroy()
      serverDoc.destroy()
      vi.useRealTimers()
    }
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

  it('recovers the negotiated generation even when an incompatible draft is newer', async () => {
    vi.useFakeTimers()
    journalStorage.clear()
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const journal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
    const currentDraft = new Y.Doc()
    currentDraft.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'current-doc')
    currentDraft.getText('default').insert(0, 'current draft')
    const currentSnapshot = Y.encodeStateAsUpdate(currentDraft)
    await journal.save('current-doc', currentSnapshot, currentSnapshot)
    await vi.advanceTimersByTimeAsync(1)
    const oldDraft = new Y.Doc()
    oldDraft.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'old-doc')
    oldDraft.getText('default').insert(0, 'incompatible draft')
    const oldSnapshot = Y.encodeStateAsUpdate(oldDraft)
    await journal.save('old-doc', oldSnapshot, oldSnapshot)
    const { socket, emit, fire } = createSocket(true)
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
    try {
      acceptJoin(fire, doc.clientID, 'current-doc')
      await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)
      expect(provider.joinError).toBeNull()
      expect(doc.getText('default').toString()).toBe('current draft')
      const update = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.UPDATE)
      expect(update).toBeDefined()
      update?.[2](null, { status: 'accepted', updateId: update[1].updateId })
      await vi.advanceTimersByTimeAsync(0)
      expect(await journal.load('current-doc')).toBeNull()
      expect((await journal.load('old-doc'))?.recoverySnapshot).toEqual(oldSnapshot)
    } finally {
      provider.destroy()
      awareness.destroy()
      doc.destroy()
      currentDraft.destroy()
      oldDraft.destroy()
      vi.useRealTimers()
    }
  })

  it('rejects an in-memory generation mismatch before applying a matching server draft', async () => {
    journalStorage.clear()
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const journal = new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' })
    const serverDraft = new Y.Doc()
    serverDraft.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'server-doc')
    serverDraft.getText('default').insert(0, 'server draft')
    const snapshot = Y.encodeStateAsUpdate(serverDraft)
    await journal.save('server-doc', snapshot, snapshot)
    const { socket, fire } = createSocket(true)
    const doc = new Y.Doc()
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'local-doc')
    doc.getText('default').insert(0, 'local draft')
    const awareness = new awarenessProtocol.Awareness(doc)
    const provider = new FileDocProvider(socket, 'file-1', doc, awareness, scope)
    acceptJoin(fire, doc.clientID, 'server-doc')
    await vi.waitFor(() => expect(provider.joinError).toMatchObject({ code: 'DOCUMENT_REPLACED' }))
    expect(doc.getText('default').toString()).toBe('local draft')
    expect((await journal.load('server-doc'))?.recoverySnapshot).toEqual(snapshot)
    provider.destroy()
    awareness.destroy()
    doc.destroy()
    serverDraft.destroy()
  })

  it('syncs after malformed recovery without replaying it on subsequent mounts', async () => {
    journalStorage.clear()
    const scope = { workspaceId: 'workspace-1', userId: 'user-1' }
    const oldDoc = new Y.Doc()
    oldDoc.getText('default').insert(0, 'quarantined snapshot')
    await new PendingFileDocUpdateJournal({ ...scope, fileId: 'file-1' }).save(
      'doc-1',
      new Uint8Array([255]),
      Y.encodeStateAsUpdate(oldDoc)
    )
    const serverDoc = new Y.Doc()
    serverDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, 'doc-1')
    serverDoc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
    serverDoc.getText('default').insert(0, 'server content')
    const frame = encoding.createEncoder()
    encoding.writeVarUint(frame, FILE_DOC_MESSAGE_TYPE.SYNC)
    syncProtocol.writeSyncStep2(frame, serverDoc)
    for (let mount = 0; mount < 2; mount++) {
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
      await vi.waitFor(() => expect(emittedMessages(emit).length).toBeGreaterThan(0))
      fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(frame))

      expect(provider.joinError).toBeNull()
      expect(provider.synced).toBe(true)
      expect(doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag)).toBe(true)
      expect(doc.getText('default').toString()).toBe('server content')
      expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
      provider.destroy()
      doc.destroy()
    }
    oldDoc.destroy()
    serverDoc.destroy()
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
        docId: 'doc-1',
        schemaVersion: FILE_DOC_SCHEMA_VERSION + 1,
      })
      fire('disconnect')
      fire('connect')
      acceptJoin(fire, doc.clientID, 'doc-1')
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

  it.each(['acknowledged', 'legacy-offline'] as const)(
    'stops editing when the complete %s recovery snapshot cannot be persisted',
    async (mode) => {
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
        acceptJoin(fire, doc.clientID, 'doc-1', mode === 'acknowledged')
        await vi.advanceTimersByTimeAsync(0)
        if (mode === 'legacy-offline') fire('disconnect')
        emit.mockClear()

        doc.getText('default').insert(0, 'must remain visible')
        await vi.advanceTimersByTimeAsync(UPDATE_BATCH_TEST_WINDOW_MS)

        expect(provider.joinError).toMatchObject({ code: 'PENDING_UPDATE_LIMIT' })
        expect(emit.mock.calls.some(([event]) => event === FILE_DOC_EVENTS.UPDATE)).toBe(false)
        provider.destroy()
        doc.destroy()
      } finally {
        save.mockRestore()
        vi.useRealTimers()
      }
    }
  )

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

  it('keeps an unseeded document retryable after the readiness deadline and accepts late server content', () => {
    vi.useFakeTimers()
    try {
      const { provider, doc, emit, fire } = createProvider(false)
      const onError = vi.fn()
      provider.on('join-error', onError)

      vi.advanceTimersByTime(12_000)

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'READINESS_TIMEOUT', retryable: true })
      )
      expect(provider.joinError).toEqual(
        expect.objectContaining({ code: 'READINESS_TIMEOUT', retryable: true })
      )
      emit.mockClear()
      fire('connect')
      expect(emit).toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, expect.anything())
      expect(doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag)).toBeUndefined()
      acceptJoin(fire, doc.clientID)
      const remote = new Y.Doc()
      remote.getText('default').insert(0, 'authoritative body')
      remote.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
      syncProtocol.writeSyncStep2(encoder, remote)
      fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))
      expect(provider.synced).toBe(true)
      expect(provider.joinError).toBeNull()
      expect(doc.getText('default').toString()).toBe('authoritative body')
      provider.destroy()
      remote.destroy()
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
        expect.objectContaining({ code: 'READINESS_TIMEOUT', retryable: true })
      )
      expect(provider.synced).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a late authoritative SyncStep2 after the readiness deadline without a local fallback seed', () => {
    vi.useFakeTimers()
    try {
      const { provider, doc, fire } = createProvider(true)
      acceptJoin(fire, doc.clientID)

      vi.advanceTimersByTime(12_000)
      expect(provider.joinError).toEqual(expect.objectContaining({ code: 'READINESS_TIMEOUT' }))

      const remote = new Y.Doc()
      remote.getText('default').insert(0, 'server content')
      remote.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
      syncProtocol.writeSyncStep2(encoder, remote)
      fire(FILE_DOC_EVENTS.MESSAGE, encoding.toUint8Array(encoder))

      expect(provider.synced).toBe(true)
      expect(provider.joinError).toBeNull()
      expect(doc.getText('default').toString()).toBe('server content')
      provider.destroy()
      remote.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['old-document', undefined])(
    'ignores delayed invalidation of %s after a newer authoritative JOIN',
    (invalidatedDocId) => {
      const { provider, doc, fire } = createProvider(true)
      fire(FILE_DOC_EVENTS.JOIN_SUCCESS, {
        fileId: 'file-1',
        clientId: doc.clientID,
        docId: 'new-document',
        version: 30,
      })
      fire(FILE_DOC_EVENTS.INVALIDATED, {
        fileId: 'file-1',
        docId: invalidatedDocId,
        version: 20,
        message: 'Old replacement',
      })
      expect(provider.joinError).toBeNull()
      provider.destroy()
    }
  )

  it('keeps matching-generation invalidation terminal even when its version equals JOIN', () => {
    const { provider, doc, fire } = createProvider(true)
    fire(FILE_DOC_EVENTS.JOIN_SUCCESS, {
      fileId: 'file-1',
      clientId: doc.clientID,
      docId: 'current-document',
      version: 20,
    })
    fire(FILE_DOC_EVENTS.INVALIDATED, {
      fileId: 'file-1',
      docId: 'current-document',
      version: 20,
      message: 'Current replacement',
    })
    expect(provider.joinError?.code).toBe('DOCUMENT_REPLACED')
    provider.destroy()
  })

  it('does not let a newer tombstone notification spare an older joined document', () => {
    const { provider, doc, fire } = createProvider(true)
    fire(FILE_DOC_EVENTS.JOIN_SUCCESS, {
      fileId: 'file-1',
      clientId: doc.clientID,
      docId: 'current-document',
      version: 10,
    })
    fire(FILE_DOC_EVENTS.INVALIDATED, {
      fileId: 'file-1',
      version: 30,
      message: 'Second unsupported replacement',
    })
    expect(provider.joinError?.code).toBe('DOCUMENT_REPLACED')
    provider.destroy()
  })

  it('fails closed on invalidation before reliable JOIN metadata exists', () => {
    const { provider, fire } = createProvider(true)
    fire(FILE_DOC_EVENTS.INVALIDATED, { fileId: 'file-1', version: 20, message: 'Replacement' })
    expect(provider.joinError?.code).toBe('DOCUMENT_REPLACED')
    provider.destroy()
  })
})
