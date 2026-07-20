import { db } from '@sim/db'
import { managedAgentConnection } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'

const logger = createLogger('ManagedAgentConnections')

/**
 * Row shape returned by list/get. `encryptedApiKey` is intentionally
 * dropped and replaced with `maskedApiKey` — nothing on the wire ever
 * carries the plaintext.
 */
export interface ManagedAgentConnectionSummary {
  id: string
  workspaceId: string
  userId: string | null
  name: string
  maskedApiKey: string
  lastVerifiedAt: Date | null
  lastVerificationError: string | null
  createdAt: Date
  updatedAt: Date
}

function toSummary(
  row: typeof managedAgentConnection.$inferSelect,
  apiKey: string | null
): ManagedAgentConnectionSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    name: row.name,
    maskedApiKey: apiKey ? maskApiKey(apiKey) : '••••••••',
    lastVerifiedAt: row.lastVerifiedAt,
    lastVerificationError: row.lastVerificationError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 12) return '••••••••'
  return `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`
}

export async function listConnections(params: {
  workspaceId: string
}): Promise<ManagedAgentConnectionSummary[]> {
  const rows = await db
    .select()
    .from(managedAgentConnection)
    .where(eq(managedAgentConnection.workspaceId, params.workspaceId))
    .orderBy(managedAgentConnection.createdAt)
  // Decrypt only to compute the mask preview; failures fall back to a
  // solid bullet string so a corrupt row can't take down the list.
  const summaries: ManagedAgentConnectionSummary[] = []
  for (const row of rows) {
    let apiKey: string | null = null
    try {
      apiKey = (await decryptSecret(row.encryptedApiKey)).decrypted
    } catch (err) {
      logger.warn(`Failed to decrypt api key for connection ${row.id}`, { error: err })
    }
    summaries.push(toSummary(row, apiKey))
  }
  return summaries
}

export async function getConnection(params: {
  id: string
  workspaceId: string
}): Promise<typeof managedAgentConnection.$inferSelect | null> {
  const rows = await db
    .select()
    .from(managedAgentConnection)
    .where(
      and(
        eq(managedAgentConnection.id, params.id),
        eq(managedAgentConnection.workspaceId, params.workspaceId)
      )
    )
    .limit(1)
  return rows[0] ?? null
}

/**
 * Decrypts the stored API key for a given connection. Server-side only —
 * never expose the return value to the browser. Callers are proxy routes
 * and the workflow-block tool.
 */
export async function getDecryptedApiKey(params: {
  id: string
  workspaceId: string
}): Promise<string | null> {
  const row = await getConnection(params)
  if (!row) return null
  const { decrypted } = await decryptSecret(row.encryptedApiKey)
  return decrypted
}

export interface CreateConnectionInput {
  workspaceId: string
  userId: string
  name: string
  apiKey: string
  /**
   * Optional callback invoked with the decrypted key so the caller can
   * verify it against `GET /v1/agents` before we commit the row. Return
   * `{ ok: true }` to persist, `{ ok: false, error }` to reject.
   */
  verify?: (apiKey: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

export async function createConnection(
  input: CreateConnectionInput
): Promise<ManagedAgentConnectionSummary> {
  if (input.verify) {
    const outcome = await input.verify(input.apiKey)
    if (!outcome.ok) {
      throw new Error(outcome.error)
    }
  }
  const now = new Date()
  const { encrypted } = await encryptSecret(input.apiKey)
  const id = generateShortId()
  await db.insert(managedAgentConnection).values({
    id,
    workspaceId: input.workspaceId,
    userId: input.userId,
    name: input.name,
    encryptedApiKey: encrypted,
    lastVerifiedAt: input.verify ? now : null,
    lastVerificationError: null,
    createdAt: now,
    updatedAt: now,
  })
  const created = await getConnection({ id, workspaceId: input.workspaceId })
  if (!created) throw new Error('Failed to load newly created managed-agent connection')
  return toSummary(created, input.apiKey)
}

export async function deleteConnection(params: {
  id: string
  workspaceId: string
}): Promise<boolean> {
  const existing = await getConnection(params)
  if (!existing) return false
  await db
    .delete(managedAgentConnection)
    .where(
      and(
        eq(managedAgentConnection.id, params.id),
        eq(managedAgentConnection.workspaceId, params.workspaceId)
      )
    )
  return true
}

export interface RotateKeyInput {
  id: string
  workspaceId: string
  apiKey: string
  verify?: (apiKey: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

export async function rotateConnectionKey(
  input: RotateKeyInput
): Promise<ManagedAgentConnectionSummary | null> {
  const existing = await getConnection({ id: input.id, workspaceId: input.workspaceId })
  if (!existing) return null
  if (input.verify) {
    const outcome = await input.verify(input.apiKey)
    if (!outcome.ok) throw new Error(outcome.error)
  }
  const { encrypted } = await encryptSecret(input.apiKey)
  const now = new Date()
  await db
    .update(managedAgentConnection)
    .set({
      encryptedApiKey: encrypted,
      lastVerifiedAt: input.verify ? now : existing.lastVerifiedAt,
      lastVerificationError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(managedAgentConnection.id, input.id),
        eq(managedAgentConnection.workspaceId, input.workspaceId)
      )
    )
  const refreshed = await getConnection({ id: input.id, workspaceId: input.workspaceId })
  if (!refreshed) return null
  return toSummary(refreshed, input.apiKey)
}

export async function markVerificationResult(params: {
  id: string
  workspaceId: string
  ok: boolean
  error?: string
}): Promise<void> {
  const now = new Date()
  await db
    .update(managedAgentConnection)
    .set({
      lastVerifiedAt: params.ok ? now : null,
      lastVerificationError: params.ok ? null : (params.error ?? 'Unknown error').slice(0, 500),
      updatedAt: now,
    })
    .where(
      and(
        eq(managedAgentConnection.id, params.id),
        eq(managedAgentConnection.workspaceId, params.workspaceId)
      )
    )
}
