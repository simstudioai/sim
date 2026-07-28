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
  /** Records `io.in(socketId).socketsLeave(room)` — a socket forced out of a room from outside. */
  const left: { socketId: string; room: string }[] = []
  const to = vi.fn((target: string) => ({
    except: (exclude: string) => ({
      emit: (event: string, payload: unknown) =>
        sent.push({ target, except: exclude, event, payload }),
    }),
    emit: (event: string, payload: unknown) => sent.push({ target, event, payload }),
  }))
  const inFn = vi.fn((socketId: string) => ({
    socketsLeave: (room: string) => {
      left.push({ socketId, room })
    },
  }))
  return { io: { to, in: inFn } as unknown as IRoomManager['io'], sent, left }
}

/** Every socket id a test created, so `afterEach` can drop their rooms without a
 * hardcoded list drifting out of sync with the tests. */
const createdSocketIds = new Set<string>()

function createSocket(id: string, overrides?: Record<string, unknown>) {
  createdSocketIds.add(id)
  const handlers: Record<string, Handler> = {}
  const socket = {
    id,
    userId: 'user-1',
    userName: 'Test User',
    // Set so the server's roster resolves the avatar from the socket (never the DB).
    userImage: 'avatar.png',
    disconnected: false,
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
    // The seed deadline uses setTimeout; fake it so tests can drive it and so a
    // real timer can never fire into a later test.
    vi.useFakeTimers()
    mockAuthorizeRoom.mockResolvedValue({
      allowed: true,
      status: 200,
      workspaceId: 'ws-1',
      workspacePermission: 'write',
    })
  })

  afterEach(() => {
    // The room store is module-global; drop every room the test's sockets opened.
    const { io } = createIo()
    // Simulate a full disconnect between tests (`endOfLife`) so the module-global join-generation
    // map is cleared and never bleeds a counter into the next test.
    for (const id of createdSocketIds) cleanupFileDocForSocket(id, io, true)
    createdSocketIds.clear()
    vi.clearAllTimers()
    vi.useRealTimers()
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

  it('aborts a join superseded by a newer join during authorization (no cross-binding)', async () => {
    const { io } = createIo()
    let resolveFirst: (v: unknown) => void = () => {}
    mockAuthorizeRoom
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ allowed: true, status: 200, workspacePermission: 'write' })
    const s = setup('socket-a', io)

    const pending = s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-2', clientId: 1 })
    resolveFirst({ allowed: true, status: 200, workspacePermission: 'write' })
    await pending

    // The socket is bound only to the newer file, never cross-bound to file-1.
    expect(s.socket.join).toHaveBeenCalledWith('workspace-file-doc:file-2')
    expect(s.socket.join).not.toHaveBeenCalledWith('workspace-file-doc:file-1')
  })

  it('does not register a socket that disconnected during authorization', async () => {
    const { io, sent } = createIo()
    let resolveAuth: (v: unknown) => void = () => {}
    mockAuthorizeRoom.mockReturnValueOnce(new Promise((resolve) => (resolveAuth = resolve)))
    const s = setup('socket-a', io)

    const pending = s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    s.socket.disconnected = true
    cleanupFileDocForSocket('socket-a', io, true) // disconnect cleanup — no-op, nothing registered yet
    resolveAuth({ allowed: true, status: 200, workspacePermission: 'write' })
    await pending

    expect(s.socket.join).not.toHaveBeenCalled()
    // No room leaked: a fresh joiner starts a new document and is elected to seed.
    const b = setup('socket-b', io)
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    expect(sent.find((m) => m.event === FILE_DOC_EVENTS.SEED_REQUEST)?.target).toBe('socket-b')
  })

  it('does not abort an in-flight join when a leave for a different file arrives', async () => {
    const { io } = createIo()
    let resolveAuth: (v: unknown) => void = () => {}
    mockAuthorizeRoom.mockReturnValueOnce(new Promise((resolve) => (resolveAuth = resolve)))
    const s = setup('socket-a', io)

    const pending = s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-2', clientId: 1 })
    // A stale leave for a DIFFERENT file must not invalidate the in-flight join.
    s.handlers[FILE_DOC_EVENTS.LEAVE]({ fileId: 'file-1' })
    resolveAuth({ allowed: true, status: 200, workspacePermission: 'write' })
    await pending

    expect(joinSuccessFileId(s.socket)).toBe('file-2')
    expect(s.socket.join).toHaveBeenCalledWith('workspace-file-doc:file-2')
  })

  it('does not reset the join generation on a leave, so an in-flight join still binds', async () => {
    const { io } = createIo()
    const s = setup('socket-a', io)

    // file-1 join completes; the socket is registered in file-1.
    await s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

    // file-2 join goes in-flight (authorize deferred).
    let resolveAuth: (v: unknown) => void = () => {}
    mockAuthorizeRoom.mockReturnValueOnce(new Promise((resolve) => (resolveAuth = resolve)))
    const pending = s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-2', clientId: 1 })

    // A deferred leave for the prior file-1 lands while file-2's join awaits authorization. Its
    // cleanup must NOT reset the monotonic join generation, or file-2's guard would see an emptied
    // map (`undefined !== generation`) and abort the join the client actually wants.
    s.handlers[FILE_DOC_EVENTS.LEAVE]({ fileId: 'file-1' })

    resolveAuth({ allowed: true, status: 200, workspacePermission: 'write' })
    await pending

    expect(joinSuccessFileId(s.socket)).toBe('file-2')
    expect(s.socket.join).toHaveBeenCalledWith('workspace-file-doc:file-2')
  })

  it('cancels an in-flight join when the client leaves that same file (no ghost owner)', async () => {
    const { io, sent } = createIo()
    let resolveAuth: (v: unknown) => void = () => {}
    mockAuthorizeRoom.mockReturnValueOnce(new Promise((resolve) => (resolveAuth = resolve)))
    const s = setup('socket-a', io)

    // Join file-1 is awaiting authorization when the client leaves file-1 (fast open→close).
    const pending = s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    s.handlers[FILE_DOC_EVENTS.LEAVE]({ fileId: 'file-1' })
    resolveAuth({ allowed: true, status: 200, workspacePermission: 'write' })
    await pending

    // The stale join must not register: no success, no room join, and no presence broadcast that
    // would leave a ghost collaborator until disconnect.
    expect(s.socket.join).not.toHaveBeenCalled()
    expect(joinSuccessFileId(s.socket)).toBeUndefined()
    expect(sent.some((m) => m.event === FILE_DOC_EVENTS.PRESENCE)).toBe(false)
  })

  it('scopes LEAVE to the named file (a leave for a different file is a no-op)', async () => {
    const { io } = createIo()
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

    a.handlers[FILE_DOC_EVENTS.LEAVE]({ fileId: 'other' })
    expect(a.socket.leave).not.toHaveBeenCalledWith(ROOM_NAME)

    a.handlers[FILE_DOC_EVENTS.LEAVE]({ fileId: 'file-1' })
    expect(a.socket.leave).toHaveBeenCalledWith(ROOM_NAME)
  })

  it('replies with a sync step 2 to the sender on a sync step 1 frame', async () => {
    const { io } = createIo()
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    // Give the server doc some content so a step-1 request yields a non-empty step 2.
    const seeded = new Y.Doc()
    seeded.getText('default').insert(0, 'hi')
    a.handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) =>
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(seeded))
      )
    )
    a.socket.emit.mockClear()

    a.handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc()))
    )

    const reply = a.socket.emit.mock.calls.find(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    expect((reply?.[1] as Uint8Array)[0]).toBe(FILE_DOC_MESSAGE_TYPE.SYNC)
  })

  it('does not re-elect a seeder once the document is marked seeded', async () => {
    const { io, sent } = createIo()
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 }) // a elected seeder
    // a seeds: set the CRDT initialContentLoaded flag on the server doc.
    const seeded = new Y.Doc()
    seeded.getMap('config').set('initialContentLoaded', true)
    a.handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) =>
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(seeded))
      )
    )
    const b = setup('socket-b', io)
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    sent.length = 0

    // The seeder leaves a SEEDED doc → no re-election (no duplicate seed).
    cleanupFileDocForSocket('socket-a', io)
    expect(sent.find((m) => m.event === FILE_DOC_EVENTS.SEED_REQUEST)).toBeUndefined()
  })

  it('leaves the previous document when a socket switches files', async () => {
    const { io, sent } = createIo()
    const s = setup('socket-a', io)
    await s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-2', clientId: 1 })

    expect(s.socket.leave).toHaveBeenCalledWith('workspace-file-doc:file-1')
    expect(s.socket.join).toHaveBeenCalledWith('workspace-file-doc:file-2')

    // file-1's room was dropped (socket-a was its only owner): a fresh joiner of
    // file-1 starts a new document and is elected to seed.
    sent.length = 0
    const b = setup('socket-b', io)
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    expect(sent.find((m) => m.event === FILE_DOC_EVENTS.SEED_REQUEST)?.target).toBe('socket-b')
  })

  it('fully evicts a reclaimed prior socket so it can no longer write to the doc', async () => {
    const { io, sent, left } = createIo()
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 7 })
    const b = setup('socket-b', io) // same default user-1
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 7 }) // reclaims client id 7

    // The stale prior socket is forced out of the Socket.IO room...
    expect(left).toContainEqual({ socketId: 'socket-a', room: ROOM_NAME })

    // ...and its room mapping is cleared, so a later document (SYNC) frame from it is dropped
    // (handleMessage's SYNC path gates on socketToRoomName): nothing is applied or relayed.
    sent.length = 0
    const doc = new Y.Doc()
    doc.getText('t').insert(0, 'x')
    const updateFrame = frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) =>
      syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc))
    )
    a.handlers[FILE_DOC_EVENTS.MESSAGE](updateFrame)
    expect(sent.some((m) => m.event === FILE_DOC_EVENTS.MESSAGE)).toBe(false)
  })

  it('does not drop the current document when a switch is rejected for a foreign client id', async () => {
    const { io } = createIo()
    const a = setup('socket-a', io) // user-1
    const other = setup('socket-c', io, { userId: 'user-b' })
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 10 }) // a owns 10 in file-1
    await other.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-2', clientId: 99 }) // user-b owns 99 in file-2
    a.socket.leave.mockClear()
    a.socket.join.mockClear()

    // a tries to switch to file-2 but requests client id 99, owned by a DIFFERENT user → reject.
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-2', clientId: 99 })

    expect(a.socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'CLIENT_ID_IN_USE' })
    )
    // The rejected switch must leave file-1 intact — a is not torn out of its current document.
    expect(a.socket.leave).not.toHaveBeenCalledWith('workspace-file-doc:file-1')
    expect(a.socket.join).not.toHaveBeenCalledWith('workspace-file-doc:file-2')
  })

  it('re-elects a new seeder when the elected one misses the seed deadline', async () => {
    const { io, sent } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    expect(sent.find((m) => m.event === FILE_DOC_EVENTS.SEED_REQUEST)?.target).toBe('socket-a')
    sent.length = 0

    // socket-a never seeds; the deadline lapses.
    vi.advanceTimersByTime(10_000)

    // The remaining un-tried client is asked to seed instead.
    expect(sent.find((m) => m.event === FILE_DOC_EVENTS.SEED_REQUEST)?.target).toBe('socket-b')
  })

  it('cancels the seed deadline once the document is seeded', async () => {
    const { io, sent } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })

    // socket-a seeds within the deadline.
    const seeded = new Y.Doc()
    seeded.getMap('config').set('initialContentLoaded', true)
    a.handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) =>
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(seeded))
      )
    )
    sent.length = 0

    vi.advanceTimersByTime(10_000)

    // No re-election: the successful seed cancelled the deadline.
    expect(sent.find((m) => m.event === FILE_DOC_EVENTS.SEED_REQUEST)).toBeUndefined()
  })

  it('broadcasts a server-authenticated presence roster on join, one entry per session', async () => {
    const { io, sent } = createIo()
    const a = setup('socket-a', io, { userId: 'user-a', userName: 'Ada', userImage: 'ada.png' })
    const b = setup('socket-b', io, { userId: 'user-b', userName: 'Bob', userImage: 'bob.png' })

    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })

    const roster = sent.filter((m) => m.event === FILE_DOC_EVENTS.PRESENCE).at(-1)?.payload as {
      fileId: string
      users: Array<{ socketId: string; userId: string; userName: string; avatarUrl: string | null }>
    }
    expect(roster.fileId).toBe('file-1')
    // Identity is each socket's authenticated session — not any client-supplied value.
    expect([...roster.users].sort((x, y) => x.userId.localeCompare(y.userId))).toEqual([
      { socketId: 'socket-a', userId: 'user-a', userName: 'Ada', avatarUrl: 'ada.png' },
      { socketId: 'socket-b', userId: 'user-b', userName: 'Bob', avatarUrl: 'bob.png' },
    ])
  })

  it('keeps a per-session entry for two sockets of the SAME user (no server-side user dedup)', async () => {
    const { io, sent } = createIo()
    // Two tabs of one account: the client self-excludes its own socket, so the roster must carry
    // BOTH sessions or a client could never see the other tab as present.
    const a = setup('socket-a', io, { userId: 'user-a', userName: 'Ada', userImage: 'ada.png' })
    const b = setup('socket-b', io, { userId: 'user-a', userName: 'Ada', userImage: 'ada.png' })

    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })

    const roster = sent.filter((m) => m.event === FILE_DOC_EVENTS.PRESENCE).at(-1)?.payload as {
      users: Array<{ socketId: string; userId: string }>
    }
    expect([...roster.users].map((u) => u.socketId).sort()).toEqual(['socket-a', 'socket-b'])
  })
})
