import {
  decryptApiKey,
  encryptApiKey,
  generateApiKey,
  generateEncryptedApiKey,
  isEncryptedApiKeyFormat,
  isLegacyApiKeyFormat,
} from '@/lib/api-key/service'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ApiKeyAuth')

/**
 * API key authentication utilities supporting both legacy plain text keys
 * and modern encrypted keys for gradual migration without breaking existing keys
 */

/**
 * Checks if a stored key is in the new encrypted format
 * @param storedKey - The key stored in the database
 * @returns true if the key is encrypted, false if it's plain text
 */
export function isEncryptedKey(storedKey: string): boolean {
  // Check if it follows the encrypted format: iv:encrypted:authTag
  return storedKey.includes(':') && storedKey.split(':').length === 3
}

/**
 * Authenticates an API key against a stored key, supporting both legacy and new encrypted formats
 * @param inputKey - The API key provided by the client
 * @param storedKey - The key stored in the database (may be plain text or encrypted)
 * @returns Promise<boolean> - true if the key is valid
 */
export async function authenticateApiKey(inputKey: string, storedKey: string): Promise<boolean> {
  try {
    // If input key has new encrypted prefix (sk-sim-), only check against encrypted storage
    if (isEncryptedApiKeyFormat(inputKey)) {
      if (isEncryptedKey(storedKey)) {
        try {
          const { decrypted } = await decryptApiKey(storedKey)
          return inputKey === decrypted
        } catch (decryptError) {
          logger.error('Failed to decrypt stored API key:', { error: decryptError })
          return false
        }
      }
      // New format keys should never match against plain text storage
      return false
    }

    // If input key has legacy prefix (sim_), check both encrypted and plain text
    if (isLegacyApiKeyFormat(inputKey)) {
      if (isEncryptedKey(storedKey)) {
        try {
          const { decrypted } = await decryptApiKey(storedKey)
          return inputKey === decrypted
        } catch (decryptError) {
          logger.error('Failed to decrypt stored API key:', { error: decryptError })
          // Fall through to plain text comparison if decryption fails
        }
      }
      // Legacy format can match against plain text storage
      return inputKey === storedKey
    }

    // If no recognized prefix, fall back to original behavior
    if (isEncryptedKey(storedKey)) {
      try {
        const { decrypted } = await decryptApiKey(storedKey)
        return inputKey === decrypted
      } catch (decryptError) {
        logger.error('Failed to decrypt stored API key:', { error: decryptError })
      }
    }

    return inputKey === storedKey
  } catch (error) {
    logger.error('API key authentication error:', { error })
    return false
  }
}

/**
 * Encrypts an API key for secure storage
 * @param apiKey - The plain text API key to encrypt
 * @returns Promise<string> - The encrypted key
 */
export async function encryptApiKeyForStorage(apiKey: string): Promise<string> {
  try {
    const { encrypted } = await encryptApiKey(apiKey)
    return encrypted
  } catch (error) {
    logger.error('API key encryption error:', { error })
    throw new Error('Failed to encrypt API key')
  }
}

/**
 * Creates a new API key
 * @param useStorage - Whether to encrypt the key before storage (default: true)
 * @returns Promise<{key: string, encryptedKey?: string}> - The plain key and optionally encrypted version
 */
export async function createApiKey(useStorage = true): Promise<{
  key: string
  encryptedKey?: string
}> {
  try {
    const hasEncryptionKey = env.API_ENCRYPTION_KEY !== undefined

    const plainKey = hasEncryptionKey ? generateEncryptedApiKey() : generateApiKey()

    if (useStorage) {
      const encryptedKey = await encryptApiKeyForStorage(plainKey)
      return { key: plainKey, encryptedKey }
    }

    return { key: plainKey }
  } catch (error) {
    logger.error('API key creation error:', { error })
    throw new Error('Failed to create API key')
  }
}

/**
 * Decrypts an API key from storage for display purposes
 * @param encryptedKey - The encrypted API key from the database
 * @returns Promise<string> - The decrypted API key
 */
export async function decryptApiKeyFromStorage(encryptedKey: string): Promise<string> {
  try {
    const { decrypted } = await decryptApiKey(encryptedKey)
    return decrypted
  } catch (error) {
    logger.error('API key decryption error:', { error })
    throw new Error('Failed to decrypt API key')
  }
}

/**
 * Gets the last 4 characters of an API key for display purposes
 * @param apiKey - The API key (plain text)
 * @returns string - The last 4 characters
 */
export function getApiKeyLast4(apiKey: string): string {
  return apiKey.slice(-4)
}

/**
 * Gets the display format for an API key showing prefix and last 4 characters
 * @param encryptedKey - The encrypted API key from the database
 * @returns Promise<string> - The display format like "sk-sim-...r6AA"
 */
export async function getApiKeyDisplayFormat(encryptedKey: string): Promise<string> {
  try {
    if (isEncryptedKey(encryptedKey)) {
      const decryptedKey = await decryptApiKeyFromStorage(encryptedKey)
      return formatApiKeyForDisplay(decryptedKey)
    }
    // For plain text keys (legacy), format directly
    return formatApiKeyForDisplay(encryptedKey)
  } catch (error) {
    logger.error('Failed to format API key for display:', { error })
    return '****'
  }
}

/**
 * Formats an API key for display showing prefix and last 4 characters
 * @param apiKey - The API key (plain text)
 * @returns string - The display format like "sk-sim-...r6AA" or "sim_...r6AA"
 */
export function formatApiKeyForDisplay(apiKey: string): string {
  if (isEncryptedApiKeyFormat(apiKey)) {
    // For sk-sim- format: "sk-sim-...r6AA"
    const last4 = getApiKeyLast4(apiKey)
    return `sk-sim-...${last4}`
  }
  if (isLegacyApiKeyFormat(apiKey)) {
    // For sim_ format: "sim_...r6AA"
    const last4 = getApiKeyLast4(apiKey)
    return `sim_...${last4}`
  }
  // Unknown format, just show last 4
  const last4 = getApiKeyLast4(apiKey)
  return `...${last4}`
}

/**
 * Gets the last 4 characters of an encrypted API key by decrypting it first
 * @param encryptedKey - The encrypted API key from the database
 * @returns Promise<string> - The last 4 characters
 */
export async function getEncryptedApiKeyLast4(encryptedKey: string): Promise<string> {
  try {
    if (isEncryptedKey(encryptedKey)) {
      const decryptedKey = await decryptApiKeyFromStorage(encryptedKey)
      return getApiKeyLast4(decryptedKey)
    }
    // For plain text keys (legacy), return last 4 directly
    return getApiKeyLast4(encryptedKey)
  } catch (error) {
    logger.error('Failed to get last 4 characters of API key:', { error })
    return '****'
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
