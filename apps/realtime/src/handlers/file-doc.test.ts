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

interface SentMessage {
  target: string
  except?: string
  event: string
  payload: unknown
}

/** An `io` mock that records every server-originated emit with its target/except. */
function createIo() {
  const sent: SentMessage[] = []
  const to = vi.fn((target: string) => ({
    except: (exclude: string) => ({
      emit: (event: string, payload: unknown) =>
        sent.push({ target, except: exclude, event, payload }),
    }),
    emit: (event: string, payload: unknown) => sent.push({ target, event, payload }),
  }))
  return { io: { to } as unknown as IRoomManager['io'], sent }
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

/** Build a real awareness frame carrying a single client's state. */
function awarenessFrame(clientId: number, name: string): { frame: Uint8Array; clientId: number } {
  const doc = new Y.Doc()
  // Force a specific clientID so the test can bind/spoof deliberately.
  doc.clientID = clientId
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalStateField('user', { name })
  const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [clientId])
  return {
    frame: frame(FILE_DOC_MESSAGE_TYPE.AWARENESS, (e) => encoding.writeVarUint8Array(e, update)),
    clientId,
  }
}

function joinSuccessFileId(socket: { emit: ReturnType<typeof vi.fn> }) {
  const calls = socket.emit.mock.calls.filter(
    (call: unknown[]) => call[0] === FILE_DOC_EVENTS.JOIN_SUCCESS
  )
  const last = calls[calls.length - 1]
  return (last?.[1] as { fileId: string } | undefined)?.fileId
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

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

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

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'ROOM_MANAGER_UNAVAILABLE', retryable: true })
    )
  })

  it('rejects a payload missing the file id or client id before authorizing', async () => {
    const { io } = createIo()
    const { socket, handlers } = setup('socket-1', io)

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: '', clientId: 1 })
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })

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

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

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

  it('joins the room, sends sync step 1, and asks the first client to seed', async () => {
    const { io, sent } = createIo()
    const { socket, handlers } = setup('socket-1', io)

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

    expect(socket.join).toHaveBeenCalledWith(ROOM_NAME)
    expect(joinSuccessFileId(socket)).toBe('file-1')

    // A binary sync-step-1 message (type tag 0) is sent to kick off the handshake.
    const syncMessage = socket.emit.mock.calls.find(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    expect((syncMessage?.[1] as Uint8Array)[0]).toBe(FILE_DOC_MESSAGE_TYPE.SYNC)

    // The lone joiner is elected to seed the empty document.
    const seed = sent.find((m) => m.event === FILE_DOC_EVENTS.SEED_REQUEST)
    expect(seed).toEqual({
      target: 'socket-1',
      event: FILE_DOC_EVENTS.SEED_REQUEST,
      payload: { fileId: 'file-1' },
    })
  })

  it('asks only one client to seed across concurrent joiners of the same file', async () => {
    const { io, sent } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)

    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })

    const seeds = sent.filter((m) => m.event === FILE_DOC_EVENTS.SEED_REQUEST)
    expect(seeds).toHaveLength(1)
    expect(seeds[0].target).toBe('socket-a')
  })

  it('relays a document update to the rest of the room, excluding the sender', async () => {
    const { io, sent } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    sent.length = 0

    const clientDoc = new Y.Doc()
    clientDoc.getText('default').insert(0, 'hello')
    const update = Y.encodeStateAsUpdate(clientDoc)
    a.handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) => syncProtocol.writeUpdate(e, update))
    )

    const relayed = sent.find((m) => m.event === FILE_DOC_EVENTS.MESSAGE)
    expect(relayed?.target).toBe(ROOM_NAME)
    expect(relayed?.except).toBe('socket-a')
    expect((relayed?.payload as Uint8Array)[0]).toBe(FILE_DOC_MESSAGE_TYPE.SYNC)
  })

  it('relays an owned awareness update to the room, excluding the sender', async () => {
    const { io, sent } = createIo()
    const { frame: awFrame, clientId } = awarenessFrame(4242, 'Ada')
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    sent.length = 0

    a.handlers[FILE_DOC_EVENTS.MESSAGE](awFrame)

    const relayed = sent.find(
      (m) =>
        m.event === FILE_DOC_EVENTS.MESSAGE &&
        (m.payload as Uint8Array)[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS
    )
    expect(relayed?.except).toBe('socket-a')
  })

  it('drops an awareness frame that spoofs another client id', async () => {
    const { io, sent } = createIo()
    // socket-a binds client id 100 at join, but sends awareness for client 999.
    const { frame: spoof } = awarenessFrame(999, 'Mallory')
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 100 })
    sent.length = 0

    a.handlers[FILE_DOC_EVENTS.MESSAGE](spoof)

    const relayed = sent.find(
      (m) =>
        m.event === FILE_DOC_EVENTS.MESSAGE &&
        (m.payload as Uint8Array)[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS
    )
    expect(relayed).toBeUndefined()
  })

  it("rejects a DIFFERENT user binding a peer's client id (spoof)", async () => {
    const { io } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io, { userId: 'attacker' })

    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 7 })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 7 })

    expect(b.socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'CLIENT_ID_IN_USE' })
    )
    expect(b.socket.join).not.toHaveBeenCalled()
  })

  it('reclaims a client id for the SAME user reconnecting (reused Yjs client id)', async () => {
    const { io } = createIo()
    // The same user's dropped socket still owns client id 7 (its disconnect
    // cleanup has not run yet) when it reconnects on a new socket reusing id 7.
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 7 })
    const b = setup('socket-b', io) // same default userId 'user-1'

    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 7 })

    expect(joinSuccessFileId(b.socket)).toBe('file-1')
    expect(b.socket.join).toHaveBeenCalledWith(ROOM_NAME)
  })

  it('clears a departed caret when a socket rejoins the room with a new client id', async () => {
    const { io, sent } = createIo()
    const { frame: awFrame } = awarenessFrame(500, 'A')
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 500 })
    a.handlers[FILE_DOC_EVENTS.MESSAGE](awFrame)
    sent.length = 0

    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 501 })

    // The old client (500) caret removal is broadcast to the room.
    const removal = sent.find(
      (m) =>
        m.event === FILE_DOC_EVENTS.MESSAGE &&
        (m.payload as Uint8Array)[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS
    )
    expect(removal).toBeDefined()
  })

  it('preserves the existing caret when a rebind to a foreign client id is rejected', async () => {
    const { io, sent } = createIo()
    const { frame: awFrame } = awarenessFrame(10, 'A')
    const a = setup('socket-a', io)
    const b = setup('socket-b', io, { userId: 'user-b' })
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 10 })
    a.handlers[FILE_DOC_EVENTS.MESSAGE](awFrame) // a publishes its caret for client 10
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 20 })
    sent.length = 0

    // socket-a (owns 10) tries to rebind to 20, owned by a different user → reject.
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 20 })

    expect(a.socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'CLIENT_ID_IN_USE' })
    )
    // The rejected rebind must NOT have removed a's existing caret (no awareness
    // removal broadcast fires).
    const removal = sent.find(
      (m) =>
        m.event === FILE_DOC_EVENTS.MESSAGE &&
        (m.payload as Uint8Array)[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS
    )
    expect(removal).toBeUndefined()
  })

  it('drops a malformed frame without throwing', async () => {
    const { io } = createIo()
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

    expect(() =>
      a.handlers[FILE_DOC_EVENTS.MESSAGE](new Uint8Array([255, 254, 253, 200]))
    ).not.toThrow()
  })

  it('hands the seeder role to a remaining client when the elected one leaves before seeding', async () => {
    const { io, sent } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    sent.length = 0

    // The seeder leaves before it ever seeded; b remains.
    cleanupFileDocForSocket('socket-a', io)

    const seed = sent.find((m) => m.event === FILE_DOC_EVENTS.SEED_REQUEST)
    expect(seed?.target).toBe('socket-b')
  })

  it('drops the document when the last editor leaves, re-seeding a fresh joiner', async () => {
    const { io, sent } = createIo()
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    cleanupFileDocForSocket('socket-a', io)
    sent.length = 0

    const b = setup('socket-b', io)
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })

    const seed = sent.find((m) => m.event === FILE_DOC_EVENTS.SEED_REQUEST)
    expect(seed?.target).toBe('socket-b')
  })
})
