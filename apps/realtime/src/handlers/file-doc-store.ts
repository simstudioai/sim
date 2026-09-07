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
 * - {@link attachRoom} reads the stream from the head when a task first opens a file, and the relay
 *   AWAITS it before attaching a client, so a late-joining task (the normal case under autoscaling)
 *   holds the current shared state before its first client syncs — a client must never watch the
 *   catch-up land entry by entry, which is the document's edit history replaying on screen. Catch-up +
 *   tail are seamless: the tailer resumes from the exact id catch-up stopped at, and {@link catchUp}
 *   can re-run at any time for a caller that must converge without waiting on the tailer.
 * - The one-time seed is written via the atomic {@link seedIfEmpty} (append-iff-empty in one Redis
 *   step), so exactly one task ever writes the seed cluster-wide (the fix for split-brain) — even if two
 *   tasks race. {@link shouldSeed} is a Redis lock + empty-stream check layered on top ONLY as an
 *   efficiency gate (so tasks don't all run the seed fetch); correctness does not depend on it.
 *
 * When `REDIS_URL` is unset (single-pod dev) the store is DISABLED and every method degrades to the
 * relay's original single-replica behavior: seed locally, no stream, no tailer.
 *
 * @module
 */
import { createLogger } from '@sim/logger'
import { FILE_DOC_SEED, FILE_DOC_TIMEOUTS } from '@sim/realtime-protocol/file-doc'
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
 * Atomic seed: append the seed entry ONLY if the stream is still empty, in one Redis-side step. This is
 * the real split-brain guard — two tasks racing (even both past an expired seed lock) can never both
 * write a seed (each would mint a distinct Yjs client id → duplicated content), because the emptiness
 * check and the append happen atomically with no check-then-append window. The seed lock is only an
 * efficiency optimization (avoid two seed fetches); correctness does not depend on it staying held.
 * Returns 1 if THIS call wrote the seed, 0 if the stream already had content.
 */
const SEED_IF_EMPTY_SCRIPT =
  "if redis.call('xlen', KEYS[1]) == 0 then redis.call('xadd', KEYS[1], '*', ARGV[1], ARGV[2]); return 1 else return 0 end"

/**
 * Monotonic set of the synced-version token: overwrite ONLY when the new value is greater than the
 * stored one (or none is stored). The token is written fire-and-forget from multiple sites (seed stamp,
 * merge, persist) and across tasks, so an out-of-order write must never REGRESS it to a version older
 * than the live doc already incorporates — a regressed token causes spurious If-Match conflicts and, on a
 * last-leave flush with no live room to reconcile into, a lost persist. Refreshes the TTL on both paths
 * so a write skipped as older still keeps the (higher) value alive. Versions are monotonic epoch-ms,
 * comfortably within a Lua double, so the numeric compare is exact.
 */
const SET_VERSION_IF_NEWER_SCRIPT =
  "local c = redis.call('get', KEYS[1]); if c == false or tonumber(c) < tonumber(ARGV[1]) then redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2]) else redis.call('expire', KEYS[1], ARGV[2]) end; return 1"

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

/**
 * Origin for an AGENT-STREAMED frame applied from the stream (a copilot output token relayed via
 * {@link FILE_DOC_MESSAGE_TYPE.SYNC_NO_PERSIST}). A peer task tails these to stay live mid-stream, but
 * they are transient preview content the copilot's durable `edit_content` write reconciles — so the
 * relay's edit-tracker must NOT mark the doc edited on them (a startup-race duplicate between two stream
 * leaders would otherwise become eligible for a peer task's persist). Behaves like {@link REDIS_ORIGIN}
 * otherwise (already in the stream — never re-published).
 */
export const REDIS_AGENT_ORIGIN = Symbol('file-doc-redis-agent')

const STREAM_PREFIX = 'filedoc:stream:'
/** Cluster-wide "durable version the live doc is synced to" (the persist If-Match token). */
const SYNC_VERSION_PREFIX = 'filedoc:syncver:'
const SEED_LOCK_PREFIX = 'filedoc:seedlock:'
const COMPACT_LOCK_PREFIX = 'filedoc:compactlock:'
const PERSIST_LOCK_PREFIX = 'filedoc:persistlock:'
const MERGE_LOCK_PREFIX = 'filedoc:mergelock:'
/** Cluster-wide "a client is actively streaming an agent edit into this live doc" flag — set (refreshed)
 *  on every agent frame so a durable {@link applyMarkdownToLiveFileDoc} merge defers to that client
 *  (which is applying the same content) instead of double-writing it. Short-TTL'd so it self-clears the
 *  moment streaming stops, after which the final durable merge lands as a near-noop. */
const AGENT_STREAM_PREFIX = 'filedoc:agentstream:'

/** The field each stream entry carries — a base64 Yjs update. */
const UPDATE_FIELD = 'u'
/** Marks a stream entry as a compaction SNAPSHOT (folds seed + edits), so the tailer applies it with
 * {@link REDIS_SNAPSHOT_ORIGIN}. Present only on snapshot entries. */
const SNAPSHOT_FIELD = 's'
/** Marks a stream entry as an AGENT-STREAMED preview frame, so the tailer applies it with
 * {@link REDIS_AGENT_ORIGIN} (never marks the doc edited). Present only on agent-frame entries. */
const AGENT_FIELD = 'a'
/**
 * Marks a stream entry as the OUTPUT of a compaction, for byte accounting only.
 *
 * {@link SNAPSHOT_FIELD} cannot serve this purpose: a fold of an agent-only stream is stamped
 * {@link AGENT_FIELD} instead, so it is indistinguishable from an ordinary agent preview frame —
 * and those are the large ones. Excluding both markers would drop preview deltas from accounting;
 * excluding neither would count a snapshot as something a fold can reclaim, arming the trigger
 * against its own output. A separate field settles it without touching origin selection, which
 * must keep treating an agent-only fold as an agent frame to preserve the no-persist guarantee.
 *
 * Entries written before this field existed carry no marker and are counted as deltas. That
 * over-arms by at most one fold, which then trims them.
 */
const COMPACTION_FIELD = 'c'

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
/**
 * Compact a stream once its appended deltas exceed this many bytes, whichever comes first.
 *
 * The entry threshold alone bounds how many entries a stream holds and says nothing about
 * how large each one is: one pasted block is a single entry carrying megabytes, so a stream
 * can sit at a few dozen entries and hundreds of megabytes and never reach
 * {@link COMPACT_THRESHOLD} before its TTL. Folding by bytes as well keeps a stream's cost
 * proportional to its document rather than to the size of the edits that produced it.
 *
 * Compaction is the only safe way to shrink one of these streams: a task attaching later
 * replays every entry to rebuild the doc, so dropping the oldest entries — what a native
 * `MAXLEN` retention bound would do — loses edits outright. A snapshot folds them first.
 *
 * Measured over deltas appended since the last fold, never over the resulting snapshot, so a
 * stream settles at roughly one document snapshot plus this much churn.
 */
const COMPACT_BYTES_THRESHOLD = 8 * 1024 * 1024
/** Check whether compaction is due only every Nth local publish, to avoid an XLEN per keystroke. */
const COMPACT_CHECK_EVERY = 64
/** Compaction critical section (snapshot + xAdd + xTrim) is fast; a generous TTL covers a slow Redis
 * round-trip without risking expiry mid-compact. Released via compare-and-delete regardless. */
const COMPACT_LOCK_TTL_MS = 10_000
/**
 * Quiet period after a failed fold before another may be forced.
 *
 * A failed fold deliberately leaves the trigger armed so the bytes are not forgotten, but the
 * snapshot `XADD` lands before the `XTRIM` — so if the trim is what failed, retrying immediately
 * appends another full-document snapshot each time, turning a Redis blip into exactly the write
 * amplification the threshold exists to prevent. The entry-count path is unaffected.
 */
const COMPACT_RETRY_COOLDOWN_MS = 30_000
/** Retry a failed stream append this many times before giving up, so a transient Redis blip doesn't
 * silently drop an edit from the shared log (which no peer would then ever see). */
const PUBLISH_MAX_RETRIES = 3
/** The seed lock spans the app seed fetch (hard-bounded at `seedRequestMs = 8s`) + the atomic seed
 * append. It is only an EFFICIENCY optimization — it stops two tasks both running the seed fetch — and is
 * sized to comfortably exceed the fetch bound while staying near the client readiness deadline (12s) so a
 * dead seeder's lock frees when clients would recover anyway. Double-seed is prevented even if the lock
 * expires mid-seed, because the seed is written via the atomic {@link SEED_IF_EMPTY_SCRIPT}
 * (append-iff-empty), NOT the lock — correctness never depends on the lock staying held. */
const SEED_LOCK_TTL_MS = FILE_DOC_TIMEOUTS.seedRequestMs + 4_000
/** How long a stream survives with no heartbeat — long enough that an occupied-but-idle doc never
 * loses its shared state (the heartbeat refreshes it while any task holds the room). */
const STREAM_TTL_SEC = 600
/** Refresh every occupied stream's TTL on this cadence, so a live doc's stream never expires. */
const HEARTBEAT_MS = 60_000
/** Cap on the delay between reconnection attempts — the strategy retries indefinitely (see `init`). */
const RECONNECT_MAX_DELAY_MS = 3_000
/** Cap on the reader's own retry backoff after a failed read. */
const READER_RETRY_MAX_MS = 10_000
/** After the first failure of a streak, log one reader failure in this many. */
const READER_ERROR_LOG_EVERY = 20

const streamKey = (name: string) => `${STREAM_PREFIX}${name}`

/**
 * Unfolded delta bytes a compaction could actually reclaim right now.
 *
 * Only entries strictly before `room.lastId` count. A fold trims with `MINID upTo`, which is
 * inclusive, so everything from `upTo` onward survives it; counting those would re-arm the trigger
 * the moment a fold finished and force a full snapshot append per publish that reclaims nothing.
 * They stay in `pendingDeltas` and start counting once the tailer has moved past them.
 */
function foldableDeltaBytes(room: StoreRoom): number {
  let bytes = 0
  for (const [id, deltaBytes] of room.pendingDeltas) {
    // Strictly before the boundary: MINID is inclusive, so the entry AT `lastId` survives the
    // trim and folding cannot reclaim it.
    if (isAfterStreamId(room.lastId, id)) bytes += deltaBytes
  }
  return bytes
}

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

/**
 * Whether stream id `id` sorts after `than`. A Redis stream id is `<ms>-<seq>`, so a lexicographic
 * compare is wrong the moment the millisecond part changes digit length (`'9999-0' > '10000-0'`);
 * compare the two parts numerically instead. The initial `'0'` (nothing applied) has no `-seq` part,
 * which reads as sequence 0 — before every real entry.
 */
function isAfterStreamId(id: string, than: string): boolean {
  const [ms, seq = '0'] = id.split('-')
  const [thanMs, thanSeq = '0'] = than.split('-')
  return Number(ms) === Number(thanMs) ? Number(seq) > Number(thanSeq) : Number(ms) > Number(thanMs)
}

/** Whether a doc carries the seed flag (mirrors the relay's `isDocSeeded`), so the store can tell the
 * one-time seed transition from a real post-seed edit without re-implementing the check divergently. */
function isDocSeeded(doc: Y.Doc): boolean {
  return doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.flag) === true
}

/** One locally-open room the store tracks: its doc and the last stream id applied to it. */
interface StoreRoom {
  doc: Y.Doc
  /** The id of the last stream entry applied to `doc`; the tailer resumes strictly after it. */
  lastId: string
  /** Local publish count, to pace compaction checks. */
  publishes: number
  /** Epoch ms before which no forced fold is attempted, after one failed. */
  compactRetryAfter: number
  /**
   * Unfolded delta bytes in the shared stream, by entry id.
   *
   * Recorded in {@link FileDocStore.applyEntry}, so it covers EVERY entry this room's tailer
   * observes — this task's own appends, a peer task's, and one published with no room attached
   * anywhere. Accounting on publish instead would see only this task's writes.
   *
   * Keyed by id rather than summed, because a fold trims to `room.lastId` and retains anything
   * from that boundary on. Those bytes are still in Redis, so dropping them would disarm the
   * trigger while the stream kept growing; entries are removed only once an `XTRIM` provably
   * removed them.
   *
   * Excludes what a fold produces (see {@link COMPACTION_FIELD}) — a snapshot is a function of
   * document size rather than edit volume, and counting one would make a large document breach
   * the threshold permanently.
   */
  pendingDeltas: Map<string, number>
  /** Set once the doc has been observed seeded, so the seed transition itself is never mistaken for an
   * edit (mirrors the relay's `seededObserved`). */
  seededObserved: boolean
  /** Whether the doc has integrated any REAL (non-agent, non-seed) edit. Compaction stamps its snapshot
   * as an AGENT snapshot ({@link REDIS_AGENT_ORIGIN}, never persisted) until this is true, so a long
   * agent-only stream that crosses the compaction threshold can't fold its preview content into a
   * snapshot that marks peers edited. */
  realEdited: boolean
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
        /**
         * Never stop reconnecting. Returning an `Error` here tells node-redis to give up and CLOSE the
         * client — and a closed client rejects every command with "The client is closed" for the rest of
         * the process's life. So an outage longer than the retry budget does not degrade this task, it
         * takes it out silently: its rooms stop receiving other tasks' updates, its own edits stop
         * reaching the shared stream, seeds and locks fail, and the only symptom is a warning per retry.
         * This process holds live documents whose sole convergence path is this connection, so a
         * connection it can rebuild is always worth rebuilding.
         */
        reconnectStrategy: (retries: number) =>
          backoffWithJitter(retries + 1, null, { baseMs: 100, maxMs: RECONNECT_MAX_DELAY_MS }),
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
   * Register a locally-opened room and load the shared state into its doc ({@link catchUp}). A
   * brand-new file has an empty stream and loads nothing (it is seeded shortly after, via
   * {@link shouldSeed}). No-op when disabled.
   */
  async attachRoom(name: string, doc: Y.Doc): Promise<void> {
    if (!this.enabled || !this.write) return
    // Register BEFORE the async read so a concurrent publish/tailer for this room can't be missed —
    // the tailer resumes from `lastId`, which the catch-up advances.
    const room: StoreRoom = {
      doc,
      lastId: '0',
      publishes: 0,
      compactRetryAfter: 0,
      pendingDeltas: new Map(),
      seededObserved: false,
      realEdited: false,
    }
    this.rooms.set(name, room)
    await this.catchUp(name)
  }

  /**
   * PULL the shared state into a registered room: read the stream and apply every entry the doc has
   * not integrated yet (origin {@link REDIS_ORIGIN}), advancing `lastId` so the tailer resumes exactly
   * after it. This is the ONLY way a room loads shared state, so a caller that must not depend on the
   * tailer's asynchronous push — the join, which may not serve a client a half-assembled document —
   * can converge on demand. Idempotent and safe to call repeatedly; no-op when disabled or the room is
   * not registered (a fast open→close detached it). Never throws.
   */
  async catchUp(name: string): Promise<void> {
    if (!this.enabled || !this.write) return
    const room = this.rooms.get(name)
    if (!room) return
    try {
      const entries = await this.write.xRange(streamKey(name), '-', '+')
      for (const entry of entries) {
        // The room can be detached + its doc destroyed while the read is in flight (a fast
        // open→close); stop touching it the moment that happens.
        if (this.rooms.get(name) !== room) return
        // Applying a Yjs update twice is a no-op, but `applyEntry`'s bookkeeping is not: re-applying
        // the SEED after `seededObserved` latched would count it as a post-seed edit and let a
        // compaction snapshot claim content no user ever typed. Skip what this room already holds.
        if (!isAfterStreamId(entry.id, room.lastId)) continue
        this.applyEntry(room, entry.id, entry.message)
      }
      await this.write.expire(streamKey(name), STREAM_TTL_SEC)
      // A stream taken over may already be past the ceiling, and nothing else re-checks until the
      // next local publish — which a read-only participant never makes.
      if (foldableDeltaBytes(room) >= COMPACT_BYTES_THRESHOLD) void this.maybeCompact(name, true)
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
  private async appendUpdate(name: string, update: Uint8Array, agent = false): Promise<void> {
    if (!this.write) return
    // Latch realEdited SYNCHRONOUSLY — before the first await — for a real (non-agent) publish. The edit
    // already sits in room.doc (applied in doc.on('update') before publish was called), so if this set
    // were deferred past the xAdd/expire awaits a CONCURRENT agent-frame-triggered maybeCompact could read
    // realEdited=false, snapshot the doc (which already holds this real edit), and stamp it an agent
    // (no-persist) snapshot — a lost edit. Setting it in the same synchronous tick as the doc mutation
    // makes "room.doc holds a real edit ⇒ realEdited" hold before any compaction (always async) can run.
    // Monotonic latch, so an eager set is safe; the seed never flows through here (it uses seedIfEmpty).
    if (!agent) {
      const editedRoom = this.rooms.get(name)
      if (editedRoom) editedRoom.realEdited = true
    }
    const encoded = Buffer.from(update).toString('base64')
    const fields: Record<string, string> = { [UPDATE_FIELD]: encoded }
    if (agent) fields[AGENT_FIELD] = '1'
    for (let attempt = 0; attempt <= PUBLISH_MAX_RETRIES; attempt++) {
      try {
        await this.write.xAdd(streamKey(name), '*', fields)
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
    if (!room) return
    // Bytes are checked every publish: one entry can cross the ceiling on its own, so pacing this
    // check the way the entry count is paced would let a stream sit far over the ceiling for up to
    // COMPACT_CHECK_EVERY more appends. The check itself is a local sum over unfolded entries.
    const overBytes = foldableDeltaBytes(room) >= COMPACT_BYTES_THRESHOLD
    if (overBytes || ++room.publishes % COMPACT_CHECK_EVERY === 0) {
      void this.maybeCompact(name, overBytes)
    }
  }

  /**
   * Fire-and-forget append for the hot keystroke path (`doc.on('update')`): converges peers without
   * blocking the relay. Retries internally; never throws. No-op when disabled. Pass `agent: true` for
   * a copilot preview frame so peer tasks tail it as {@link REDIS_AGENT_ORIGIN} and never persist it.
   */
  publish(name: string, update: Uint8Array, agent = false): void {
    if (!this.enabled || !this.write) return
    void this.appendUpdate(name, update, agent).catch(() => {}) // already logged inside appendUpdate
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
   * Atomically seed the stream iff it is still empty (see {@link SEED_IF_EMPTY_SCRIPT}). This is what
   * actually prevents split-brain double-seeding: the emptiness check and the append happen in one
   * Redis-side step, so — unlike a separate {@link streamHasContent} fence + {@link publishAndWait} —
   * there is no check-then-append window, and two tasks racing (even both past an expired seed lock) can
   * never both write a seed. Returns true if THIS call wrote the seed (apply it locally), false if the
   * stream was already seeded (the tailer will deliver the peer's seed — do NOT apply a second one).
   * Retries a transient Redis error like {@link appendUpdate}; throws if it ultimately fails. Disabled →
   * true (single-replica: seed locally, no stream).
   */
  async seedIfEmpty(name: string, update: Uint8Array): Promise<boolean> {
    if (!this.enabled || !this.write) return true
    const encoded = Buffer.from(update).toString('base64')
    for (let attempt = 0; attempt <= PUBLISH_MAX_RETRIES; attempt++) {
      try {
        const wrote = await this.write.eval(SEED_IF_EMPTY_SCRIPT, {
          keys: [streamKey(name)],
          arguments: [UPDATE_FIELD, encoded],
        })
        await this.write.expire(streamKey(name), STREAM_TTL_SEC).catch(() => {})
        return wrote === 1
      } catch (error) {
        if (attempt === PUBLISH_MAX_RETRIES) {
          logger.error(`FileDocStore seed failed for ${name}`, { error: getErrorMessage(error) })
          throw error
        }
        await sleep(backoffWithJitter(attempt + 1, null, { baseMs: 50, maxMs: 500 }))
      }
    }
    return false
  }

  /**
   * Whether the file's stream already holds content — an EFFICIENCY recheck in {@link shouldSeed} that
   * skips the seed fetch when a prior holder already seeded (the split-brain guard itself is the atomic
   * {@link SEED_IF_EMPTY_SCRIPT}, not this check). Treats `true` as "already seeded", so it fails CLOSED:
   * a Redis `xLen` error returns `true` (cannot confirm empty → skip the redundant fetch; the atomic seed
   * would no-op anyway). `false` only when genuinely empty, or when disabled (single-replica).
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
   * Decide whether THIS task should run the (expensive) seed fetch + write for a file. Returns a lock
   * TOKEN when this task wins the seed lock and the stream still looks empty; `null` otherwise. This is an
   * EFFICIENCY gate — it stops every task that opens the file at once from each fetching the seed. It does
   * NOT by itself guarantee a single seed: exactly-once is enforced by the atomic {@link seedIfEmpty} the
   * token-holder then calls (the split-brain guard), so a lock that expires mid-seed cannot cause a
   * double-seed. Release the token with {@link releaseSeedLock}. Disabled → always a token (single-replica:
   * seed locally).
   */
  async shouldSeed(name: string): Promise<string | null> {
    const token = await this.acquireLock(`${SEED_LOCK_PREFIX}${name}`, SEED_LOCK_TTL_MS)
    if (!token || token === DISABLED_LOCK_TOKEN) return token
    // The lock could be free yet the stream already seeded (a prior holder seeded then its lock
    // expired). Re-check so we skip the redundant seed fetch — the atomic seedIfEmpty would no-op anyway,
    // but this avoids the wasted app round-trip.
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

  /**
   * The durable file version (its `updatedAt`, epoch ms) the shared live doc is synced to — the
   * cluster-wide {@link https://www.rfc-editor.org/rfc/rfc7232 `If-Match`} token for persistence. Held
   * in Redis (not per-task room state) so whichever task runs a debounced/last-leave persist reads the
   * SAME version, even though the write that advanced it (a seed or a merged edit) may have run on
   * another task. Returns `null` when unset/expired (persist then falls back to the local room's value).
   */
  async getSyncedVersion(name: string): Promise<number | null> {
    if (!this.enabled || !this.write) return null
    try {
      const value = await this.write.get(`${SYNC_VERSION_PREFIX}${name}`)
      const parsed = value === null ? Number.NaN : Number(value)
      return Number.isFinite(parsed) ? parsed : null
    } catch (error) {
      logger.warn(`FileDocStore getSyncedVersion failed for ${name}`, {
        error: getErrorMessage(error),
      })
      return null
    }
  }

  /** Record the durable version the shared live doc is now synced to. MONOTONIC — writes only when the
   * new value exceeds the stored one ({@link SET_VERSION_IF_NEWER_SCRIPT}), so an out-of-order
   * fire-and-forget write can't regress the token. Best-effort; TTL-bounded like the stream so an idle
   * file's key can't outlive its room. No-op when disabled (single-pod fallback). */
  async setSyncedVersion(name: string, version: number): Promise<void> {
    if (!this.enabled || !this.write) return
    // Retry a transient failure (bounded) rather than swallow it: this token is the ONLY way a
    // peer-seeded task learns the durable version, so a dropped write would leave that peer's persists
    // deferring forever with the session's edits stranded in the TTL'd stream. The monotonic script makes
    // a retry that races a newer value a no-op, never a regression.
    for (let attempt = 0; attempt <= PUBLISH_MAX_RETRIES; attempt++) {
      try {
        await this.write.eval(SET_VERSION_IF_NEWER_SCRIPT, {
          keys: [`${SYNC_VERSION_PREFIX}${name}`],
          arguments: [String(version), String(STREAM_TTL_SEC)],
        })
        return
      } catch (error) {
        if (attempt === PUBLISH_MAX_RETRIES) {
          logger.warn(`FileDocStore setSyncedVersion failed for ${name}`, {
            error: getErrorMessage(error),
          })
          return
        }
        await sleep(backoffWithJitter(attempt + 1, null, { baseMs: 50, maxMs: 500 }))
      }
    }
  }

  /** Mark (or refresh) that a client is actively streaming an agent edit into this live doc — a plain
   *  `SET key "1" PX ttl`, so it self-clears when streaming stops. Best-effort; no-op when disabled. */
  async markAgentStreaming(name: string, ttlMs: number): Promise<void> {
    if (!this.enabled || !this.write) return
    try {
      await this.write.set(`${AGENT_STREAM_PREFIX}${name}`, '1', { PX: ttlMs })
    } catch (error) {
      logger.warn(`FileDocStore markAgentStreaming failed for ${name}`, {
        error: getErrorMessage(error),
      })
    }
  }

  /** Whether a client is currently streaming an agent edit into this live doc (see
   *  {@link markAgentStreaming}). Best-effort; treats an error/disabled store as "not streaming" so a
   *  merge never blocks on this check. */
  async isAgentStreaming(name: string): Promise<boolean> {
    if (!this.enabled || !this.write) return false
    try {
      return (await this.write.exists(`${AGENT_STREAM_PREFIX}${name}`)) === 1
    } catch (error) {
      logger.warn(`FileDocStore isAgentStreaming failed for ${name}`, {
        error: getErrorMessage(error),
      })
      return false
    }
  }

  async releaseMergeSlot(name: string, token: string): Promise<void> {
    await this.releaseLock(`${MERGE_LOCK_PREFIX}${name}`, token)
  }

  private applyEntry(room: StoreRoom, id: string, message: Record<string, string>): void {
    room.lastId = id
    // Account for every entry the tailer sees, whoever wrote it — this is the only point that
    // observes peer and roomless appends. A fold's own output is excluded so it cannot arm the
    // trigger against itself.
    if (!message[COMPACTION_FIELD]) {
      room.pendingDeltas.set(id, message[UPDATE_FIELD]?.length ?? 0)
    }
    // A compaction snapshot folds seed + edits into one frame; stamp it so the relay's edit-tracker
    // treats a fresh catch-up from it as edited (a snapshot only exists once real edits accumulated). An
    // agent-streamed preview frame is stamped separately so the tracker NEVER marks it edited.
    const origin = message[SNAPSHOT_FIELD]
      ? REDIS_SNAPSHOT_ORIGIN
      : message[AGENT_FIELD]
        ? REDIS_AGENT_ORIGIN
        : REDIS_ORIGIN
    const seededBefore = room.seededObserved
    applyEntryToDoc(room.doc, id, message, origin)
    if (isDocSeeded(room.doc)) room.seededObserved = true
    // Track a real edit integrated from the stream so compaction knows whether its snapshot represents
    // real content or agent-only preview: a real snapshot (folds real edits), or a markerless edit
    // applied AFTER the doc was already seeded (the seed transition itself never counts). Agent frames
    // and agent snapshots (REDIS_AGENT_ORIGIN) never count.
    if (origin === REDIS_SNAPSHOT_ORIGIN || (origin === REDIS_ORIGIN && seededBefore)) {
      room.realEdited = true
    }
  }

  /**
   * The single multiplexed tail loop: block-read every locally-open room's stream from its last id and
   * apply new entries. One blocking connection for the whole process regardless of open-file count.
   */
  private async runReader(): Promise<void> {
    let failures = 0
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
        // The streak ends HERE, on the read returning at all — not further down once entries are
        // applied. A blocking read that times out with nothing new is the idle steady state, and it
        // proves the connection works just as well as one carrying messages; leaving the streak
        // standing through it would keep an old outage's count alive indefinitely, so the next
        // unrelated blip would open at the backoff cap and log a failure count it never earned.
        failures = 0
        if (!res) continue
        for (const stream of res) {
          const name = stream.name.slice(STREAM_PREFIX.length)
          const room = this.rooms.get(name)
          // Skip if detached mid-read, OR replaced by a close→reopen (a DIFFERENT StoreRoom): applying
          // entries read against the OLD room's lastId to the new one could regress its lastId (harmless
          // but wasteful re-delivery). The new room caught itself up via xRange already.
          if (!room || room !== snapshot.get(name)) continue
          for (const entry of stream.messages) this.applyEntry(room, entry.id, entry.message)
          // Foldability is decided by `lastId`, which only the tailer advances — so a burst of
          // large edits followed by silence would otherwise sit unfolded until the next publish
          // happened to re-evaluate the trigger. Re-check it where the boundary actually moved.
          if (foldableDeltaBytes(room) >= COMPACT_BYTES_THRESHOLD)
            void this.maybeCompact(name, true)
        }
      } catch (error) {
        if (!this.running) break
        await this.recoverReader(++failures, error)
      }
    }
  }

  /**
   * A failed read is either a transient blip or a connection that is gone, and this loop cannot tell
   * them apart — so it backs off instead of retrying at the read cadence. Without that, a connection
   * that cannot serve reads spins this loop forever at two attempts a second, one warning each, which
   * is how an outage turns into thousands of identical log lines that bury the reason for it.
   *
   * It also re-opens a CLOSED client. node-redis reconnects a client that merely dropped, but never one
   * it has closed; the strategy above no longer closes one, so this covers a client closed some other
   * way (an explicit disconnect, a shutdown that raced a read) rather than leaving the tailer dead.
   *
   * Logs the first failure of a streak and then one in every {@link READER_ERROR_LOG_EVERY}, carrying
   * the streak length, so a real outage stays visible without filling the log.
   */
  private async recoverReader(failures: number, error: unknown): Promise<void> {
    if (failures === 1 || failures % READER_ERROR_LOG_EVERY === 0) {
      logger.warn(`FileDocStore reader failed ${failures}x in a row; retrying`, {
        error: getErrorMessage(error),
      })
    }
    await sleep(backoffWithJitter(failures, null, { baseMs: 500, maxMs: READER_RETRY_MAX_MS }))
    if (this.running && this.read && !this.read.isOpen) {
      await this.read.connect().catch((reconnectError) => {
        logger.warn('FileDocStore could not re-open the reader connection', {
          error: getErrorMessage(reconnectError),
        })
      })
    }
  }

  /**
   * Snapshot-then-trim compaction: append a full-state snapshot and drop the older deltas it subsumes,
   * so the stream stays bounded while a fresh task can still catch up from the head. Lock-guarded so
   * only one task compacts a given stream at a time (concurrent snapshot+trim would race). Trims only up
   * to what the snapshot provably contains — never un-integrated peer entries (see below).
   */
  private async maybeCompact(name: string, force = false): Promise<void> {
    if (!this.write) return
    const room = this.rooms.get(name)
    if (!room) return
    try {
      if (force && Date.now() < room.compactRetryAfter) return
      if (!force && (await this.write.xLen(streamKey(name))) < COMPACT_THRESHOLD) return
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
        // Stamp the snapshot by what it folds: a real edit → SNAPSHOT_FIELD (a fresh catch-up treats it
        // as edited content, not a bare seed). An agent-ONLY stream (no real edit yet) → AGENT_FIELD, so a
        // peer catching up applies it as REDIS_AGENT_ORIGIN and never marks the doc edited — preserving
        // the no-persist guarantee even when a long copilot stream alone crosses the compaction threshold.
        const marker = room.realEdited ? SNAPSHOT_FIELD : AGENT_FIELD
        await this.write.xAdd(streamKey(name), '*', {
          [UPDATE_FIELD]: snapshot,
          [marker]: '1',
          [COMPACTION_FIELD]: '1',
        })
        // MINID keeps entries with id >= upTo: the snapshot, any un-integrated peer entries, and
        // `upTo` itself (redundant with the snapshot, harmless); it drops only the folded older deltas.
        await this.write.xTrim(streamKey(name), 'MINID', upTo)
        // Drop exactly what the trim removed, which `MINID upTo` being INCLUSIVE makes `id < upTo`
        // — the entry at the boundary survives, and its bytes are still in Redis. Run after the
        // trim, so a failed fold leaves the ledger intact and the trigger armed.
        for (const id of room.pendingDeltas.keys()) {
          if (isAfterStreamId(upTo, id)) room.pendingDeltas.delete(id)
        }
      } finally {
        await this.releaseLock(key, token)
      }
    } catch (error) {
      room.compactRetryAfter = Date.now() + COMPACT_RETRY_COOLDOWN_MS
      logger.warn(`FileDocStore compaction failed for ${name}`, { error: getErrorMessage(error) })
    }
  }

  private async refreshTtls(): Promise<void> {
    if (!this.write) return
    for (const name of this.rooms.keys()) {
      await this.write.expire(streamKey(name), STREAM_TTL_SEC).catch(() => {})
      // Keep the synced-version key alive as long as its stream, so an open-but-idle doc's persist
      // If-Match token can't expire out from under it (which would force a needless reconcile).
      await this.write.expire(`${SYNC_VERSION_PREFIX}${name}`, STREAM_TTL_SEC).catch(() => {})
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
