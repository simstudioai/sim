/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

/**
 * One shared in-memory Redis backing per test, so several {@link FileDocStore} instances (modelling
 * several ECS tasks) all talk to the "same Redis". A minimal fake of just the stream/lock ops the
 * store uses.
 */
interface Backing {
  streams: Map<string, { id: string; message: Record<string, string> }[]>
  kv: Map<string, string>
  seq: number
  /** Number of upcoming xAdd calls to fail with a transient error (to exercise publish retry). */
  failXAdd: number
}

const state = vi.hoisted(() => ({ backing: null as Backing | null }))

const seqOf = (id: string) => Number(id.split('-')[0])

function makeClient(): any {
  const b = () => {
    if (!state.backing) throw new Error('backing not initialized')
    return state.backing
  }
  const client: any = {
    connect: async () => {},
    quit: async () => {},
    on: () => client,
    duplicate: () => makeClient(),
    xAdd: async (key: string, _star: string, fields: Record<string, string>) => {
      if (b().failXAdd > 0) {
        b().failXAdd--
        throw new Error('transient xAdd failure')
      }
      const id = `${++b().seq}-0`
      const arr = b().streams.get(key) ?? []
      arr.push({ id, message: { ...fields } })
      b().streams.set(key, arr)
      return id
    },
    xRange: async (key: string) => (b().streams.get(key) ?? []).map((e) => ({ ...e })),
    xLen: async (key: string) => (b().streams.get(key) ?? []).length,
    xTrim: async (key: string, _strategy: string, minid: string) => {
      const arr = b().streams.get(key) ?? []
      b().streams.set(
        key,
        arr.filter((e) => seqOf(e.id) >= seqOf(minid))
      )
    },
    xRead: async (streams: { key: string; id: string }[]) => {
      const res: { name: string; messages: { id: string; message: Record<string, string> }[] }[] =
        []
      for (const { key, id } of streams) {
        const after = (b().streams.get(key) ?? []).filter((e) => seqOf(e.id) > seqOf(id))
        if (after.length) res.push({ name: key, messages: after.map((e) => ({ ...e })) })
      }
      if (res.length) return res
      await new Promise((r) => setTimeout(r, 5))
      return null
    },
    set: async (key: string, val: string, opts?: { NX?: boolean }) => {
      if (opts?.NX && b().kv.has(key)) return null
      b().kv.set(key, val)
      return 'OK'
    },
    del: async (key: string) => {
      b().kv.delete(key)
      return 1
    },
    // Compare-and-delete Lua (RELEASE_LOCK_SCRIPT): del only if the stored value matches the token.
    eval: async (_script: string, opts: { keys: string[]; arguments: string[] }) => {
      const [key] = opts.keys
      const [token] = opts.arguments
      if (b().kv.get(key) === token) {
        b().kv.delete(key)
        return 1
      }
      return 0
    },
    expire: async () => 1,
  }
  return client
}

vi.mock('redis', () => ({ createClient: () => makeClient() }))

import { FileDocStore } from '@/handlers/file-doc-store'

const REDIS_URL = 'redis://fake'
const NAME = 'workspace-file-doc:file-1'

function docWithText(text: string): Y.Doc {
  const doc = new Y.Doc()
  doc.getText('body').insert(0, text)
  return doc
}

/** The delta a doc emits when `text` is inserted — what the relay would `publish`. */
function updateFor(text: string): Uint8Array {
  const doc = docWithText(text)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

let stores: FileDocStore[] = []
async function newStore(): Promise<FileDocStore> {
  const store = new FileDocStore(REDIS_URL)
  await store.init()
  stores.push(store)
  return store
}

describe('FileDocStore', () => {
  beforeEach(() => {
    state.backing = { streams: new Map(), kv: new Map(), seq: 0, failXAdd: 0 }
    stores = []
  })

  afterEach(async () => {
    await Promise.all(stores.map((s) => s.shutdown()))
  })

  it('elects exactly one seeder across tasks (no split-brain seed)', async () => {
    const a = await newStore()
    const b = await newStore()
    // shouldSeed returns a lock token (truthy) for the winner, null for the loser.
    const [aTok, bTok] = await Promise.all([a.shouldSeed(NAME), b.shouldSeed(NAME)])
    expect([aTok, bTok].filter(Boolean)).toHaveLength(1)
  })

  it('does not re-seed once the stream already has content (stale lock)', async () => {
    const a = await newStore()
    const token = await a.shouldSeed(NAME)
    expect(token).toBeTruthy()
    // A seeds and releases its lock.
    a.publish(NAME, updateFor('hello'))
    await vi.waitFor(async () => expect(await a.getStreamState(NAME)).not.toBeNull())
    await a.releaseSeedLock(NAME, token as string)
    // A different task must NOT seed again — the lock is free but the stream is non-empty.
    const b = await newStore()
    expect(await b.shouldSeed(NAME)).toBeNull()
  })

  it('getStreamState reconstructs the shared document from the stream', async () => {
    const a = await newStore()
    a.publish(NAME, updateFor('shared content'))
    let state: Uint8Array | null = null
    await vi.waitFor(async () => {
      state = await a.getStreamState(NAME)
      expect(state).not.toBeNull()
    })
    const doc = new Y.Doc()
    Y.applyUpdate(doc, state!)
    expect(doc.getText('body').toString()).toBe('shared content')
    doc.destroy()
  })

  it('attachRoom catches a fresh task up to the current shared state', async () => {
    const a = await newStore()
    a.publish(NAME, updateFor('already here'))
    await vi.waitFor(async () => expect(await a.getStreamState(NAME)).not.toBeNull())

    // A second task opens the same file: its doc must load the existing content, not start empty.
    const b = await newStore()
    const doc = new Y.Doc()
    await b.attachRoom(NAME, doc)
    expect(doc.getText('body').toString()).toBe('already here')
    doc.destroy()
  })

  it('converges a peer task via the tailer after attach', async () => {
    const a = await newStore()
    const b = await newStore()
    const bDoc = new Y.Doc()
    await b.attachRoom(NAME, bDoc)

    // A publishes an edit; B's multiplexed reader must apply it to B's attached doc.
    a.publish(NAME, updateFor('from task A'))
    await vi.waitFor(() => expect(bDoc.getText('body').toString()).toBe('from task A'), {
      timeout: 2000,
    })
    bDoc.destroy()
  })

  it('compaction never trims peer entries the compacting task has not yet integrated', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const noop = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64')

    // Two peer edits published by ANOTHER task that this task's tailer has not read yet.
    const peerDoc = new Y.Doc()
    const peerUpdates: Uint8Array[] = []
    peerDoc.on('update', (u: Uint8Array) => peerUpdates.push(u))
    peerDoc.getText('body').insert(0, 'PEER1')
    peerDoc.getText('body').insert(5, 'PEER2')

    // Backing: 400 already-integrated (no-op) entries this task's doc reflects, then the 2 un-integrated
    // peer entries. Enough entries to cross COMPACT_THRESHOLD.
    const entries = Array.from({ length: 400 }, (_, i) => ({
      id: `${i + 1}-0`,
      message: { u: noop },
    }))
    entries.push({ id: '401-0', message: { u: Buffer.from(peerUpdates[0]).toString('base64') } })
    entries.push({ id: '402-0', message: { u: Buffer.from(peerUpdates[1]).toString('base64') } })
    state.backing!.streams.set(streamKey, entries)
    state.backing!.seq = 402

    const a = await newStore()
    // This task has integrated only up to entry 400 (all no-ops) — its local doc is empty and lags the
    // two peer entries. Inject that lagging room directly.
    ;(a as any).rooms.set(NAME, { doc: new Y.Doc(), lastId: '400-0', publishes: 0 })
    await (a as any).maybeCompact(NAME)

    // A fresh catch-up must still reconstruct the peer content — compaction must not have trimmed 401/402.
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await a.getStreamState(NAME))!)
    expect(doc.getText('body').toString()).toBe('PEER1PEER2')
    doc.destroy()
  })

  it('retries a transient append failure so the edit is not lost from the shared log', async () => {
    const a = await newStore()
    state.backing!.failXAdd = 2 // first two xAdd attempts throw; the third must succeed
    a.publish(NAME, updateFor('resilient'))
    await vi.waitFor(
      async () => {
        const doc = new Y.Doc()
        Y.applyUpdate(doc, (await a.getStreamState(NAME))!)
        expect(doc.getText('body').toString()).toBe('resilient')
        doc.destroy()
      },
      { timeout: 2000 }
    )
  })

  it('streamHasContent fences a seed apply against an already-seeded stream', async () => {
    const a = await newStore()
    expect(await a.streamHasContent(NAME)).toBe(false)
    a.publish(NAME, updateFor('seeded'))
    await vi.waitFor(async () => expect(await a.streamHasContent(NAME)).toBe(true))
  })

  it('serializes merges across tasks via the merge lock', async () => {
    const a = await newStore()
    const b = await newStore()
    const aTok = await a.acquireMergeSlot(NAME, 5_000)
    expect(aTok).toBeTruthy()
    // A holds it → B is refused until A releases.
    expect(await b.acquireMergeSlot(NAME, 5_000)).toBeNull()
    // A stale-holder release with the WRONG token must NOT free A's lock (compare-and-delete).
    await b.releaseMergeSlot(NAME, 'wrong-token')
    expect(await b.acquireMergeSlot(NAME, 5_000)).toBeNull()
    // A releases with its real token → B can now acquire.
    await a.releaseMergeSlot(NAME, aTok as string)
    const bTok = await b.acquireMergeSlot(NAME, 5_000)
    expect(bTok).toBeTruthy()
    await b.releaseMergeSlot(NAME, bTok as string)
  })

  it('is disabled without a REDIS_URL and behaves single-replica', async () => {
    const store = new FileDocStore(undefined)
    expect(store.enabled).toBe(false)
    // Seeds locally (returns a sentinel token), never touches a stream.
    expect(await store.shouldSeed(NAME)).toBeTruthy()
    expect(await store.getStreamState(NAME)).toBeNull()
    const doc = new Y.Doc()
    await store.attachRoom(NAME, doc) // no-op, no throw
    expect(doc.getText('body').toString()).toBe('')
    doc.destroy()
  })
})
