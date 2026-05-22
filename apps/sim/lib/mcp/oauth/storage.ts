import { createHash } from 'node:crypto'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { db } from '@sim/db'
import { mcpServerOauth } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq, gt } from 'drizzle-orm'
import { acquireLock, extendLock, releaseLock } from '@/lib/core/config/redis'
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
  workspaceId: string
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
  userId: string
  workspaceId: string
}): Promise<McpOauthRow> {
  const existing = await loadOauthRow(params)
  if (existing) return existing

  const id = generateId()
  try {
    await db.insert(mcpServerOauth).values({
      id,
      mcpServerId: params.mcpServerId,
      userId: params.userId,
      workspaceId: params.workspaceId,
    })
  } catch (error) {
    const winner = await loadOauthRow(params)
    if (winner) return winner
    throw error
  }

  return {
    id,
    mcpServerId: params.mcpServerId,
    userId: params.userId,
    workspaceId: params.workspaceId,
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
  await db
    .update(mcpServerOauth)
    .set({ clientInformation: encrypted, updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
}

export async function saveTokens(rowId: string, tokens: OAuthTokens): Promise<void> {
  const encrypted = await encryptTokens(tokens)
  await db
    .update(mcpServerOauth)
    .set({ tokens: encrypted, lastRefreshedAt: new Date(), updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
}

export async function saveCodeVerifier(rowId: string, verifier: string): Promise<void> {
  const { encrypted } = await encryptSecret(verifier)
  await db
    .update(mcpServerOauth)
    .set({ codeVerifier: encrypted, updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
}

export async function saveState(rowId: string, state: string): Promise<void> {
  const now = new Date()
  await db
    .update(mcpServerOauth)
    .set({ state: hashState(state), stateCreatedAt: now, updatedAt: now })
    .where(eq(mcpServerOauth.id, rowId))
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

export async function clearState(rowId: string): Promise<void> {
  await db
    .update(mcpServerOauth)
    .set({ state: null, stateCreatedAt: null, updatedAt: new Date() })
    .where(eq(mcpServerOauth.id, rowId))
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
 *      runs `fn()` after the previous settles.
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

const inflightChains = new Map<string, Promise<unknown>>()

export async function withMcpOauthRefreshLock<T>(rowId: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = `mcp:oauth:refresh:${rowId}`
  const prev = inflightChains.get(lockKey) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(() => runWithRedisMutex(lockKey, rowId, fn))
  inflightChains.set(lockKey, next)
  const cleanup = () => {
    if (inflightChains.get(lockKey) === next) inflightChains.delete(lockKey)
  }
  next.then(cleanup, cleanup)
  return next as Promise<T>
}

async function runWithRedisMutex<T>(
  lockKey: string,
  rowId: string,
  fn: () => Promise<T>
): Promise<T> {
  const ownerToken = generateShortId()
  const deadline = Date.now() + REFRESH_MAX_WAIT_MS

  while (true) {
    let acquired = false
    try {
      acquired = await acquireLock(lockKey, ownerToken, REFRESH_LOCK_TTL_SEC)
    } catch (error) {
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
    await sleep(REFRESH_POLL_INTERVAL_MS)
  }
}
