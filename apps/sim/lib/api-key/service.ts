import { db } from '@sim/db'
import { apiKey as apiKeyTable } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { authenticateApiKey } from '@/lib/api-key/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { getWorkspaceBillingSettings } from '@/lib/workspaces/utils'

const logger = createLogger('ApiKeyService')

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

/**
 * Authenticate an API key from header with flexible filtering options
 */
export async function authenticateApiKeyFromHeader(
  apiKeyHeader: string,
  options: ApiKeyAuthOptions = {}
): Promise<ApiKeyAuthResult> {
  if (!apiKeyHeader) {
    return { success: false, error: 'API key required' }
  }

  try {
    let workspaceSettings: {
      billedAccountUserId: string | null
      allowPersonalApiKeys: boolean
    } | null = null

    if (options.workspaceId) {
      workspaceSettings = await getWorkspaceBillingSettings(options.workspaceId)
      if (!workspaceSettings) {
        return { success: false, error: 'Workspace not found' }
      }
    }

    // Build query based on options
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

    // Apply filters
    const conditions = []

    if (options.userId) {
      conditions.push(eq(apiKeyTable.userId, options.userId))
    }

    if (options.keyTypes?.length) {
      if (options.keyTypes.length === 1) {
        conditions.push(eq(apiKeyTable.type, options.keyTypes[0]))
      } else {
        // For multiple types, we'll filter in memory since drizzle's inArray is complex here
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

    // Authenticate each key
    for (const storedKey of filteredRecords) {
      // Skip expired keys
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

    return { success: false, error: 'Invalid API key' }
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
