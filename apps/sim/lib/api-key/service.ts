import { db } from '@sim/db'
import { apiKey as apiKeyTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { authenticateApiKey } from '@/lib/api-key/auth'
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
 * Tries the hash lookup first. If that misses (legacy row not yet backfilled,
 * or writer missed the hash column), falls back to the original scan+decrypt
 * loop. The fallback emits a warn log whenever it actually matches a row so
 * we can confirm the fast path is covering 100% of traffic before deleting
 * the fallback block below in a follow-up PR.
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

    const hashResult = await authenticateApiKeyByHash(apiKeyHeader, options, workspaceSettings)
    if (hashResult !== null) return hashResult

    // LEGACY FALLBACK — delete once `logger.warn('API key matched via fallback
    // decrypt loop', ...)` count stays at zero in prod. The block below is the
    // pre-hash-lookup implementation, preserved verbatim as a safety net while
    // the `key_hash` backfill rolls out.
    let query = db
      .select({
        id: apiKeyTable.id,
        userId: apiKeyTable.userId,
        workspaceId: apiKeyTable.workspaceId,
        type: apiKeyTable.type,
        key: apiKeyTable.key,
        expiresAt: apiKeyTable.expiresAt,
      })
      .from(apiKeyTable)

    const conditions = []

    if (options.userId) {
      conditions.push(eq(apiKeyTable.userId, options.userId))
    }

    if (options.keyTypes?.length) {
      if (options.keyTypes.length === 1) {
        conditions.push(eq(apiKeyTable.type, options.keyTypes[0]))
      }
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any
    }

    const keyRecords = await query

    const filteredRecords = keyRecords.filter((record) => {
      const keyType = record.type as 'personal' | 'workspace'

      if (options.keyTypes?.length && !options.keyTypes.includes(keyType)) {
        return false
      }

      if (options.workspaceId) {
        if (keyType === 'workspace') {
          return record.workspaceId === options.workspaceId
        }

        if (keyType === 'personal') {
          return workspaceSettings?.allowPersonalApiKeys ?? false
        }
      }

      return true
    })

    const permissionCache = new Map<string, boolean>()

    for (const storedKey of filteredRecords) {
      if (storedKey.expiresAt && storedKey.expiresAt < new Date()) {
        continue
      }

      if (options.workspaceId && (storedKey.type as 'personal' | 'workspace') === 'personal') {
        if (!workspaceSettings?.allowPersonalApiKeys) {
          continue
        }

        if (!storedKey.userId) {
          continue
        }

        if (!permissionCache.has(storedKey.userId)) {
          const permission = await getUserEntityPermissions(
            storedKey.userId,
            'workspace',
            options.workspaceId
          )
          permissionCache.set(storedKey.userId, permission !== null)
        }

        if (!permissionCache.get(storedKey.userId)) {
          continue
        }
      }

      try {
        const isValid = await authenticateApiKey(apiKeyHeader, storedKey.key)
        if (isValid) {
          logger.warn('API key matched via fallback decrypt loop', { keyId: storedKey.id })
          return {
            success: true,
            userId: storedKey.userId,
            keyId: storedKey.id,
            keyType: storedKey.type as 'personal' | 'workspace',
            workspaceId: storedKey.workspaceId || options.workspaceId || undefined,
          }
        }
      } catch (error) {
        logger.error('Error authenticating API key:', error)
      }
    }

    return INVALID
  } catch (error) {
    logger.error('API key authentication error:', error)
    return { success: false, error: 'Authentication failed' }
  }
}

/**
 * Fast path: look up a single row by `sha256(apiKeyHeader)` and apply the
 * scope / expiry / permission gates. Returns `null` when no row matched the
 * hash (caller should fall through to the legacy scan+decrypt loop). A hash
 * hit that fails a gate returns a concrete `INVALID` — the key definitely
 * belongs to that row, it's just not authorized in this scope.
 */
async function authenticateApiKeyByHash(
  apiKeyHeader: string,
  options: ApiKeyAuthOptions,
  workspaceSettings: WorkspaceBillingSettings | null
): Promise<ApiKeyAuthResult | null> {
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

  if (rows.length === 0) return null

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
