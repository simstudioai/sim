import { createHash } from 'node:crypto'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { db } from '@sim/db'
import { mcpServerOauth } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, gt, sql } from 'drizzle-orm'
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
 * Two-tier locking:
 *   1) In-process Promise chain — cheap, avoids DB roundtrips when the same
 *      Node process holds concurrent callers.
 *   2) Postgres advisory transaction lock — blocks across processes; released
 *      automatically when the transaction ends.
 *
 * Tradeoff: the connection is held for the duration of `fn()`, which includes
 * the SDK's OAuth HTTP refresh. Session-level locks (`pg_advisory_lock`) would
 * release the connection earlier, but they don't survive PgBouncer transaction
 * pooling — they're scoped to the underlying physical connection, which can be
 * swapped between statements. `pg_advisory_xact_lock` is the correct choice
 * here. If pool pressure becomes a real concern at scale, swap this for a
 * Redis-based distributed lock (Redlock) that doesn't pin a DB connection.
 */
const refreshLocks = new Map<string, Promise<unknown>>()

export async function withMcpOauthRefreshLock<T>(rowId: string, fn: () => Promise<T>): Promise<T> {
  const prev = refreshLocks.get(rowId) ?? Promise.resolve()
  const next = prev
    .catch(() => undefined)
    .then(() =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mcp_oauth_refresh:${rowId}`}, 0))`
        )
        return fn()
      })
    )
  refreshLocks.set(rowId, next)
  const cleanup = () => {
    if (refreshLocks.get(rowId) === next) refreshLocks.delete(rowId)
  }
  next.then(cleanup, cleanup)
  return next
}
