/**
 * @vitest-environment node
 *
 * The join's readiness contract, with the shared store ENABLED (`file-doc.test.ts` runs it disabled).
 *
 * A room loads its document from the file's Redis stream one entry at a time, into the same `Y.Doc`
 * that fans every update out to the room. So a client attached while that is happening is not sent the
 * document — it is sent the document's history, and it watches the history replay on screen (reload
 * right after moving a block and the block moves again in front of you). These tests pin the fix: the
 * join waits for the room to hold the whole document, so the client's first sync is authoritative.
 */
import {
  FILE_DOC_EVENTS,
  FILE_DOC_MESSAGE_TYPE,
  FILE_DOC_SCHEMA_VERSION,
  FILE_DOC_SEED,
} from '@sim/realtime-protocol/file-doc'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import type { IRoomManager } from '@/rooms'

const { mockAuthorizeRoom, mockFetchFileDocSeed } = vi.hoisted(() => ({
  mockAuthorizeRoom: vi.fn(),
  mockFetchFileDocSeed: vi.fn(),
}))

vi.mock('@sim/platform-authz/rooms', () => ({ authorizeRoom: mockAuthorizeRoom }))

vi.mock('@/handlers/file-doc-app', () => ({
  fetchFileDocSeed: mockFetchFileDocSeed,
  fetchFileDocMerge: vi.fn(),
  fetchFileDocPersist: vi.fn().mockResolvedValue({ status: 'persisted', version: 1 }),
}))

/** One in-memory Redis backing per test — only the stream/lock ops the store actually uses. */
const backing = vi.hoisted(() => ({
  streams: new Map<string, { id: string; message: Record<string, string> }[]>(),
  kv: new Map<string, string>(),
  seq: 0,
  /** Ticks of event-loop delay each xRange takes, modelling a remote (cross-region) Redis. */
  readDelayTicks: 0,
}))

const seqOf = (id: string) => Number(id.split('-')[0])

vi.mock('redis', () => {
  const makeClient = (): Record<string, unknown> => {
    const client: Record<string, unknown> = {
      connect: async () => {},
      quit: async () => {},
      on: () => client,
      duplicate: () => makeClient(),
      xAdd: async (key: string, _star: string, fields: Record<string, string>) => {
        const id = `${++backing.seq}-0`
        const arr = backing.streams.get(key) ?? []
        arr.push({ id, message: { ...fields } })
        backing.streams.set(key, arr)
        return id
      },
      xRange: async (key: string) => {
        for (let i = 0; i < backing.readDelayTicks; i++) await Promise.resolve()
        return (backing.streams.get(key) ?? []).map((e) => ({ ...e }))
      },
      xRevRange: async (key: string) =>
        [...(backing.streams.get(key) ?? [])]
          .reverse()
          .slice(0, 1)
          .map((entry) => ({ ...entry })),
      xLen: async (key: string) => (backing.streams.get(key) ?? []).length,
      xRead: async (streams: { key: string; id: string }[], options?: { COUNT?: number }) => {
        const res: { name: string; messages: { id: string; message: Record<string, string> }[] }[] =
          []
        for (const { key, id } of streams) {
          const after = (backing.streams.get(key) ?? [])
            .filter((e) => seqOf(e.id) > seqOf(id))
            .slice(0, options?.COUNT)
          if (after.length) res.push({ name: key, messages: after.map((e) => ({ ...e })) })
        }
        if (res.length) return res
        await new Promise((r) => setTimeout(r, 5))
        return null
      },
      set: async (key: string, val: string, opts?: { NX?: boolean }) => {
        if (opts?.NX && backing.kv.has(key)) return null
        backing.kv.set(key, val)
        return 'OK'
      },
      eval: async (script: string, opts: { keys: string[]; arguments: string[] }) => {
        const [key] = opts.keys
        if (script.includes('xlen')) {
          const [field, value] = opts.arguments
          const arr = backing.streams.get(key) ?? []
          if (arr.length > 0) return 0
          arr.push({ id: `${++backing.seq}-0`, message: { [field]: value } })
          backing.streams.set(key, arr)
          return 1
        }
        const [token] = opts.arguments
        if (backing.kv.get(key) === token) {
          backing.kv.delete(key)
          return 1
        }
        return 0
      },
      expire: async () => 1,
      get: async (key: string) => backing.kv.get(key) ?? null,
      exists: async (key: string) => (backing.kv.has(key) ? 1 : 0),
    }
    return client
  }
  return { createClient: () => makeClient() }
})

import { cleanupFileDocForSocket, setupWorkspaceFileDocHandlers } from '@/handlers/file-doc'
import { getFileDocStore, initFileDocStore } from '@/handlers/file-doc-store'

const FILE_ID = 'file-1'
const ROOM_NAME = `workspace-file-doc:${FILE_ID}`
const STREAM_KEY = `filedoc:stream:${ROOM_NAME}`
const FIELD = 'default'

type Handler = (payload?: unknown) => Promise<void> | void

interface FakeSocket {
  id: string
  emit: (event: string, payload: unknown) => void
  rooms: Set<string>
}

/**
 * An `io` that actually DELIVERS: a room emit reaches every socket that joined that room, so a frame
 * the relay fans out mid-assembly lands on the joiner's `emit` exactly as it would in the browser.
 * Recording the emits without routing them would hide the very thing these tests are about.
 */
function createIo(sockets: FakeSocket[]) {
  const emitTo = (target: string, except: string | null, event: string, payload: unknown) => {
    for (const socket of sockets) {
      if (socket.id === except || !socket.rooms.has(target)) continue
      socket.emit(event, payload)
    }
  }
  const to = vi.fn((target: string) => ({
    except: (exclude: string) => ({
      emit: (event: string, payload: unknown) => emitTo(target, exclude, event, payload),
    }),
    emit: (event: string, payload: unknown) => emitTo(target, null, event, payload),
  }))
  return {
    to,
    in: vi.fn(() => ({ socketsLeave: () => {} })),
    local: { to },
  } as unknown as IRoomManager['io']
}

function setup(id: string, sockets: FakeSocket[]) {
  const handlers: Record<string, Handler> = {}
  const rooms = new Set<string>()
  const socket = {
    id,
    userId: 'user-1',
    userName: 'Test User',
    userImage: 'avatar.png',
    disconnected: false,
    rooms,
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handler
    }),
    emit: vi.fn(),
    join: vi.fn((name: string) => rooms.add(name)),
    leave: vi.fn((name: string) => rooms.delete(name)),
  }
  sockets.push(socket as unknown as FakeSocket)
  setupWorkspaceFileDocHandlers(
    socket as unknown as Parameters<typeof setupWorkspaceFileDocHandlers>[0],
    { isReady: () => true, io: createIo(sockets) } as unknown as IRoomManager
  )
  return { socket, handlers }
}

/** Append a Yjs update to the file's stream, exactly as `publish`/`seedIfEmpty` would. */
function appendToStream(update: Uint8Array): void {
  const arr = backing.streams.get(STREAM_KEY) ?? []
  arr.push({ id: `${++backing.seq}-0`, message: { u: Buffer.from(update).toString('base64') } })
  backing.streams.set(STREAM_KEY, arr)
}

/**
 * A warm room's history: the seed, then a later edit — the "I moved a block, then reloaded" case.
 * Returns the markdown-equivalent text of each state.
 */
function seedWarmStreamHistory(): { intermediate: string; final: string } {
  const doc = new Y.Doc()
  doc.getText(FIELD).insert(0, 'AAA')
  doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
  appendToStream(Y.encodeStateAsUpdate(doc))
  const afterSeed = Y.encodeStateVector(doc)
  doc.getText(FIELD).insert(0, 'BBB')
  appendToStream(Y.encodeStateAsUpdate(doc, afterSeed))
  doc.destroy()
  return { intermediate: 'AAA', final: 'BBBAAA' }
}

/** Every document state this socket was ever shown, in order. */
function statesDeliveredTo(socket: { emit: ReturnType<typeof vi.fn> }): string[] {
  const clientDoc = new Y.Doc()
  const states: string[] = []
  for (const [event, payload] of socket.emit.mock.calls) {
    if (event !== FILE_DOC_EVENTS.MESSAGE || !(payload instanceof Uint8Array)) continue
    const decoder = decoding.createDecoder(payload)
    if (decoding.readVarUint(decoder) !== FILE_DOC_MESSAGE_TYPE.SYNC) continue
    syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), clientDoc, null)
    const text = clientDoc.getText(FIELD).toString()
    if (text !== (states.at(-1) ?? '')) states.push(text)
  }
  clientDoc.destroy()
  return states
}

/** Let anything the join left running (a catch-up, a seed) settle, so a frame it fans out afterwards
 *  is counted — that late delivery IS the replay these tests exist to rule out. */
async function flushPendingWork(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** Ask the server for its state the way a client does after the join ack. */
function requestSyncStep2(handlers: Record<string, Handler>): void {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, FILE_DOC_MESSAGE_TYPE.SYNC)
  syncProtocol.writeSyncStep1(encoder, new Y.Doc())
  handlers[FILE_DOC_EVENTS.MESSAGE](encoding.toUint8Array(encoder))
}

describe('file-doc join readiness (shared store enabled)', () => {
  /** Every socket the test created, so a room emit can be routed to its members. */
  const sockets: FakeSocket[] = []

  // One store for the whole file: `initFileDocStore` is idempotent once enabled, so a per-test
  // shutdown would leave every later test running against a store with closed clients.
  beforeAll(async () => {
    await initFileDocStore('redis://fake')
  })

  afterAll(async () => {
    await getFileDocStore().shutdown()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    backing.streams.clear()
    backing.kv.clear()
    backing.seq = 0
    backing.readDelayTicks = 0
    mockAuthorizeRoom.mockResolvedValue({
      allowed: true,
      status: 200,
      workspaceId: 'ws-1',
      workspacePermission: 'write',
    })
    mockFetchFileDocSeed.mockResolvedValue(null)
  })

  afterEach(() => {
    cleanupFileDocForSocket('socket-1', createIo(sockets), true)
    sockets.length = 0
  })

  it('hands a joiner the final document, never the room history it was rebuilt from', async () => {
    const { intermediate, final } = seedWarmStreamHistory()
    // The catch-up read is not instantaneous — the case that made this visible is a cross-region Redis.
    backing.readDelayTicks = 6
    const { socket, handlers } = setup('socket-1', sockets)

    await handlers[FILE_DOC_EVENTS.JOIN]({
      fileId: FILE_ID,
      clientId: 1,
      schemaVersion: FILE_DOC_SCHEMA_VERSION,
    })
    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_SUCCESS,
      expect.objectContaining({ fileId: FILE_ID, schemaVersion: FILE_DOC_SCHEMA_VERSION })
    )
    requestSyncStep2(handlers)
    await flushPendingWork()

    // One state, and it is the final one: the client never saw the pre-move document.
    expect(statesDeliveredTo(socket)).toEqual([final])
    expect(statesDeliveredTo(socket)).not.toContain(intermediate)
  })

  it('does not fetch a seed for a room the stream can already reconstruct', async () => {
    seedWarmStreamHistory()
    const { socket, handlers } = setup('socket-1', sockets)

    await handlers[FILE_DOC_EVENTS.JOIN]({
      fileId: FILE_ID,
      clientId: 1,
      schemaVersion: FILE_DOC_SCHEMA_VERSION,
    })
    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_SUCCESS,
      expect.objectContaining({ fileId: FILE_ID, schemaVersion: FILE_DOC_SCHEMA_VERSION })
    )

    expect(mockFetchFileDocSeed).not.toHaveBeenCalled()
  })

  it('pulls a seed another writer put in the stream instead of waiting for the tailer to push it', async () => {
    // The seed lock is held by a writer whose room has since been dropped (a fast open→close on a
    // freshly created file), and its seed lands in the stream. Waiting to be told about it is what
    // left a new file un-editable until the client's readiness deadline lapsed; the join reads it.
    backing.kv.set(`filedoc:seedlock:${ROOM_NAME}`, 'held-by-a-writer-that-is-gone')
    const doc = new Y.Doc()
    doc.getText(FIELD).insert(0, 'seeded by the writer that held the lock')
    doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
    appendToStream(Y.encodeStateAsUpdate(doc))
    doc.destroy()

    const { socket, handlers } = setup('socket-1', sockets)
    await handlers[FILE_DOC_EVENTS.JOIN]({
      fileId: FILE_ID,
      clientId: 1,
      schemaVersion: FILE_DOC_SCHEMA_VERSION,
    })
    expect(socket.emit).toHaveBeenCalledWith(
      FILE_DOC_EVENTS.JOIN_SUCCESS,
      expect.objectContaining({ fileId: FILE_ID, schemaVersion: FILE_DOC_SCHEMA_VERSION })
    )
    requestSyncStep2(handlers)
    await flushPendingWork()

    expect(mockFetchFileDocSeed).not.toHaveBeenCalled()
    expect(statesDeliveredTo(socket)).toEqual(['seeded by the writer that held the lock'])
  })
})
