/**
 * @vitest-environment node
 */
import {
  FILE_DOC_EVENTS,
  FILE_DOC_LIMITS,
  FILE_DOC_MESSAGE_TYPE,
  FILE_DOC_SEED,
} from '@sim/realtime-protocol/file-doc'
import { ROOM_TYPES } from '@sim/realtime-protocol/rooms'
import { sleep } from '@sim/utils/helpers'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import type { IRoomManager } from '@/rooms'

const { mockAuthorizeRoom, mockFetchFileDocSeed, mockFetchFileDocMerge, mockFetchFileDocPersist } =
  vi.hoisted(() => ({
    mockAuthorizeRoom: vi.fn(),
    mockFetchFileDocSeed: vi.fn(),
    mockFetchFileDocMerge: vi.fn(),
    mockFetchFileDocPersist: vi.fn(),
  }))

vi.mock('@sim/platform-authz/rooms', () => ({
  authorizeRoom: mockAuthorizeRoom,
}))

vi.mock('@/handlers/file-doc-app', () => ({
  fetchFileDocSeed: mockFetchFileDocSeed,
  fetchFileDocMerge: mockFetchFileDocMerge,
  fetchFileDocPersist: mockFetchFileDocPersist,
}))

import {
  applyMarkdownToLiveFileDoc,
  cleanupFileDocForSocket,
  fileDocAdmissionRoom,
  flushAllFileDocRooms,
  invalidateLiveFileDocument,
  setupWorkspaceFileDocHandlers,
} from '@/handlers/file-doc'
import { FileDocInvalidatedError, getFileDocStore } from '@/handlers/file-doc-store'
import * as permissions from '@/middleware/permissions'
import {
  beginRoomPermissionRead,
  commitRoomPermission,
  ROLE_REVALIDATION_TTL_MS,
} from '@/middleware/permissions'

type Handler = (...payload: unknown[]) => Promise<void> | void

const ROOM_NAME = 'workspace-file-doc:file-1'

interface SentMessage {
  target: string
  except?: string
  event: string
  payload: unknown
}

/** An `io` mock that records every server-originated emit with its target/except. */
function createIo(deliver?: (message: SentMessage) => void) {
  const sent: SentMessage[] = []
  const emit = (message: SentMessage) => {
    sent.push(message)
    deliver?.(message)
  }
  /** Records `io.in(socketId).socketsLeave(room)` — a socket forced out of a room from outside. */
  const left: { socketId: string; room: string }[] = []
  const to = vi.fn((target: string) => ({
    except: (exclude: string) => ({
      emit: (event: string, payload: unknown) => emit({ target, except: exclude, event, payload }),
    }),
    emit: (event: string, payload: unknown) => emit({ target, event, payload }),
  }))
  const inFn = vi.fn((socketId: string) => ({
    socketsLeave: (room: string) => {
      left.push({ socketId, room })
    },
  }))
  // Doc-sync frames fan out via `io.local.to(...)` (cross-task delivery rides the Redis stream, not the
  // adapter). With the store disabled in tests, `local` is the whole room — mirror `to` so those emits
  // are recorded identically. Awareness/presence still use `io.to(...)`.
  return { io: { to, in: inFn, local: { to } } as unknown as IRoomManager['io'], sent, left }
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

const FILE_DOC_FIELD = 'default'

/** Let a fire-and-forget `void ensureServerSeed(...)` chain settle (mock resolves synchronously). */
async function flushMicrotasks(): Promise<void> {
  // Enough to drain the fire-and-forget seed chain (shouldSeed → fetch → fence → publish → apply).
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

/**
 * An encoded Yjs update shaped like the server seed builder's output: some content in the shared
 * `default` type plus the {@link FILE_DOC_SEED} flag, so applying it marks the doc seeded.
 */
function seedResult(
  content: string,
  docId = 'doc-default'
): { update: Uint8Array; version: number } {
  const doc = new Y.Doc()
  doc.getText(FILE_DOC_FIELD).insert(0, content)
  doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
  if (docId) doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, docId)
  return { update: Y.encodeStateAsUpdate(doc), version: 1 }
}

/** Apply a server sync reply frame (`[SYNC tag][sync message]`) into a fresh client doc. */
function applySyncReply(frameBytes: Uint8Array, doc: Y.Doc): void {
  const decoder = decoding.createDecoder(frameBytes)
  decoding.readVarUint(decoder) // skip the message-type tag
  syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), doc, null)
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
    mockFetchFileDocSeed.mockResolvedValue(seedResult(''))
    // Default: the merge builder returns a valid no-op (empty-doc) update. Tests exercising copilot
    // merges override it.
    mockFetchFileDocMerge.mockResolvedValue(Y.encodeStateAsUpdate(new Y.Doc()))
    // Default: persist succeeds. Tests asserting conflict/reconcile override this per-case.
    mockFetchFileDocPersist.mockResolvedValue({ status: 'persisted', version: 1 })
  })

  afterEach(async () => {
    // The room store is module-global; drop every room the test's sockets opened.
    const { io } = createIo()
    // Simulate a full disconnect between tests (`endOfLife`) so the module-global join-generation
    // map is cleared and never bleeds a counter into the next test.
    for (const id of createdSocketIds) cleanupFileDocForSocket(id, io, true)
    createdSocketIds.clear()
    await getFileDocStore().shutdown()
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

  it('fails closed when authorization does not resolve a workspace context', async () => {
    mockAuthorizeRoom.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workspacePermission: 'write',
    })
    const { io } = createIo()
    const { socket, handlers } = setup('socket-no-workspace', io)

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'JOIN_FAILED', retryable: true })
    )
    expect(socket.join).not.toHaveBeenCalled()
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

  it('rejects a payload with a missing or out-of-range client id before authorizing', async () => {
    const { io } = createIo()
    const { socket, handlers } = setup('socket-1', io)

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: '', clientId: 1 })
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1' })
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 0x1_0000_0000 })

    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'INVALID_PAYLOAD', retryable: false })
    )
    expect(mockAuthorizeRoom).not.toHaveBeenCalled()
  })

  it('rejects an incompatible collaborative-document schema before authorizing', async () => {
    const { io } = createIo()
    const { socket, handlers } = setup('socket-schema', io)

    await handlers[FILE_DOC_EVENTS.JOIN]({
      fileId: 'file-1',
      clientId: 1,
      schemaVersion: 99,
    })

    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'SCHEMA_VERSION_MISMATCH', retryable: false })
    )
    expect(mockAuthorizeRoom).not.toHaveBeenCalled()
  })

  it('acknowledges user updates only after applying them to the joined document', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Original', 'doc-1'))
    const { io, sent } = createIo()
    const { handlers } = setup('socket-update', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

    const source = new Y.Doc()
    source.getText(FILE_DOC_FIELD).insert(0, 'acknowledged edit')
    const acknowledge = vi.fn()
    sent.length = 0

    await handlers[FILE_DOC_EVENTS.UPDATE](
      {
        fileId: 'file-1',
        docId: 'doc-1',
        updateId: 'update-1',
        update: Y.encodeStateAsUpdate(source),
      },
      acknowledge
    )

    await vi.waitFor(() =>
      expect(acknowledge).toHaveBeenCalledWith({ status: 'accepted', updateId: 'update-1' })
    )
    expect(sent).toContainEqual(
      expect.objectContaining({
        target: ROOM_NAME,
        event: FILE_DOC_EVENTS.MESSAGE,
      })
    )
    source.destroy()
  })

  it('rejects an update for a replaced document without applying it', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Original', 'doc-current'))
    const { io, sent } = createIo()
    const { handlers } = setup('socket-replaced', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    const acknowledge = vi.fn()
    sent.length = 0

    await handlers[FILE_DOC_EVENTS.UPDATE](
      {
        fileId: 'file-1',
        docId: 'doc-stale',
        updateId: 'update-stale',
        update: Y.encodeStateAsUpdate(new Y.Doc()),
      },
      acknowledge
    )

    expect(acknowledge).toHaveBeenCalledWith({
      status: 'rejected',
      code: 'DOCUMENT_REPLACED',
      retryable: false,
      updateId: 'update-stale',
    })
    expect(sent).toHaveLength(0)
  })

  it('rejects malformed Yjs updates without retrying them', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Original', 'doc-1'))
    const { io } = createIo()
    const { handlers } = setup('socket-malformed-update', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    const acknowledge = vi.fn()

    await handlers[FILE_DOC_EVENTS.UPDATE](
      {
        fileId: 'file-1',
        docId: 'doc-1',
        updateId: 'update-malformed',
        update: new Uint8Array([255]),
      },
      acknowledge
    )

    expect(acknowledge).toHaveBeenCalledWith({
      status: 'rejected',
      code: 'INVALID_UPDATE',
      retryable: false,
      updateId: 'update-malformed',
    })
  })

  it('ignores an acknowledged-update event without a callable acknowledgement', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Original', 'doc-1'))
    const { io } = createIo()
    const { handlers } = setup('socket-missing-ack', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

    expect(() =>
      handlers[FILE_DOC_EVENTS.UPDATE](
        {
          fileId: 'file-1',
          docId: 'doc-1',
          updateId: 'update-1',
          update: Y.encodeStateAsUpdate(new Y.Doc()),
        },
        { not: 'a function' }
      )
    ).not.toThrow()
  })

  it('keeps a room alive until an acknowledged update finishes appending', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Original', 'doc-1'))
    let resolveAppend: () => void = () => {}
    const append = new Promise<void>((resolve) => {
      resolveAppend = resolve
    })
    const publish = vi
      .spyOn(getFileDocStore(), 'publishClientUpdateAndWait')
      .mockReturnValue(append)
    const { io } = createIo()
    const { handlers } = setup('socket-update-leave', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    const source = new Y.Doc()
    source.getText(FILE_DOC_FIELD).insert(0, 'accepted before leave')
    const acknowledge = vi.fn()

    handlers[FILE_DOC_EVENTS.UPDATE](
      {
        fileId: 'file-1',
        docId: 'doc-1',
        updateId: 'update-leave',
        update: Y.encodeStateAsUpdate(source),
      },
      acknowledge
    )
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    handlers[FILE_DOC_EVENTS.LEAVE]({ fileId: 'file-1' })
    resolveAppend()

    await vi.waitFor(() =>
      expect(acknowledge).toHaveBeenCalledWith({
        status: 'accepted',
        updateId: 'update-leave',
      })
    )
    publish.mockRestore()
    source.destroy()
  })

  it('rejects a generation-fenced update as a durable document replacement', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Original', 'doc-1'))
    const publish = vi
      .spyOn(getFileDocStore(), 'publishClientUpdateAndWait')
      .mockRejectedValue(new FileDocInvalidatedError())
    const { io } = createIo()
    const { handlers } = setup('socket-replaced-update', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    const source = new Y.Doc()
    source.getText(FILE_DOC_FIELD).insert(0, 'stale edit')
    const acknowledge = vi.fn()

    await handlers[FILE_DOC_EVENTS.UPDATE](
      {
        fileId: 'file-1',
        docId: 'doc-1',
        updateId: 'update-replaced',
        update: Y.encodeStateAsUpdate(source),
      },
      acknowledge
    )

    expect(acknowledge).toHaveBeenCalledWith({
      status: 'rejected',
      code: 'DOCUMENT_REPLACED',
      retryable: false,
      updateId: 'update-replaced',
    })
    publish.mockRestore()
    source.destroy()
  })

  it.each(['before append', 'during append', 'during append and reseed'] as const)(
    'rejects a document invalidated %s without applying or relaying its stale update',
    async (timing) => {
      mockFetchFileDocSeed.mockResolvedValue(seedResult('Original', 'doc-race'))
      const { io, sent } = createIo()
      const { handlers } = setup('socket-generation-race', io)
      await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
      const store = getFileDocStore()
      let finishAppend!: () => void
      const pendingAppend = new Promise<void>((resolve) => {
        finishAppend = resolve
      })
      const publish =
        timing !== 'before append'
          ? vi.spyOn(store, 'publishClientUpdateAndWait').mockReturnValueOnce(pendingAppend)
          : undefined
      const source = new Y.Doc()
      source.getText(FILE_DOC_FIELD).insert(0, 'Stale text')
      const acknowledge = vi.fn()
      try {
        if (timing === 'before append') await invalidateLiveFileDocument('file-1', 2)
        sent.length = 0
        handlers[FILE_DOC_EVENTS.UPDATE](
          {
            fileId: 'file-1',
            docId: 'doc-race',
            updateId: 'update-race',
            update: Y.encodeStateAsUpdate(source),
          },
          acknowledge
        )
        if (timing !== 'before append') {
          expect(publish).toHaveBeenCalledTimes(1)
          await invalidateLiveFileDocument('file-1', 2)
          if (timing === 'during append and reseed') {
            mockFetchFileDocSeed.mockResolvedValue({
              ...seedResult('Replacement', 'doc-new'),
              version: 2,
            })
            const fresh = setup('socket-generation-fresh', io)
            await fresh.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
            expect(fresh.socket.emit).toHaveBeenCalledWith(
              FILE_DOC_EVENTS.JOIN_SUCCESS,
              expect.objectContaining({ docId: 'doc-new' })
            )
            sent.length = 0
          }
          finishAppend()
        }
        await vi.waitFor(() =>
          expect(acknowledge).toHaveBeenCalledWith({
            status: 'rejected',
            code: 'DOCUMENT_REPLACED',
            retryable: false,
            updateId: 'update-race',
          })
        )
        expect(sent).toHaveLength(0)
      } finally {
        finishAppend()
        publish?.mockRestore()
        source.destroy()
      }
    }
  )

  it('does not re-enter the room when access was revoked while the join was in flight', async () => {
    // The sweep records a revocation before it evicts, so a join whose authorize
    // completed just before that must not put the socket back in the document.
    const { io } = createIo()
    const { socket, handlers } = setup('socket-race', io, { userId: 'user-race' })

    mockAuthorizeRoom.mockImplementation(async () => {
      // Simulate the revocation landing between this join's authorize and its commit,
      // exactly as the sweep would record it.
      commitRoomPermission(
        'user-race',
        { type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: 'file-1' },
        null,
        beginRoomPermissionRead()
      )
      return { allowed: true, status: 200, workspaceId: 'ws-1', workspacePermission: 'write' }
    })

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_ERROR,
      expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
    )
    expect(socket.join).not.toHaveBeenCalled()
    expect(joinSuccessFileId(socket)).toBeUndefined()
  })

  it('re-reads access when the cached decision expired mid-join, instead of failing open', async () => {
    // A join stalled longer than the cache TTL: the sweep's denial is recorded with a
    // later read ticket (so this join's own allow is correctly dropped) but has since
    // expired. Peeking the cache would read that as "unknown" and let the socket back
    // into the document, so the join must re-resolve against the database.
    vi.useFakeTimers()
    try {
      const room = { type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: 'file-stale' }
      const { io } = createIo()
      const { socket, handlers } = setup('socket-stale', io, { userId: 'user-stale' })

      mockAuthorizeRoom.mockImplementation(async ({ action }: { action: string }) => {
        // The authoritative current answer: access is gone.
        if (action !== 'write')
          return { allowed: false, status: 403, workspaceId: 'ws-1', workspacePermission: null }
        // This join's own authorize saw the pre-revocation state, and the sweep records
        // the revocation (later read ticket) while it is still in flight.
        commitRoomPermission('user-stale', room, null, beginRoomPermissionRead())
        await sleep(31_000)
        return { allowed: true, status: 200, workspaceId: 'ws-1', workspacePermission: 'write' }
      })

      const joining = handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-stale', clientId: 1 })
      await vi.advanceTimersByTimeAsync(31_000)
      await joining

      expect(socket.emit).toHaveBeenCalledWith(
        FILE_DOC_EVENTS.JOIN_ERROR,
        expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
      )
      expect(socket.join).not.toHaveBeenCalled()
      expect(joinSuccessFileId(socket)).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
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

  it('does NOT persist a seeded-but-unedited doc on last disconnect (no clobber of a concurrent write)', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# From server'))
    const { io } = createIo()
    const { handlers } = setup('socket-1', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks() // let the seed apply

    // Last collaborator leaves without ever editing — projecting this seed back over the file could
    // clobber a concurrent copilot write, so the final flush must NOT persist.
    cleanupFileDocForSocket('socket-1', io, true)
    await flushMicrotasks()
    expect(mockFetchFileDocPersist).not.toHaveBeenCalled()
  })

  it('persists on last disconnect once a genuine user edit has landed', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# From server'))
    const { io } = createIo()
    const { handlers } = setup('socket-1', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    // A real user edit (socket-origin sync update) marks the doc dirty.
    const edit = new Y.Doc()
    edit.getText(FILE_DOC_FIELD).insert(0, 'user typed this')
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) =>
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(edit))
      )
    )
    await flushMicrotasks()

    cleanupFileDocForSocket('socket-1', io, true)
    await flushMicrotasks()
    expect(mockFetchFileDocPersist).toHaveBeenCalled()
  })

  it('awaits final persistence of an already removed room during shutdown', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# From server'))
    const { io } = createIo()
    const { handlers } = setup('socket-final-persist', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    const edit = new Y.Doc()
    edit.getText(FILE_DOC_FIELD).insert(0, 'last edit')
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (encoder) =>
        syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(edit))
      )
    )
    let finishPersist!: (result: { status: 'persisted'; version: number }) => void
    mockFetchFileDocPersist.mockReturnValueOnce(
      new Promise((resolve) => {
        finishPersist = resolve
      })
    )
    cleanupFileDocForSocket('socket-final-persist', io, true)
    await flushMicrotasks()
    expect(mockFetchFileDocPersist).toHaveBeenCalledTimes(1)
    const completed = vi.fn()
    const flush = flushAllFileDocRooms().then(completed)
    await flushMicrotasks()
    expect(completed).not.toHaveBeenCalled()
    finishPersist({ status: 'persisted', version: 2 })
    await flush
    expect(completed).toHaveBeenCalledTimes(1)
    edit.destroy()
  })

  it('drains an accepted update still appending when the last socket closes', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# From server', 'shutdown-doc'))
    const { io } = createIo()
    const { handlers } = setup('socket-closing-update', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    let finishAppend!: () => void
    const append = vi.spyOn(getFileDocStore(), 'publishClientUpdateAndWait').mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishAppend = resolve
      })
    )
    const edit = new Y.Doc()
    edit.getText(FILE_DOC_FIELD).insert(0, 'accepted before socket close')
    const ack = vi.fn()
    handlers[FILE_DOC_EVENTS.UPDATE](
      {
        fileId: 'file-1',
        docId: 'shutdown-doc',
        updateId: 'shutdown-update',
        update: Y.encodeStateAsUpdate(edit),
      },
      ack
    )
    cleanupFileDocForSocket('socket-closing-update', io, true)
    const completed = vi.fn()
    const flush = flushAllFileDocRooms().then(completed)
    await flushMicrotasks()
    expect(completed).not.toHaveBeenCalled()
    expect(mockFetchFileDocPersist).not.toHaveBeenCalled()
    finishAppend()
    await flush
    expect(ack).toHaveBeenCalledWith({ status: 'accepted', updateId: 'shutdown-update' })
    expect(mockFetchFileDocPersist).toHaveBeenCalledTimes(1)
    const persisted = new Y.Doc()
    Y.applyUpdate(persisted, mockFetchFileDocPersist.mock.calls[0][3])
    expect(persisted.getText(FILE_DOC_FIELD).toString()).toContain('accepted before socket close')
    append.mockRestore()
    edit.destroy()
    persisted.destroy()
  })

  it.each(['persist', 'invalidate', 'leave'] as const)(
    'retries a throttled persist safely until %s',
    async (outcome) => {
      vi.useFakeTimers()
      const store = getFileDocStore()
      const claim = vi
        .spyOn(store, 'tryClaimPersistWindow')
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true)
      try {
        mockFetchFileDocSeed.mockResolvedValue(seedResult('# From server'))
        const { io } = createIo()
        const { handlers } = setup('socket-throttled', io)
        await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
        const edit = new Y.Doc()
        edit.getText(FILE_DOC_FIELD).insert(0, 'pending durable edit')
        handlers[FILE_DOC_EVENTS.MESSAGE](
          frame(FILE_DOC_MESSAGE_TYPE.SYNC, (encoder) =>
            syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(edit))
          )
        )
        await vi.advanceTimersByTimeAsync(5_000)
        expect(claim).toHaveBeenCalledTimes(1)
        expect(mockFetchFileDocPersist).not.toHaveBeenCalled()
        if (outcome === 'invalidate') await store.invalidateDocument(ROOM_NAME, 2)
        if (outcome === 'leave') {
          cleanupFileDocForSocket('socket-throttled', io, true)
          await vi.advanceTimersByTimeAsync(0)
          expect(mockFetchFileDocPersist).toHaveBeenCalledTimes(1)
          mockFetchFileDocPersist.mockClear()
        }
        await vi.advanceTimersByTimeAsync(5_000)
        expect(mockFetchFileDocPersist).toHaveBeenCalledTimes(outcome === 'persist' ? 1 : 0)
        if (outcome === 'persist') {
          const persisted = new Y.Doc()
          Y.applyUpdate(persisted, mockFetchFileDocPersist.mock.calls[0][3])
          expect(persisted.getText(FILE_DOC_FIELD).toString()).toContain('pending durable edit')
          persisted.destroy()
        }
        edit.destroy()
      } finally {
        claim.mockRestore()
        vi.useRealTimers()
      }
    }
  )

  it('drops document frames and evicts once the editor loses write access mid-session', async () => {
    // The join-time check is not a standing right: a collaborator downgraded to `read`
    // (or removed) must stop landing durable edits on the socket they already hold.
    // A distinct user/file so the recorded revocation — written under fake timers, so it
    // outlives this test in real time — cannot leak into siblings through the
    // module-global role cache.
    vi.useFakeTimers()
    try {
      mockFetchFileDocSeed.mockResolvedValue(seedResult('# From server'))
      const { io, sent } = createIo()
      const { socket, handlers } = setup('socket-revoked', io, { userId: 'user-revoked' })
      await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-revoked', clientId: 1 })
      await vi.advanceTimersByTimeAsync(0)

      // Access is downgraded to read-only, and the cached join-time decision expires.
      mockAuthorizeRoom.mockResolvedValue({
        allowed: false,
        status: 403,
        workspaceId: 'ws-1',
        workspacePermission: 'read',
      })
      await vi.advanceTimersByTimeAsync(31_000)

      const edit = new Y.Doc()
      edit.getText(FILE_DOC_FIELD).insert(0, 'edit after revocation')
      const editFrame = () =>
        handlers[FILE_DOC_EVENTS.MESSAGE](
          frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) =>
            syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(edit))
          )
        )

      // The first frame after expiry finds nothing cached, so it is accepted and kicks
      // off the authoritative re-read (never a synchronous DB wait on the relay path).
      editFrame()
      await vi.advanceTimersByTimeAsync(0)

      // The next frame is gated on the now-authoritative denial: dropped, and the socket
      // is evicted rather than left holding the room.
      editFrame()
      await vi.advanceTimersByTimeAsync(0)

      expect(socket.emit).toHaveBeenCalledWith(
        'room-access-revoked',
        expect.objectContaining({ room: { type: 'workspace-file-doc', id: 'file-revoked' } })
      )
      expect(socket.leave).toHaveBeenCalledWith('workspace-file-doc:file-revoked')

      // The binding is gone, so every later frame is inert — nothing is applied and
      // nothing reaches the room.
      const sentAfterEviction = sent.length
      const emitsAfterEviction = socket.emit.mock.calls.length
      editFrame()
      await vi.advanceTimersByTimeAsync(0)
      expect(sent.length).toBe(sentAfterEviction)
      expect(socket.emit.mock.calls.length).toBe(emitsAfterEviction)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps relaying document frames while the cached permission still allows writing', async () => {
    const { io, sent } = createIo()
    const { socket, handlers } = setup('socket-1', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    const before = sent.length
    const edit = new Y.Doc()
    edit.getText(FILE_DOC_FIELD).insert(0, 'still allowed')
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) =>
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(edit))
      )
    )
    await flushMicrotasks()

    expect(sent.slice(before).length).toBeGreaterThan(0)
    expect(socket.emit).not.toHaveBeenCalledWith('room-access-revoked', expect.anything())
  })

  it('applies + fans out an agent-streamed frame (SYNC_NO_PERSIST) but never persists it', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# From server'))
    const { io, sent } = createIo()
    const { handlers } = setup('socket-1', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    const before = sent.length
    const edit = new Y.Doc()
    edit.getText(FILE_DOC_FIELD).insert(0, 'agent streamed this')
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST, (e) =>
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(edit))
      )
    )
    await flushMicrotasks()

    // It fans out to the WHOLE room — no socket excluded — so peers AND a same-socket sibling provider see
    // the stream live (the emitting provider no-ops on its own echo).
    const fanout = sent
      .slice(before)
      .filter((m) => m.event === FILE_DOC_EVENTS.MESSAGE && m.except === undefined)
    expect(fanout.length).toBeGreaterThan(0)

    // ...but it must NOT mark the doc dirty: a last-disconnect flush never persists agent content (the
    // copilot's final edit_content write is the authoritative durable persist).
    cleanupFileDocForSocket('socket-1', io, true)
    await flushMicrotasks()
    expect(mockFetchFileDocPersist).not.toHaveBeenCalled()
  })

  it('stops on a persist conflict without clobbering (single attempt, durable left authoritative)', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# From server'))
    // A persist reports an out-of-band change (If-Match conflict). The relay must NOT re-persist against
    // the current stream (the external write commits durable before its chokepoint merge lands, so a
    // re-persist could clobber it) — it stops after a single attempt and leaves the durable file
    // authoritative; a later flush projects the converged stream once the merge lands.
    mockFetchFileDocPersist.mockResolvedValue({
      status: 'conflict',
    })
    const { io } = createIo()
    const { handlers } = setup('socket-1', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    const edit = new Y.Doc()
    edit.getText(FILE_DOC_FIELD).insert(0, 'user typed this')
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) =>
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(edit))
      )
    )
    await flushMicrotasks()

    // The conflict is handled gracefully: the persist is attempted exactly once (never silently skipped,
    // never retried against a possibly-behind stream) and the durable file is left authoritative.
    cleanupFileDocForSocket('socket-1', io, true)
    await flushMicrotasks()
    expect(mockFetchFileDocPersist).toHaveBeenCalledTimes(1)
  })

  it('flushAllFileDocRooms persists open EDITED rooms (graceful shutdown), skips unedited', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# From server'))
    const { io } = createIo()
    const { handlers } = setup('socket-1', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    // Seed-only room: a graceful-shutdown flush must NOT persist it.
    mockFetchFileDocPersist.mockClear()
    await flushAllFileDocRooms()
    expect(mockFetchFileDocPersist).not.toHaveBeenCalled()

    // After a real user edit, the same flush persists (edits would otherwise be lost on deploy).
    const edit = new Y.Doc()
    edit.getText(FILE_DOC_FIELD).insert(0, 'typed')
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) =>
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(edit))
      )
    )
    await flushMicrotasks()
    mockFetchFileDocPersist.mockClear()
    await flushAllFileDocRooms()
    expect(mockFetchFileDocPersist).toHaveBeenCalled()
  })

  it('joins the room, sends sync step 1, and seeds the document from the server', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# From server'))
    const { io } = createIo()
    const { socket, handlers } = setup('socket-1', io)

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

    expect(socket.join).toHaveBeenCalledWith(ROOM_NAME)
    expect(joinSuccessFileId(socket)).toBe('file-1')
    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_SUCCESS,
      expect.objectContaining({ fileId: 'file-1', clientId: 1 })
    )
    const joinSuccess = socket.emit.mock.calls.find(
      ([event]) => event === FILE_DOC_EVENTS.JOIN_SUCCESS
    )?.[1] as Record<string, unknown>
    expect(joinSuccess).not.toHaveProperty('acknowledgedUpdates')

    // A binary sync-step-1 message (type tag 0) is sent to kick off the handshake.
    const syncMessage = socket.emit.mock.calls.find(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    expect((syncMessage?.[1] as Uint8Array)[0]).toBe(FILE_DOC_MESSAGE_TYPE.SYNC)

    // The server seeds authoritatively from the file's stored markdown, keyed by (workspaceId, fileId).
    await flushMicrotasks()
    expect(mockFetchFileDocSeed).toHaveBeenCalledWith('ws-1', 'file-1')

    // The seeded state is served to a client that syncs: request step 2 and decode it.
    socket.emit.mockClear()
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc()))
    )
    const reply = socket.emit.mock.calls.find(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    const clientDoc = new Y.Doc()
    applySyncReply(reply?.[1] as Uint8Array, clientDoc)
    expect(clientDoc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag)).toBe(true)
    expect(clientDoc.getText(FILE_DOC_FIELD).toString()).toBe('# From server')
  })

  it('discards a fenced in-memory generation before serving the next join', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Old', 'doc-old'))
    const { io, left } = createIo()
    const first = setup('socket-old-generation', io)
    await first.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })

    await getFileDocStore().invalidateDocument(ROOM_NAME, 1)
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# New', 'doc-new'))
    const second = setup('socket-new-generation', io)
    await second.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })

    expect(left).toContainEqual({ socketId: 'socket-old-generation', room: ROOM_NAME })
    second.socket.emit.mockClear()
    second.handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (encoder) =>
        syncProtocol.writeSyncStep1(encoder, new Y.Doc())
      )
    )
    const reply = second.socket.emit.mock.calls.find(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    const clientDoc = new Y.Doc()
    applySyncReply(reply?.[1] as Uint8Array, clientDoc)
    expect(clientDoc.getText(FILE_DOC_FIELD).toString()).toBe('# New')
    clientDoc.destroy()
  })

  it.each([false, true])(
    'rejects a pending join invalidated during permission with existing room %s',
    async (existingRoom) => {
      const seed = seedResult('# Old', 'doc-old')
      mockFetchFileDocSeed.mockResolvedValue(seed)
      const { io, sent } = createIo()
      if (existingRoom) {
        const first = setup('socket-first-invalidation', io)
        await first.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
      }
      let resolvePermission!: (permission: string) => void
      const permission = new Promise<string>((resolve) => {
        resolvePermission = resolve
      })
      const permissionCheck = vi
        .spyOn(permissions, 'resolveCurrentRoomPermission')
        .mockImplementationOnce(() => permission)
      try {
        const pending = setup('socket-pending-invalidation', io)
        const joining = pending.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
        await vi.waitFor(() => expect(permissionCheck).toHaveBeenCalledOnce())
        expect(await invalidateLiveFileDocument('file-1', 2)).toMatchObject({ status: 'applied' })
        io.to(ROOM_NAME).emit(FILE_DOC_EVENTS.INVALIDATED, { fileId: 'file-1' })
        resolvePermission('write')
        await joining

        expect(joinSuccessFileId(pending.socket)).toBeUndefined()
        expect(pending.socket.emit).toHaveBeenCalledWith(
          FILE_DOC_EVENTS.JOIN_ERROR,
          expect.objectContaining({ retryable: true })
        )
        const staleClient = new Y.Doc()
        Y.applyUpdate(staleClient, seed.update)
        const vector = Y.encodeStateVector(staleClient)
        staleClient.getText(FILE_DOC_FIELD).insert(0, 'must not accept ')
        sent.length = 0
        pending.socket.emit.mockClear()
        pending.handlers[FILE_DOC_EVENTS.MESSAGE](
          frame(FILE_DOC_MESSAGE_TYPE.SYNC, (encoder) =>
            syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(staleClient, vector))
          )
        )
        expect(sent).toHaveLength(0)
        expect(pending.socket.emit).not.toHaveBeenCalledWith(
          FILE_DOC_EVENTS.MESSAGE,
          expect.any(Uint8Array)
        )
        await flushAllFileDocRooms()
        expect(mockFetchFileDocPersist).not.toHaveBeenCalled()
        staleClient.destroy()

        mockFetchFileDocSeed.mockResolvedValue({ ...seedResult('# New', 'doc-new'), version: 2 })
        await pending.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
        expect(pending.socket.emit).toHaveBeenCalledWith(
          FILE_DOC_EVENTS.JOIN_SUCCESS,
          expect.objectContaining({ docId: 'doc-new' })
        )
      } finally {
        resolvePermission('write')
        permissionCheck.mockRestore()
      }
    }
  )

  it.each(['write', 'read', null] as const)(
    'withholds document and presence broadcasts until final authorization resolves to %s',
    async (permission) => {
      mockFetchFileDocSeed.mockResolvedValue(seedResult('# Private', 'doc-private'))
      const memberships = new Set<string>()
      let pending: ReturnType<typeof setup>
      const { io } = createIo(({ target, event, payload }) => {
        if (memberships.has(target)) pending.socket.emit(event, payload)
      })
      pending = setup('socket-pending-authorization', io, {
        join: vi.fn((name: string) => {
          memberships.add(name)
        }),
        leave: vi.fn((name: string) => {
          memberships.delete(name)
        }),
      })
      let resolvePermission!: (value: 'write' | 'read' | null) => void
      const authorization = new Promise<'write' | 'read' | null>((resolve) => {
        resolvePermission = resolve
      })
      const guard = vi
        .spyOn(permissions, 'resolveCurrentRoomPermission')
        .mockResolvedValueOnce('write')
        .mockImplementationOnce(() => authorization)
      const joining = pending.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
      try {
        await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(2))
        const content = frame(FILE_DOC_MESSAGE_TYPE.SYNC, (encoder) =>
          syncProtocol.writeUpdate(encoder, seedResult('# Private update').update)
        )
        io.local.to(ROOM_NAME).emit(FILE_DOC_EVENTS.MESSAGE, content)
        io.to(ROOM_NAME).emit(
          FILE_DOC_EVENTS.MESSAGE,
          new Uint8Array([FILE_DOC_MESSAGE_TYPE.AWARENESS])
        )
        io.to(ROOM_NAME).emit(FILE_DOC_EVENTS.PRESENCE, [{ userId: 'private-peer' }])
        expect(pending.socket.emit).not.toHaveBeenCalledWith(
          FILE_DOC_EVENTS.MESSAGE,
          expect.anything()
        )
        expect(pending.socket.emit).not.toHaveBeenCalledWith(
          FILE_DOC_EVENTS.PRESENCE,
          expect.anything()
        )
        expect(memberships.has(ROOM_NAME)).toBe(false)
        resolvePermission(permission)
        await joining
        expect(memberships.has(ROOM_NAME)).toBe(permission === 'write')
        if (permission === 'write') {
          expect(joinSuccessFileId(pending.socket)).toBe('file-1')
          expect(pending.socket.emit).toHaveBeenCalledWith(
            FILE_DOC_EVENTS.MESSAGE,
            expect.any(Uint8Array)
          )
        } else {
          expect(joinSuccessFileId(pending.socket)).toBeUndefined()
          expect(pending.socket.emit).toHaveBeenCalledWith(
            FILE_DOC_EVENTS.JOIN_ERROR,
            expect.objectContaining({ code: 'ACCESS_DENIED', retryable: false })
          )
        }
      } finally {
        resolvePermission(permission)
        await joining
        guard.mockRestore()
      }
    }
  )

  it('rejects a generation invalidated while final authorization is pending', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Old', 'doc-old'))
    const { io } = createIo()
    const pending = setup('socket-final-authorization-invalidation', io)
    let finishAuthorization!: (permission: 'write') => void
    const authorization = new Promise<'write'>((resolve) => {
      finishAuthorization = resolve
    })
    const guard = vi
      .spyOn(permissions, 'resolveCurrentRoomPermission')
      .mockResolvedValueOnce('write')
      .mockImplementationOnce(() => authorization)
    const joining = pending.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    try {
      await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(2))
      await getFileDocStore().invalidateDocument(ROOM_NAME, 2)
      finishAuthorization('write')
      await joining
      expect(pending.socket.join).not.toHaveBeenCalledWith(ROOM_NAME)
      expect(joinSuccessFileId(pending.socket)).toBeUndefined()
      expect(pending.socket.emit).toHaveBeenCalledWith(
        FILE_DOC_EVENTS.JOIN_ERROR,
        expect.objectContaining({ code: 'JOIN_FAILED', retryable: true })
      )
      expect(pending.socket.leave).toHaveBeenCalledWith(fileDocAdmissionRoom('file-1'))
    } finally {
      finishAuthorization('write')
      await joining
      guard.mockRestore()
    }
  })

  it.each(['revoked', 'expired'] as const)(
    'rejects access %s while the final generation check is pending',
    async (access) => {
      mockFetchFileDocSeed.mockResolvedValue(seedResult('# Private', 'doc-private'))
      const { io } = createIo()
      const pending = setup('socket-generation-authorization-revocation', io)
      let finishGeneration!: (current: boolean) => void
      const generation = new Promise<boolean>((resolve) => {
        finishGeneration = resolve
      })
      const guard = vi
        .spyOn(getFileDocStore(), 'isDocumentGenerationCurrent')
        .mockImplementationOnce(() => generation)
      const joining = pending.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
      const clock = vi.spyOn(Date, 'now')
      try {
        await vi.waitFor(() => expect(guard).toHaveBeenCalledOnce())
        if (access === 'revoked') {
          commitRoomPermission(
            'user-1',
            { type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: 'file-1' },
            'read',
            beginRoomPermissionRead()
          )
        } else {
          clock.mockReturnValue(Date.now() + ROLE_REVALIDATION_TTL_MS + 1)
        }
        finishGeneration(true)
        await joining
        expect(pending.socket.join).not.toHaveBeenCalledWith(ROOM_NAME)
        expect(joinSuccessFileId(pending.socket)).toBeUndefined()
        expect(pending.socket.emit).toHaveBeenCalledWith(
          FILE_DOC_EVENTS.JOIN_ERROR,
          expect.objectContaining({
            code: access === 'revoked' ? 'ACCESS_DENIED' : 'JOIN_FAILED',
            retryable: access === 'expired',
          })
        )
      } finally {
        clock.mockRestore()
        finishGeneration(true)
        await joining
        guard.mockRestore()
      }
    }
  )

  it('receives invalidation while the subscribed generation check is pending', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Old', 'doc-old'))
    const memberships = new Set<string>()
    let pending: ReturnType<typeof setup>
    const { io } = createIo(({ target, event, payload }) => {
      if (memberships.has(target)) pending.socket.emit(event, payload)
    })
    pending = setup('socket-subscribed-invalidation', io, {
      join: vi.fn((name: string) => {
        memberships.add(name)
      }),
      leave: vi.fn((name: string) => {
        memberships.delete(name)
      }),
    })
    let resolveGeneration!: (current: boolean) => void
    const currentGeneration = new Promise<boolean>((resolve) => {
      resolveGeneration = resolve
    })
    const guard = vi
      .spyOn(getFileDocStore(), 'isDocumentGenerationCurrent')
      .mockImplementationOnce(() => currentGeneration)
    try {
      const joining = pending.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
      await vi.waitFor(() => expect(guard).toHaveBeenCalledOnce())
      expect(memberships.has(ROOM_NAME)).toBe(false)
      expect(memberships.has(fileDocAdmissionRoom('file-1'))).toBe(true)
      await getFileDocStore().invalidateDocument(ROOM_NAME, 2)
      io.to(fileDocAdmissionRoom('file-1')).emit(FILE_DOC_EVENTS.INVALIDATED, { fileId: 'file-1' })
      expect(pending.socket.emit).toHaveBeenCalledWith(FILE_DOC_EVENTS.INVALIDATED, {
        fileId: 'file-1',
      })
      await pending.handlers[FILE_DOC_EVENTS.LEAVE]({ fileId: 'file-1' })
      resolveGeneration(true)
      await joining

      expect(joinSuccessFileId(pending.socket)).toBeUndefined()
      expect(memberships.has(ROOM_NAME)).toBe(false)
      expect(memberships.has(fileDocAdmissionRoom('file-1'))).toBe(false)
    } finally {
      resolveGeneration(true)
      guard.mockRestore()
    }
  })

  it.each(['invalidation', 'revocation', 'leave'] as const)(
    'rolls back an asynchronous room subscription interrupted by %s',
    async (interruption) => {
      mockFetchFileDocSeed.mockResolvedValue(seedResult('# Old', 'doc-old'))
      const { io } = createIo()
      let finishSubscription!: () => void
      const subscription = new Promise<void>((resolve) => {
        finishSubscription = resolve
      })
      const pending = setup('socket-async-subscription', io, {
        join: vi.fn(() => subscription),
      })
      const joining = pending.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
      await vi.waitFor(() => expect(pending.socket.join).toHaveBeenCalledOnce())
      expect(joinSuccessFileId(pending.socket)).toBeUndefined()
      if (interruption === 'invalidation') {
        await getFileDocStore().invalidateDocument(ROOM_NAME, 2)
      } else if (interruption === 'revocation') {
        commitRoomPermission(
          'user-1',
          { type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: 'file-1' },
          'read',
          beginRoomPermissionRead()
        )
      } else {
        await pending.handlers[FILE_DOC_EVENTS.LEAVE]({ fileId: 'file-1' })
      }
      finishSubscription()
      await joining
      expect(joinSuccessFileId(pending.socket)).toBeUndefined()
      expect(pending.socket.leave).toHaveBeenCalledWith(ROOM_NAME)
    }
  )

  it.each(['revoked', 'expired', 'unchanged'] as const)(
    'checks %s access after an asynchronous content-room join',
    async (access) => {
      mockFetchFileDocSeed.mockResolvedValue(seedResult('# Private', 'doc-private'))
      const { io } = createIo()
      const memberships = new Set<string>()
      let finishSubscription!: () => void
      const subscription = new Promise<void>((resolve) => {
        finishSubscription = resolve
      })
      const pending = setup('socket-content-subscription-access', io, {
        join: vi.fn((name: string) => {
          if (name === ROOM_NAME)
            return subscription.then(() => {
              memberships.add(name)
            })
          memberships.add(name)
        }),
        leave: vi.fn((name: string) => memberships.delete(name)),
      })
      const clock = vi.spyOn(Date, 'now')
      const joining = pending.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
      try {
        await vi.waitFor(() => expect(pending.socket.join).toHaveBeenCalledWith(ROOM_NAME))
        expect(joinSuccessFileId(pending.socket)).toBeUndefined()
        if (access === 'revoked') {
          commitRoomPermission(
            'user-1',
            { type: ROOM_TYPES.WORKSPACE_FILE_DOC, id: 'file-1' },
            'read',
            beginRoomPermissionRead()
          )
        } else if (access === 'expired') {
          clock.mockReturnValue(Date.now() + ROLE_REVALIDATION_TTL_MS + 1)
        }
        finishSubscription()
        await joining
        expect(memberships.has(fileDocAdmissionRoom('file-1'))).toBe(false)
        expect(memberships.has(ROOM_NAME)).toBe(access === 'unchanged')
        if (access === 'unchanged') {
          expect(joinSuccessFileId(pending.socket)).toBe('file-1')
        } else {
          expect(joinSuccessFileId(pending.socket)).toBeUndefined()
          expect(pending.socket.emit).toHaveBeenCalledWith(
            FILE_DOC_EVENTS.JOIN_ERROR,
            expect.objectContaining({
              code: access === 'revoked' ? 'ACCESS_DENIED' : 'JOIN_FAILED',
              retryable: access === 'expired',
            })
          )
          expect(pending.socket.emit).not.toHaveBeenCalledWith(
            FILE_DOC_EVENTS.MESSAGE,
            expect.anything()
          )
          expect(pending.socket.emit).not.toHaveBeenCalledWith(
            FILE_DOC_EVENTS.PRESENCE,
            expect.anything()
          )
        }
      } finally {
        clock.mockRestore()
        finishSubscription()
        await joining
      }
    }
  )

  it('keeps a shared provisional subscription until the other provider finishes joining', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Shared', 'doc-shared'))
    const { io } = createIo()
    const pending = setup('socket-shared-subscription', io)
    const checks: Array<(current: boolean) => void> = []
    const guard = vi
      .spyOn(getFileDocStore(), 'isDocumentGenerationCurrent')
      .mockImplementation(() => new Promise<boolean>((resolve) => checks.push(resolve)))
    try {
      const first = pending.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
      const second = pending.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
      await vi.waitFor(() => expect(checks).toHaveLength(2))
      checks[0](false)
      await first
      expect(pending.socket.leave).not.toHaveBeenCalled()
      checks[1](true)
      await second
      expect(pending.socket.emit).toHaveBeenCalledWith(
        FILE_DOC_EVENTS.JOIN_SUCCESS,
        expect.objectContaining({ clientId: 2, docId: 'doc-shared' })
      )
      expect(pending.socket.leave).not.toHaveBeenCalledWith(ROOM_NAME)
      expect(pending.socket.leave).toHaveBeenCalledWith(fileDocAdmissionRoom('file-1'))
    } finally {
      for (const resolve of checks) resolve(true)
      guard.mockRestore()
    }
  })

  it('preserves the committed binding when a co-mounted provider join fails', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Shared', 'doc-shared'))
    const { io } = createIo()
    const current = setup('socket-existing-subscription', io)
    await current.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    const guard = vi
      .spyOn(getFileDocStore(), 'isDocumentGenerationCurrent')
      .mockRejectedValueOnce(new Error('Temporary generation read failure'))
    try {
      await current.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
      expect(current.socket.leave).not.toHaveBeenCalledWith(ROOM_NAME)
      current.socket.emit.mockClear()
      current.handlers[FILE_DOC_EVENTS.MESSAGE](
        frame(FILE_DOC_MESSAGE_TYPE.SYNC, (encoder) =>
          syncProtocol.writeSyncStep1(encoder, new Y.Doc())
        )
      )
      expect(current.socket.emit).toHaveBeenCalledWith(
        FILE_DOC_EVENTS.MESSAGE,
        expect.any(Uint8Array)
      )
    } finally {
      guard.mockRestore()
    }
  })

  it('does not discard a rebuilt room after a delayed check of its predecessor', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Old', 'doc-old'))
    const { io, left } = createIo()
    const original = setup('socket-original', io)
    await original.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    const checks: Array<(current: boolean) => void> = []
    const guard = vi
      .spyOn(getFileDocStore(), 'isDocumentGenerationCurrent')
      .mockResolvedValue(true)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => checks.push(resolve)))
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => checks.push(resolve)))
    try {
      mockFetchFileDocSeed.mockResolvedValue(seedResult('# New', 'doc-new'))
      const first = setup('socket-first-new', io)
      const second = setup('socket-second-new', io)
      const firstJoin = first.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
      const secondJoin = second.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 3 })
      await vi.waitFor(() => expect(checks).toHaveLength(2))
      checks[0](false)
      await firstJoin
      checks[1](false)
      await secondJoin

      expect(joinSuccessFileId(first.socket)).toBe('file-1')
      expect(joinSuccessFileId(second.socket)).toBe('file-1')
      expect(left).toContainEqual({ socketId: 'socket-original', room: ROOM_NAME })
      expect(left).not.toContainEqual({ socketId: 'socket-first-new', room: ROOM_NAME })
    } finally {
      guard.mockRestore()
    }
  })

  it('seeds once across concurrent joiners, and every one of them waits for that seed', async () => {
    // Keep the first seed fetch IN FLIGHT so the doc is still unseeded when the second socket joins:
    // that forces the dedup onto the in-flight seed rather than `isDocSeeded`. Both joins must WAIT
    // for it — a joiner answered before the seed would be handed an empty document and would then
    // watch the content arrive as a live update.
    let resolveSeed: (v: { update: Uint8Array; version: number } | null) => void = () => {}
    mockFetchFileDocSeed.mockReturnValueOnce(new Promise((resolve) => (resolveSeed = resolve)))
    const { io } = createIo()
    const a = setup('socket-a', io)
    const b = setup('socket-b', io)

    const joinA = a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    const joinB = b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    await flushMicrotasks()

    // The second join found the seed already in flight, so it does not start another one — and
    // neither join has been answered yet.
    expect(mockFetchFileDocSeed).toHaveBeenCalledTimes(1)
    expect(joinSuccessFileId(a.socket)).toBeUndefined()
    expect(joinSuccessFileId(b.socket)).toBeUndefined()

    resolveSeed(seedResult('# From server'))
    await Promise.all([joinA, joinB])
    expect(mockFetchFileDocSeed).toHaveBeenCalledTimes(1)

    // The joiner that never triggered the fetch is served the seeded document all the same.
    b.socket.emit.mockClear()
    b.handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc()))
    )
    const reply = b.socket.emit.mock.calls.find(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    const clientDoc = new Y.Doc()
    applySyncReply(reply?.[1] as Uint8Array, clientDoc)
    expect(clientDoc.getText(FILE_DOC_FIELD).toString()).toBe('# From server')
  })

  it('seeds an existing empty file with its accepted document identity', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('', 'empty-doc'))
    const { io } = createIo()
    const { socket, handlers } = setup('socket-1', io)

    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_SUCCESS,
      expect.objectContaining({ docId: 'empty-doc', version: 1 })
    )
    socket.emit.mockClear()
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc()))
    )
    const reply = socket.emit.mock.calls.find(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    const clientDoc = new Y.Doc()
    applySyncReply(reply?.[1] as Uint8Array, clientDoc)
    expect(clientDoc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag)).toBe(true)
    expect(clientDoc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)).toBe('empty-doc')
    expect(clientDoc.getText(FILE_DOC_FIELD).toString()).toBe('')
    clientDoc.destroy()
  })

  it('rejects a missing seed without publishing an editable blank room and releases its lock', async () => {
    mockFetchFileDocSeed.mockResolvedValueOnce(null)
    const { io, sent } = createIo()
    const { socket, handlers } = setup('socket-missing-seed', io)
    const release = vi.spyOn(getFileDocStore(), 'releaseSeedLock')
    const seed = vi.spyOn(getFileDocStore(), 'seedIfEmpty')
    try {
      await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
      expect(socket.emit).toHaveBeenCalledWith(
        FILE_DOC_EVENTS.JOIN_ERROR,
        expect.objectContaining({ code: 'NOT_FOUND', retryable: false })
      )
      expect(socket.emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.JOIN_SUCCESS, expect.anything())
      expect(socket.emit).not.toHaveBeenCalledWith(FILE_DOC_EVENTS.MESSAGE, expect.anything())
      expect(socket.join).not.toHaveBeenCalled()
      expect(sent.some(({ event }) => event === FILE_DOC_EVENTS.PRESENCE)).toBe(false)
      expect(seed).not.toHaveBeenCalled()
      expect(release).toHaveBeenCalledOnce()

      await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
      expect(socket.emit).toHaveBeenCalledWith(
        FILE_DOC_EVENTS.JOIN_SUCCESS,
        expect.objectContaining({ docId: 'doc-default' })
      )
    } finally {
      release.mockRestore()
      seed.mockRestore()
    }
  })

  it('makes one seed attempt and releases the guard on failure so a later join retries', async () => {
    mockFetchFileDocSeed
      .mockRejectedValueOnce(new Error('transport blip'))
      .mockResolvedValueOnce(seedResult('# Recovered'))
    const { io } = createIo()
    const { socket, handlers } = setup('socket-1', io)

    // First join: a single attempt that fails — no in-room retry loop.
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()
    expect(mockFetchFileDocSeed).toHaveBeenCalledTimes(1)

    // The guard was released, so a subsequent join re-attempts and this time the seed lands.
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    await flushMicrotasks()
    expect(mockFetchFileDocSeed).toHaveBeenCalledTimes(2)

    socket.emit.mockClear()
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc()))
    )
    const reply = socket.emit.mock.calls.find(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    const clientDoc = new Y.Doc()
    applySyncReply(reply?.[1] as Uint8Array, clientDoc)
    expect(clientDoc.getText(FILE_DOC_FIELD).toString()).toBe('# Recovered')
  })

  it('does not seed a room the joiner abandoned while the seed fetch was in flight', async () => {
    let resolveSeed: (v: { update: Uint8Array; version: number } | null) => void = () => {}
    mockFetchFileDocSeed.mockReturnValueOnce(new Promise((resolve) => (resolveSeed = resolve)))
    const { io } = createIo()
    const { socket, handlers } = setup('socket-1', io)

    const joining = handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()
    // The client leaves before the room finished assembling → the join aborts and drops the room it
    // was preparing (nothing else owns it).
    handlers[FILE_DOC_EVENTS.LEAVE]({ fileId: 'file-1' })
    // Resolving now must not touch the destroyed doc or throw (liveness re-check after the await).
    resolveSeed(seedResult('# Too late'))
    await expect(joining).resolves.toBeUndefined()
    expect(joinSuccessFileId(socket)).toBeUndefined()
    expect(socket.join).not.toHaveBeenCalled()
  })

  it('attaches a client only once the document is whole — no empty sync, no frames before it', async () => {
    // The room assembles itself into the same doc that fans updates out to its room, so a socket
    // attached mid-assembly receives the document's history rather than the document. Nothing about
    // the client exists in the room until the seed has landed: no membership, no sync, and any frame
    // it sends meanwhile is not applied.
    let resolveSeed: (v: { update: Uint8Array; version: number } | null) => void = () => {}
    mockFetchFileDocSeed.mockReturnValueOnce(new Promise((resolve) => (resolveSeed = resolve)))
    const { io } = createIo()
    const { socket, handlers } = setup('socket-1', io)
    const joining = handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    expect(socket.join).not.toHaveBeenCalled()
    expect(joinSuccessFileId(socket)).toBeUndefined()
    expect(
      socket.emit.mock.calls.some(
        ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
      )
    ).toBe(false)

    // A document frame sent before the join was answered reaches an unbound socket and is dropped.
    const early = new Y.Doc()
    early.getText(FILE_DOC_FIELD).insert(0, 'too early')
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) =>
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(early))
      )
    )

    resolveSeed(seedResult('# Seeded'))
    await joining
    expect(joinSuccessFileId(socket)).toBe('file-1')

    // The first thing the client is served is the finished document — content and seed flag together.
    socket.emit.mockClear()
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc()))
    )
    const reply = socket.emit.mock.calls.find(
      ([event, payload]) => event === FILE_DOC_EVENTS.MESSAGE && payload instanceof Uint8Array
    )
    const clientDoc = new Y.Doc()
    applySyncReply(reply?.[1] as Uint8Array, clientDoc)
    expect(clientDoc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag)).toBe(true)
    expect(clientDoc.getText(FILE_DOC_FIELD).toString()).toBe('# Seeded')
  })

  it('merges a copilot edit into a seeded live room and relays it to editors', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Original'))
    const { io, sent } = createIo()
    const { handlers } = setup('socket-1', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks() // seed lands → room is seeded/live

    // The app returns a diff (here, an update introducing text) for the relay to apply.
    const diff = new Y.Doc()
    diff.getText(FILE_DOC_FIELD).insert(0, 'copilot content')
    mockFetchFileDocMerge.mockResolvedValue(Y.encodeStateAsUpdate(diff))
    sent.length = 0

    const result = await applyMarkdownToLiveFileDoc('file-1', '# Rewritten by copilot')

    expect(result).toBe('applied')
    expect(mockFetchFileDocMerge).toHaveBeenCalledWith(
      'file-1',
      expect.any(Uint8Array),
      '# Rewritten by copilot'
    )
    // Applying the diff fires doc.on('update') → the merge is broadcast to the whole room.
    expect(sent.some((m) => m.event === FILE_DOC_EVENTS.MESSAGE && m.target === ROOM_NAME)).toBe(
      true
    )
  })

  it('defers the content merge to an actively-streaming client (records version, no double-write)', async () => {
    // Two-writer duplication guard: while a client is streaming an agent edit into the shared doc
    // (agent frames flowing), a durable apply-edit merge must NOT also publish the same content — the
    // client's private shadow never observes this merge and would re-insert it. The merge still records
    // the durable version; once streaming stops it resumes and lands as a near-noop.
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Original'))
    const { io } = createIo()
    const { handlers } = setup('socket-1', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    // A client streams an agent frame → the room is now "actively streaming".
    const edit = new Y.Doc()
    edit.getText(FILE_DOC_FIELD).insert(0, 'agent streaming this live')
    handlers[FILE_DOC_EVENTS.MESSAGE](
      frame(FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST, (e) =>
        syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(edit))
      )
    )
    await flushMicrotasks()

    mockFetchFileDocMerge.mockResolvedValue(Y.encodeStateAsUpdate(new Y.Doc()))
    // The durable merge lands mid-stream: it must defer (record version) and skip the content diff.
    const result = await applyMarkdownToLiveFileDoc('file-1', '# Rewritten by copilot', {
      version: 100,
    })
    expect(result).toBe('applied')
    expect(mockFetchFileDocMerge).not.toHaveBeenCalled() // content deferred to the client

    // The recorded version is honored: a later stale merge is still rejected on it.
    expect(await applyMarkdownToLiveFileDoc('file-1', '# older', { version: 50 })).toBe('stale')
  })

  it('reports no-live-room (and does not call the app) when the file has no seeded room', async () => {
    const result = await applyMarkdownToLiveFileDoc('file-1', '# anything')
    expect(result).toBe('no-live-room')
    expect(mockFetchFileDocMerge).not.toHaveBeenCalled()
  })

  it('rejects a stale versioned merge (not newer than the synced version) without regressing the doc', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Original')) // seed version 1
    const { io } = createIo()
    const { handlers } = setup('socket-1', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    mockFetchFileDocMerge.mockResolvedValue(Y.encodeStateAsUpdate(new Y.Doc()))

    // A newer durable version lands and is recorded as the synced version.
    expect(await applyMarkdownToLiveFileDoc('file-1', '# newer', { version: 100 })).toBe('applied')
    mockFetchFileDocMerge.mockClear()

    // An older durable version arriving out of order (e.g. a concurrent write on another process) is
    // stale: skipped before any diff is computed, so the live doc never regresses to older content and
    // no diff is published that a later persist could write back.
    expect(await applyMarkdownToLiveFileDoc('file-1', '# older, stale', { version: 50 })).toBe(
      'stale'
    )
    // The same version is idempotent — also skipped.
    expect(await applyMarkdownToLiveFileDoc('file-1', '# same version', { version: 100 })).toBe(
      'stale'
    )
    expect(mockFetchFileDocMerge).not.toHaveBeenCalled()
  })

  it('serializes concurrent merges for the same file (second waits for the first)', async () => {
    mockFetchFileDocSeed.mockResolvedValue(seedResult('# Original'))
    const { io } = createIo()
    const { handlers } = setup('socket-1', io)
    await handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()

    // First merge is left in flight; the second must not start its own fetch until the first finishes.
    const noOpUpdate = Y.encodeStateAsUpdate(new Y.Doc())
    let resolveFirst: (v: Uint8Array) => void = () => {}
    mockFetchFileDocMerge
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(noOpUpdate)

    const first = applyMarkdownToLiveFileDoc('file-1', '# One')
    const second = applyMarkdownToLiveFileDoc('file-1', '# Two')
    await flushMicrotasks()
    expect(mockFetchFileDocMerge).toHaveBeenCalledTimes(1) // second is queued behind the first

    resolveFirst(noOpUpdate)
    await first
    await second
    // Only after the first resolved did the second run — and it snapshotted the post-first state.
    expect(mockFetchFileDocMerge).toHaveBeenCalledTimes(2)
  })

  it('relays a document update to every provider, including siblings on the sender socket', async () => {
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
    expect(relayed?.except).toBeUndefined()
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
    expect(b.socket.leave).toHaveBeenCalledWith(ROOM_NAME)
    expect(joinSuccessFileId(b.socket)).toBeUndefined()
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

  it('a socket owns MULTIPLE client ids (co-mounted providers) and relays awareness for each', async () => {
    // The shared workspace socket hosts one provider per collaborative view, so the chat file preview
    // and the standalone Files editor for the same file each JOIN with their own Yjs client id over ONE
    // socket. Ownership is per client id: BOTH announcements must relay. (The old one-owner-per-socket
    // model let the later JOIN overwrite the earlier, dropping its awareness — which broke the
    // single-writer agent-stream election, letting a peer also self-elect and duplicate streamed text.)
    const { io, sent } = createIo()
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 500 })
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 501 })
    expect(joinSuccessFileId(a.socket)).toBe('file-1')

    const relayedFor = (clientId: number) => {
      sent.length = 0
      a.handlers[FILE_DOC_EVENTS.MESSAGE](awarenessFrame(clientId, `c${clientId}`).frame)
      return sent.find(
        (m) =>
          m.event === FILE_DOC_EVENTS.MESSAGE &&
          (m.payload as Uint8Array)[0] === FILE_DOC_MESSAGE_TYPE.AWARENESS
      )
    }
    // The FIRST provider's client id (500) is still owned after the second joins — its awareness relays.
    expect(relayedFor(500)).toBeDefined()
    // The second provider's client id (501) relays too.
    expect(relayedFor(501)).toBeDefined()
    // A client id this socket does NOT own is still dropped (ownership is not blanket-allowed).
    expect(relayedFor(999)).toBeUndefined()
  })

  it('accepts concurrent joins from co-mounted providers for the same file', async () => {
    let resolveFirstAuth: (value: unknown) => void = () => {}
    mockAuthorizeRoom.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstAuth = resolve
      })
    )
    const { io } = createIo()
    const { socket, handlers } = setup('socket-a', io)

    const first = handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 500 })
    await Promise.resolve()
    const second = handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 501 })
    await second

    resolveFirstAuth({
      allowed: true,
      status: 200,
      workspaceId: 'ws-1',
      workspacePermission: 'write',
    })
    await first

    const acceptedClientIds = socket.emit.mock.calls
      .filter(([event]) => event === FILE_DOC_EVENTS.JOIN_SUCCESS)
      .map(([, payload]) => (payload as { clientId: number }).clientId)
    expect(acceptedClientIds).toEqual(expect.arrayContaining([500, 501]))
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

  it('drops a legacy frame that cannot fit the durable stream budget', async () => {
    const { io, sent } = createIo()
    const a = setup('socket-oversized-legacy', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    sent.length = 0

    expect(() =>
      a.handlers[FILE_DOC_EVENTS.MESSAGE](new Uint8Array(FILE_DOC_LIMITS.updateBytes + 65))
    ).not.toThrow()
    expect(sent).toHaveLength(0)
  })

  it('preflights the inner legacy update before applying a framing-sized overflow', async () => {
    const { io, sent } = createIo()
    const a = setup('socket-inner-oversized-legacy', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    sent.length = 0
    const oversized = frame(FILE_DOC_MESSAGE_TYPE.SYNC, (encoder) =>
      syncProtocol.writeUpdate(encoder, new Uint8Array(FILE_DOC_LIMITS.updateBytes + 1))
    )

    expect(() => a.handlers[FILE_DOC_EVENTS.MESSAGE](oversized)).not.toThrow()
    expect(sent).toHaveLength(0)
  })

  it('drops the document when the last editor leaves, re-seeding a fresh joiner from the server', async () => {
    const { io } = createIo()
    const a = setup('socket-a', io)
    await a.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await flushMicrotasks()
    cleanupFileDocForSocket('socket-a', io)

    // The room was dropped with its last owner: a fresh joiner starts a new document, so the server
    // is asked to seed it again (a stale in-memory doc is never reused across an empty gap).
    mockFetchFileDocSeed.mockClear()
    const b = setup('socket-b', io)
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    await flushMicrotasks()

    expect(b.socket.join).toHaveBeenCalledWith(ROOM_NAME)
    expect(mockFetchFileDocSeed).toHaveBeenCalledWith('ws-1', 'file-1')
  })

  it('aborts a join superseded by a newer join during authorization (no cross-binding)', async () => {
    const { io } = createIo()
    let resolveFirst: (v: unknown) => void = () => {}
    mockAuthorizeRoom
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({
        allowed: true,
        status: 200,
        workspacePermission: 'write',
        workspaceId: 'ws-1',
      })
    const s = setup('socket-a', io)

    const pending = s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-2', clientId: 1 })
    resolveFirst({
      allowed: true,
      status: 200,
      workspacePermission: 'write',
      workspaceId: 'ws-1',
    })
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
    resolveAuth({
      allowed: true,
      status: 200,
      workspacePermission: 'write',
      workspaceId: 'ws-1',
    })
    await pending

    expect(s.socket.join).not.toHaveBeenCalled()
    // No room leaked: a fresh joiner starts a new document and joins cleanly.
    const b = setup('socket-b', io)
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    expect(b.socket.join).toHaveBeenCalledWith(ROOM_NAME)
    expect(joinSuccessFileId(b.socket)).toBe('file-1')
  })

  it('does not abort an in-flight join when a leave for a different file arrives', async () => {
    const { io } = createIo()
    let resolveAuth: (v: unknown) => void = () => {}
    mockAuthorizeRoom.mockReturnValueOnce(new Promise((resolve) => (resolveAuth = resolve)))
    const s = setup('socket-a', io)

    const pending = s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-2', clientId: 1 })
    // A stale leave for a DIFFERENT file must not invalidate the in-flight join.
    s.handlers[FILE_DOC_EVENTS.LEAVE]({ fileId: 'file-1' })
    resolveAuth({
      allowed: true,
      status: 200,
      workspacePermission: 'write',
      workspaceId: 'ws-1',
    })
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

    resolveAuth({
      allowed: true,
      status: 200,
      workspacePermission: 'write',
      workspaceId: 'ws-1',
    })
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

  it('leaves the previous document when a socket switches files', async () => {
    const { io, sent } = createIo()
    const s = setup('socket-a', io)
    await s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 1 })
    await s.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-2', clientId: 1 })

    expect(s.socket.leave).toHaveBeenCalledWith('workspace-file-doc:file-1')
    expect(s.socket.join).toHaveBeenCalledWith('workspace-file-doc:file-2')

    // file-1's room was dropped (socket-a was its only owner): a fresh joiner of file-1 starts a new
    // document, so the server is asked to seed it again.
    await flushMicrotasks()
    mockFetchFileDocSeed.mockClear()
    const b = setup('socket-b', io)
    await b.handlers[FILE_DOC_EVENTS.JOIN]({ fileId: 'file-1', clientId: 2 })
    await flushMicrotasks()
    expect(b.socket.join).toHaveBeenCalledWith('workspace-file-doc:file-1')
    expect(mockFetchFileDocSeed).toHaveBeenCalledWith('ws-1', 'file-1')
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
    expect(a.socket.leave).toHaveBeenCalledWith('workspace-file-doc:file-2')
    expect(joinSuccessFileId(a.socket)).toBe('file-1')
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
