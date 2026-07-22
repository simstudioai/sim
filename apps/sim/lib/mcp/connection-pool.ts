/**
 * Warm MCP connection pool: one reused connection per (server, workspace, user)
 * for the tool-exec and discovery hot paths, replacing connect-per-operation.
 *
 * The key includes the workspace + user because a server's headers/URL resolve
 * from the caller's env (`resolveMcpConfigEnvVars`), so two users must never share
 * a credential-bearing connection. Concurrent borrowers multiplex over one client
 * (the SDK tracks requests by id); creation is single-flight; liveness is
 * ping-cached; reconnect is demand-driven (callers' retries re-acquire).
 *
 * Connections are ref-counted. Eviction *retires* an entry — removes it from the
 * pool so later acquires stop reusing it — but the socket is closed only once the
 * last in-flight borrower releases, so a sibling failure, idle sweep, or config
 * change never tears down a connection mid-request. Retirement is identity-checked,
 * so a stale `onClose` can't disconnect a replacement stored under the same key.
 * Pools are per-process. Callers must release every acquired lease and must not
 * disconnect the client themselves.
 *
 * Config-change invalidation is the caller's job via `evictServer` (wired to the
 * service's `evictServerConnections`), not a per-acquire timestamp check — `updatedAt`
 * is also bumped by status telemetry, so it can't distinguish a config edit.
 * Cross-process, a config edit is bounded by max age (self-heals when a stale
 * connection errors).
 */

import { createLogger } from '@sim/logger'
import { isTest } from '@/lib/core/config/env-flags'
import type { McpClient } from '@/lib/mcp/client'

const logger = createLogger('McpConnectionPool')

const MAX_POOL_SIZE = 100
/** Max lifetime; on expiry the pinned SSRF `resolvedIP` re-resolves. */
const MAX_CONNECTION_AGE_MS = 10 * 60 * 1000
/**
 * Circuit breaker: retire a connection after this many CONSECUTIVE request
 * timeouts. One timeout is a slow request and keeps the session (retiring on
 * every timeout causes connect/stall/reconnect churn); repeated timeouts with
 * no success in between indicate a half-open transport the liveness ping
 * hasn't caught yet. A healthy release resets the count.
 */
const MAX_CONSECUTIVE_TIMEOUTS = 2
const LIVENESS_TTL_MS = 60 * 1000
const LIVENESS_PING_TIMEOUT_MS = 5 * 1000
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const IDLE_CHECK_INTERVAL_MS = 60 * 1000

export interface AcquireParams {
  /** Auth-scoped pool key — `${serverId}:${workspaceId}:${userId}`. */
  key: string
  /** Server id, for bulk `evictServer` on config change/delete. */
  serverId: string
  /** Builds and connects a fresh client; invoked once per miss (single-flight). */
  create: () => Promise<McpClient>
}

/**
 * A borrowed connection. `release(poison, sawTimeout)` must be called exactly once:
 * `poison: true` retires immediately (dead-connection error); `sawTimeout: true`
 * counts toward the consecutive-timeout circuit breaker without retiring on its own.
 */
export interface ConnectionLease {
  client: McpClient
  release: (poison?: boolean, sawTimeout?: boolean) => Promise<void>
}

interface PoolEntry {
  key: string
  serverId: string
  client: McpClient
  createdAt: number
  lastActivityAt: number
  lastLivenessCheckAt: number
  borrowers: number
  consecutiveTimeouts: number
  retired: boolean
  closing: boolean
}

/**
 * An in-flight `createEntry`. `evictServer` sets `invalidated` on the records for its
 * server so a connect racing a config edit/delete is one-shot instead of pooled stale.
 * Lives only until the create settles (cleared in `finally`), so it's self-bounded.
 */
interface PendingCreate {
  serverId: string
  /** `flag.invalidated` is set by `evictServer` racing this create → it one-shots instead of pooling. */
  flag: { invalidated: boolean }
  promise: Promise<PoolEntry>
}

export class McpConnectionPool {
  private entries = new Map<string, PoolEntry>()
  private pending = new Map<string, PendingCreate>()
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  /** Borrow a warm connection for `key`, creating one on a miss. Caller must `release`. */
  async acquire(params: AcquireParams): Promise<ConnectionLease> {
    if (this.disposed) {
      const client = await params.create()
      return { client, release: () => client.disconnect().catch(() => {}) }
    }
    // A concurrent evict/release/idle could have started disconnecting the resolved
    // entry during an `await` gap; `closing` (not `retired`, which a usable one-shot
    // also sets) means the socket is going away, so resolve again.
    let entry = await this.resolveEntry(params)
    while (entry.closing) entry = await this.resolveEntry(params)
    entry.borrowers++
    entry.lastActivityAt = Date.now()
    return {
      client: entry.client,
      release: (poison, sawTimeout) => this.release(entry, poison ?? false, sawTimeout ?? false),
    }
  }

  private async resolveEntry(params: AcquireParams): Promise<PoolEntry> {
    while (true) {
      const pending = this.pending.get(params.key)
      if (pending) return pending.promise

      const current = this.entries.get(params.key)
      if (!current) return this.createEntry(params)

      const reusable = await this.tryReuse(current)
      if (reusable) return reusable
      // tryReuse awaited a ping and retired `current`; loop to re-check pending/entries —
      // a concurrent acquire may have pooled a replacement we must reuse, not overwrite.
    }
  }

  /** Return `entry` if in-age, connected, and live; else retire it and return null. */
  private async tryReuse(entry: PoolEntry): Promise<PoolEntry | null> {
    const now = Date.now()
    if (now - entry.createdAt > MAX_CONNECTION_AGE_MS) {
      this.retire(entry, 'max age reached')
      return null
    }
    if (!entry.client.getStatus().connected) {
      this.retire(entry, 'not connected')
      return null
    }
    if (now - entry.lastLivenessCheckAt > LIVENESS_TTL_MS) {
      const alive = await entry.client
        .ping(LIVENESS_PING_TIMEOUT_MS)
        .then(() => true)
        .catch(() => false)
      // A concurrent poison/evict/age eviction may have retired this during the
      // ping await; don't hand out a connection that's already closing.
      if (entry.retired) return null
      if (!alive) {
        this.retire(entry, 'liveness ping failed')
        return null
      }
      entry.lastLivenessCheckAt = now
    }
    logger.debug(`Reusing pooled MCP connection ${entry.key}`)
    return entry
  }

  private createEntry(params: AcquireParams): Promise<PoolEntry> {
    // Re-check: the `await` in `resolveEntry` yields, so two acquires can both
    // reach here; the first registers the pending create, the rest join.
    const inFlight = this.pending.get(params.key)
    if (inFlight) return inFlight.promise

    // Declared before the create closure so `evictServer` can invalidate a create
    // that's racing a config edit/delete (the closure reads it after its `await`).
    const flag = { invalidated: false }
    const creation = (async () => {
      const client = await params.create()
      const now = Date.now()
      const entry: PoolEntry = {
        key: params.key,
        serverId: params.serverId,
        client,
        createdAt: now,
        lastActivityAt: now,
        lastLivenessCheckAt: now,
        borrowers: 0,
        consecutiveTimeouts: 0,
        retired: false,
        closing: false,
      }
      // Disposed, or the server was evicted (config edit/delete) while connecting:
      // don't pool a connection built against the now-stale config. The current
      // borrower still uses it once (as connect-per-op would for an in-flight
      // request); it's disconnected on release, and the next acquire builds fresh.
      if (this.disposed || flag.invalidated) {
        entry.retired = true
        return entry
      }
      this.evictLruIfFull()
      this.entries.set(params.key, entry)
      client.onClose(this.makeCloseHandler(entry))
      this.ensureIdleCheck()
      logger.debug(
        `Established and pooled MCP connection ${params.key} (${this.entries.size}/${MAX_POOL_SIZE})`
      )
      return entry
    })()

    const record: PendingCreate = {
      serverId: params.serverId,
      flag,
      promise: creation.finally(() => {
        if (this.pending.get(params.key) === record) this.pending.delete(params.key)
      }),
    }
    this.pending.set(params.key, record)
    return record.promise
  }

  private async release(entry: PoolEntry, poison: boolean, sawTimeout: boolean): Promise<void> {
    entry.borrowers = Math.max(0, entry.borrowers - 1)
    entry.lastActivityAt = Date.now()
    if (sawTimeout) {
      entry.consecutiveTimeouts++
      if (entry.consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
        this.retire(entry, `${entry.consecutiveTimeouts} consecutive request timeouts`)
      }
    } else if (!poison) {
      entry.consecutiveTimeouts = 0
    }
    if (poison) this.retire(entry, 'poisoned by failed operation')
    await this.closeIfIdle(entry)
  }

  /** Own scope so the handler captures only `entry` (never the create params / secrets). */
  private makeCloseHandler(entry: PoolEntry): () => void {
    return () => {
      if (this.entries.get(entry.key) === entry) this.retire(entry, 'transport closed')
    }
  }

  /** Remove `entry` from the pool so no new borrower takes it; close it once idle. */
  private retire(entry: PoolEntry, reason: string): void {
    if (!entry.retired) {
      entry.retired = true
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
      logger.debug(`Retiring pooled MCP connection ${entry.key}: ${reason}`, {
        borrowers: entry.borrowers,
        poolSize: this.entries.size,
      })
    }
    void this.closeIfIdle(entry)
  }

  private async closeIfIdle(entry: PoolEntry): Promise<void> {
    if (!entry.retired || entry.borrowers > 0 || entry.closing) return
    entry.closing = true
    logger.debug(`Closing pooled MCP connection ${entry.key}`)
    await entry.client.disconnect().catch((error) => {
      logger.warn(`Error disconnecting pooled MCP connection ${entry.key}:`, error)
    })
  }

  /** Retire every connection for a server (all users) — config changed or deleted. */
  async evictServer(serverId: string, reason: string): Promise<void> {
    // Flag in-flight creates first so one racing this eviction is one-shot on
    // completion instead of pooling a connection built against the now-stale config.
    for (const record of this.pending.values()) {
      if (record.serverId === serverId) record.flag.invalidated = true
    }
    for (const entry of this.entries.values()) {
      if (entry.serverId === serverId) this.retire(entry, reason)
    }
  }

  private evictLruIfFull(): void {
    if (this.entries.size < MAX_POOL_SIZE) return
    let lru: PoolEntry | undefined
    for (const entry of this.entries.values()) {
      if (!lru || entry.lastActivityAt < lru.lastActivityAt) lru = entry
    }
    // Retiring a still-borrowed LRU frees the map slot now; its socket closes on release.
    if (lru) this.retire(lru, 'pool at capacity (LRU)')
  }

  private ensureIdleCheck(): void {
    if (this.idleCheckTimer) return
    this.idleCheckTimer = setInterval(() => {
      const now = Date.now()
      for (const entry of this.entries.values()) {
        if (entry.borrowers === 0 && now - entry.lastActivityAt > IDLE_TIMEOUT_MS)
          this.retire(entry, 'idle timeout')
      }
      if (this.entries.size === 0 && this.idleCheckTimer) {
        clearInterval(this.idleCheckTimer)
        this.idleCheckTimer = null
      }
    }, IDLE_CHECK_INTERVAL_MS)
    this.idleCheckTimer.unref?.()
  }

  /** Tear down every connection and the idle sweep. */
  dispose(): void {
    this.disposed = true
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer)
      this.idleCheckTimer = null
    }
    const entries = [...this.entries.values()]
    // Mark retired before disconnecting so an in-flight liveness ping observes it
    // and can't hand out a torn-down client (the retired-before-disconnect invariant).
    for (const entry of entries) entry.retired = true
    this.entries.clear()
    this.pending.clear()
    void Promise.allSettled(entries.map((entry) => entry.client.disconnect()))
  }
}

type McpPoolGlobal = typeof globalThis & {
  _mcpConnectionPool?: McpConnectionPool | null
}

const _g = globalThis as McpPoolGlobal
if (!('_mcpConnectionPool' in _g)) {
  _g._mcpConnectionPool = isTest ? null : new McpConnectionPool()
}

export const mcpConnectionPool: McpConnectionPool | null = _g._mcpConnectionPool ?? null
