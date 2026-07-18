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
 * pool so no new borrower can take it — but the socket is closed only once the
 * last in-flight borrower releases, so a sibling failure, idle sweep, or config
 * change never tears down a connection mid-request. Retirement is identity-checked,
 * so a stale `onClose` can't disconnect a replacement stored under the same key.
 * Pools are per-process. Callers must release every acquired lease and must not
 * disconnect the client themselves.
 *
 * Config-change invalidation is the caller's job via `evictServer` (wired to the
 * service's `clearCache`), not a per-acquire timestamp check — `updatedAt` is also
 * bumped by status telemetry, so it can't distinguish a config edit. Cross-process,
 * a config edit is bounded by max age (and self-heals when a stale connection errors).
 */

import { createLogger } from '@sim/logger'
import { isTest } from '@/lib/core/config/env-flags'
import type { McpClient } from '@/lib/mcp/client'

const logger = createLogger('McpConnectionPool')

const MAX_POOL_SIZE = 100
/** Max lifetime; on expiry the pinned SSRF `resolvedIP` re-resolves. */
const MAX_CONNECTION_AGE_MS = 10 * 60 * 1000
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

/** A borrowed connection. `release(poison)` must be called exactly once; pass `poison: true` to retire on failure. */
export interface ConnectionLease {
  client: McpClient
  release: (poison?: boolean) => Promise<void>
}

interface PoolEntry {
  key: string
  serverId: string
  client: McpClient
  createdAt: number
  lastActivityAt: number
  lastLivenessCheckAt: number
  borrowers: number
  retired: boolean
  closing: boolean
}

export class McpConnectionPool {
  private entries = new Map<string, PoolEntry>()
  private pending = new Map<string, Promise<PoolEntry>>()
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  /** Borrow a warm connection for `key`, creating one on a miss. Caller must `release`. */
  async acquire(params: AcquireParams): Promise<ConnectionLease> {
    if (this.disposed) {
      const client = await params.create()
      return { client, release: () => client.disconnect().catch(() => {}) }
    }
    const entry = await this.resolveEntry(params)
    entry.borrowers++
    entry.lastActivityAt = Date.now()
    return { client: entry.client, release: (poison) => this.release(entry, poison ?? false) }
  }

  private async resolveEntry(params: AcquireParams): Promise<PoolEntry> {
    const pending = this.pending.get(params.key)
    if (pending) {
      const entry = await pending
      if (!entry.retired) return entry
      return this.resolveEntry(params)
    }

    const current = this.entries.get(params.key)
    if (current) {
      const reusable = await this.tryReuse(current)
      if (reusable) return reusable
    }
    return this.createEntry(params)
  }

  /** Return `entry` if in-age, connected, and live; else retire it and return null. */
  private async tryReuse(entry: PoolEntry): Promise<PoolEntry | null> {
    const now = Date.now()
    if (now - entry.createdAt > MAX_CONNECTION_AGE_MS) {
      this.retire(entry)
      return null
    }
    if (!entry.client.getStatus().connected) {
      this.retire(entry)
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
        this.retire(entry)
        return null
      }
      entry.lastLivenessCheckAt = now
    }
    return entry
  }

  private createEntry(params: AcquireParams): Promise<PoolEntry> {
    // Re-check: the `await` in `resolveEntry` yields, so two acquires can both
    // reach here; the first registers the pending create, the rest join.
    const inFlight = this.pending.get(params.key)
    if (inFlight) return inFlight

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
        retired: false,
        closing: false,
      }
      if (this.disposed) {
        entry.retired = true
        void client.disconnect().catch(() => {})
        return entry
      }
      this.evictLruIfFull()
      this.entries.set(params.key, entry)
      client.onClose(this.makeCloseHandler(entry))
      this.ensureIdleCheck()
      return entry
    })()

    this.pending.set(params.key, creation)
    return creation.finally(() => {
      if (this.pending.get(params.key) === creation) this.pending.delete(params.key)
    })
  }

  private async release(entry: PoolEntry, poison: boolean): Promise<void> {
    entry.borrowers = Math.max(0, entry.borrowers - 1)
    entry.lastActivityAt = Date.now()
    if (poison) this.retire(entry)
    await this.closeIfIdle(entry)
  }

  /** Own scope so the handler captures only `entry` (never the create params / secrets). */
  private makeCloseHandler(entry: PoolEntry): () => void {
    return () => {
      if (this.entries.get(entry.key) === entry) this.retire(entry)
    }
  }

  /** Remove `entry` from the pool so no new borrower takes it; close it once idle. */
  private retire(entry: PoolEntry): void {
    if (!entry.retired) {
      entry.retired = true
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
    }
    void this.closeIfIdle(entry)
  }

  private async closeIfIdle(entry: PoolEntry): Promise<void> {
    if (!entry.retired || entry.borrowers > 0 || entry.closing) return
    entry.closing = true
    logger.info(`Closing pooled MCP connection ${entry.key}`)
    await entry.client.disconnect().catch((error) => {
      logger.warn(`Error disconnecting pooled MCP connection ${entry.key}:`, error)
    })
  }

  /** Retire every connection for a server (all users) — config changed or deleted. */
  async evictServer(serverId: string, reason: string): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.serverId === serverId) {
        logger.info(`Evicting pooled MCP connection ${entry.key}: ${reason}`)
        this.retire(entry)
      }
    }
  }

  private evictLruIfFull(): void {
    if (this.entries.size < MAX_POOL_SIZE) return
    let lru: PoolEntry | undefined
    for (const entry of this.entries.values()) {
      if (!lru || entry.lastActivityAt < lru.lastActivityAt) lru = entry
    }
    // Retiring a still-borrowed LRU frees the map slot now; its socket closes on release.
    if (lru) this.retire(lru)
  }

  private ensureIdleCheck(): void {
    if (this.idleCheckTimer) return
    this.idleCheckTimer = setInterval(() => {
      const now = Date.now()
      for (const entry of this.entries.values()) {
        if (entry.borrowers === 0 && now - entry.lastActivityAt > IDLE_TIMEOUT_MS)
          this.retire(entry)
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
    const clients = [...this.entries.values()].map((e) => e.client)
    this.entries.clear()
    this.pending.clear()
    void Promise.allSettled(clients.map((client) => client.disconnect()))
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
