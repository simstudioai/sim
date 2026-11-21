/**
 * An in-memory stand-in for the node-redis client surface {@link FileDocStore} uses (streams, locks,
 * and its Lua scripts, matched by shape), so unit tests can run the store and the relay without a Redis
 * server. Tests install it with `vi.mock('redis', () => ({ createClient: () => makeClient() }))` and
 * reset {@link fakeRedis}.backing with {@link createBacking} before each test; every client shares that
 * backing, so several stores model several tasks on one Redis.
 *
 * @module
 */
import { sleep } from '@sim/utils/helpers'

interface TestStreamEntry {
  id: string
  message: Record<string, string>
}

export interface TestRedisClient {
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
export interface Backing {
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
  /** Reads currently awaiting a reply, and the most ever in flight at once: one per reader loop. */
  inFlightReads: number
  maxInFlightReads: number
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

function compareStreamIds(left: string, right: string): bigint {
  const [leftMs, leftSequence] = left.split('-').map(BigInt)
  const [rightMs, rightSequence] = right.split('-').map(BigInt)
  return leftMs === rightMs ? leftSequence - rightSequence : leftMs - rightMs
}

/** A client over the current {@link fakeRedis} backing; `duplicate()` shares it. */
export function makeClient(): TestRedisClient {
  const b = () => {
    if (!fakeRedis.backing) throw new Error('backing not initialized')
    return fakeRedis.backing
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
      b().inFlightReads++
      b().maxInFlightReads = Math.max(b().maxInFlightReads, b().inFlightReads)
      try {
        await sleep(5)
      } finally {
        b().inFlightReads--
      }
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
        arr.push({ id, message: { [field]: value, eu: opts.arguments[6], ec: opts.arguments[7] } })
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
            eu: opts.arguments[7],
            ec: opts.arguments[8],
            ei: opts.arguments[9],
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

/** The backing every fake client reads and writes; reset per test with {@link createBacking}. */
export const fakeRedis: { backing: Backing | null } = { backing: null }

export function createBacking(): Backing {
  return {
    streams: new Map(),
    kv: new Map(),
    dedupe: new Map(),
    seq: 0,
    failXAdd: 0,
    readerClosed: false,
    reads: 0,
    failedReadTimes: [],
    idleReads: 0,
    inFlightReads: 0,
    maxInFlightReads: 0,
    connects: 0,
    maxRangeCount: 0,
    rangeCalls: 0,
    maxReadStreams: 0,
    maxReadCount: 0,
  }
}
