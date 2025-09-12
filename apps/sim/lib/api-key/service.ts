import { and, eq } from 'drizzle-orm'
import { authenticateApiKey } from '@/lib/api-key/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { apiKey as apiKeyTable, workspace } from '@/db/schema'

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

    // Add workspace join if needed for workspace keys
    if (options.workspaceId || options.keyTypes?.includes('workspace')) {
      query = query.leftJoin(workspace, eq(apiKeyTable.workspaceId, workspace.id)) as any
    }

    // Apply filters
    const conditions = []

    if (options.userId) {
      conditions.push(eq(apiKeyTable.userId, options.userId))
    }

    if (options.workspaceId) {
      conditions.push(eq(apiKeyTable.workspaceId, options.workspaceId))
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

    // Filter by keyTypes in memory if multiple types specified
    const filteredRecords =
      options.keyTypes?.length && options.keyTypes.length > 1
        ? keyRecords.filter((record) => options.keyTypes!.includes(record.type as any))
        : keyRecords

    // Authenticate each key
    for (const storedKey of filteredRecords) {
      // Skip expired keys
      if (storedKey.expiresAt && storedKey.expiresAt < new Date()) {
        continue
      }

      try {
        const isValid = await authenticateApiKey(apiKeyHeader, storedKey.key)
        if (isValid) {
          return {
            success: true,
            userId: storedKey.userId,
            keyId: storedKey.id,
            keyType: storedKey.type as 'personal' | 'workspace',
            workspaceId: storedKey.workspaceId || undefined,
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
