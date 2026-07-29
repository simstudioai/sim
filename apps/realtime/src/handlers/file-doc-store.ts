/**
 * Shared, multi-replica Yjs backend for the collaborative file-document relay, over Redis Streams.
 *
 * The relay keeps an in-memory {@link Y.Doc} per open file (for the sync handshake, awareness, and
 * copilot merges), but on a horizontally-scaled deployment (multiple ECS tasks, autoscaling) that
 * per-process doc is NOT authoritative on its own: two tasks each seeding the same file from markdown
 * would mint independent Yjs client ids and union into duplicated content (split-brain), and a task
 * only ever sees the edits of ITS OWN clients. This module makes every task converge on ONE CRDT per
 * file by treating a Redis Stream as the shared, ordered, replayable log of Yjs updates — the union of
 * a stream's entries IS the document. It is the "shared Yjs backend (y-redis / Hocuspocus)" the relay's
 * single-replica model always deferred, built natively for our Socket.IO transport on the Redis the
 * Socket.IO adapter already runs.
 *
 * How it fits the relay's message flow (see `file-doc.ts`):
 * - Doc-sync messages no longer ride the Socket.IO Redis ADAPTER cross-pod. Instead each applied
 *   update is {@link publish}ed to the stream; every task's multiplexed reader
 *   applies it to its local doc (origin {@link REDIS_ORIGIN}) and fans it out to ITS OWN clients. So a
 *   client receives each update exactly once, from its own task's local broadcast — no adapter
 *   amplification, and every task's doc stays converged. (Awareness/presence stay on the adapter: they
 *   are ephemeral and need no convergence or replay.)
 * - {@link attachRoom} does a synchronous catch-up read from the head of the stream when a task first
 *   opens a file, so a late-joining task (the normal case under autoscaling) loads the current shared
 *   state before its first client syncs. Catch-up + tail are seamless: the tailer resumes from the
 *   exact id catch-up stopped at.
 * - {@link shouldSeed} coordinates the one-time seed with a Redis lock AND an empty-stream check, so
 *   exactly one task ever writes the seed cluster-wide (the fix for split-brain).
 *
 * When `REDIS_URL` is unset (single-pod dev) the store is DISABLED and every method degrades to the
 * relay's original single-replica behavior: seed locally, no stream, no tailer.
 *
 * @module
 */
import { createLogger } from '@sim/logger'
import { FILE_DOC_TIMEOUTS } from '@sim/realtime-protocol/file-doc'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { createClient, type RedisClientType } from 'redis'
import * as Y from 'yjs'

const logger = createLogger('FileDocStore')

/**
 * Compare-and-delete: release a lock ONLY if this task still holds it (its token still the value), so a
 * lock that expired and was re-acquired by another task is never stolen by the original holder's release.
 */
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"

/**
 * The transaction origin the store stamps on updates it applies from the stream. The relay's
 * `doc.on('update')` handler uses it to distinguish an update that ARRIVED from a peer (fan out to
 * local clients, but do NOT re-publish — it is already in the stream) from a local edit (fan out AND
 * publish). It must be a non-string sentinel so it is never mistaken for a socket id.
 */
export const REDIS_ORIGIN = Symbol('file-doc-redis')

/**
 * Origin for a COMPACTED SNAPSHOT applied from the stream. A snapshot folds the seed + all prior edits
 * into one entry, so a fresh task catching up from it would otherwise never see a separate post-seed
 * edit frame and would treat the doc as unedited. The relay's edit-tracker uses this origin to mark the
 * doc edited (a snapshot only exists after the stream crossed the compaction threshold, i.e. real edits
 * happened). Behaves like {@link REDIS_ORIGIN} otherwise (already in the stream — never re-published).
 */
export const REDIS_SNAPSHOT_ORIGIN = Symbol('file-doc-redis-snapshot')

const STREAM_PREFIX = 'filedoc:stream:'
const SEED_LOCK_PREFIX = 'filedoc:seedlock:'
const COMPACT_LOCK_PREFIX = 'filedoc:compactlock:'
const PERSIST_LOCK_PREFIX = 'filedoc:persistlock:'
const MERGE_LOCK_PREFIX = 'filedoc:mergelock:'

/** The field each stream entry carries — a base64 Yjs update. */
const UPDATE_FIELD = 'u'
/** Marks a stream entry as a compaction SNAPSHOT (folds seed + edits), so the tailer applies it with
 * {@link REDIS_SNAPSHOT_ORIGIN}. Present only on snapshot entries. */
const SNAPSHOT_FIELD = 's'

/** Sentinel token a DISABLED store returns from a lock acquire, so single-replica callers proceed
 * without special-casing; {@link FileDocStore.releaseLock} treats it as a no-op. Not a real UUID, so it
 * can never collide with a {@link generateId} token. */
const DISABLED_LOCK_TOKEN = '__disabled__'

/** How long a blocking multiplexed read waits before re-snapshotting the live room set. Also bounds
 * how long a room attached mid-block waits for its first cross-task update (updates are not lost — the
 * next read resumes from its last id — only briefly delayed). */
const READ_BLOCK_MS = 1_000
/** Idle poll cadence when NO room is open on this task, so a freshly-attached room is picked up fast
 * without busy-spinning an empty task. */
const IDLE_POLL_MS = 250
/** Max entries drained per stream per read. */
const READ_COUNT = 200
/** Compact a stream once it exceeds this many entries (snapshot + trim). */
const COMPACT_THRESHOLD = 400
/** Check whether compaction is due only every Nth local publish, to avoid an XLEN per keystroke. */
const COMPACT_CHECK_EVERY = 64
/** Compaction critical section (snapshot + xAdd + xTrim) is fast; a generous TTL covers a slow Redis
 * round-trip without risking expiry mid-compact. Released via compare-and-delete regardless. */
const COMPACT_LOCK_TTL_MS = 10_000
/** Retry a failed stream append this many times before giving up, so a transient Redis blip doesn't
 * silently drop an edit from the shared log (which no peer would then ever see). */
const PUBLISH_MAX_RETRIES = 3
/** The seed lock spans the app seed fetch (hard-bounded at `seedRequestMs = 8s`) + the apply + the
 * AWAITED seed publish. The margin comfortably exceeds the fetch bound so the lock does not expire
 * mid-seed, while staying at the client readiness deadline (12s) so a dead seeder's lock frees when
 * clients would recover anyway. Double-seed is prevented regardless of the margin: the seeder publishes
 * the seed to the stream BEFORE releasing the lock, so any later seeder's {@link streamHasContent} fence
 * sees it. */
const SEED_LOCK_TTL_MS = FILE_DOC_TIMEOUTS.seedRequestMs + 4_000
/** How long a stream survives with no heartbeat — long enough that an occupied-but-idle doc never
 * loses its shared state (the heartbeat refreshes it while any task holds the room). */
const STREAM_TTL_SEC = 600
/** Refresh every occupied stream's TTL on this cadence, so a live doc's stream never expires. */
const HEARTBEAT_MS = 60_000

const streamKey = (name: string) => `${STREAM_PREFIX}${name}`

/**
 * Decode one stream entry's base64 Yjs update and apply it to `doc`. A malformed entry is logged and
 * SKIPPED — never thrown — so one bad frame can neither wedge the tailer nor abort a headless
 * stream-fold. Shared by the tailer/catch-up (applies with {@link REDIS_ORIGIN}) and the merge-base
 * reconstruction (no origin — a throwaway doc), so the two can never diverge on how an entry is read.
 */
function applyEntryToDoc(
  doc: Y.Doc,
  id: string,
  message: Record<string, string>,
  origin?: unknown
): void {
  const encoded = message[UPDATE_FIELD]
  if (!encoded) return
  try {
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(encoded, 'base64')), origin)
  } catch (error) {
    logger.warn('FileDocStore dropping malformed stream entry', {
      id,
      error: getErrorMessage(error),
    })
  }
}

/** One locally-open room the store tracks: its doc and the last stream id applied to it. */
interface StoreRoom {
  doc: Y.Doc
  /** The id of the last stream entry applied to `doc`; the tailer resumes strictly after it. */
  lastId: string
  /** Local publish count, to pace compaction checks. */
  publishes: number
}

/**
 * The Redis-Streams shared Yjs backend. A single instance per process. `enabled` is false when there
 * is no `REDIS_URL`, in which case every method is a no-op and the relay runs single-replica.
 */
export class FileDocStore {
  readonly enabled: boolean
  /** Command connection: XADD / locks / XLEN / XTRIM / EXPIRE. */
  private write: RedisClientType | null = null
  /** Dedicated connection for blocking XREAD (a blocking command monopolizes its connection). */
  private read: RedisClientType | null = null
  private readonly rooms = new Map<string, StoreRoom>()
  private running = false
  private heartbeat: ReturnType<typeof setInterval> | null = null

  constructor(private readonly redisUrl: string | undefined) {
    this.enabled = Boolean(redisUrl)
  }

  /** Connect the two Redis clients and start the multiplexed reader + TTL heartbeat. Idempotent. */
  async init(): Promise<void> {
    if (!this.enabled || this.running || !this.redisUrl) return
    const options = {
      url: this.redisUrl,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 10) return new Error('FileDocStore Redis reconnection failed')
          return Math.min(retries * 100, 3000)
        },
      },
    }
    this.write = createClient(options)
    this.read = this.write.duplicate()
    this.write.on('error', (err) => logger.error('FileDocStore write client error:', err))
    this.read.on('error', (err) => logger.error('FileDocStore read client error:', err))
    await Promise.all([this.write.connect(), this.read.connect()])
    this.running = true
    void this.runReader()
    this.heartbeat = setInterval(() => void this.refreshTtls(), HEARTBEAT_MS)
    logger.info('FileDocStore ready — shared Yjs backend over Redis Streams enabled')
  }

  /** Stop the reader/heartbeat and close both clients. */
  async shutdown(): Promise<void> {
    this.running = false
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    await Promise.all([this.write?.quit().catch(() => {}), this.read?.quit().catch(() => {})])
    this.write = null
    this.read = null
  }

  /**
   * Register a locally-opened room and load the shared state into its doc: read the whole stream from
   * the head, apply every entry (origin {@link REDIS_ORIGIN}), and remember the last id so the tailer
   * resumes exactly after it. A brand-new file has an empty stream and loads nothing (it is seeded
   * shortly after, via {@link shouldSeed}). No-op when disabled.
   */
  async attachRoom(name: string, doc: Y.Doc): Promise<void> {
    if (!this.enabled || !this.write) return
    // Register BEFORE the async read so a concurrent publish/tailer for this room can't be missed —
    // the tailer resumes from `lastId`, which the catch-up advances.
    const room: StoreRoom = { doc, lastId: '0', publishes: 0 }
    this.rooms.set(name, room)
    try {
      const entries = await this.write.xRange(streamKey(name), '-', '+')
      for (const entry of entries) {
        // The room can be detached + its doc destroyed while catch-up is in flight (a fast open→close);
        // stop touching it the moment that happens.
        if (this.rooms.get(name) !== room) return
        this.applyEntry(room, entry.id, entry.message)
      }
      await this.write.expire(streamKey(name), STREAM_TTL_SEC)
    } catch (error) {
      logger.warn(`FileDocStore catch-up failed for ${name}`, { error: getErrorMessage(error) })
    }
  }

  /** Deregister a room the relay is destroying, so the tailer stops touching its (about-to-be-destroyed) doc. */
  detachRoom(name: string): void {
    this.rooms.delete(name)
  }

  /**
   * Append a locally-applied update to the shared stream so every task converges, AWAITING the write
   * and retrying a transient failure ({@link PUBLISH_MAX_RETRIES}) so a Redis blip can't silently drop
   * an edit from the shared log. Only the `xAdd` is retried; the TTL refresh + compaction check are
   * post-write best-effort and never re-trigger the append. Throws if the append ultimately fails.
   */
  private async appendUpdate(name: string, update: Uint8Array): Promise<void> {
    if (!this.write) return
    const encoded = Buffer.from(update).toString('base64')
    for (let attempt = 0; attempt <= PUBLISH_MAX_RETRIES; attempt++) {
      try {
        await this.write.xAdd(streamKey(name), '*', { [UPDATE_FIELD]: encoded })
        break
      } catch (error) {
        if (attempt === PUBLISH_MAX_RETRIES) {
          logger.error(`FileDocStore append failed for ${name}`, { error: getErrorMessage(error) })
          throw error
        }
        // Snappy backoff — a stream append is a fast op; a transient blip clears in tens of ms.
        // `backoffWithJitter` is 1-indexed, so pass the 1-based attempt number.
        await sleep(backoffWithJitter(attempt + 1, null, { baseMs: 50, maxMs: 500 }))
      }
    }
    await this.write.expire(streamKey(name), STREAM_TTL_SEC).catch(() => {})
    const room = this.rooms.get(name)
    if (room && ++room.publishes % COMPACT_CHECK_EVERY === 0) void this.maybeCompact(name)
  }

  /**
   * Fire-and-forget append for the hot keystroke path (`doc.on('update')`): converges peers without
   * blocking the relay. Retries internally; never throws. No-op when disabled.
   */
  publish(name: string, update: Uint8Array): void {
    if (!this.enabled || !this.write) return
    void this.appendUpdate(name, update).catch(() => {}) // already logged inside appendUpdate
  }

  /**
   * Awaitable append for callers that must know the update is durably in the stream before proceeding
   * — the copilot merge, so the cross-task merge lock is not released before the diff is committed
   * (else the next task would diff a stale base). Throws on ultimate failure. No-op when disabled.
   */
  async publishAndWait(name: string, update: Uint8Array): Promise<void> {
    if (!this.enabled || !this.write) return
    await this.appendUpdate(name, update)
  }

  /**
   * Whether the file's stream already holds content — fences a seed apply against a peer that seeded
   * while this task held a (possibly stale) lock, so we never write a second seed (split-brain). Both
   * callers treat `true` as "do not seed", so this fails CLOSED: a Redis `xLen` error returns `true`
   * (cannot confirm the stream is empty → do not risk a double-seed). `false` only when genuinely empty,
   * or when disabled (single-replica, where seeding locally is always correct).
   */
  async streamHasContent(name: string): Promise<boolean> {
    if (!this.enabled || !this.write) return false
    try {
      return (await this.write.xLen(streamKey(name))) > 0
    } catch (error) {
      logger.warn(`FileDocStore streamHasContent failed for ${name}`, {
        error: getErrorMessage(error),
      })
      return true
    }
  }

  /**
   * Acquire a distributed lock with a unique ownership TOKEN (`SET key <token> NX PX`). Returns the
   * token to release with, or `null` if not won. Fails CLOSED (null) on a Redis error — a lock we can't
   * prove we hold must not be treated as held. The special sentinel {@link DISABLED_LOCK_TOKEN} lets a
   * disabled store return a truthy token so callers proceed single-replica without special-casing.
   */
  private async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    if (!this.enabled || !this.write) return DISABLED_LOCK_TOKEN
    const token = generateId()
    try {
      return (await this.write.set(key, token, { NX: true, PX: ttlMs })) === 'OK' ? token : null
    } catch (error) {
      logger.warn(`FileDocStore lock ${key} failed`, { error: getErrorMessage(error) })
      return null
    }
  }

  /** Release a lock via compare-and-delete, so it is only dropped if we still hold our token. */
  private async releaseLock(key: string, token: string): Promise<void> {
    if (!this.write || token === DISABLED_LOCK_TOKEN) return
    await this.write.eval(RELEASE_LOCK_SCRIPT, { keys: [key], arguments: [token] }).catch(() => {})
  }

  /**
   * Decide whether THIS task should build and write the file's one-time seed. Returns a lock TOKEN only
   * when the shared stream is genuinely empty AND this task wins the seed lock — so exactly one task
   * across the cluster ever seeds a file, even if several open it at once (the fix for split-brain
   * seeding). `null` otherwise. Release the token with {@link releaseSeedLock}. Disabled → always a
   * token (single-replica: seed locally).
   */
  async shouldSeed(name: string): Promise<string | null> {
    const token = await this.acquireLock(`${SEED_LOCK_PREFIX}${name}`, SEED_LOCK_TTL_MS)
    if (!token || token === DISABLED_LOCK_TOKEN) return token
    // The lock could be free yet the stream already seeded (a prior holder seeded then its lock
    // expired). Re-check under the lock so we never write a SECOND seed on top of an existing one.
    if (await this.streamHasContent(name)) {
      await this.releaseSeedLock(name, token)
      return null
    }
    return token
  }

  /**
   * Build the file's current shared state from the stream, headless (no registered room), for a merge
   * that must reach the live doc regardless of which task holds it. Returns the encoded Yjs state, or
   * `null` when the stream is empty — i.e. no doc is (or was recently) live, so there is nothing to
   * merge into and the caller should fall back to a direct file write. Disabled → always null.
   */
  async getStreamState(name: string): Promise<Uint8Array | null> {
    if (!this.enabled || !this.write) return null
    const entries = await this.write.xRange(streamKey(name), '-', '+')
    if (entries.length === 0) return null
    const doc = new Y.Doc()
    try {
      for (const entry of entries) applyEntryToDoc(doc, entry.id, entry.message)
      return Y.encodeStateAsUpdate(doc)
    } finally {
      doc.destroy()
    }
  }

  /** Release the seed lock (compare-and-delete) once the seed has been published or a seed attempt failed. */
  async releaseSeedLock(name: string, token: string): Promise<void> {
    await this.releaseLock(`${SEED_LOCK_PREFIX}${name}`, token)
  }

  /**
   * A best-effort TTL dedup WINDOW (NOT a lock): claim the right to run a debounced persist for the next
   * `ttlMs`, so concurrent tasks editing the same file don't each write a redundant blob version. It is
   * never released — it simply expires after `ttlMs`, gating the debounced persist to ~once per window
   * cluster-wide. Fails OPEN (returns true on a Redis error): a redundant persist is a harmless
   * idempotent write, so it must never block a real one. The final last-collaborator flush does NOT gate
   * on this — it must always write.
   */
  async tryClaimPersistWindow(name: string, ttlMs: number): Promise<boolean> {
    if (!this.enabled || !this.write) return true
    try {
      const won = await this.write.set(`${PERSIST_LOCK_PREFIX}${name}`, '1', {
        NX: true,
        PX: ttlMs,
      })
      return won === 'OK'
    } catch {
      return true
    }
  }

  /**
   * Try to claim the cross-task right to merge new content into this file. The relay already serializes
   * merges per task; this extends that across tasks so two copilot edits to the same file landing on
   * different tasks don't each diff the SAME shared base and publish conflicting full-document rewrites.
   * The loser waits and retries so it diffs against the winner's RESULT (correct sequential merge).
   * Returns a lock TOKEN (proceed) when disabled or once won; `null` otherwise (fails CLOSED on error, so
   * a merge never races when exclusivity can't be proven). Release with {@link releaseMergeSlot}.
   */
  async acquireMergeSlot(name: string, ttlMs: number): Promise<string | null> {
    return this.acquireLock(`${MERGE_LOCK_PREFIX}${name}`, ttlMs)
  }

  async releaseMergeSlot(name: string, token: string): Promise<void> {
    await this.releaseLock(`${MERGE_LOCK_PREFIX}${name}`, token)
  }

  private applyEntry(room: StoreRoom, id: string, message: Record<string, string>): void {
    room.lastId = id
    // A compaction snapshot folds seed + edits into one frame; stamp it so the relay's edit-tracker
    // treats a fresh catch-up from it as edited (a snapshot only exists once real edits accumulated).
    const origin = message[SNAPSHOT_FIELD] ? REDIS_SNAPSHOT_ORIGIN : REDIS_ORIGIN
    applyEntryToDoc(room.doc, id, message, origin)
  }

  /**
   * The single multiplexed tail loop: block-read every locally-open room's stream from its last id and
   * apply new entries. One blocking connection for the whole process regardless of open-file count.
   */
  private async runReader(): Promise<void> {
    while (this.running && this.read) {
      const snapshot = new Map(this.rooms)
      if (snapshot.size === 0) {
        await sleep(IDLE_POLL_MS)
        continue
      }
      try {
        const res = await this.read.xRead(
          [...snapshot].map(([name, room]) => ({ key: streamKey(name), id: room.lastId })),
          { BLOCK: READ_BLOCK_MS, COUNT: READ_COUNT }
        )
        if (!res) continue
        for (const stream of res) {
          const name = stream.name.slice(STREAM_PREFIX.length)
          const room = this.rooms.get(name)
          // Skip if detached mid-read, OR replaced by a close→reopen (a DIFFERENT StoreRoom): applying
          // entries read against the OLD room's lastId to the new one could regress its lastId (harmless
          // but wasteful re-delivery). The new room caught itself up via xRange already.
          if (!room || room !== snapshot.get(name)) continue
          for (const entry of stream.messages) this.applyEntry(room, entry.id, entry.message)
        }
      } catch (error) {
        if (!this.running) break
        logger.warn('FileDocStore reader error; retrying', { error: getErrorMessage(error) })
        await sleep(500)
      }
    }
  }

  /**
   * Snapshot-then-trim compaction: append a full-state snapshot and drop the older deltas it subsumes,
   * so the stream stays bounded while a fresh task can still catch up from the head. Lock-guarded so
   * only one task compacts a given stream at a time (concurrent snapshot+trim would race). Trims only up
   * to what the snapshot provably contains — never un-integrated peer entries (see below).
   */
  private async maybeCompact(name: string): Promise<void> {
    if (!this.write) return
    const room = this.rooms.get(name)
    if (!room) return
    try {
      if ((await this.write.xLen(streamKey(name))) < COMPACT_THRESHOLD) return
      const key = `${COMPACT_LOCK_PREFIX}${name}`
      const token = await this.acquireLock(key, COMPACT_LOCK_TTL_MS)
      if (!token) return
      try {
        // Capture the snapshot AND the id it covers in one synchronous step (no await between): the
        // snapshot is `room.doc`, which holds exactly what this task's tailer has integrated — every
        // entry up to `room.lastId`. Entries a peer task published AFTER that (id > lastId) are NOT in
        // the snapshot and this task's blocking reader may not have seen them yet, so we must NOT trim
        // them — only entries the snapshot provably subsumes (id <= lastId). Trimming to the freshly
        // appended snapshot id instead would silently drop those un-integrated peer entries.
        const upTo = room.lastId
        const snapshot = Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64')
        // Mark it a snapshot so a fresh catch-up task treats it as edited content, not a bare seed.
        await this.write.xAdd(streamKey(name), '*', {
          [UPDATE_FIELD]: snapshot,
          [SNAPSHOT_FIELD]: '1',
        })
        // MINID keeps entries with id >= upTo: the snapshot, any un-integrated peer entries, and
        // `upTo` itself (redundant with the snapshot, harmless); it drops only the folded older deltas.
        await this.write.xTrim(streamKey(name), 'MINID', upTo)
      } finally {
        await this.releaseLock(key, token)
      }
    } catch (error) {
      logger.warn(`FileDocStore compaction failed for ${name}`, { error: getErrorMessage(error) })
    }
  }

  private async refreshTtls(): Promise<void> {
    if (!this.write) return
    for (const name of this.rooms.keys()) {
      await this.write.expire(streamKey(name), STREAM_TTL_SEC).catch(() => {})
    }
  }
}

let store: FileDocStore | null = null

/**
 * Initialize the process-wide store from the realtime server bootstrap (alongside the socket adapter).
 * Authoritative: if a disabled placeholder was lazily created by an early {@link getFileDocStore} call,
 * this REPLACES it with the real, connected store — so the bootstrap can never silently no-op. A second
 * call once already initialized is a no-op.
 */
export async function initFileDocStore(redisUrl: string | undefined): Promise<FileDocStore> {
  if (store?.enabled) return store
  store = new FileDocStore(redisUrl)
  await store.init()
  return store
}

/** The process-wide store. Returns a disabled instance if init was never called (e.g. in unit tests). */
export function getFileDocStore(): FileDocStore {
  if (!store) store = new FileDocStore(undefined)
  return store
}
