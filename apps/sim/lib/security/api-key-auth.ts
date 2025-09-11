import bcrypt from 'bcryptjs'
import { createLogger } from '@/lib/logs/console/logger'
import { generateApiKey } from '@/lib/utils'

const logger = createLogger('ApiKeyAuth')

/**
 * API key authentication utilities supporting both legacy plain text keys
 * and modern hashed keys for gradual migration without breaking existing keys
 */

/**
 * Checks if a stored key is in the new hashed format
 * @param storedKey - The key stored in the database
 * @returns true if the key is hashed, false if it's plain text
 */
export function isHashedKey(storedKey: string): boolean {
  return (
    storedKey.startsWith('$2a$') || storedKey.startsWith('$2b$') || storedKey.startsWith('$2y$')
  )
}

/**
 * Authenticates an API key against a stored key, supporting both formats
 * @param inputKey - The API key provided by the client
 * @param storedKey - The key stored in the database (may be plain text or hashed)
 * @returns Promise<boolean> - true if the key is valid
 */
export async function authenticateApiKey(inputKey: string, storedKey: string): Promise<boolean> {
  try {
    if (isHashedKey(storedKey)) {
      return await bcrypt.compare(inputKey, storedKey)
    }

    return inputKey === storedKey
  } catch (error) {
    logger.error('API key authentication error:', { error })
    return false
  }
}

/**
 * Hashes an API key for secure storage
 * @param apiKey - The plain text API key to hash
 * @param saltRounds - Number of salt rounds (default: 12)
 * @returns Promise<string> - The hashed key
 */
export async function hashApiKey(apiKey: string, saltRounds = 12): Promise<string> {
  try {
    return await bcrypt.hash(apiKey, saltRounds)
  } catch (error) {
    logger.error('API key hashing error:', { error })
    throw new Error('Failed to hash API key')
  }
}

/**
 * Creates a new API key with optional hashing
 * @param useHashing - Whether to hash the key before storage (default: true for new keys)
 * @returns Promise<{key: string, hashedKey?: string}> - The plain key and optionally hashed version
 */
export async function createApiKey(useHashing = true): Promise<{
  key: string
  hashedKey?: string
}> {
  try {
    const plainKey = generateApiKey()

    if (useHashing) {
      const hashedKey = await hashApiKey(plainKey)
      return { key: plainKey, hashedKey }
    }

    return { key: plainKey }
  } catch (error) {
    logger.error('API key creation error:', { error })
    throw new Error('Failed to create API key')
  }
}

/**
 * Migrates a plain text key to hashed format during authentication
 * This is used for gradual migration - when a plain text key is successfully authenticated,
 * it can be rehashed and updated in the database
 * @param plainKey - The plain text API key
 * @returns Promise<string> - The hashed version of the key
 */
export async function migrateKeyToHashed(plainKey: string): Promise<string> {
  try {
    return await hashApiKey(plainKey)
  } catch (error) {
    logger.error('Key migration error:', { error })
    throw new Error('Failed to migrate key to hashed format')
  }
}

/**
 * Validates API key format (basic validation)
 * @param apiKey - The API key to validate
 * @returns boolean - true if the format appears valid
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  return typeof apiKey === 'string' && apiKey.length > 10 && apiKey.length < 200
}
