/**
 * @vitest-environment node
 */
import { FILE_DOC_EVENTS, FILE_DOC_MESSAGE_TYPE } from '@sim/realtime-protocol/file-doc'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import type { IRoomManager } from '@/rooms'

const { mockAuthorizeRoom } = vi.hoisted(() => ({
  mockAuthorizeRoom: vi.fn(),
}))

vi.mock('@sim/platform-authz/rooms', () => ({
  authorizeRoom: mockAuthorizeRoom,
}))

import { cleanupFileDocForSocket, setupWorkspaceFileDocHandlers } from '@/handlers/file-doc'

type Handler = (payload?: unknown) => Promise<void> | void

const ROOM_NAME = 'workspace-file-doc:file-1'

/** A shared Socket.IO `io` mock whose `to().except().emit()` chain is inspectable. */
function createIo() {
  const emit = vi.fn()
  const except = vi.fn().mockReturnValue({ emit })
  const to = vi.fn().mockReturnValue({ except, emit })
  return { io: { to } as unknown as IRoomManager['io'], to, except, emit }
}

function createSocket(id: string, overrides?: Record<string, unknown>) {
  const handlers: Record<string, Handler> = {}
  const socket = {
    id,
    userId: 'user-1',
    userName: 'Test User',
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handler
    }),
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    ...overrides,
  }
  return { handlers, socket }
}

function createRoomManager(
  io: IRoomManager['io'],
  overrides?: Partial<IRoomManager>
): IRoomManager {
  return {
    isReady: vi.fn().mockReturnValue(true),
    io,
    ...overrides,
  } as unknown as IRoomManager
}

function setup(id: string, io: IRoomManager['io'], socketOverrides?: Record<string, unknown>) {
  const { socket, handlers } = createSocket(id, socketOverrides)
  setupWorkspaceFileDocHandlers(
    socket as unknown as Parameters<typeof setupWorkspaceFileDocHandlers>[0],
    createRoomManager(io)
  )
  return { socket, handlers }
}

/** Frame a Yjs message with its type tag, exactly as the client provider would. */
function frame(type: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

/** The last `JOIN_SUCCESS` payload emitted on a socket. */
function joinSuccess(socket: { emit: ReturnType<typeof vi.fn> }) {
  const calls = socket.emit.mock.calls.filter(
    (call: unknown[]) => call[0] === FILE_DOC_EVENTS.JOIN_SUCCESS
  )
  const last = calls[calls.length - 1]
  return last?.[1] as { fileId: string; shouldSeed: boolean } | undefined
}

describe('setupWorkspaceFileDocHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorizeRoom.mockResolvedValue({
      allowed: true,
      status: 200,
      workspaceId: 'ws-1',
      workspacePermission: 'write',
    })
  })

  afterEach(() => {
    // The room store is module-global; drop any room the test's sockets left open.
    const { io } = createIo()
    for (const id of ['socket-1', 'socket-a', 'socket-b', 'socket-c']) {
      cleanupFileDocForSocket(id, io)
    }
  })

  it('rejects join when the socket is not authenticated', async () => {
    const { io } = createIo()
    const { socket, handlers } = setup('socket-1', io, { userId: undefined, userName: undefined })

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })

    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED', retryable: false })
    )
  })

  it('rejects join with a retryable error when realtime is unavailable', async () => {
    const { io } = createIo()
    const { socket, handlers } = createSocket('socket-1')
    setupWorkspaceFileDocHandlers(
      socket as unknown as Parameters<typeof setupWorkspaceFileDocHandlers>[0],
      createRoomManager(io, { isReady: vi.fn().mockReturnValue(false) })
    )

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })

    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'ROOM_MANAGER_UNAVAILABLE', retryable: true })
    )
  })

  it('rejects an invalid file id before authorizing', async () => {
    const { io } = createIo()
    const { socket, handlers } = setup('socket-1', io)

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: '' })

    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'INVALID_PAYLOAD', retryable: false })
    )
    expect(mockAuthorizeRoom).not.toHaveBeenCalled()
  })

  it('requires write permission and reports 404 as NOT_FOUND', async () => {
    mockAuthorizeRoom.mockResolvedValue({ allowed: false, status: 404, workspacePermission: null })
    const { io } = createIo()
    const { socket, handlers } = setup('socket-1', io)

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })

    expect(mockAuthorizeRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'write',
        room: { type: 'workspace-file-doc', id: 'file-1' },
      })
    )
    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'NOT_FOUND', retryable: false })
    )
  })

  it('joins the room, elects the first client as seeder, and sends sync step 1', async () => {
    const { io, to } = createIo()
    const { socket, handlers } = setup('socket-1', io)

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })

    expect(socket.join).toHaveBeenCalledWith(ROOM_NAME)
    expect(joinSuccess(socket)).toEqual({ fileId: 'file-1', shouldSeed: true })

    // A binary sync-step-1 message (type tag 0) is sent to kick off the handshake.
    const syncMessage = socket.emit.mock.calls.find(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    expect(syncMessage).toBeDefined()
    expect((syncMessage?.[1] as Uint8Array)[0]).toBe(FILE_DOC_MESSAGE_TYPE.SYNC)
    // A fresh join with no doc updates yet performs no room broadcast.
    expect(to).not.toHaveBeenCalled()
  })

  it('elects only one seeder across concurrent joiners of the same file', async () => {
    const { io } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)

    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })

    expect(joinSuccess(a.socket)?.shouldSeed).toBe(true)
    expect(joinSuccess(b.socket)?.shouldSeed).toBe(false)
  })

  it('relays a document update to the rest of the room, excluding the sender', async () => {
    const { io, to, except, emit } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    to.mockClear()
    except.mockClear()
    emit.mockClear()

    // A real client edit, framed as a sync update.
    const clientDoc = new Y.Doc()
    clientDoc.getText('default').insert(0, 'hello')
    const update = Y.encodeStateAsUpdate(clientDoc)
    a.handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) => syncProtocol.writeUpdate(e, update))
    )

    expect(to).toHaveBeenCalledWith(ROOM_NAME)
    expect(except).toHaveBeenCalledWith('socket-a')
    const relayed = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.MESSAGE)
    expect(relayed).toBeDefined()
    expect((relayed?.[1] as Uint8Array)[0]).toBe(FILE_DOC_MESSAGE_TYPE.SYNC)
  })

  it('relays awareness (cursor/selection) updates to the room, excluding the sender', async () => {
    const { io, except, emit } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    except.mockClear()
    emit.mockClear()

    const clientDoc = new Y.Doc()
    const clientAwareness = new awarenessProtocol.Awareness(clientDoc)
    clientAwareness.setLocalStateField('user', { name: 'Ada', color: '#f783ac' })
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(clientAwareness, [
      clientDoc.clientID,
    ])
    a.handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.AWARENESS, (e) => encoding.writeVarUint8Array(e, awarenessUpdate))
    )

    expect(except).toHaveBeenCalledWith('socket-a')
    const relayed = emit.mock.calls.find(([event]) => event === FILE_DOC_EVENTS.MESSAGE)
    expect((relayed?.[1] as Uint8Array)[0]).toBe(FILE_DOC_MESSAGE_TYPE.AWARENESS)
  })

  it('re-elects a seeder when the elected one disconnects before seeding', async () => {
    const { io } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    expect(joinSuccess(a.socket)?.shouldSeed).toBe(true)

    // The seeder leaves before it ever seeded; b remains so the room survives.
    cleanupFileDocForSocket('socket-a', io)

    const c = setup('socket-c', io)
    await c.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    expect(joinSuccess(c.socket)?.shouldSeed).toBe(true)
  })

  it('drops the document when the last editor leaves, re-seeding a fresh joiner', async () => {
    const { io } = createIo()
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    cleanupFileDocForSocket('socket-a', io)

    // With the room dropped, the next joiner starts a brand-new document and is
    // elected to seed again.
    const b = setup('socket-b', io)
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    expect(joinSuccess(b.socket)?.shouldSeed).toBe(true)
  })
})
