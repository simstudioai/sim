/**
 * @vitest-environment node
 */
import {
  FILE_DOC_EVENTS,
  FILE_DOC_MESSAGE_TYPE,
  FILE_DOC_SEED,
} from '@sim/realtime-protocol/file-doc'
import * as encoding from 'lib0/encoding'
import type { Socket } from 'socket.io-client'
import { describe, expect, it, vi } from 'vitest'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { FileDocProvider } from './file-doc-provider'

/** A minimal fake Socket.IO client whose server→client events can be fired in tests. */
function createSocket(connected = true) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const emit = vi.fn()
  const socket = {
    connected,
    emit,
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
    for (const cb of listeners.get(event) ?? []) cb(...args)
  }
  return { socket: socket as unknown as Socket, emit, fire }
}

function createProvider(connected = true) {
  const { socket, emit, fire } = createSocket(connected)
  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  const provider = new FileDocProvider(socket, 'file-1', doc, awareness)
  return { provider, doc, awareness, emit, fire }
}

/** Messages emitted to the server, decoded to their `{ type, bytes }`. */
function emittedMessages(emit: ReturnType<typeof vi.fn>) {
  return emit.mock.calls
    .filter(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    .map(([, payload]) => payload as Uint8Array)
}

describe('FileDocProvider', () => {
  it('joins immediately with its client id when the socket is already connected', () => {
    const { doc, emit } = createProvider(true)
    expect(emit).toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN, {
      fileId: 'file-1',
      clientId: doc.clientID,
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
    const { emit, fire } = createProvider(true)
    emit.mockClear()

    fire(FILE_DOC_EVENTS.JOIN_SUCCESS, { fileId: 'file-1' })

    // A sync step 1 (type tag 0) is sent to exchange state with the server.
    const messages = emittedMessages(emit)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages[0][0]).toBe(FILE_DOC_MESSAGE_TYPE.SYNC)
  })

  it('ignores a join ack for a different file', () => {
    const { emit, fire } = createProvider(true)
    emit.mockClear()

    fire(FILE_DOC_EVENTS.JOIN_SUCCESS, { fileId: 'other-file' })

    // No sync/awareness exchange starts for a file this provider does not own.
    expect(emittedMessages(emit)).toHaveLength(0)
  })

  it('applies a server sync step 2 and becomes synced', () => {
    const { provider, doc, fire } = createProvider(true)
    const synced = vi.fn()
    provider.on('synced', synced)

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

  it('sends local document edits to the server as sync updates', () => {
    const { doc, emit } = createProvider(true)
    emit.mockClear()

    doc.getText('default').insert(0, 'x')

    const messages = emittedMessages(emit)
    expect(messages.length).toBe(1)
    expect(messages[0][0]).toBe(FILE_DOC_MESSAGE_TYPE.SYNC)
  })

  it('does not echo updates it applied from the server', () => {
    const { provider, emit, fire } = createProvider(true)
    fire(FILE_DOC_EVENTS.JOIN_SUCCESS, { fileId: 'file-1' })
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
    const { awareness, emit } = createProvider(true)
    emit.mockClear()

    awareness.setLocalStateField('user', { name: 'Ada', color: '#f783ac' })

    const messages = emittedMessages(emit)
    expect(messages.some((m) => m[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS)).toBe(true)
  })

  it('reseeds a cleared awareness so a reused instance can publish again', () => {
    const { socket, emit } = createSocket(true)
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

    emit.mockClear()
    // The caret extension setting the user field must now actually publish.
    awareness.setLocalStateField('user', { name: 'Ada', color: '#f783ac' })
    expect(emittedMessages(emit).some((m) => m[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS)).toBe(true)
  })

  it('does not forward awareness it applied from the server', () => {
    const { emit, fire } = createProvider(true)
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

  it('still rejoins on reconnect after a retryable error', () => {
    const { emit, fire } = createProvider(true)
    fire(FILE_DOC_EVENTS.JOIN_ERROR, {
      fileId: 'file-1',
      error: 'Realtime unavailable',
      code: 'ROOM_MANAGER_UNAVAILABLE',
      retryable: true,
    })
    emit.mockClear()

    fire('connect')

    expect(emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN,
      expect.objectContaining({ fileId: 'file-1' })
    )
  })

  it('resets synced and rejoins on a reconnect', () => {
    const { provider, emit, fire } = createProvider(true)
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
    const { socket, emit } = createSocket(true)
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
    emit.mockClear()

    first.destroy()
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
      const { provider, fire } = createProvider(true)
      const onError = vi.fn()
      provider.on('join-error', onError)

      // The initial sync brings BOTH content and the server seed flag before the deadline.
      fire(FILE_DOC_EVENTS.JOIN_SUCCESS, { fileId: 'file-1' })
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
      const { provider, fire } = createProvider(true)
      const onError = vi.fn()
      provider.on('join-error', onError)

      // The socket syncs an empty doc, but the server-side seed never arrives (its build persistently
      // failed) — `synced` is true yet `initialContentLoaded` is never set.
      fire(FILE_DOC_EVENTS.JOIN_SUCCESS, { fileId: 'file-1' })
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
      fire(FILE_DOC_EVENTS.JOIN_SUCCESS, { fileId: 'file-1' })

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
