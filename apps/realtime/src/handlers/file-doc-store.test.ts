/**
 * @vitest-environment node
 */
import { sleep } from '@sim/utils/helpers'
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
  /** Set to fail every xRead the way node-redis does once a client has been closed. */
  readerClosed: boolean
  /** Failed reads served, so a test can prove the loop is not spinning at the read cadence. */
  reads: number
  /** When each FAILED read was attempted, so a test can measure one backoff interval exactly. */
  failedReadTimes: number[]
  /** Reads that returned (the idle steady state) — the event that ends a failure streak. */
  idleReads: number
  /** `connect()` calls, so a test can prove a closed reader is re-opened rather than abandoned. */
  connects: number
}

const state = vi.hoisted(() => ({ backing: null as Backing | null }))

const seqOf = (id: string) => Number(id.split('-')[0])

function makeClient(): any {
  const b = () => {
    if (!state.backing) throw new Error('backing not initialized')
    return state.backing
  }
  const client: any = {
    isOpen: true,
    connect: async () => {
      client.isOpen = true
      b().connects++
    },
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
      b().reads++
      if (b().readerClosed) {
        b().failedReadTimes.push(Date.now())
        client.isOpen = false
        throw new Error('The client is closed')
      }
      const res: { name: string; messages: { id: string; message: Record<string, string> }[] }[] =
        []
      for (const { key, id } of streams) {
        const after = (b().streams.get(key) ?? []).filter((e) => seqOf(e.id) > seqOf(id))
        if (after.length) res.push({ name: key, messages: after.map((e) => ({ ...e })) })
      }
      if (res.length) {
        b().idleReads++
        return res
      }
      await sleep(5)
      b().idleReads++
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
    eval: async (script: string, opts: { keys: string[]; arguments: string[] }) => {
      const [key] = opts.keys
      // Atomic seed-if-empty (SEED_IF_EMPTY_SCRIPT): append the entry iff the stream is empty, in one
      // synchronous step — mirroring Redis's atomic Lua execution, so two concurrent evals can never both
      // append (the second sees a non-empty stream).
      if (script.includes('xlen')) {
        const [field, value] = opts.arguments
        const arr = b().streams.get(key) ?? []
        if (arr.length > 0) return 0
        const id = `${++b().seq}-0`
        arr.push({ id, message: { [field]: value } })
        b().streams.set(key, arr)
        return 1
      }
      // Compare-and-delete Lua (RELEASE_LOCK_SCRIPT): del only if the stored value matches the token.
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

import { FileDocStore, REDIS_AGENT_ORIGIN, REDIS_ORIGIN } from '@/handlers/file-doc-store'

const REDIS_URL = 'redis://fake'

interface StoreRoomInternals {
  lastId: string
  pendingDeltas: Map<string, number>
  realEdited: boolean
  publishes: number
  compactRetryAfter: number
  doc: Y.Doc
  seededObserved: boolean
}

interface FileDocStoreInternals {
  rooms: Map<string, StoreRoomInternals>
  applyEntry(room: StoreRoomInternals, id: string, message: Record<string, string>): void
  appendUpdate(name: string, update: Uint8Array, agent?: boolean): Promise<void>
  write: { xTrim: (...args: unknown[]) => Promise<unknown> }
  maybeCompact(name: string, force?: boolean): Promise<void>
}

/** Reaches the private state these tests assert on, without `any`. */
function internals(store: object): FileDocStoreInternals {
  return store as unknown as FileDocStoreInternals
}

const COMPACT_THRESHOLD_ENTRIES = 400
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
    state.backing = {
      streams: new Map(),
      kv: new Map(),
      seq: 0,
      failXAdd: 0,
      readerClosed: false,
      reads: 0,
      failedReadTimes: [],
      idleReads: 0,
      connects: 0,
    }
    stores = []
  })

  afterEach(async () => {
    await Promise.all(stores.map((s) => s.shutdown()))
  })

  /**
   * A connection that stops serving reads used to spin the tailer at the read cadence — two attempts a
   * second, one warning each, forever — while the task quietly stopped converging with every other one.
   * The loop must back off instead, and re-open a client that was closed rather than reading a dead one.
   */
  it('backs off and re-opens the reader when its connection is closed, instead of spinning', async () => {
    const store = await newStore()
    const doc = new Y.Doc()
    await store.attachRoom(NAME, doc)
    state.backing!.readerClosed = true

    state.backing!.connects = 0 // ignore the two `init` connects; count only recovery attempts
    const before = state.backing!.reads
    await sleep(3000)
    const attempts = state.backing!.reads - before

    // A fixed 500ms retry manages 6–7 attempts in this window; backing off (500 → 1s → 2s → …) manages
    // about 3. Exact counts are timing-dependent, so assert the property — it slowed down — not a number.
    expect(attempts).toBeGreaterThan(0)
    expect(attempts).toBeLessThanOrEqual(4)
    // …and it tried to bring the connection back rather than leaving the tailer dead forever.
    expect(state.backing!.connects).toBeGreaterThan(0)
    doc.destroy()
  })

  /**
   * The streak has to end on a read that RETURNS, not on one that carries messages: a blocking read
   * timing out with nothing new is the idle steady state. Counting only message-bearing reads would
   * keep a healed outage's streak alive through normal polling, so the next unrelated blip would open
   * at the backoff cap — minutes of unnecessary split-brain — and log a count it never earned.
   */
  it('ends the failure streak on an idle read, so a later blip starts over', async () => {
    const store = await newStore()
    const doc = new Y.Doc()
    await store.attachRoom(NAME, doc)

    // Build a streak of two failures (the retries back off ~0.5s, then ~1s).
    state.backing!.readerClosed = true
    await vi.waitFor(
      () => expect(state.backing!.failedReadTimes.length).toBeGreaterThanOrEqual(2),
      {
        timeout: 5000,
        interval: 25,
      }
    )

    // Redis comes back. Wait for a read to actually RETURN — waiting a fixed span instead is a race:
    // the pending backoff can outlast it, no idle read lands, and the streak survives into the phase
    // below, which then measures the wrong backoff and fails. That is an event, so wait on the event.
    state.backing!.readerClosed = false
    const idleBefore = state.backing!.idleReads
    await vi.waitFor(() => expect(state.backing!.idleReads).toBeGreaterThan(idleBefore), {
      timeout: 5000,
      interval: 25,
    })

    // A fresh blip must retry at the START of the backoff curve, not partway up it. Assert the DELAY
    // itself: counting attempts inside a fixed window cannot tell the two apart, because the jittered
    // delay for a carried streak (1.6–2.4s) overlaps any window wide enough to catch a reset one.
    // Measure FAILURE to FAILURE so the sample is exactly one backoff — a straggler successful read
    // landing just after the flag flips would otherwise become the first sample and pass trivially.
    state.backing!.readerClosed = true
    state.backing!.failedReadTimes.length = 0
    await vi.waitFor(
      () => expect(state.backing!.failedReadTimes.length).toBeGreaterThanOrEqual(2),
      {
        timeout: 6000,
        interval: 25,
      }
    )
    const [first, second] = state.backing!.failedReadTimes

    // Streak reset ⇒ the first delay is 500ms ±20% ⇒ at most 600ms. Streak carried over ⇒ it is the
    // third delay, 2000ms ±20% ⇒ at least 1600ms. The bound sits between them with room on both
    // sides, so a loaded machine stretching the short sleep does not flip the verdict.
    expect(second - first).toBeLessThan(1200)
    doc.destroy()
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
    // two peer entries. Inject that lagging room directly (a real edit was integrated → realEdited).
    internals(a).rooms.set(NAME, {
      doc: new Y.Doc(),
      lastId: '400-0',
      publishes: 0,
      compactRetryAfter: 0,
      pendingDeltas: new Map(),
      seededObserved: true,
      realEdited: true,
    })
    await internals(a).maybeCompact(NAME)

    // A fresh catch-up must still reconstruct the peer content — compaction must not have trimmed 401/402.
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await a.getStreamState(NAME))!)
    expect(doc.getText('body').toString()).toBe('PEER1PEER2')
    doc.destroy()

    // The appended snapshot entry must carry the snapshot marker, so a fresh catch-up task treats it as
    // edited content (not a bare seed) and persists on last-disconnect.
    const stream = state.backing!.streams.get(streamKey)!
    expect(stream[stream.length - 1].message.s).toBe('1')
  })

  it('tags an agent-streamed frame so a peer tailer applies it as REDIS_AGENT_ORIGIN (never persisted)', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const a = await newStore()
    const b = await newStore()
    const bDoc = new Y.Doc()
    // Capture the origin the tailer stamps each applied entry with — the persistence gate keys off it.
    const origins: unknown[] = []
    bDoc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
    await b.attachRoom(NAME, bDoc)

    // A normal edit tails as REDIS_ORIGIN (a peer edit that CAN be persisted).
    a.publish(NAME, updateFor('user edit'))
    await vi.waitFor(() => expect(origins).toContain(REDIS_ORIGIN), { timeout: 2000 })

    // An agent-streamed frame is published WITH the agent flag: the stream entry carries the marker, and
    // the peer tailer applies it as REDIS_AGENT_ORIGIN — excluded from the relay's edited/persist gate.
    a.publish(NAME, updateFor('agent frame'), true)
    await vi.waitFor(() => expect(origins).toContain(REDIS_AGENT_ORIGIN), { timeout: 2000 })
    const stream = state.backing!.streams.get(streamKey)!
    expect(stream.some((e) => e.message.a === '1')).toBe(true)
    // The normal edit's entry carries no agent marker.
    expect(stream.filter((e) => e.message.a === '1')).toHaveLength(1)
    bDoc.destroy()
  })

  it('latches realEdited synchronously so a concurrent compaction can never mislabel a real edit', async () => {
    // The data-loss race: a real edit sits in room.doc synchronously, but if realEdited were set only
    // AFTER appendUpdate's awaits, a concurrent agent-triggered compaction could snapshot that content and
    // stamp it an agent (no-persist) frame — losing the edit. The latch must be set in the same tick.
    const a = await newStore()
    const doc = new Y.Doc()
    await a.attachRoom(NAME, doc)
    const room = internals(a).rooms.get(NAME)!
    expect(room.realEdited).toBe(false)
    // Kick off a real (non-agent) append but do NOT await it: realEdited must already be true before the
    // xAdd/expire awaits resolve, so any compaction racing on the awaits sees the real edit.
    const pending = internals(a).appendUpdate(NAME, updateFor('real user edit'))
    expect(room.realEdited).toBe(true)
    await pending
    doc.destroy()
  })

  it('compacts on appended bytes, before the entry threshold is anywhere near reached', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const a = await newStore()
    const doc = new Y.Doc()
    await a.attachRoom(NAME, doc)

    // A handful of large pastes: far below COMPACT_THRESHOLD entries, far above the byte ceiling.
    // Before bytes were counted this stream held tens of megabytes and never compacted.
    const updates: Uint8Array[] = []
    doc.on('update', (u: Uint8Array) => updates.push(u))
    for (let i = 0; i < 4; i++) {
      doc.getText('body').insert(0, 'x'.repeat(3 * 1024 * 1024))
    }
    for (const update of updates) {
      await a.publishAndWait(NAME, update)
    }

    await vi.waitFor(
      () => {
        const stream = state.backing!.streams.get(streamKey)!
        expect(stream.length).toBeLessThan(COMPACT_THRESHOLD_ENTRIES)
        expect(stream.some((entry) => entry.message.s === '1')).toBe(true)
      },
      { timeout: 5000 }
    )

    // Compaction must be lossless: the whole document is still reconstructable from what remains.
    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, (await a.getStreamState(NAME))!)
    expect(rebuilt.getText('body').length).toBe(4 * 3 * 1024 * 1024)
    rebuilt.destroy()
    doc.destroy()
  })

  it('does not re-compact on every publish once the document itself exceeds the byte ceiling', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const a = await newStore()
    const doc = new Y.Doc()
    await a.attachRoom(NAME, doc)

    const updates: Uint8Array[] = []
    doc.on('update', (u: Uint8Array) => updates.push(u))
    // Grow the document past the byte ceiling so its own snapshot exceeds it, then keep editing.
    // Counting the snapshot as appended bytes would leave the threshold permanently breached and
    // force a full snapshot append per keystroke — the amplification the threshold exists to stop.
    doc.getText('body').insert(0, 'x'.repeat(12 * 1024 * 1024))
    for (let i = 0; i < 30; i++) doc.getText('body').insert(0, 'tiny')
    for (const update of updates) {
      await a.publishAndWait(NAME, update)
    }
    await vi.waitFor(() => {
      const stream = state.backing!.streams.get(streamKey)!
      expect(stream.some((entry) => entry.message.s === '1')).toBe(true)
    })

    const snapshots = state
      .backing!.streams.get(streamKey)!
      .filter((entry) => entry.message.s === '1').length
    expect(snapshots).toBeLessThanOrEqual(2)

    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, (await a.getStreamState(NAME))!)
    expect(rebuilt.getText('body').toString().startsWith('tiny')).toBe(true)
    expect(rebuilt.getText('body').length).toBe(12 * 1024 * 1024 + 30 * 4)
    rebuilt.destroy()
    doc.destroy()
  })

  it('keeps the byte trigger armed when compaction fails', async () => {
    const a = await newStore()
    const doc = new Y.Doc()
    await a.attachRoom(NAME, doc)
    const room = internals(a).rooms.get(NAME)!
    room.pendingDeltas = new Map([['1-0', 9 * 1024 * 1024]])
    room.realEdited = true

    const write = internals(a).write
    const original = write.xTrim.bind(write)
    write.xTrim = async () => {
      throw new Error('redis blip')
    }
    await internals(a).maybeCompact(NAME, true)

    // A failed fold must not disarm the trigger — otherwise the stream stays oversized until
    // this task happens to append another full threshold's worth of deltas.
    expect([...room.pendingDeltas]).toEqual([['1-0', 9 * 1024 * 1024]])

    // But it must not retry immediately either: the snapshot XADD lands before the XTRIM, so a
    // persistent trim failure would append a full-document snapshot on every attempt.
    const snapshotsAfterFailure = state.backing!.streams.get(`filedoc:stream:${NAME}`)?.length ?? 0
    await internals(a).maybeCompact(NAME, true)
    await internals(a).maybeCompact(NAME, true)
    expect(state.backing!.streams.get(`filedoc:stream:${NAME}`)?.length ?? 0).toBe(
      snapshotsAfterFailure
    )

    write.xTrim = original
    doc.destroy()
  })

  it('keeps counting deltas the trim retained because they sit past the fold boundary', async () => {
    const a = await newStore()
    const doc = new Y.Doc()
    await a.attachRoom(NAME, doc)
    const room = internals(a).rooms.get(NAME)!
    room.realEdited = true
    // The tailer has integrated up to 5-0, so `MINID 5-0` retains both 5-0 (the boundary is
    // INCLUSIVE) and 9-0. Their bytes are still in Redis, and dropping them would disarm the
    // byte trigger while the stream kept growing.
    room.lastId = '5-0'
    room.pendingDeltas = new Map([
      ['3-0', 4 * 1024 * 1024],
      ['5-0', 6 * 1024 * 1024],
      ['9-0', 7 * 1024 * 1024],
    ])

    await internals(a).maybeCompact(NAME, true)

    expect([...room.pendingDeltas]).toEqual([
      ['5-0', 6 * 1024 * 1024],
      ['9-0', 7 * 1024 * 1024],
    ])
    doc.destroy()
  })

  it('adopts accounting for a stream it takes over, and folds it if already over the ceiling', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    // A stream left behind by a previous task: two entries, so far under the entry threshold, and
    // far over the byte ceiling. A fresh room starting from an empty ledger would never fold it,
    // while its own heartbeat kept refreshing the TTL.
    const seedDoc = new Y.Doc()
    const updates: Uint8Array[] = []
    seedDoc.on('update', (u: Uint8Array) => updates.push(u))
    seedDoc.getText('body').insert(0, 'x'.repeat(9 * 1024 * 1024))
    seedDoc.getText('body').insert(0, 'tail')
    state.backing!.streams.set(
      streamKey,
      updates.map((update, index) => ({
        id: `${index + 1}-0`,
        message: { u: Buffer.from(update).toString('base64') },
      }))
    )
    state.backing!.seq = updates.length

    const a = await newStore()
    const doc = new Y.Doc()
    await a.attachRoom(NAME, doc)

    // Either marker counts as a fold: this room only ever replayed entries, so it never observed
    // a real edit and its snapshot is stamped as an agent frame (the no-persist guarantee).
    await vi.waitFor(() => {
      const stream = state.backing!.streams.get(streamKey)!
      expect(stream.some((entry) => entry.message.s === '1' || entry.message.a === '1')).toBe(true)
    })

    // Lossless: the adopted content survives the fold it triggered.
    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, (await a.getStreamState(NAME))!)
    expect(rebuilt.getText('body').length).toBe(9 * 1024 * 1024 + 4)
    rebuilt.destroy()
    doc.destroy()
    seedDoc.destroy()
  })

  it('counts agent preview deltas, which share a marker with an agent-only snapshot', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    // Agent preview frames are the LARGE ones — a copilot file edit re-serialising a document is
    // what filled Redis. They carry the same marker as a fold of an agent-only stream, so keying
    // exclusion on that marker would drop exactly the payloads this bound exists for.
    const seedDoc = new Y.Doc()
    const updates: Uint8Array[] = []
    seedDoc.on('update', (u: Uint8Array) => updates.push(u))
    seedDoc.getText('body').insert(0, 'x'.repeat(9 * 1024 * 1024))
    seedDoc.getText('body').insert(0, 'tail')
    state.backing!.streams.set(
      streamKey,
      updates.map((update, index) => ({
        id: `${index + 1}-0`,
        message: { u: Buffer.from(update).toString('base64'), a: '1' },
      }))
    )
    state.backing!.seq = updates.length

    const a = await newStore()
    const doc = new Y.Doc()
    await a.attachRoom(NAME, doc)

    await vi.waitFor(() => {
      const stream = state.backing!.streams.get(streamKey)!
      expect(stream.some((entry) => entry.message.c === '1')).toBe(true)
    })

    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, (await a.getStreamState(NAME))!)
    expect(rebuilt.getText('body').length).toBe(9 * 1024 * 1024 + 4)
    rebuilt.destroy()
    doc.destroy()
    seedDoc.destroy()
  })

  it("never counts a fold's own output, so a large document cannot arm the trigger against itself", async () => {
    const a = await newStore()
    const doc = new Y.Doc()
    await a.attachRoom(NAME, doc)
    const room = internals(a).rooms.get(NAME)!

    internals(a).applyEntry(room, '7-0', { u: 'x'.repeat(9 * 1024 * 1024), a: '1', c: '1' })

    expect(room.pendingDeltas.has('7-0')).toBe(false)
    doc.destroy()
  })

  it('counts a delta published by a peer task, which this room only ever tails', async () => {
    const a = await newStore()
    const doc = new Y.Doc()
    await a.attachRoom(NAME, doc)
    const room = internals(a).rooms.get(NAME)!

    // Never published locally, so publish-side accounting would miss it entirely.
    internals(a).applyEntry(room, '4-0', { u: 'x'.repeat(1024) })

    expect(room.pendingDeltas.get('4-0')).toBe(1024)
    doc.destroy()
  })

  it('stamps a compaction snapshot of an agent-ONLY stream as an agent frame (never persisted)', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const noop = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64')
    // A doc whose content is purely agent preview (no real edit integrated) — realEdited stays false.
    const agentDoc = docWithText('agent-only preview body')
    const entries = Array.from({ length: 400 }, (_, i) => ({
      id: `${i + 1}-0`,
      message: { u: noop },
    }))
    state.backing!.streams.set(streamKey, entries)
    state.backing!.seq = 400

    const a = await newStore()
    internals(a).rooms.set(NAME, {
      doc: agentDoc,
      lastId: '400-0',
      publishes: 0,
      compactRetryAfter: 0,
      pendingDeltas: new Map(),
      seededObserved: true,
      realEdited: false,
    })
    await internals(a).maybeCompact(NAME)

    // The snapshot must carry the AGENT marker, NOT the snapshot marker, so a peer catch-up applies it as
    // REDIS_AGENT_ORIGIN and never marks the doc edited — the no-persist guarantee survives compaction.
    const stream = state.backing!.streams.get(streamKey)!
    const last = stream[stream.length - 1].message
    expect(last.a).toBe('1')
    expect(last.s).toBeUndefined()
    // Content is still fully reconstructable from the compacted stream.
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await a.getStreamState(NAME))!)
    expect(doc.getText('body').toString()).toBe('agent-only preview body')
    doc.destroy()
    agentDoc.destroy()
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

  it('seedIfEmpty writes the seed once and reports it, then refuses a non-empty stream', async () => {
    const a = await newStore()
    expect(await a.seedIfEmpty(NAME, updateFor('first'))).toBe(true)
    // A second seed attempt (any task) must be refused — the stream already holds content.
    const b = await newStore()
    expect(await b.seedIfEmpty(NAME, updateFor('second'))).toBe(false)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await a.getStreamState(NAME))!)
    expect(doc.getText('body').toString()).toBe('first')
    doc.destroy()
  })

  it('atomic seed prevents split-brain even when the seed lock expired mid-seed', async () => {
    // The exact split-brain precondition from the concurrency audit: the seed lock is only an efficiency
    // optimization, so if it lapses (TTL) while the stream is still empty, TWO tasks can both hold a
    // token and both try to seed with DIFFERENT docs (distinct Yjs client ids). The atomic seedIfEmpty
    // must still let only one land — otherwise the union duplicates content.
    const a = await newStore()
    const b = await newStore()
    const tokenA = await a.shouldSeed(NAME)
    expect(tokenA).toBeTruthy()
    // Simulate A's lock expiring mid-seed so B also wins the freed lock over a still-empty stream.
    state.backing!.kv.delete(`filedoc:seedlock:${NAME}`)
    const tokenB = await b.shouldSeed(NAME)
    expect(tokenB).toBeTruthy()
    // Both tasks now race to seed with distinct client ids.
    const [seededA, seededB] = await Promise.all([
      a.seedIfEmpty(NAME, updateFor('SEED-A')),
      b.seedIfEmpty(NAME, updateFor('SEED-B')),
    ])
    expect([seededA, seededB].filter(Boolean)).toHaveLength(1)
    // Exactly one seed is in the stream — the reconstructed text is a single seed, never a duplicated
    // union of both (e.g. 'SEED-ASEED-B').
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await a.getStreamState(NAME))!)
    expect(['SEED-A', 'SEED-B']).toContain(doc.getText('body').toString())
    doc.destroy()
  })

  it('a peer edit published during attachRoom catch-up is not lost', async () => {
    // Author two INCREMENTAL edits from one doc so they converge to 'basepeer' (not an independent union).
    const author = new Y.Doc()
    const updates: Uint8Array[] = []
    author.on('update', (u: Uint8Array) => updates.push(u))
    author.getText('body').insert(0, 'base')
    author.getText('body').insert(4, 'peer')

    const a = await newStore()
    a.publish(NAME, updates[0]) // 'base'
    await vi.waitFor(async () => expect(await a.getStreamState(NAME)).not.toBeNull())

    // Task B attaches; while its synchronous catch-up runs, task A publishes the second edit. The tailer
    // resumes from the id catch-up stopped at, so the edit converges rather than falling into a gap.
    const b = await newStore()
    const bDoc = new Y.Doc()
    const attach = b.attachRoom(NAME, bDoc)
    a.publish(NAME, updates[1]) // 'peer' appended
    await attach
    await vi.waitFor(() => expect(bDoc.getText('body').toString()).toBe('basepeer'), {
      timeout: 2000,
    })
    bDoc.destroy()
    author.destroy()
  })

  it('concurrent compaction on two tasks preserves the full document', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const noop = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64')

    // Two peer edits neither compacting task has integrated (id > each task's lastId).
    const peerDoc = new Y.Doc()
    const peerUpdates: Uint8Array[] = []
    peerDoc.on('update', (u: Uint8Array) => peerUpdates.push(u))
    peerDoc.getText('body').insert(0, 'PEER1')
    peerDoc.getText('body').insert(5, 'PEER2')

    const entries = Array.from({ length: 400 }, (_, i) => ({
      id: `${i + 1}-0`,
      message: { u: noop },
    }))
    entries.push({ id: '401-0', message: { u: Buffer.from(peerUpdates[0]).toString('base64') } })
    entries.push({ id: '402-0', message: { u: Buffer.from(peerUpdates[1]).toString('base64') } })
    state.backing!.streams.set(streamKey, entries)
    state.backing!.seq = 402

    // Two tasks whose local docs lag at DIFFERENT points (400 and 401): both cross the threshold and
    // compact concurrently. Each must only trim what its own snapshot subsumes, so the union of both
    // snapshots plus the un-integrated peer entries still reconstructs the whole doc.
    const a = await newStore()
    const b = await newStore()
    const docA = new Y.Doc()
    Y.applyUpdate(docA, peerUpdates[0]) // A integrated up to 401
    internals(a).rooms.set(NAME, {
      doc: docA,
      lastId: '401-0',
      publishes: 0,
      compactRetryAfter: 0,
      pendingDeltas: new Map(),
      seededObserved: true,
      realEdited: true,
    })
    internals(b).rooms.set(NAME, {
      doc: new Y.Doc(),
      lastId: '400-0',
      publishes: 0,
      compactRetryAfter: 0,
      pendingDeltas: new Map(),
      seededObserved: true,
      realEdited: true,
    })
    await Promise.all([internals(a).maybeCompact(NAME), internals(b).maybeCompact(NAME)])

    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await a.getStreamState(NAME))!)
    expect(doc.getText('body').toString()).toBe('PEER1PEER2')
    doc.destroy()
  })
})
