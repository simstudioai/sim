/**
 * MCP Connection Pool
 *
 * Serves warm, reused MCP connections to the tool-execution hot paths
 * (`executeTool` / discovery), replacing the connect-per-operation pattern that
 * pays a full connect + `initialize` + teardown on every call.
 *
 * Design (verified against LibreChat, Cline, VS Code, and the MCP TS SDK):
 * - **One warm connection per server**, keyed by server id. Concurrent requests
 *   multiplex safely over a single transport (SDK tracks each request by id), so
 *   no per-server sub-pool is needed.
 * - **Demand-driven reconnect, not a background loop**: on a dead/stale
 *   connection the caller's existing retry re-acquires a fresh one. This mirrors
 *   VS Code's model and keeps the pool free of reconnect-storm machinery.
 * - **Single-flight creation** so a burst of concurrent acquires for the same
 *   server performs exactly one connect (the LibreChat app-repo race this fixes).
 * - **Liveness is TTL-cached** — at most one `ping()` per {@link LIVENESS_TTL_MS}
 *   window, never per request.
 * - **Eviction** on: config change (`updatedAt` moved), max age (so the pinned
 *   SSRF `resolvedIP` re-resolves), idle timeout, transport close, and explicit
 *   session-error eviction by the caller.
 *
 * Connections are per-process (no cross-replica sharing on ECS), consistent with
 * every reference client. Callers must NOT disconnect an acquired client — the
 * pool owns its lifecycle.
 *
 * A server that also supports `listChanged` keeps a separate connection in the
 * connection manager (for notifications); the two lifecycles are intentionally
 * distinct — this pool is not the notification path and does not consolidate it.
 */

import { createLogger } from '@sim/logger'
import { isTest } from '@/lib/core/config/env-flags'
import type { McpClient } from '@/lib/mcp/client'

const logger = createLogger('McpConnectionPool')

const MAX_POOL_SIZE = 100
/** Max connection lifetime; on expiry the pinned SSRF `resolvedIP` re-resolves. */
const MAX_CONNECTION_AGE_MS = 10 * 60 * 1000
/** Liveness (`ping`) is checked at most once per this window per connection. */
const LIVENESS_TTL_MS = 60 * 1000
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const IDLE_CHECK_INTERVAL_MS = 60 * 1000

/** Parameters for acquiring (or lazily creating) a pooled connection. */
export interface AcquireParams {
  /** Pool key — the MCP server id. */
  key: string
  /**
   * The server config's `updatedAt` (ISO string) at acquire time. When it moves
   * past the pooled connection's creation time the connection is rebuilt, so a
   * config edit never rides a stale warm connection.
   */
  configUpdatedAt?: string
  /**
   * Factory that constructs and connects a fresh {@link McpClient}. Invoked only
   * on a genuine miss; concurrent misses for the same key share one invocation.
   */
  create: () => Promise<McpClient>
}

interface PoolEntry {
  client: McpClient
  createdAt: number
  /** `configUpdatedAt` (ms epoch) the connection was built against; 0 if unknown. */
  configUpdatedAtMs: number
  lastActivityAt: number
  lastLivenessCheckAt: number
}

/**
 * Parses an ISO timestamp to epoch ms, or 0 when absent/invalid. A `0` sentinel
 * means "unknown" and never triggers staleness on its own (0 is always ≤ an
 * entry's recorded value), so a missing `updatedAt` degrades to no-op, not churn.
 */
function toEpochMs(iso: string | undefined): number {
  if (!iso) return 0
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

export class McpConnectionPool {
  private entries = new Map<string, PoolEntry>()
  private pending = new Map<string, Promise<McpClient>>()
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  /**
   * Return a warm, live connection for `key`, creating one on a miss. The caller
   * must not disconnect the returned client; call {@link evict} to drop it (e.g.
   * on a session error) so the next acquire rebuilds it.
   */
  async acquire(params: AcquireParams): Promise<McpClient> {
    if (this.disposed) return params.create()

    const inFlight = this.pending.get(params.key)
    if (inFlight) return inFlight

    const reusable = await this.tryReuse(params)
    if (reusable) return reusable

    return this.create(params)
  }

  /**
   * Returns the pooled client for `key` if it passes every reuse check
   * (config-fresh, within max age, connected, and live), refreshing its liveness
   * stamp as a side effect. Evicts and returns `null` on any failed check.
   */
  private async tryReuse(params: AcquireParams): Promise<McpClient | null> {
    const entry = this.entries.get(params.key)
    if (!entry) return null

    const now = Date.now()
    const configUpdatedAtMs = toEpochMs(params.configUpdatedAt)

    if (configUpdatedAtMs > entry.configUpdatedAtMs) {
      await this.evict(params.key, 'config changed')
      return null
    }
    if (now - entry.createdAt > MAX_CONNECTION_AGE_MS) {
      await this.evict(params.key, 'max age reached')
      return null
    }
    if (!entry.client.getStatus().connected) {
      await this.evict(params.key, 'not connected')
      return null
    }
    if (now - entry.lastLivenessCheckAt > LIVENESS_TTL_MS) {
      const alive = await entry.client
        .ping()
        .then(() => true)
        .catch(() => false)
      if (!alive) {
        await this.evict(params.key, 'ping failed')
        return null
      }
      entry.lastLivenessCheckAt = now
    }

    entry.lastActivityAt = now
    return entry.client
  }

  /** Single-flight creation: concurrent misses for one key share this invocation. */
  private create(params: AcquireParams): Promise<McpClient> {
    // Re-check under the synchronous part of this call: two acquires can both
    // clear the top-of-`acquire` pending check before either reaches here (the
    // `await tryReuse` between them yields), so the first to arrive registers the
    // pending promise and any follower joins it instead of connecting again.
    const inFlight = this.pending.get(params.key)
    if (inFlight) return inFlight

    const creation = (async () => {
      const client = await params.create()
      if (this.disposed) {
        await client.disconnect().catch(() => {})
        return client
      }
      this.evictLruIfFull()
      const now = Date.now()
      this.entries.set(params.key, {
        client,
        createdAt: now,
        configUpdatedAtMs: toEpochMs(params.configUpdatedAt),
        lastActivityAt: now,
        lastLivenessCheckAt: now,
      })
      client.onClose(this.makeTransportCloseHandler(params.key))
      this.ensureIdleCheck()
      return client
    })()

    this.pending.set(params.key, creation)
    return creation.finally(() => {
      // Identity guard: only clear our own pending entry, never a newer attempt's.
      if (this.pending.get(params.key) === creation) this.pending.delete(params.key)
    })
  }

  /**
   * Builds the transport-close handler in its own scope so it captures only the
   * `key` string — never the `create` params, which transitively retain the
   * resolved config (and its auth secrets), `resolvedIP`, and the service. Those
   * must not stay alive for the connection's lifetime.
   */
  private makeTransportCloseHandler(key: string): () => void {
    return () => void this.evict(key, 'transport closed')
  }

  /** Drop and disconnect the pooled connection for `key`, if any. */
  async evict(key: string, reason: string): Promise<void> {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    logger.info(`Evicting pooled MCP connection ${key}: ${reason}`)
    await entry.client.disconnect().catch((error) => {
      logger.warn(`Error disconnecting evicted MCP connection ${key}:`, error)
    })
  }

  /** Evict the least-recently-used connection when the pool is at capacity. */
  private evictLruIfFull(): void {
    if (this.entries.size < MAX_POOL_SIZE) return
    let lruKey: string | undefined
    let oldest = Number.POSITIVE_INFINITY
    for (const [key, entry] of this.entries) {
      if (entry.lastActivityAt < oldest) {
        oldest = entry.lastActivityAt
        lruKey = key
      }
    }
    if (lruKey) void this.evict(lruKey, 'pool at capacity (LRU)')
  }

  private ensureIdleCheck(): void {
    if (this.idleCheckTimer) return
    this.idleCheckTimer = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.entries) {
        if (now - entry.lastActivityAt > IDLE_TIMEOUT_MS) {
          void this.evict(key, 'idle timeout')
        }
      }
      if (this.entries.size === 0 && this.idleCheckTimer) {
        clearInterval(this.idleCheckTimer)
        this.idleCheckTimer = null
      }
    }, IDLE_CHECK_INTERVAL_MS)
    // Never keep the process (or a test runner) alive for the sweep.
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
