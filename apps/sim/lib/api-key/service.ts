import { db } from '@sim/db'
import { apiKey as apiKeyTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { hashApiKey } from '@/lib/api-key/crypto'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceBillingSettings, type WorkspaceBillingSettings } from '@/lib/workspaces/utils'

const logger = createLogger('ApiKeyService')

export async function listApiKeys(workspaceId: string) {
  return db
    .select({
      id: apiKeyTable.id,
      name: apiKeyTable.name,
      type: apiKeyTable.type,
      lastUsed: apiKeyTable.lastUsed,
      createdAt: apiKeyTable.createdAt,
      expiresAt: apiKeyTable.expiresAt,
      createdBy: apiKeyTable.createdBy,
    })
    .from(apiKeyTable)
    .where(and(eq(apiKeyTable.workspaceId, workspaceId), eq(apiKeyTable.type, 'workspace')))
    .orderBy(apiKeyTable.createdAt)
}

export interface ApiKeyAuthOptions {
  userId?: string
  workspaceId?: string
  keyTypes?: ('personal' | 'workspace')[]
}

export interface ApiKeyAuthResult {
  success: boolean
  userId?: string
  keyId?: string
  keyType?: 'personal' | 'workspace'
  workspaceId?: string
  error?: string
}

const INVALID = { success: false, error: 'Invalid API key' } as const

interface HashCandidate {
  id: string
  userId: string
  workspaceId: string | null
  type: string
  expiresAt: Date | null
}

/**
 * Authenticate an API key from header with flexible filtering options.
 *
 * Looks up a single row by `sha256(apiKeyHeader)` and applies the scope /
 * expiry / permission gates. Any miss — no matching hash or a failed gate —
 * returns `INVALID`.
 */
export async function authenticateApiKeyFromHeader(
  apiKeyHeader: string,
  options: ApiKeyAuthOptions = {}
): Promise<ApiKeyAuthResult> {
  if (!apiKeyHeader) {
    return { success: false, error: 'API key required' }
  }

  try {
    let workspaceSettings: WorkspaceBillingSettings | null = null

    if (options.workspaceId) {
      workspaceSettings = await getWorkspaceBillingSettings(options.workspaceId)
      if (!workspaceSettings) {
        return { success: false, error: 'Workspace not found' }
      }
    }

    const keyHash = hashApiKey(apiKeyHeader)
    const rows: HashCandidate[] = await db
      .select({
        id: apiKeyTable.id,
        userId: apiKeyTable.userId,
        workspaceId: apiKeyTable.workspaceId,
        type: apiKeyTable.type,
        expiresAt: apiKeyTable.expiresAt,
      })
      .from(apiKeyTable)
      .where(eq(apiKeyTable.keyHash, keyHash))

    if (rows.length === 0) return INVALID

    const record = rows[0]
    const keyType = record.type as 'personal' | 'workspace'

    if (options.userId && record.userId !== options.userId) return INVALID
    if (options.keyTypes?.length && !options.keyTypes.includes(keyType)) return INVALID
    if (record.expiresAt && record.expiresAt < new Date()) return INVALID

    if (
      options.workspaceId &&
      keyType === 'workspace' &&
      record.workspaceId !== options.workspaceId
    ) {
      return INVALID
    }

    if (options.workspaceId && keyType === 'personal') {
      if (!workspaceSettings?.allowPersonalApiKeys) return INVALID
      if (!record.userId) return INVALID

      const permission = await getUserEntityPermissions(
        record.userId,
        'workspace',
        options.workspaceId
      )
      if (permission === null) return INVALID
    }

    logger.debug('API key matched via hash lookup', { keyId: record.id, keyType })

    return {
      success: true,
      userId: record.userId,
      keyId: record.id,
      keyType,
      workspaceId: record.workspaceId || options.workspaceId || undefined,
    }
  } catch (error) {
    logger.error('API key authentication error:', error)
    return { success: false, error: 'Authentication failed' }
  }
}

/**
 * Update the last used timestamp for an API key
 */
export async function updateApiKeyLastUsed(keyId: string): Promise<void> {
  try {
    await db.update(apiKeyTable).set({ lastUsed: new Date() }).where(eq(apiKeyTable.id, keyId))
  } catch (error) {
    logger.error('Error updating API key last used:', error)
  }
}
