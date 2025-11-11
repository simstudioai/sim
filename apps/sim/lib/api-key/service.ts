import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { db } from '@sim/db'
import { apiKey as apiKeyTable } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { authenticateApiKey } from '@/lib/api-key/auth'
import { env } from '@/lib/env'
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

/**
 * Get the API encryption key from the environment
 * @returns The API encryption key
 */
function getApiEncryptionKey(): Buffer | null {
  const key = env.API_ENCRYPTION_KEY
  if (!key) {
    logger.warn(
      'API_ENCRYPTION_KEY not set - API keys will be stored in plain text. Consider setting this for better security.'
    )
    return null
  }
  if (key.length !== 64) {
    throw new Error('API_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

/**
 * Encrypts an API key using the dedicated API encryption key
 * @param apiKey - The API key to encrypt
 * @returns A promise that resolves to an object containing the encrypted API key and IV
 */
export async function encryptApiKey(apiKey: string): Promise<{ encrypted: string; iv: string }> {
  const key = getApiEncryptionKey()

  // If no API encryption key is set, return the key as-is for backward compatibility
  if (!key) {
    return { encrypted: apiKey, iv: '' }
  }

  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(apiKey, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Format: iv:encrypted:authTag
  return {
    encrypted: `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`,
    iv: iv.toString('hex'),
  }
}

/**
 * Decrypts an API key using the dedicated API encryption key
 * @param encryptedValue - The encrypted value in format "iv:encrypted:authTag" or plain text
 * @returns A promise that resolves to an object containing the decrypted API key
 */
export async function decryptApiKey(encryptedValue: string): Promise<{ decrypted: string }> {
  // Check if this is actually encrypted (contains colons)
  if (!encryptedValue.includes(':') || encryptedValue.split(':').length !== 3) {
    // This is a plain text key, return as-is
    return { decrypted: encryptedValue }
  }

  const key = getApiEncryptionKey()

  // If no API encryption key is set, assume it's plain text
  if (!key) {
    return { decrypted: encryptedValue }
  }

  const parts = encryptedValue.split(':')
  const ivHex = parts[0]
  const authTagHex = parts[parts.length - 1]
  const encrypted = parts.slice(1, -1).join(':')

  if (!ivHex || !encrypted || !authTagHex) {
    throw new Error('Invalid encrypted API key format. Expected "iv:encrypted:authTag"')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return { decrypted }
  } catch (error: unknown) {
    logger.error('API key decryption error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    throw error
  }
}

/**
 * Generates a standardized API key with the 'sim_' prefix (legacy format)
 * @returns A new API key string
 */
export function generateApiKey(): string {
  return `sim_${randomBytes(24).toString('base64url')}`
}

/**
 * Generates a new encrypted API key with the 'sk-sim-' prefix
 * @returns A new encrypted API key string
 */
export function generateEncryptedApiKey(): string {
  return `sk-sim-${randomBytes(24).toString('base64url')}`
}

/**
 * Determines if an API key uses the new encrypted format based on prefix
 * @param apiKey - The API key to check
 * @returns true if the key uses the new encrypted format (sk-sim- prefix)
 */
export function isEncryptedApiKeyFormat(apiKey: string): boolean {
  return apiKey.startsWith('sk-sim-')
}

/**
 * Determines if an API key uses the legacy format based on prefix
 * @param apiKey - The API key to check
 * @returns true if the key uses the legacy format (sim_ prefix)
 */
export function isLegacyApiKeyFormat(apiKey: string): boolean {
  return apiKey.startsWith('sim_') && !apiKey.startsWith('sk-sim-')
}
