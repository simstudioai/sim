import { createHash } from 'node:crypto'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { db } from '@sim/db'
import { mcpServerOauth } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq, gt } from 'drizzle-orm'
import { acquireLock, extendLock, releaseLock } from '@/lib/core/config/redis'
import {
  resourceScopeColumns,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'

const logger = createLogger('McpOauthStorage')

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex')
}

const STATE_TTL_MS = 10 * 60 * 1000

export interface McpOauthRow {
  id: string
  mcpServerId: string
  userId: string | null
  workspaceId: string | null
  organizationId: string | null
  clientInformation: OAuthClientInformationMixed | null
  tokens: OAuthTokens | null
  codeVerifier: string | null
  state: string | null
  stateCreatedAt: Date | null
  updatedAt: Date
}

async function encryptTokens(tokens: OAuthTokens): Promise<string> {
  const { encrypted } = await encryptSecret(JSON.stringify(tokens))
  return encrypted
}

async function encryptClientInformation(info: OAuthClientInformationMixed): Promise<string> {
  const { encrypted } = await encryptSecret(JSON.stringify(info))
  return encrypted
}

/**
 * Returns `null` and clears the column when decryption fails (e.g. key rotation)
 * so the next call triggers a fresh OAuth flow instead of a 500.
 */
async function safeDecrypt<T>(
  rowId: string,
  column: 'tokens' | 'clientInformation' | 'codeVerifier',
  encrypted: string,
  decode: (decrypted: string) => T
): Promise<T | null> {
  try {
    const { decrypted } = await decryptSecret(encrypted)
    return decode(decrypted)
  } catch (error) {
    logger.warn(`Failed to decrypt ${column} for OAuth row ${rowId}; clearing column`, {
      error: toError(error).message,
    })
    await db
      .update(mcpServerOauth)
      .set({ [column]: null, updatedAt: new Date() })
      .where(eq(mcpServerOauth.id, rowId))
    return null
  }
}

export async function getOrCreateOauthRow(params: {
  mcpServerId: string
  userId?: string | null
  workspaceId?: string
  organizationId?: string
}): Promise<McpOauthRow> {
  const scope = resourceScopeFromOwner(params)
  const existing = await loadOauthRow(params)
  if (existing) {
    if (!sameResourceScope(scope, resourceScopeFromOwner(existing)))
      throw new Error('MCP OAuth client belongs to another scope')
    return existing
  }

  const id = generateId()
  try {
    await db.insert(mcpServerOauth).values({
      id,
      mcpServerId: params.mcpServerId,
      userId: params.userId ?? null,
      ...resourceScopeColumns(scope),
    })
  } catch (error) {
    const winner = await loadOauthRow(params)
    if (winner && sameResourceScope(scope, resourceScopeFromOwner(winner))) return winner
    throw error
  }

  return {
    id,
    mcpServerId: params.mcpServerId,
    userId: params.userId ?? null,
    ...resourceScopeColumns(scope),
    clientInformation: null,
    tokens: null,
    codeVerifier: null,
    state: null,
    stateCreatedAt: null,
    updatedAt: new Date(),
  }
}

type RawOauthRow = typeof mcpServerOauth.$inferSelect

async function mapOauthRow(row: RawOauthRow): Promise<McpOauthRow> {
  return {
    id: row.id,
    mcpServerId: row.mcpServerId,
    userId: row.userId,
    workspaceId: row.workspaceId,
    organizationId: row.organizationId,
    clientInformation: row.clientInformation
      ? await safeDecrypt(
          row.id,
          'clientInformation',
          row.clientInformation,
          (d) => JSON.parse(d) as OAuthClientInformationMixed
        )
      : null,
    tokens: row.tokens
      ? await safeDecrypt(row.id, 'tokens', row.tokens, (d) => JSON.parse(d) as OAuthTokens)
      : null,
    codeVerifier: row.codeVerifier
      ? await safeDecrypt(row.id, 'codeVerifier', row.codeVerifier, (d) => d)
      : null,
    state: row.state,
    stateCreatedAt: row.stateCreatedAt,
    updatedAt: row.updatedAt,
  }
}

export async function loadOauthRow(params: { mcpServerId: string }): Promise<McpOauthRow | null> {
  const [row] = await db
    .select()
    .from(mcpServerOauth)
    .where(eq(mcpServerOauth.mcpServerId, params.mcpServerId))
    .limit(1)
  if (!row) return null
  return mapOauthRow(row)
}

export async function setOauthRowUser(rowId: string, userId: string): Promise<void> {
  await db
    .update(mcpServerOauth)
    .set({ userId, updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
}

export async function loadOauthRowByState(state: string): Promise<McpOauthRow | null> {
  const [row] = await db
    .select()
    .from(mcpServerOauth)
    .where(
      and(
        eq(mcpServerOauth.state, hashState(state)),
        gt(mcpServerOauth.stateCreatedAt, new Date(Date.now() - STATE_TTL_MS))
      )
    )
    .limit(1)
  if (!row) return null
  return mapOauthRow(row)
}

export async function saveClientInformation(
  rowId: string,
  info: OAuthClientInformationMixed
): Promise<void> {
  const encrypted = await encryptClientInformation(info)
  logger.info('Persisting MCP OAuth client information', { rowId })
  await db
    .update(mcpServerOauth)
    .set({ clientInformation: encrypted, updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
  logger.info('Persisted MCP OAuth client information', { rowId })
}

export async function saveTokens(rowId: string, tokens: OAuthTokens): Promise<void> {
  const encrypted = await encryptTokens(tokens)
  logger.info('Persisting MCP OAuth tokens', { rowId })
  await db
    .update(mcpServerOauth)
    .set({ tokens: encrypted, lastRefreshedAt: new Date(), updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
  logger.info('Persisted MCP OAuth tokens', { rowId })
}

export async function saveCodeVerifier(rowId: string, verifier: string): Promise<void> {
  const { encrypted } = await encryptSecret(verifier)
  await db
    .update(mcpServerOauth)
    .set({ codeVerifier: encrypted, updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
}

export async function saveState(rowId: string, state: string, context = 'unknown'): Promise<void> {
  const now = new Date()
  await db
    .update(mcpServerOauth)
    .set({ state: hashState(state), stateCreatedAt: now, updatedAt: now })
    .where(eq(mcpServerOauth.id, rowId))
  logger.info('MCP OAuth authorization state saved', { rowId, context })
}

export async function clearTokens(rowId: string): Promise<void> {
  await db
    .update(mcpServerOauth)
    .set({ tokens: null, updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
}

export async function clearClient(rowId: string): Promise<void> {
  await db
    .update(mcpServerOauth)
    .set({ clientInformation: null, updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
}

export async function clearVerifier(rowId: string): Promise<void> {
  await db
    .update(mcpServerOauth)
    .set({ codeVerifier: null, updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
}

export async function clearState(rowId: string, context = 'unknown'): Promise<void> {
  await db
    .update(mcpServerOauth)
    .set({ state: null, stateCreatedAt: null, updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
  logger.info('MCP OAuth authorization state cleared', { rowId, context })
}

/**
 * Serialize OAuth row access across all callers, in-process AND across
 * processes. Refresh tokens rotate (RFC 6749 §6, MCP §2.3.3), so two concurrent
 * refreshes against the same row would race and one would receive
 * `invalid_grant`, wiping credentials.
 *
 * Two-tier serialization (each caller runs its OWN `fn()` — callers consume
 * `McpClient` instances that can't be shared, unlike a scalar access token):
 *   1) In-process: per-row Promise chain. Concurrent callers queue; each
 *      runs `fn()` after the previous settles. The queue wait is bounded —
 *      a caller whose turn does not arrive within
 *      {@link REFRESH_QUEUE_WAIT_TIMEOUT_MS} rejects without ever running
 *      its `fn()`, so a wedged link cannot accumulate callers indefinitely.
 *   2) Cross-process: Redis mutex (`acquireLock` / `releaseLock`) with a TTL
 *      watchdog that periodically extends the lock while `fn()` runs, so
 *      long-running refreshes don't drop the lock and let another process
 *      race onto the same refresh.
 *
 * Falls open if Redis is unavailable — `acquireLock` no-ops, but in-process
 * serialization still holds within a single Node process.
 */
const REFRESH_LOCK_TTL_SEC = 15
const REFRESH_LOCK_EXTEND_INTERVAL_MS = 5_000
const REFRESH_POLL_INTERVAL_MS = 100
const REFRESH_MAX_WAIT_MS = 30_000

/**
 * Deadline on the in-process QUEUE WAIT only — the time a caller spends
 * waiting for its turn behind queued predecessors. Without it, one hung
 * link wedges every subsequent caller for that row until process restart.
 * Sized to survive one legitimately slow predecessor: up to
 * REFRESH_MAX_WAIT_MS of cross-process lock contention plus the MCP SDK's
 * 60s initialize timeout. Deliberately NOT applied to the caller's own
 * `fn()` run — aborting a running `fn()` would orphan a connected
 * `McpClient` and abandon a possibly mid-rotation refresh; `fn()` is
 * bounded by its own SDK/HTTP/Redis timeouts instead.
 */
const REFRESH_QUEUE_WAIT_TIMEOUT_MS = 90_000

const inflightChains = new Map<string, Promise<unknown>>()

export async function withMcpOauthRefreshLock<T>(
  rowId: string,
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const lockKey = `mcp:oauth:refresh:${rowId}`
  const prev = inflightChains.get(lockKey) ?? Promise.resolve()
  const prevSettled = prev.catch(() => undefined)

  let queueTimedOut = false
  const next = prevSettled.then(() => {
    if (queueTimedOut) {
      throw new Error(`MCP OAuth refresh queue for ${rowId} abandoned after timeout`)
    }
    signal?.throwIfAborted()
    return runWithRedisMutex(lockKey, rowId, fn, signal)
  })
  inflightChains.set(lockKey, next)
  const cleanup = () => {
    if (inflightChains.get(lockKey) === next) inflightChains.delete(lockKey)
  }
  next.then(cleanup, cleanup)

  let queueTimer: ReturnType<typeof setTimeout> | undefined
  const queueDeadline = new Promise<never>((_, reject) => {
    queueTimer = setTimeout(() => {
      queueTimedOut = true
      reject(
        new Error(
          `MCP OAuth refresh queue for ${rowId} stalled for ${REFRESH_QUEUE_WAIT_TIMEOUT_MS}ms`
        )
      )
    }, REFRESH_QUEUE_WAIT_TIMEOUT_MS)
    queueTimer.unref?.()
  })
  let abortListener: (() => void) | undefined
  const queueAbort = new Promise<never>((_resolve, reject) => {
    if (!signal) return
    abortListener = () => {
      try {
        signal.throwIfAborted()
      } catch (error) {
        reject(error)
      }
    }
    signal.addEventListener('abort', abortListener, { once: true })
    if (signal.aborted) abortListener()
  })

  try {
    await Promise.race([prevSettled, queueDeadline, queueAbort])
  } finally {
    clearTimeout(queueTimer)
    if (signal && abortListener) signal.removeEventListener('abort', abortListener)
  }

  return next
}

async function runWithRedisMutex<T>(
  lockKey: string,
  rowId: string,
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const ownerToken = generateShortId()
  const deadline = Date.now() + REFRESH_MAX_WAIT_MS

  while (true) {
    signal?.throwIfAborted()
    let acquired = false
    try {
      acquired = await acquireLock(lockKey, ownerToken, REFRESH_LOCK_TTL_SEC)
    } catch (error) {
      if (signal?.aborted) {
        await releaseLock(lockKey, ownerToken).catch((releaseError) => {
          logger.warn('Refresh lock cleanup after cancelled acquire failed (will expire via TTL)', {
            rowId,
            error: toError(releaseError).message,
          })
        })
        signal.throwIfAborted()
      }
      logger.warn('Redis unavailable, running OAuth flow uncoordinated', {
        rowId,
        error: toError(error).message,
      })
      return fn()
    }

    if (acquired) {
      const watchdog = setInterval(() => {
        extendLock(lockKey, ownerToken, REFRESH_LOCK_TTL_SEC).catch((error) => {
          logger.warn('Refresh lock extend failed', {
            rowId,
            error: toError(error).message,
          })
        })
      }, REFRESH_LOCK_EXTEND_INTERVAL_MS)
      try {
        signal?.throwIfAborted()
        return await fn()
      } finally {
        clearInterval(watchdog)
        await releaseLock(lockKey, ownerToken).catch((error) => {
          logger.warn('Refresh lock release failed (will expire via TTL)', {
            rowId,
            error: toError(error).message,
          })
        })
      }
    }

    signal?.throwIfAborted()
    if (Date.now() >= deadline) {
      // Lock still held by another process AND its watchdog is keeping it
      // alive — falling open would let us refresh concurrently and race the
      // rotating refresh token. Throw and let the caller decide whether to
      // retry; the Redis-down path remains the only branch that runs `fn()`
      // uncoordinated (no coordination available there).
      throw new Error(
        `MCP OAuth refresh lock for ${rowId} held longer than ${REFRESH_MAX_WAIT_MS}ms`
      )
    }
    await interruptibleSleep(REFRESH_POLL_INTERVAL_MS, signal)
  }
}
