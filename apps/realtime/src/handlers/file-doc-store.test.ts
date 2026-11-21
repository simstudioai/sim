import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

vi.mock('redis', async () => {
  const { makeClient } = await import('@/handlers/fixtures/redis.fixture')
  return { createClient: () => makeClient() }
})

import { FileDocStore, REDIS_AGENT_ORIGIN, REDIS_ORIGIN } from '@/handlers/file-doc-store'
import { type Backing, createBacking, fakeRedis } from '@/handlers/fixtures/redis.fixture'

const REDIS_URL = 'redis://fake'
const NAME = 'workspace-file-doc:file-1'

interface StoreRoomTestAccess {
  doc: Y.Doc
  lastId: string
  publishes: number
  uncompactedDeltaBytes: number
  lastDeltaBytes: number
  compactRetryAfter: number
  compacting: boolean
  seededObserved: boolean
  realEdited: boolean
}

interface StoreTestAccess {
  rooms: Map<string, StoreRoomTestAccess>
  maybeCompact(name: string): Promise<void>
  appendUpdate(name: string, update: Uint8Array): Promise<void>
  applyEntry(
    name: string,
    room: StoreRoomTestAccess,
    id: string,
    message: Record<string, string>
  ): void
}

function storeInternals(store: FileDocStore): StoreTestAccess {
  return store as unknown as StoreTestAccess
}

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

function seedFor(text: string): Uint8Array {
  const doc = docWithText(text)
  const config = doc.getMap(FILE_DOC_SEED.configMap)
  config.set(FILE_DOC_SEED.flag, true)
  config.set(FILE_DOC_SEED.docIdKey, `doc-${text}`)
  try {
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

let stores: FileDocStore[] = []

/** The in-memory Redis behind every fake client; each test starts a fresh one. */
function currentBacking(): Backing {
  if (!fakeRedis.backing) throw new Error('backing not initialized')
  return fakeRedis.backing
}

/** An existing stream from a relay predating generation markers; modern seeds use seedIfEmpty. */
function seedLegacyStream(update = updateFor('')): void {
  const backing = currentBacking()
  backing.streams.set(`filedoc:stream:${NAME}`, [
    { id: `${++backing.seq}-0`, message: { u: Buffer.from(update).toString('base64') } },
  ])
}

async function newStore(): Promise<FileDocStore> {
  const store = new FileDocStore(REDIS_URL)
  await store.init()
  stores.push(store)
  return store
}

describe('FileDocStore', () => {
  it('retains only an accepted editor across durable merges, compaction, and generation replacement', async () => {
    const store = await newStore()
    const source = docWithText('base')
    source.getMap('config').set('docId', 'generation-1')
    source.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
    const replica = new Y.Doc()
    try {
      await store.seedIfEmpty(NAME, Y.encodeStateAsUpdate(source), 10)
      let vector = Y.encodeStateVector(source)
      source.getText('body').insert(4, '-durable')
      await store.publishAndWait(NAME, Y.encodeStateAsUpdate(source, vector), 'generation-1')
      expect((await store.getStreamSnapshot(NAME, 'generation-1'))?.editor).toBeNull()
      vector = Y.encodeStateVector(source)
      source.getText('body').insert(source.getText('body').length, '-writer')
      const actor = { userId: 'actual-editor', connectionId: 'authenticated-socket' }
      await store.publishClientUpdateAndWait(
        NAME,
        'edit-1',
        Y.encodeStateAsUpdate(source, vector),
        'generation-1',
        actor
      )
      vector = Y.encodeStateVector(source)
      source.getText('body').insert(source.getText('body').length, '-external')
      await store.publishAndWait(NAME, Y.encodeStateAsUpdate(source, vector), 'generation-1')
      const snapshot = await store.getStreamSnapshot(NAME, 'generation-1')
      expect(snapshot?.editor).toEqual(actor)
      if (!snapshot) throw new Error('Expected accepted snapshot')
      Y.applyUpdate(replica, snapshot.docState)
      expect(replica.getText('body').toString()).toBe('base-durable-writer-external')
      await store.attachRoom(NAME, replica)
      const room = storeInternals(store).rooms.get(NAME)
      if (!room) throw new Error('Expected attached room')
      room.uncompactedDeltaBytes = 12 * 1024 * 1024
      await storeInternals(store).maybeCompact(NAME)
      expect((await store.getStreamSnapshot(NAME, 'generation-1'))?.editor).toEqual(actor)
      store.detachRoom(NAME)
      await store.invalidateDocument(NAME, 20)
      const replacement = docWithText('replacement')
      replacement.getMap('config').set('docId', 'generation-2')
      replacement.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
      try {
        await store.seedIfEmpty(NAME, Y.encodeStateAsUpdate(replacement), 20)
        expect((await store.getStreamSnapshot(NAME, 'generation-2'))?.editor).toBeNull()
      } finally {
        replacement.destroy()
      }
    } finally {
      store.detachRoom(NAME)
      source.destroy()
      replica.destroy()
    }
  })

  beforeEach(() => {
    fakeRedis.backing = createBacking()
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
    // Faked before `init` so the reader loop's first sleep already runs on the fake clock.
    vi.useFakeTimers()
    try {
      const store = await newStore()
      const doc = new Y.Doc()
      await store.attachRoom(NAME, doc)
      currentBacking().readerClosed = true

      currentBacking().connects = 0 // ignore the two `init` connects; count only recovery attempts
      const before = currentBacking().reads
      await vi.advanceTimersByTimeAsync(3000)
      const attempts = currentBacking().reads - before

      // A fixed 500ms retry manages 6 attempts in this window; backing off (500 → 1s → 2s → …)
      // manages about 3. The ±20% jitter moves the exact count, so assert that it slowed down.
      expect(attempts).toBeGreaterThan(0)
      expect(attempts).toBeLessThanOrEqual(4)
      // …and it tried to bring the connection back rather than leaving the tailer dead forever.
      expect(currentBacking().connects).toBeGreaterThan(0)
      doc.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens one pair of connections when init is called concurrently', async () => {
    const store = new FileDocStore(REDIS_URL)
    stores.push(store)
    await Promise.all([store.init(), store.init(), store.init()])
    expect(currentBacking().connects).toBe(2)
  })

  /**
   * A restart that lands while the previous reader loop is between reads must retire that loop:
   * otherwise it resumes on the new connection and two loops tail the same rooms forever.
   */
  it('runs a single reader loop after a shutdown and restart', async () => {
    vi.useFakeTimers()
    const doc = new Y.Doc()
    try {
      const store = await newStore()
      await store.shutdown()
      await store.init()
      await store.attachRoom(NAME, doc)
      await vi.advanceTimersByTimeAsync(1000)
      expect(currentBacking().idleReads).toBeGreaterThan(0)
      expect(currentBacking().maxInFlightReads).toBe(1)
    } finally {
      doc.destroy()
      vi.useRealTimers()
    }
  })

  it('elects exactly one seeder across tasks (no split-brain seed)', async () => {
    const a = await newStore()
    const b = await newStore()
    // shouldSeed returns a lock token (truthy) for the winner, null for the loser.
    const [aTok, bTok] = await Promise.all([a.shouldSeed(NAME), b.shouldSeed(NAME)])
    expect([aTok, bTok].filter(Boolean)).toHaveLength(1)
  })

  it('fences stale publishers after invalidation and lets the next authoritative seed start fresh', async () => {
    const store = await newStore()
    const original = seedFor('old generation')
    await store.seedIfEmpty(NAME, original)
    await store.invalidateDocument(NAME, 10)

    await expect(store.getStreamState(NAME)).resolves.toBeNull()
    await expect(store.publishAndWait(NAME, updateFor('stale write'))).rejects.toThrow(
      'replaced by a newer durable version'
    )
    await expect(
      store.publishClientUpdateAndWait(
        NAME,
        'stale-update',
        updateFor('stale acknowledged write'),
        undefined,
        { userId: 'editor', connectionId: 'socket-editor' }
      )
    ).rejects.toThrow('replaced by a newer durable version')

    const fresh = seedFor('fresh generation')
    await expect(store.seedIfEmpty(NAME, fresh, 11)).resolves.toBe(true)
    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, (await store.getStreamState(NAME))!)
    expect(recovered.getText('body').toString()).toBe('fresh generation')
    recovered.destroy()
  })

  it('rejects old seeds and version callbacks after an invalidation', async () => {
    const store = await newStore()
    await store.seedIfEmpty(NAME, seedFor('old'), 10)
    const generation = await store.getDocumentGeneration(NAME)
    await store.invalidateDocument(NAME, 20)
    await expect(store.seedIfEmpty(NAME, seedFor('late stale seed'), 10)).resolves.toBe(false)
    await store.setSyncedVersion(NAME, 30, generation)
    expect(await store.getSyncedVersion(NAME)).toBe(20)
    await expect(store.getStreamState(NAME)).resolves.toBeNull()
  })

  it('rejects appends and duplicate acknowledgements when only the stream is lost', async () => {
    const store = await newStore()
    await store.seedIfEmpty(NAME, seedFor('base'), 10)
    const generation = await store.getDocumentGeneration(NAME)
    const delta = updateFor('edit')
    await store.publishClientUpdateAndWait(NAME, 'accepted-update', delta, generation, {
      userId: 'editor',
      connectionId: 'socket-editor',
    })
    currentBacking().streams.delete(`filedoc:stream:${NAME}`)

    await expect(store.publishAndWait(NAME, delta, generation)).rejects.toThrow('replaced')
    await expect(
      store.publishClientUpdateAndWait(NAME, 'new-update', delta, generation, {
        userId: 'editor',
        connectionId: 'socket-editor',
      })
    ).rejects.toThrow('replaced')
    await expect(
      store.publishClientUpdateAndWait(NAME, 'accepted-update', delta, generation, {
        userId: 'editor',
        connectionId: 'socket-editor',
      })
    ).rejects.toThrow('replaced')
    expect(currentBacking().streams.has(`filedoc:stream:${NAME}`)).toBe(false)
  })

  it('rejects a shared replay if the document generation changes between pages', async () => {
    const store = await newStore()
    await store.seedIfEmpty(NAME, seedFor('old generation'), 10)
    currentBacking().onRange = () => {
      currentBacking().kv.set(`filedoc:generation:${NAME}`, 'new generation')
    }
    await expect(store.getStreamState(NAME)).rejects.toThrow('replaced')
  })

  it('fails safely when an uncompacted stream exceeds the replay entry budget', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const noop = Buffer.from(updateFor('')).toString('base64')
    currentBacking().streams.set(
      streamKey,
      Array.from({ length: 2_001 }, (_, index) => ({
        id: `${index + 1}-0`,
        message: { u: noop },
      }))
    )
    currentBacking().seq = 2_001
    const store = await newStore()

    await expect(store.getStreamState(NAME)).rejects.toThrow('replay exceeded its safety limit')
  })

  it('never exposes a partially replayed document when room attachment exceeds its budget', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const noop = Buffer.from(updateFor('')).toString('base64')
    currentBacking().streams.set(
      streamKey,
      Array.from({ length: 2_001 }, (_, index) => ({
        id: `${index + 1}-0`,
        message: { u: noop },
      }))
    )
    currentBacking().seq = 2_001
    const store = await newStore()
    const doc = new Y.Doc()

    await expect(store.attachRoom(NAME, doc)).rejects.toThrow('replay exceeded its safety limit')

    expect(doc.getText('body').toString()).toBe('')
    expect(storeInternals(store).rooms.has(NAME)).toBe(false)
    doc.destroy()
  })

  it('recovers from compaction that trims unread pages during replay', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const noop = Buffer.from(updateFor('')).toString('base64')
    currentBacking().streams.set(
      streamKey,
      Array.from({ length: 8 }, (_, index) => ({
        id: `${index + 1}-0`,
        message: { u: noop },
      }))
    )
    currentBacking().seq = 8
    currentBacking().onRange = (call, key) => {
      if (call !== 2 || key !== streamKey) return
      currentBacking().streams.set(streamKey, [
        {
          id: '9-0',
          message: { u: Buffer.from(updateFor('compacted')).toString('base64'), s: '1' },
        },
      ])
      currentBacking().seq = 9
      currentBacking().onRange = undefined
    }
    const store = await newStore()

    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, (await store.getStreamState(NAME))!)
    expect(recovered.getText('body').toString()).toBe('compacted')
    recovered.destroy()
  })

  it('reads the replacement snapshot when peer deltas cross the old replay tail', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const source = new Y.Doc()
    const entries: Array<{ id: string; message: Record<string, string> }> = []
    source.on('update', (update: Uint8Array) => {
      entries.push({
        id: `${entries.length + 1}-0`,
        message: { u: Buffer.from(update).toString('base64') },
      })
    })
    for (let i = 1; i <= 8; i++)
      source.getText('body').insert(source.getText('body').length, String(i))
    const snapshot = Y.encodeStateAsUpdate(source)
    currentBacking().streams.set(streamKey, entries.slice())
    for (let i = 9; i <= 11; i++)
      source.getText('body').insert(source.getText('body').length, String(i))
    currentBacking().onRange = (_call, key, start) => {
      if (key !== streamKey || start !== '(4-0') return
      currentBacking().streams.set(streamKey, [
        ...entries.slice(7),
        { id: '12-0', message: { u: Buffer.from(snapshot).toString('base64'), s: '1' } },
      ])
      currentBacking().onRange = undefined
    }
    const store = await newStore()
    const recovered = new Y.Doc()
    try {
      Y.applyUpdate(recovered, (await store.getStreamState(NAME))!)
      expect(recovered.getText('body').toString()).toBe(source.getText('body').toString())
    } finally {
      source.destroy()
      recovered.destroy()
    }
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
    currentBacking().streams.set(streamKey, entries)
    currentBacking().seq = 402

    const a = await newStore()
    // This task has integrated only up to entry 400 (all no-ops) — its local doc is empty and lags the
    // two peer entries. Inject that lagging room directly (a real edit was integrated → realEdited).
    storeInternals(a).rooms.set(NAME, {
      doc: new Y.Doc(),
      lastId: '400-0',
      publishes: 0,
      uncompactedDeltaBytes: 0,
      lastDeltaBytes: 0,
      compactRetryAfter: 0,
      compacting: false,
      seededObserved: true,
      realEdited: true,
    })
    await storeInternals(a).maybeCompact(NAME)

    // A fresh catch-up must still reconstruct the peer content — compaction must not have trimmed 401/402.
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await a.getStreamState(NAME))!)
    expect(doc.getText('body').toString()).toBe('PEER1PEER2')
    doc.destroy()

    // The appended snapshot entry must carry the snapshot marker, so a fresh catch-up task treats it as
    // edited content (not a bare seed) and persists on last-disconnect.
    const stream = currentBacking().streams.get(streamKey)!
    expect(stream[stream.length - 1].message.s).toBe('1')
  })

  it('tags an agent-streamed frame so a peer tailer applies it as REDIS_AGENT_ORIGIN (never persisted)', async () => {
    seedLegacyStream()
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
    const stream = currentBacking().streams.get(streamKey)!
    expect(stream.some((e) => e.message.a === '1')).toBe(true)
    // The normal edit's entry carries no agent marker.
    expect(stream.filter((e) => e.message.a === '1')).toHaveLength(1)
    bDoc.destroy()
  })

  it('latches realEdited synchronously so a concurrent compaction can never mislabel a real edit', async () => {
    seedLegacyStream()
    // The data-loss race: a real edit sits in room.doc synchronously, but if realEdited were set only
    // AFTER appendUpdate's awaits, a concurrent agent-triggered compaction could snapshot that content and
    // stamp it an agent (no-persist) frame — losing the edit. The latch must be set in the same tick.
    const a = await newStore()
    const doc = new Y.Doc()
    await a.attachRoom(NAME, doc)
    const room = storeInternals(a).rooms.get(NAME)!
    expect(room.realEdited).toBe(false)
    // Kick off a real (non-agent) append but do NOT await it: realEdited must already be true before the
    // xAdd/expire awaits resolve, so any compaction racing on the awaits sees the real edit.
    const pending = storeInternals(a).appendUpdate(NAME, updateFor('real user edit'))
    expect(room.realEdited).toBe(true)
    await pending
    doc.destroy()
  })

  it('compacts a burst of large edits below the entry threshold without losing content', async () => {
    seedLegacyStream()
    const store = await newStore()
    const doc = new Y.Doc()
    await store.attachRoom(NAME, doc)
    const source = new Y.Doc()
    for (let index = 0; index < 4; index++) {
      const before = Y.encodeStateVector(source)
      source.getText('body').insert(0, 'x'.repeat(3 * 1024 * 1024))
      await store.publishAndWait(NAME, Y.encodeStateAsUpdate(source, before))
    }

    await vi.waitFor(() => {
      const stream = currentBacking().streams.get(`filedoc:stream:${NAME}`)!
      expect(stream.length).toBeLessThan(400)
      expect(stream.some((entry) => entry.message.c === '1')).toBe(true)
    })
    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, (await store.getStreamState(NAME))!)
    expect(rebuilt.getText('body').length).toBe(12 * 1024 * 1024)
    store.detachRoom(NAME)
    rebuilt.destroy()
    source.destroy()
    doc.destroy()
  })

  it('retries a transient append failure so the edit is not lost from the shared log', async () => {
    seedLegacyStream()
    const a = await newStore()
    currentBacking().failXAdd = 2 // first two xAdd attempts throw; the third must succeed
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

  it('deduplicates acknowledged client retries by update id', async () => {
    seedLegacyStream()
    const store = await newStore()
    const update = updateFor('retry-safe')

    await store.publishClientUpdateAndWait(NAME, 'update-1', update, undefined, {
      userId: 'editor',
      connectionId: 'socket-editor',
    })
    await store.publishClientUpdateAndWait(NAME, 'update-1', update, undefined, {
      userId: 'editor',
      connectionId: 'socket-editor',
    })

    expect(currentBacking().streams.get(`filedoc:stream:${NAME}`)).toHaveLength(2)
  })

  it('does not drop different payloads that reuse an acknowledged update id', async () => {
    seedLegacyStream()
    const store = await newStore()

    await store.publishClientUpdateAndWait(NAME, 'update-1', updateFor('first'), undefined, {
      userId: 'editor',
      connectionId: 'socket-editor',
    })
    await store.publishClientUpdateAndWait(NAME, 'update-1', updateFor('second'), undefined, {
      userId: 'editor',
      connectionId: 'socket-editor',
    })

    expect(currentBacking().streams.get(`filedoc:stream:${NAME}`)).toHaveLength(3)
  })

  it('preserves the inclusive barrier and delta bytes observed during compaction', async () => {
    seedLegacyStream()
    const store = await newStore()
    const doc = new Y.Doc()
    await store.attachRoom(NAME, doc)
    const room = storeInternals(store).rooms.get(NAME)!
    room.uncompactedDeltaBytes = 12 * 1024 * 1024
    const retainedBarrierBytes = room.lastDeltaBytes
    const lateUpdate = updateFor('concurrent edit')
    currentBacking().onSnapshot = async () => {
      await store.publishAndWait(NAME, lateUpdate)
      await store.catchUp(NAME)
    }
    await storeInternals(store).maybeCompact(NAME)
    expect(room.uncompactedDeltaBytes).toBe(
      retainedBarrierBytes + Buffer.from(lateUpdate).toString('base64').length
    )
    expect(doc.getText('body').toString()).toBe('concurrent edit')
    store.detachRoom(NAME)
    doc.destroy()
  })

  it('does not trim a replacement stream recreated in the same millisecond as its compaction barrier', async () => {
    const store = await newStore()
    const replacer = await newStore()
    const oldDoc = docWithText('old')
    oldDoc.getMap('config').set('docId', 'old-generation')
    currentBacking().nextIds = ['1000-0', '1000-1', '1000-2']
    await store.seedIfEmpty(NAME, Y.encodeStateAsUpdate(oldDoc), 10)
    await store.publishAndWait(NAME, updateFor('first edit'), 'old-generation')
    await store.publishAndWait(NAME, updateFor('second edit'), 'old-generation')
    await store.attachRoom(NAME, oldDoc)
    storeInternals(store).rooms.get(NAME)!.uncompactedDeltaBytes = 12 * 1024 * 1024

    const freshDoc = docWithText('fresh')
    freshDoc.getMap('config').set('docId', 'new-generation')
    const freshSeed = Y.encodeStateAsUpdate(freshDoc)
    const beforeEdit = Y.encodeStateVector(freshDoc)
    freshDoc.getText('body').insert(5, ' accepted edit')
    const freshEdit = Y.encodeStateAsUpdate(freshDoc, beforeEdit)
    const streamKey = `filedoc:stream:${NAME}`
    currentBacking().nextIds = ['1000-3', '1000-0', '1000-1']
    currentBacking().onSnapshot = async () => {
      await replacer.invalidateDocument(NAME, 20)
      await replacer.seedIfEmpty(NAME, freshSeed, 20)
      await replacer.publishClientUpdateAndWait(NAME, 'fresh-edit', freshEdit, 'new-generation', {
        userId: 'editor',
        connectionId: 'socket-editor',
      })
      expect(
        currentBacking()
          .streams.get(streamKey)
          ?.map((entry) => entry.id)
      ).toEqual(['1000-0', '1000-1'])
    }

    await storeInternals(store).maybeCompact(NAME)

    expect(
      currentBacking()
        .streams.get(streamKey)
        ?.map((entry) => entry.id)
    ).toEqual(['1000-0', '1000-1'])
    await replacer.publishClientUpdateAndWait(NAME, 'fresh-edit', freshEdit, 'new-generation', {
      userId: 'editor',
      connectionId: 'socket-editor',
    })
    expect(currentBacking().streams.get(streamKey)).toHaveLength(2)
    const persisted = await replacer.getStreamState(NAME)
    expect(persisted).not.toBeNull()
    const replayed = new Y.Doc()
    Y.applyUpdate(replayed, persisted!)
    expect(replayed.getText('body').toString()).toBe('fresh accepted edit')
    store.detachRoom(NAME)
    oldDoc.destroy()
    freshDoc.destroy()
    replayed.destroy()
  })

  it('fails closed when a Redis-backed store has not initialized', async () => {
    const store = new FileDocStore(REDIS_URL)
    const doc = new Y.Doc()

    await expect(store.attachRoom(NAME, doc)).rejects.toThrow('not initialized')
    await expect(
      store.publishClientUpdateAndWait(NAME, 'update-1', updateFor('x'), undefined, {
        userId: 'editor',
        connectionId: 'socket-editor',
      })
    ).rejects.toThrow('not initialized')
    await expect(store.seedIfEmpty(NAME, seedFor('seed'))).rejects.toThrow('not initialized')
    await expect(store.getStreamState(NAME)).rejects.toThrow('not initialized')
    expect(await store.acquireMergeSlot(NAME, 1_000)).toBeNull()
    doc.destroy()
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
    currentBacking().kv.delete(`filedoc:seedlock:${NAME}`)
    const tokenB = await b.shouldSeed(NAME)
    expect(tokenB).toBeTruthy()
    // Both tasks now race to seed with distinct client ids.
    const [seededA, seededB] = await Promise.all([
      a.seedIfEmpty(NAME, seedFor('SEED-A')),
      b.seedIfEmpty(NAME, seedFor('SEED-B')),
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
    seedLegacyStream(updates[0])
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
    currentBacking().streams.set(streamKey, entries)
    currentBacking().seq = 402

    // Two tasks whose local docs lag at DIFFERENT points (400 and 401): both cross the threshold and
    // compact concurrently. Each must only trim what its own snapshot subsumes, so the union of both
    // snapshots plus the un-integrated peer entries still reconstructs the whole doc.
    const a = await newStore()
    const b = await newStore()
    const docA = new Y.Doc()
    Y.applyUpdate(docA, peerUpdates[0]) // A integrated up to 401
    storeInternals(a).rooms.set(NAME, {
      doc: docA,
      lastId: '401-0',
      publishes: 0,
      uncompactedDeltaBytes: 0,
      lastDeltaBytes: 0,
      compactRetryAfter: 0,
      compacting: false,
      seededObserved: true,
      realEdited: true,
    })
    storeInternals(b).rooms.set(NAME, {
      doc: new Y.Doc(),
      lastId: '400-0',
      publishes: 0,
      uncompactedDeltaBytes: 0,
      lastDeltaBytes: 0,
      compactRetryAfter: 0,
      compacting: false,
      seededObserved: true,
      realEdited: true,
    })
    await Promise.all([storeInternals(a).maybeCompact(NAME), storeInternals(b).maybeCompact(NAME)])

    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await a.getStreamState(NAME))!)
    expect(doc.getText('body').toString()).toBe('PEER1PEER2')
    doc.destroy()
  })
})
