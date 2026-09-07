/**
 * @vitest-environment node
 */
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { sleep } from '@sim/utils/helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

interface TestStreamEntry {
  id: string
  message: Record<string, string>
}

interface TestRedisClient {
  isOpen: boolean
  connect(): Promise<void>
  quit(): Promise<void>
  on(): TestRedisClient
  duplicate(): TestRedisClient
  xAdd(key: string, id: string, fields: Record<string, string>): Promise<string>
  xRange(
    key: string,
    start: string,
    end: string,
    options?: { COUNT?: number }
  ): Promise<TestStreamEntry[]>
  xRevRange(
    key: string,
    start: string,
    end: string,
    options?: { COUNT?: number }
  ): Promise<TestStreamEntry[]>
  xLen(key: string): Promise<number>
  xTrim(key: string, strategy: string, minId: string): Promise<void>
  xRead(
    streams: { key: string; id: string }[],
    options?: { BLOCK?: number; COUNT?: number }
  ): Promise<{ name: string; messages: TestStreamEntry[] }[] | null>
  set(key: string, value: string, options?: { NX?: boolean }): Promise<string | null>
  get(key: string): Promise<string | null>
  del(keys: string | string[]): Promise<number>
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<string | number | boolean | null>
  expire(): Promise<number>
}

/**
 * One shared in-memory Redis backing per test, so several {@link FileDocStore} instances (modelling
 * several ECS tasks) all talk to the "same Redis". A minimal fake of just the stream/lock ops the
 * store uses.
 */
interface Backing {
  streams: Map<string, TestStreamEntry[]>
  kv: Map<string, string>
  dedupe: Map<string, string[]>
  seq: number
  /** Override generated IDs to model a recreated stream restarting its same-millisecond sequence. */
  nextIds?: string[]
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
  /** Largest stream range response requested, proving replay is paginated. */
  maxRangeCount: number
  /** Optional deterministic compaction hook invoked before each range page is read. */
  onRange?: (call: number, key: string, start: string) => void
  rangeCalls: number
  /** Largest multiplexed XREAD request and COUNT observed. */
  maxReadStreams: number
  maxReadCount: number
  onSnapshot?: () => Promise<void>
  failSnapshotTrim?: boolean
  onLength?: () => Promise<void>
}

const state = vi.hoisted(() => ({ backing: null as Backing | null }))

function compareStreamIds(left: string, right: string): bigint {
  const [leftMs, leftSequence] = left.split('-').map(BigInt)
  const [rightMs, rightSequence] = right.split('-').map(BigInt)
  return leftMs === rightMs ? leftSequence - rightSequence : leftMs - rightMs
}

function makeClient(): TestRedisClient {
  const b = () => {
    if (!state.backing) throw new Error('backing not initialized')
    return state.backing
  }
  const nextId = () => b().nextIds?.shift() ?? `${++b().seq}-0`
  const client: TestRedisClient = {
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
      const id = nextId()
      const arr = b().streams.get(key) ?? []
      arr.push({ id, message: { ...fields } })
      b().streams.set(key, arr)
      return id
    },
    xRange: async (key: string, start: string, end: string, options?: { COUNT?: number }) => {
      b().rangeCalls++
      b().onRange?.(b().rangeCalls, key, start)
      const startId = start.startsWith('(') ? start.slice(1) : start
      const entries = (b().streams.get(key) ?? []).filter(
        (entry) =>
          (start === '-' || compareStreamIds(entry.id, startId) > 0n) &&
          (end === '+' || compareStreamIds(entry.id, end) <= 0n)
      )
      const count = options?.COUNT ?? entries.length
      b().maxRangeCount = Math.max(b().maxRangeCount, count)
      return entries.slice(0, count).map((entry) => ({ ...entry }))
    },
    xRevRange: async (key: string, _start: string, _end: string, options?: { COUNT?: number }) =>
      [...(b().streams.get(key) ?? [])]
        .reverse()
        .slice(0, options?.COUNT)
        .map((entry) => ({ ...entry })),
    xLen: async (key: string) => {
      await b().onLength?.()
      return (b().streams.get(key) ?? []).length
    },
    xTrim: async (key: string, _strategy: string, minid: string) => {
      const arr = b().streams.get(key) ?? []
      b().streams.set(
        key,
        arr.filter((e) => compareStreamIds(e.id, minid) >= 0n)
      )
    },
    xRead: async (
      streams: { key: string; id: string }[],
      options?: { BLOCK?: number; COUNT?: number }
    ) => {
      b().reads++
      b().maxReadStreams = Math.max(b().maxReadStreams, streams.length)
      b().maxReadCount = Math.max(b().maxReadCount, options?.COUNT ?? 0)
      if (b().readerClosed) {
        b().failedReadTimes.push(Date.now())
        client.isOpen = false
        throw new Error('The client is closed')
      }
      const res: { name: string; messages: TestStreamEntry[] }[] = []
      for (const { key, id } of streams) {
        const after = (b().streams.get(key) ?? [])
          .filter((e) => compareStreamIds(e.id, id) > 0n)
          .slice(0, options?.COUNT)
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
    get: async (key: string) => b().kv.get(key) ?? null,
    del: async (keys: string | string[]) => {
      const targets = Array.isArray(keys) ? keys : [keys]
      for (const key of targets) {
        b().kv.delete(key)
        b().streams.delete(key)
        b().dedupe.delete(key)
      }
      return targets.length
    },
    eval: async (script: string, opts: { keys: string[]; arguments: string[] }) => {
      const [key] = opts.keys
      if (script.startsWith('for _, key in ipairs(KEYS)')) return 1
      if (script.includes("redis.call('exists', KEYS[1])") && !b().streams.has(key)) {
        return script.includes('zscore') ? -1 : false
      }
      if (script.includes('return ARGV[1]')) {
        const generation = b().kv.get(opts.keys[1])
        if (generation !== undefined) return generation
        if (!b().streams.get(key)?.length) return false
        b().kv.set(opts.keys[1], opts.arguments[0])
        return opts.arguments[0]
      }
      if (script.includes("redis.call('del', KEYS[1], KEYS[4], KEYS[5])")) {
        const [, generationKey, versionKey, dedupeKey, agentKey, invalidationKey] = opts.keys
        const [version, , marker] = opts.arguments
        const current = b().kv.get(versionKey)
        const invalidated = b().kv.get(invalidationKey)
        if (invalidated && Number(invalidated) >= Number(version)) return null
        if (current && Number(current) > Number(version)) return null
        if (current === version && b().kv.get(generationKey) === marker) return null
        const generation = b().kv.get(generationKey) ?? ''
        b().kv.set(generationKey, marker)
        b().kv.set(versionKey, version)
        b().kv.set(invalidationKey, version)
        b().streams.delete(key)
        b().dedupe.delete(dedupeKey)
        b().kv.delete(agentKey)
        return generation
      }
      if (script.includes('zscore')) {
        const [, dedupeKey, generationKey] = opts.keys
        const [member, field, value, capacityText, , expectedGeneration] = opts.arguments
        const generation = b().kv.get(generationKey)
        if ((generation ?? '') !== expectedGeneration) return -1
        const members = b().dedupe.get(dedupeKey) ?? []
        if (members.includes(member)) return 0
        const id = nextId()
        const arr = b().streams.get(key) ?? []
        arr.push({ id, message: { [field]: value } })
        b().streams.set(key, arr)
        members.push(member)
        const capacity = Number(capacityText)
        if (members.length > capacity) members.splice(0, members.length - capacity)
        b().dedupe.set(dedupeKey, members)
        return 1
      }
      // Atomic seed-if-empty (SEED_IF_EMPTY_SCRIPT): append the entry iff the stream is empty, in one
      // synchronous step — mirroring Redis's atomic Lua execution, so two concurrent evals can never both
      // append (the second sees a non-empty stream).
      if (script.includes('xlen')) {
        const [, generationKey, versionKey] = opts.keys
        const [field, value, generation, , generationField, version] = opts.arguments
        if (Number(b().kv.get(versionKey) ?? 0) > Number(version)) return 0
        const arr = b().streams.get(key) ?? []
        if (arr.length > 0) return 0
        b().kv.set(generationKey, generation)
        if (version !== '0') b().kv.set(versionKey, version)
        const id = nextId()
        arr.push({ id, message: { [field]: value, [generationField]: generation } })
        b().streams.set(key, arr)
        return 1
      }
      if (script.includes('ARGV[5], ARGV[4]')) {
        const [, generationKey] = opts.keys
        const [field, value, marker, expectedGeneration, generationField, upTo, compactionField] =
          opts.arguments
        const generation = b().kv.get(generationKey)
        if ((generation ?? '') !== expectedGeneration) return false
        const id = nextId()
        const arr = b().streams.get(key) ?? []
        arr.push({
          id,
          message: {
            [field]: value,
            [marker]: '1',
            [generationField]: expectedGeneration,
            ...(compactionField ? { [compactionField]: '1' } : {}),
          },
        })
        b().streams.set(key, arr)
        if (script.includes("redis.call('xtrim'")) {
          if (b().failSnapshotTrim) throw new Error('snapshot trim failed')
          b().streams.set(
            key,
            arr.filter((entry) => compareStreamIds(entry.id, upTo) >= 0n)
          )
        }
        await b().onSnapshot?.()
        return id
      }
      if (script.includes("ARGV[3] ~= ''")) {
        const [, generationKey] = opts.keys
        const generation = b().kv.get(generationKey)
        const expectedGeneration = opts.arguments[3]
        if ((generation ?? '') !== expectedGeneration) return false
        if (b().failXAdd > 0) {
          b().failXAdd--
          throw new Error('transient xAdd failure')
        }
        const [field, value, marker] = opts.arguments
        const id = nextId()
        const arr = b().streams.get(key) ?? []
        arr.push({ id, message: { [field]: value, ...(marker ? { [marker]: '1' } : {}) } })
        b().streams.set(key, arr)
        return id
      }
      if (script.includes('tonumber(c)')) {
        const [value, , expectedGeneration] = opts.arguments
        const generation = b().kv.get(opts.keys[1])
        if ((generation ?? '') !== expectedGeneration) return 0
        const current = b().kv.get(key)
        if (current === undefined || Number(current) < Number(value)) b().kv.set(key, value)
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
  localInvalidations: Map<string, { version: number; expiresAt: number }>
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

/** An existing stream from a relay predating generation markers; modern seeds use seedIfEmpty. */
function seedLegacyStream(update = updateFor('')): void {
  const backing = state.backing!
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
  beforeEach(() => {
    state.backing = {
      streams: new Map(),
      kv: new Map(),
      dedupe: new Map(),
      seq: 0,
      failXAdd: 0,
      readerClosed: false,
      reads: 0,
      failedReadTimes: [],
      idleReads: 0,
      connects: 0,
      maxRangeCount: 0,
      rangeCalls: 0,
      maxReadStreams: 0,
      maxReadCount: 0,
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
    await a.seedIfEmpty(NAME, seedFor('hello'))
    await vi.waitFor(async () => expect(await a.getStreamState(NAME)).not.toBeNull())
    await a.releaseSeedLock(NAME, token as string)
    // A different task must NOT seed again — the lock is free but the stream is non-empty.
    const b = await newStore()
    expect(await b.shouldSeed(NAME)).toBeNull()
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
      store.publishClientUpdateAndWait(NAME, 'stale-update', updateFor('stale acknowledged write'))
    ).rejects.toThrow('replaced by a newer durable version')

    const fresh = seedFor('fresh generation')
    await expect(store.seedIfEmpty(NAME, fresh, 11)).resolves.toBe(true)
    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, (await store.getStreamState(NAME))!)
    expect(recovered.getText('body').toString()).toBe('fresh generation')
    recovered.destroy()
  })

  it('getStreamState reconstructs the shared document from the stream', async () => {
    const a = await newStore()
    await a.seedIfEmpty(NAME, seedFor('shared content'))
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

  it('lets a headless replica append against the generation of its shared base', async () => {
    const seeded = await newStore()
    await seeded.seedIfEmpty(NAME, seedFor('shared'), 20)
    const headless = await newStore()
    const generation = await headless.getDocumentGeneration(NAME)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await headless.getStreamState(NAME, generation))!)
    const before = Y.encodeStateVector(doc)
    doc.getText('body').insert(6, ' edit')
    await headless.publishAndWait(NAME, Y.encodeStateAsUpdate(doc, before), generation)
    const replay = new Y.Doc()
    Y.applyUpdate(replay, (await seeded.getStreamState(NAME))!)
    expect(replay.getText('body').toString()).toBe('shared edit')
    doc.destroy()
    replay.destroy()
  })

  it('keeps a newer seeded generation when an older invalidation arrives', async () => {
    const store = await newStore()
    await store.seedIfEmpty(NAME, seedFor('newest'), 20)
    const generation = await store.getDocumentGeneration(NAME)
    await expect(store.invalidateDocument(NAME, 10)).resolves.toEqual({ status: 'stale' })
    expect(await store.getDocumentGeneration(NAME)).toBe(generation)
    expect(await store.getSyncedVersion(NAME)).toBe(20)
    await expect(store.getStreamState(NAME)).resolves.not.toBeNull()
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

  it('does not repeat an invalidation after the same durable version is reseeded', async () => {
    const store = await newStore()
    await store.seedIfEmpty(NAME, seedFor('old'), 10)
    await expect(store.invalidateDocument(NAME, 20)).resolves.toMatchObject({ status: 'applied' })
    await expect(store.seedIfEmpty(NAME, seedFor('replacement'), 20)).resolves.toBe(true)
    const generation = await store.getDocumentGeneration(NAME)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, (await store.getStreamState(NAME))!)
    const before = Y.encodeStateVector(doc)
    doc.getText('body').insert(11, ' accepted')
    await store.publishClientUpdateAndWait(
      NAME,
      'accepted-edit',
      Y.encodeStateAsUpdate(doc, before),
      generation
    )

    await expect(store.invalidateDocument(NAME, 20)).resolves.toEqual({ status: 'stale' })
    expect(await store.getDocumentGeneration(NAME)).toBe(generation)
    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, (await store.getStreamState(NAME))!)
    expect(recovered.getText('body').toString()).toBe('replacement accepted')
    expect(state.backing!.dedupe.get(`filedoc:updates:${NAME}`)).toHaveLength(1)
    doc.destroy()
    recovered.destroy()
  })

  it('applies the first invalidation even when its durable version was already seeded', async () => {
    const store = await newStore()
    await store.seedIfEmpty(NAME, seedFor('same content, changed eligibility'), 20)
    const docId = await store.getDocumentGeneration(NAME)
    await expect(store.invalidateDocument(NAME, 20)).resolves.toEqual({ status: 'applied', docId })
    await expect(store.invalidateDocument(NAME, 20)).resolves.toEqual({ status: 'stale' })
    await expect(store.getStreamState(NAME)).resolves.toBeNull()
  })

  it('returns the removed generation and qualifies consecutive unsupported replacements', async () => {
    const store = await newStore()
    await store.seedIfEmpty(NAME, seedFor('old'), 10)
    const oldId = await store.getDocumentGeneration(NAME)
    await expect(store.invalidateDocument(NAME, 20)).resolves.toEqual({
      status: 'applied',
      docId: oldId,
    })
    await expect(store.invalidateDocument(NAME, 30)).resolves.toEqual({ status: 'applied' })
    await store.seedIfEmpty(NAME, seedFor('replacement'), 30)
    const replacementId = await store.getDocumentGeneration(NAME)
    expect(replacementId).not.toBe(oldId)
    await expect(store.invalidateDocument(NAME, 30)).resolves.toEqual({ status: 'stale' })
    await expect(store.invalidateDocument(NAME, 40)).resolves.toEqual({
      status: 'applied',
      docId: replacementId,
    })
  })

  it('does not resurrect a tracked stream with a dependency-only update after Redis loses it', async () => {
    const store = await newStore()
    await store.seedIfEmpty(NAME, seedFor('base'), 10)
    const generation = await store.getDocumentGeneration(NAME)
    state.backing!.streams.delete(`filedoc:stream:${NAME}`)
    state.backing!.kv.delete(`filedoc:generation:${NAME}`)
    await expect(store.publishAndWait(NAME, updateFor('stale'), generation)).rejects.toThrow(
      'replaced'
    )
    await expect(
      store.publishClientUpdateAndWait(NAME, 'lost-stream-update', updateFor('stale'), generation)
    ).rejects.toThrow('replaced')
    await expect(store.getStreamState(NAME)).resolves.toBeNull()
  })

  it('rejects appends and duplicate acknowledgements when only the stream is lost', async () => {
    const store = await newStore()
    await store.seedIfEmpty(NAME, seedFor('base'), 10)
    const generation = await store.getDocumentGeneration(NAME)
    const delta = updateFor('edit')
    await store.publishClientUpdateAndWait(NAME, 'accepted-update', delta, generation)
    state.backing!.streams.delete(`filedoc:stream:${NAME}`)

    await expect(store.publishAndWait(NAME, delta, generation)).rejects.toThrow('replaced')
    await expect(
      store.publishClientUpdateAndWait(NAME, 'new-update', delta, generation)
    ).rejects.toThrow('replaced')
    await expect(
      store.publishClientUpdateAndWait(NAME, 'accepted-update', delta, generation)
    ).rejects.toThrow('replaced')
    expect(state.backing!.streams.has(`filedoc:stream:${NAME}`)).toBe(false)
  })

  it('adopts the identity of a pre-upgrade stream before acknowledging its edits', async () => {
    const store = await newStore()
    const seed = new Y.Doc()
    seed.getMap('config').set('initialContentLoaded', true)
    seed.getMap('config').set('docId', 'legacy-document')
    seed.getText('body').insert(0, 'legacy')
    seedLegacyStream(Y.encodeStateAsUpdate(seed))
    const attached = new Y.Doc()
    await store.attachRoom(NAME, attached)
    expect(await store.getDocumentGeneration(NAME)).toBe('legacy-document')
    const before = Y.encodeStateVector(seed)
    seed.getText('body').insert(6, ' edit')
    await expect(
      store.publishClientUpdateAndWait(
        NAME,
        'legacy-edit',
        Y.encodeStateAsUpdate(seed, before),
        'legacy-document'
      )
    ).resolves.toBeUndefined()
    store.detachRoom(NAME)
    seed.destroy()
    attached.destroy()
  })

  it('rejects a shared replay if the document generation changes between pages', async () => {
    const store = await newStore()
    await store.seedIfEmpty(NAME, seedFor('old generation'), 10)
    state.backing!.onRange = () => {
      state.backing!.kv.set(`filedoc:generation:${NAME}`, 'new generation')
    }
    await expect(store.getStreamState(NAME)).rejects.toThrow('replaced')
  })

  it.each([true, false])(
    'validates a modern snapshot following a legacy seed (same identity: %s)',
    async (sameIdentity) => {
      const store = await newStore()
      const seed = new Y.Doc()
      seed.getMap('config').set('initialContentLoaded', true)
      seed.getMap('config').set('docId', 'legacy-document')
      seed.getText('body').insert(0, 'legacy')
      seedLegacyStream(Y.encodeStateAsUpdate(seed))
      const backing = state.backing!
      backing.kv.set(
        `filedoc:generation:${NAME}`,
        sameIdentity ? 'legacy-document' : 'different-document'
      )
      backing.streams.get(`filedoc:stream:${NAME}`)!.push({
        id: `${++backing.seq}-0`,
        message: {
          u: Buffer.from(Y.encodeStateAsUpdate(seed)).toString('base64'),
          s: '1',
          g: sameIdentity ? 'legacy-document' : 'different-document',
        },
      })
      const attached = new Y.Doc()
      if (sameIdentity) {
        await store.attachRoom(NAME, attached)
        const before = Y.encodeStateVector(seed)
        seed.getText('body').insert(6, ' peer')
        await store.publishClientUpdateAndWait(
          NAME,
          'peer-edit',
          Y.encodeStateAsUpdate(seed, before),
          'legacy-document'
        )
        await store.catchUp(NAME)
        expect(attached.getText('body').toString()).toBe('legacy peer')
        store.detachRoom(NAME)
      } else {
        await expect(store.attachRoom(NAME, attached)).rejects.toThrow('replaced')
        expect(storeInternals(store).rooms.has(NAME)).toBe(false)
      }
      seed.destroy()
      attached.destroy()
    }
  )

  it('replays stream history in bounded pages', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const noop = Buffer.from(updateFor('')).toString('base64')
    state.backing!.streams.set(
      streamKey,
      Array.from({ length: 40 }, (_, index) => ({
        id: `${index + 1}-0`,
        message: { u: noop },
      }))
    )
    state.backing!.seq = 40
    const store = await newStore()

    await expect(store.getStreamState(NAME)).resolves.not.toBeNull()

    expect(state.backing!.maxRangeCount).toBe(4)
  })

  it('fails safely when an uncompacted stream exceeds the replay entry budget', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const noop = Buffer.from(updateFor('')).toString('base64')
    state.backing!.streams.set(
      streamKey,
      Array.from({ length: 2_001 }, (_, index) => ({
        id: `${index + 1}-0`,
        message: { u: noop },
      }))
    )
    state.backing!.seq = 2_001
    const store = await newStore()

    await expect(store.getStreamState(NAME)).rejects.toThrow('replay exceeded its safety limit')
  })

  it('never exposes a partially replayed document when room attachment exceeds its budget', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const noop = Buffer.from(updateFor('')).toString('base64')
    state.backing!.streams.set(
      streamKey,
      Array.from({ length: 2_001 }, (_, index) => ({
        id: `${index + 1}-0`,
        message: { u: noop },
      }))
    )
    state.backing!.seq = 2_001
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
    state.backing!.streams.set(
      streamKey,
      Array.from({ length: 8 }, (_, index) => ({
        id: `${index + 1}-0`,
        message: { u: noop },
      }))
    )
    state.backing!.seq = 8
    state.backing!.onRange = (call, key) => {
      if (call !== 2 || key !== streamKey) return
      state.backing!.streams.set(streamKey, [
        {
          id: '9-0',
          message: { u: Buffer.from(updateFor('compacted')).toString('base64'), s: '1' },
        },
      ])
      state.backing!.seq = 9
      state.backing!.onRange = undefined
    }
    const store = await newStore()

    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, (await store.getStreamState(NAME))!)
    expect(recovered.getText('body').toString()).toBe('compacted')
    recovered.destroy()
  })

  it.each(['headless', 'attached'] as const)(
    'does not recount a replacement snapshot near the byte budget during %s replay',
    async (mode) => {
      const streamKey = `filedoc:stream:${NAME}`
      const source = new Y.Doc()
      source.getText('body').insert(0, 'x'.repeat(10 * 1024 * 1024))
      const initial = Buffer.from(Y.encodeStateAsUpdate(source)).toString('base64')
      const noop = Buffer.from(updateFor('')).toString('base64')
      state.backing!.streams.set(
        streamKey,
        Array.from({ length: 8 }, (_, index) => ({
          id: `${index + 1}-0`,
          message: { u: index === 0 ? initial : noop },
        }))
      )
      source.getText('body').insert(source.getText('body').length, ' joined')
      const compacted = Buffer.from(Y.encodeStateAsUpdate(source)).toString('base64')
      state.backing!.seq = 8
      state.backing!.onRange = (_call, key, start) => {
        if (key !== streamKey || start !== '(4-0') return
        state.backing!.streams.set(streamKey, [{ id: '9-0', message: { u: compacted, s: '1' } }])
        state.backing!.seq = 9
        state.backing!.onRange = undefined
      }
      const store = await newStore()
      const recovered = new Y.Doc()
      try {
        if (mode === 'attached') await store.attachRoom(NAME, recovered)
        else Y.applyUpdate(recovered, (await store.getStreamState(NAME))!)
        expect(recovered.getText('body').toString()).toBe(source.getText('body').toString())
      } finally {
        store.detachRoom(NAME)
        recovered.destroy()
        source.destroy()
      }
    }
  )

  it('does not recount retained entries when compaction meets the exact entry budget', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const noop = Buffer.from(updateFor('')).toString('base64')
    const entries = Array.from({ length: 1_999 }, (_, index) => ({
      id: `${index + 1}-0`,
      message: { u: noop },
    }))
    state.backing!.streams.set(streamKey, entries)
    state.backing!.seq = 1_999
    state.backing!.onRange = (_call, key, start) => {
      if (key !== streamKey || start !== '(1996-0') return
      state.backing!.streams.set(streamKey, [
        ...entries.slice(1_996),
        {
          id: '2000-0',
          message: { u: Buffer.from(updateFor('complete')).toString('base64'), s: '1' },
        },
      ])
      state.backing!.seq = 2_000
      state.backing!.onRange = undefined
    }
    const store = await newStore()
    const recovered = new Y.Doc()
    try {
      Y.applyUpdate(recovered, (await store.getStreamState(NAME))!)
      expect(recovered.getText('body').toString()).toBe('complete')
    } finally {
      recovered.destroy()
    }
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
    state.backing!.streams.set(streamKey, entries.slice())
    for (let i = 9; i <= 11; i++)
      source.getText('body').insert(source.getText('body').length, String(i))
    state.backing!.onRange = (_call, key, start) => {
      if (key !== streamKey || start !== '(4-0') return
      state.backing!.streams.set(streamKey, [
        ...entries.slice(7),
        { id: '12-0', message: { u: Buffer.from(snapshot).toString('base64'), s: '1' } },
      ])
      state.backing!.onRange = undefined
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

  it('attachRoom catches a fresh task up to the current shared state', async () => {
    const a = await newStore()
    await a.seedIfEmpty(NAME, seedFor('already here'))
    await vi.waitFor(async () => expect(await a.getStreamState(NAME)).not.toBeNull())

    // A second task opens the same file: its doc must load the existing content, not start empty.
    const b = await newStore()
    const doc = new Y.Doc()
    await b.attachRoom(NAME, doc)
    expect(doc.getText('body').toString()).toBe('already here')
    doc.destroy()
  })

  it('converges a peer task via the tailer after attach', async () => {
    seedLegacyStream()
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
    const stream = state.backing!.streams.get(streamKey)!
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
    const stream = state.backing!.streams.get(streamKey)!
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
      const stream = state.backing!.streams.get(`filedoc:stream:${NAME}`)!
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

  it('does not append a full snapshot per small edit after growing beyond the byte threshold', async () => {
    seedLegacyStream()
    const store = await newStore()
    const doc = new Y.Doc()
    await store.attachRoom(NAME, doc)
    const source = new Y.Doc()
    for (let index = 0; index < 33; index++) {
      const before = Y.encodeStateVector(source)
      source.getText('body').insert(0, index < 3 ? 'x'.repeat(3 * 1024 * 1024) : 'tiny')
      await store.publishAndWait(NAME, Y.encodeStateAsUpdate(source, before))
      await store.catchUp(NAME)
    }
    const streamKey = `filedoc:stream:${NAME}`
    await vi.waitFor(() => {
      expect(storeInternals(store).rooms.get(NAME)!.compacting).toBe(false)
      expect(state.backing!.streams.get(streamKey)!.some((entry) => entry.message.c === '1')).toBe(
        true
      )
    })
    expect(
      state.backing!.streams.get(streamKey)!.filter((entry) => entry.message.c === '1').length
    ).toBeLessThanOrEqual(2)
    const rebuilt = new Y.Doc()
    Y.applyUpdate(rebuilt, (await store.getStreamState(NAME))!)
    expect(rebuilt.getText('body').length).toBe(9 * 1024 * 1024 + 30 * 4)
    expect(rebuilt.getText('body').toString().startsWith('tiny')).toBe(true)
    store.detachRoom(NAME)
    source.destroy()
    rebuilt.destroy()
    doc.destroy()
  })

  it.each([false, true])(
    'adopts and compacts an oversized legacy stream (agent: %s)',
    async (agent) => {
      const source = new Y.Doc()
      const updates: Uint8Array[] = []
      source.on('update', (update: Uint8Array) => updates.push(update))
      source.getText('body').insert(0, 'x'.repeat(7 * 1024 * 1024))
      source.getText('body').insert(0, 'tail')
      const streamKey = `filedoc:stream:${NAME}`
      state.backing!.streams.set(
        streamKey,
        updates.map((update, index) => ({
          id: `${index + 1}-0`,
          message: { u: Buffer.from(update).toString('base64'), ...(agent ? { a: '1' } : {}) },
        }))
      )
      state.backing!.seq = updates.length
      const store = await newStore()
      const doc = new Y.Doc()
      await store.attachRoom(NAME, doc)

      await vi.waitFor(() =>
        expect(
          state.backing!.streams.get(streamKey)!.some((entry) => entry.message.c === '1')
        ).toBe(true)
      )
      const rebuilt = new Y.Doc()
      Y.applyUpdate(rebuilt, (await store.getStreamState(NAME))!)
      expect(rebuilt.getText('body').length).toBe(7 * 1024 * 1024 + 4)
      store.detachRoom(NAME)
      rebuilt.destroy()
      source.destroy()
      doc.destroy()
    }
  )

  it('keeps failed compaction accounting armed without repeated snapshot appends', async () => {
    seedLegacyStream()
    const store = await newStore()
    const doc = new Y.Doc()
    await store.attachRoom(NAME, doc)
    const room = storeInternals(store).rooms.get(NAME)!
    room.uncompactedDeltaBytes = 9 * 1024 * 1024
    state.backing!.failSnapshotTrim = true

    await storeInternals(store).maybeCompact(NAME)

    expect(room.uncompactedDeltaBytes).toBe(9 * 1024 * 1024)
    expect(room.compactRetryAfter).toBeGreaterThan(Date.now())
    const entriesAfterFailure = state.backing!.streams.get(`filedoc:stream:${NAME}`)!.length
    await storeInternals(store).maybeCompact(NAME)
    await storeInternals(store).maybeCompact(NAME)
    expect(state.backing!.streams.get(`filedoc:stream:${NAME}`)).toHaveLength(entriesAfterFailure)

    state.backing!.failSnapshotTrim = false
    room.compactRetryAfter = 0
    await storeInternals(store).maybeCompact(NAME)
    expect(room.uncompactedDeltaBytes).toBeLessThan(9 * 1024 * 1024)
    store.detachRoom(NAME)
    doc.destroy()
  })

  it('retains the last delta without repeatedly folding an unreclaimable boundary', async () => {
    seedLegacyStream()
    const store = await newStore()
    const doc = new Y.Doc()
    await store.attachRoom(NAME, doc)
    const room = storeInternals(store).rooms.get(NAME)!
    room.uncompactedDeltaBytes = 9 * 1024 * 1024
    room.lastDeltaBytes = room.uncompactedDeltaBytes
    await storeInternals(store).maybeCompact(NAME)
    expect(state.backing!.streams.get(`filedoc:stream:${NAME}`)).toHaveLength(1)
    expect(room.uncompactedDeltaBytes).toBe(9 * 1024 * 1024)
    store.detachRoom(NAME)
    doc.destroy()
  })

  it('excludes older agent compaction output from delta bytes', async () => {
    seedLegacyStream()
    const store = await newStore()
    const doc = new Y.Doc()
    await store.attachRoom(NAME, doc)
    const room = storeInternals(store).rooms.get(NAME)!
    const priorBytes = room.uncompactedDeltaBytes
    const encoded = Buffer.from(updateFor('agent snapshot')).toString('base64')
    storeInternals(store).applyEntry(NAME, room, '7-0', { u: encoded, a: '1', c: '1' })
    expect(room.uncompactedDeltaBytes).toBe(priorBytes)
    expect(room.lastDeltaBytes).toBe(0)
    expect(doc.getText('body').toString()).toBe('agent snapshot')
    store.detachRoom(NAME)
    doc.destroy()
  })

  it('counts peer deltas once using ordered replay without retaining an entry ledger', async () => {
    seedLegacyStream()
    const store = await newStore()
    const doc = new Y.Doc()
    await store.attachRoom(NAME, doc)
    const room = storeInternals(store).rooms.get(NAME)!
    const priorBytes = room.uncompactedDeltaBytes
    const encoded = Buffer.from(updateFor('peer')).toString('base64')
    storeInternals(store).applyEntry(NAME, room, '4-0', { u: encoded })
    storeInternals(store).applyEntry(NAME, room, '4-0', { u: encoded })
    storeInternals(store).applyEntry(NAME, room, '3-0', { u: encoded })
    expect(room.uncompactedDeltaBytes).toBe(priorBytes + encoded.length)
    expect(room.lastDeltaBytes).toBe(encoded.length)
    store.detachRoom(NAME)
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
    storeInternals(a).rooms.set(NAME, {
      doc: agentDoc,
      lastId: '400-0',
      publishes: 0,
      uncompactedDeltaBytes: 0,
      lastDeltaBytes: 0,
      compactRetryAfter: 0,
      compacting: false,
      seededObserved: true,
      realEdited: false,
    })
    await storeInternals(a).maybeCompact(NAME)

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
    seedLegacyStream()
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

  it('deduplicates acknowledged client retries by update id', async () => {
    seedLegacyStream()
    const store = await newStore()
    const update = updateFor('retry-safe')

    await store.publishClientUpdateAndWait(NAME, 'update-1', update)
    await store.publishClientUpdateAndWait(NAME, 'update-1', update)

    expect(state.backing!.streams.get(`filedoc:stream:${NAME}`)).toHaveLength(2)
  })

  it('does not drop different payloads that reuse an acknowledged update id', async () => {
    seedLegacyStream()
    const store = await newStore()

    await store.publishClientUpdateAndWait(NAME, 'update-1', updateFor('first'))
    await store.publishClientUpdateAndWait(NAME, 'update-1', updateFor('second'))

    expect(state.backing!.streams.get(`filedoc:stream:${NAME}`)).toHaveLength(3)
  })

  it('uses unambiguous acknowledged-update deduplication keys', async () => {
    seedLegacyStream()
    const store = await newStore()

    await store.publishClientUpdateAndWait(NAME, 'a', new Uint8Array([0, 98]))
    await store.publishClientUpdateAndWait(NAME, 'a\0', new Uint8Array([98]))

    expect(state.backing!.streams.get(`filedoc:stream:${NAME}`)).toHaveLength(3)
  })

  it('bounds acknowledged-update deduplication independently of stream traffic', async () => {
    seedLegacyStream()
    const store = await newStore()
    const update = updateFor('bounded')

    for (let index = 0; index <= 16_384; index += 1) {
      await store.publishClientUpdateAndWait(NAME, `update-${index}`, update)
    }

    expect(state.backing!.dedupe.get(`filedoc:updates:${NAME}`)).toHaveLength(16_384)
  })

  it('limits every multiplexed read to four streams and one entry per stream', async () => {
    const store = await newStore()
    const docs = Array.from({ length: 9 }, () => new Y.Doc())
    await Promise.all(docs.map((doc, index) => store.attachRoom(`${NAME}-${index}`, doc)))
    state.backing!.maxReadStreams = 0
    state.backing!.maxReadCount = 0
    const readsBefore = state.backing!.reads

    await vi.waitFor(() => expect(state.backing!.reads).toBeGreaterThan(readsBefore))

    expect(state.backing!.maxReadStreams).toBeLessThanOrEqual(4)
    expect(state.backing!.maxReadCount).toBe(1)
    docs.forEach((doc, index) => {
      store.detachRoom(`${NAME}-${index}`)
      doc.destroy()
    })
  })

  it.each(['client', 'server'] as const)(
    'does not delay a durable %s append for pending compaction',
    async (publisher) => {
      const store = await newStore()
      await store.seedIfEmpty(NAME, seedFor('base'))
      const doc = new Y.Doc()
      await store.attachRoom(NAME, doc)
      const room = storeInternals(store).rooms.get(NAME)!
      room.publishes = 63
      let finishCompaction!: () => void
      const compaction = new Promise<void>((resolve) => {
        finishCompaction = resolve
      })
      state.backing!.onLength = vi.fn(() => compaction)
      const publish = (id: string) =>
        publisher === 'client'
          ? store.publishClientUpdateAndWait(NAME, id, updateFor(id), 'doc-base')
          : store.publishAndWait(NAME, updateFor(id), 'doc-base')
      let accepted = false
      const pending = publish('first').then(() => {
        accepted = true
      })
      try {
        await vi.waitFor(() => expect(accepted).toBe(true))
        expect(room.compacting).toBe(true)
        expect(state.backing!.streams.get(`filedoc:stream:${NAME}`)).toHaveLength(2)
        room.publishes = 127
        await publish('second')
        expect(state.backing!.onLength).toHaveBeenCalledOnce()
        expect(state.backing!.streams.get(`filedoc:stream:${NAME}`)).toHaveLength(3)
      } finally {
        finishCompaction()
        await pending
        await vi.waitFor(() => expect(room.compacting).toBe(false))
        store.detachRoom(NAME)
        doc.destroy()
      }
    }
  )

  it('compacts on retained bytes before the entry-count threshold can exhaust replay', async () => {
    const streamKey = `filedoc:stream:${NAME}`
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64')
    state.backing!.streams.set(streamKey, [{ id: '1-0', message: { u: snapshot } }])
    state.backing!.seq = 1
    const store = await newStore()
    storeInternals(store).rooms.set(NAME, {
      doc: new Y.Doc(),
      lastId: '1-0',
      publishes: 0,
      uncompactedDeltaBytes: 12 * 1024 * 1024,
      lastDeltaBytes: 0,
      compactRetryAfter: 0,
      compacting: false,
      seededObserved: true,
      realEdited: true,
    })

    await storeInternals(store).maybeCompact(NAME)

    const stream = state.backing!.streams.get(streamKey)!
    expect(stream).toHaveLength(2)
    expect(stream.at(-1)?.message.s).toBe('1')
  })

  it('does not compact a large snapshot again while continuing to accept small edits', async () => {
    const store = await newStore()
    const source = docWithText('x'.repeat(9 * 1024 * 1024))
    source.getMap('config').set('initialContentLoaded', true)
    source.getMap('config').set('docId', 'large-document')
    const streamKey = `filedoc:stream:${NAME}`
    state.backing!.kv.set(`filedoc:generation:${NAME}`, 'large-document')
    state.backing!.streams.set(streamKey, [
      {
        id: '1-0',
        message: {
          u: Buffer.from(Y.encodeStateAsUpdate(source)).toString('base64'),
          s: '1',
          g: 'large-document',
        },
      },
    ])
    state.backing!.seq = 1
    const loaded = new Y.Doc()
    await store.attachRoom(NAME, loaded)
    expect(storeInternals(store).rooms.get(NAME)!.uncompactedDeltaBytes).toBe(0)

    let deltaBytes = 0
    for (let index = 0; index < 30; index++) {
      const before = Y.encodeStateVector(source)
      source.getText('body').insert(source.getText('body').length, 'y')
      const update = Y.encodeStateAsUpdate(source, before)
      deltaBytes += Buffer.from(update).toString('base64').length
      await store.publishClientUpdateAndWait(NAME, `small-${index}`, update, 'large-document')
      await store.catchUp(NAME)
    }
    expect(state.backing!.streams.get(streamKey)?.filter((entry) => entry.message.s)).toHaveLength(
      1
    )
    expect(storeInternals(store).rooms.get(NAME)!.uncompactedDeltaBytes).toBe(deltaBytes)
    expect(loaded.getText('body').length).toBe(9 * 1024 * 1024 + 30)
    store.detachRoom(NAME)
    source.destroy()
    loaded.destroy()
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
    state.backing!.onSnapshot = async () => {
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
    state.backing!.nextIds = ['1000-0', '1000-1', '1000-2']
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
    state.backing!.nextIds = ['1000-3', '1000-0', '1000-1']
    state.backing!.onSnapshot = async () => {
      await replacer.invalidateDocument(NAME, 20)
      await replacer.seedIfEmpty(NAME, freshSeed, 20)
      await replacer.publishClientUpdateAndWait(NAME, 'fresh-edit', freshEdit, 'new-generation')
      expect(state.backing!.streams.get(streamKey)?.map((entry) => entry.id)).toEqual([
        '1000-0',
        '1000-1',
      ])
    }

    await storeInternals(store).maybeCompact(NAME)

    expect(state.backing!.streams.get(streamKey)?.map((entry) => entry.id)).toEqual([
      '1000-0',
      '1000-1',
    ])
    await replacer.publishClientUpdateAndWait(NAME, 'fresh-edit', freshEdit, 'new-generation')
    expect(state.backing!.streams.get(streamKey)).toHaveLength(2)
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

  it('expires idle single-replica invalidation watermarks', async () => {
    vi.useFakeTimers()
    const store = new FileDocStore(undefined)
    try {
      for (let index = 0; index < 100; index++) {
        await store.invalidateDocument(`closed-${index}`, 10)
      }
      expect(storeInternals(store).localInvalidations.size).toBe(100)
      await vi.advanceTimersByTimeAsync(660_000)
      expect(storeInternals(store).localInvalidations.size).toBe(0)
    } finally {
      await store.shutdown()
      vi.useRealTimers()
    }
  })

  it('deduplicates single-replica invalidations across same-version seeds and room reopen', async () => {
    const store = new FileDocStore(undefined)
    const staleDoc = new Y.Doc()
    await store.attachRoom(NAME, staleDoc)
    await store.invalidateDocument(NAME, 20)
    await expect(store.seedIfEmpty(NAME, seedFor('stale fetched seed'), 10)).resolves.toBe(false)
    await expect(store.isDocumentGenerationCurrent(NAME)).resolves.toBe(false)
    expect(storeInternals(store).localInvalidations.size).toBe(1)
    await expect(store.seedIfEmpty(NAME, seedFor('same-version seed'), 20)).resolves.toBe(true)
    await expect(store.invalidateDocument(NAME, 20)).resolves.toEqual({ status: 'stale' })
    await expect(store.isDocumentGenerationCurrent(NAME)).resolves.toBe(true)

    store.detachRoom(NAME)
    expect(storeInternals(store).localInvalidations.size).toBe(1)
    const freshDoc = new Y.Doc()
    await store.attachRoom(NAME, freshDoc)
    await expect(store.seedIfEmpty(NAME, seedFor('fresh authoritative seed'), 20)).resolves.toBe(
      true
    )
    await expect(store.invalidateDocument(NAME, 20)).resolves.toEqual({ status: 'stale' })
    await expect(store.isDocumentGenerationCurrent(NAME)).resolves.toBe(true)
    await store.invalidateDocument(NAME, 40)
    await store.shutdown()
    expect(storeInternals(store).localInvalidations.size).toBe(0)
    staleDoc.destroy()
    freshDoc.destroy()
  })

  it('fails closed when a Redis-backed store has not initialized', async () => {
    const store = new FileDocStore(REDIS_URL)
    const doc = new Y.Doc()

    await expect(store.attachRoom(NAME, doc)).rejects.toThrow('not initialized')
    await expect(
      store.publishClientUpdateAndWait(NAME, 'update-1', updateFor('x'))
    ).rejects.toThrow('not initialized')
    await expect(store.seedIfEmpty(NAME, seedFor('seed'))).rejects.toThrow('not initialized')
    await expect(store.getStreamState(NAME)).rejects.toThrow('not initialized')
    expect(await store.acquireMergeSlot(NAME, 1_000)).toBeNull()
    doc.destroy()
  })

  it('streamHasContent fences a seed apply against an already-seeded stream', async () => {
    const a = await newStore()
    expect(await a.streamHasContent(NAME)).toBe(false)
    await a.seedIfEmpty(NAME, seedFor('seeded'))
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

  it.each([
    { redis: true, docId: undefined },
    { redis: true, docId: '' },
    { redis: false, docId: undefined },
    { redis: false, docId: '' },
  ])('rejects an unnamed seed before publication (%j)', async ({ redis, docId }) => {
    const store = redis ? await newStore() : new FileDocStore(undefined)
    const doc = new Y.Doc()
    const config = doc.getMap(FILE_DOC_SEED.configMap)
    config.set(FILE_DOC_SEED.flag, true)
    if (docId !== undefined) config.set(FILE_DOC_SEED.docIdKey, docId)
    try {
      await expect(store.seedIfEmpty(NAME, Y.encodeStateAsUpdate(doc), 1)).rejects.toThrow(
        'missing its accepted document identity'
      )
      await expect(store.getStreamState(NAME)).resolves.toBeNull()
    } finally {
      doc.destroy()
      if (!redis) await store.shutdown()
    }
  })

  it('uses the same accepted identity for the seed owner and a replaying peer', async () => {
    const owner = await newStore()
    const peer = await newStore()
    const ownerDoc = new Y.Doc()
    const peerDoc = new Y.Doc()
    try {
      await owner.attachRoom(NAME, ownerDoc)
      const seed = seedFor('shared identity')
      expect(await owner.seedIfEmpty(NAME, seed, 1)).toBe(true)
      Y.applyUpdate(ownerDoc, seed)
      await peer.attachRoom(NAME, peerDoc)
      for (const [store, doc] of [
        [owner, ownerDoc],
        [peer, peerDoc],
      ] as const) {
        const docId = doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)
        expect(docId).toBe('doc-shared identity')
        expect(await store.getDocumentGeneration(NAME)).toBe(docId)
        expect(await store.isDocumentGenerationCurrent(NAME, 'doc-shared identity')).toBe(true)
      }
    } finally {
      ownerDoc.destroy()
      peerDoc.destroy()
    }
  })

  it('seedIfEmpty writes the seed once and reports it, then refuses a non-empty stream', async () => {
    const a = await newStore()
    expect(await a.seedIfEmpty(NAME, seedFor('first'))).toBe(true)
    // A second seed attempt (any task) must be refused — the stream already holds content.
    const b = await newStore()
    expect(await b.seedIfEmpty(NAME, seedFor('second'))).toBe(false)
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
    state.backing!.streams.set(streamKey, entries)
    state.backing!.seq = 402

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
