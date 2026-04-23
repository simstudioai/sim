import { createLogger } from '@sim/logger'
import { decrypt, encrypt } from '@sim/security/encryption'
import { sha256Hex } from '@sim/security/hash'
import { generateSecureToken } from '@sim/security/tokens'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'

const logger = createLogger('ApiKeyCrypto')

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
 * Encrypts an API key using the dedicated API encryption key. Falls back to
 * returning the plain key when `API_ENCRYPTION_KEY` is unset, for backward
 * compatibility with deployments that predate encryption-at-rest.
 */
export async function encryptApiKey(apiKey: string): Promise<{ encrypted: string; iv: string }> {
  const key = getApiEncryptionKey()
  if (!key) {
    return { encrypted: apiKey, iv: '' }
  }
  return encrypt(apiKey, key)
}

/**
 * Decrypts an API key previously produced by {@link encryptApiKey}. Values
 * that lack the `iv:ciphertext:authTag` shape are assumed to be legacy plain
 * text and returned unchanged.
 */
export async function decryptApiKey(encryptedValue: string): Promise<{ decrypted: string }> {
  const parts = encryptedValue.split(':')
  if (parts.length !== 3) {
    return { decrypted: encryptedValue }
  }

  const key = getApiEncryptionKey()
  if (!key) {
    return { decrypted: encryptedValue }
  }

  try {
    return await decrypt(encryptedValue, key)
  } catch (error) {
    logger.error('API key decryption error:', { error: toError(error).message })
    throw error
  }
}

/**
 * Generates a standardized API key with the 'sim_' prefix (legacy format)
 * @returns A new API key string
 */
export function generateApiKey(): string {
  return `sim_${generateSecureToken(24)}`
}

/**
 * Generates a new encrypted API key with the 'sk-sim-' prefix
 * @returns A new encrypted API key string
 */
export function generateEncryptedApiKey(): string {
  return `sk-sim-${generateSecureToken(24)}`
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

/**
 * Deterministically hashes a plain-text API key for indexed lookup. The hash
 * column has a unique index so authentication can match an incoming key via a
 * single `WHERE key_hash = $hash` lookup instead of scanning and decrypting
 * every stored encrypted key.
 *
 * @param plainKey - The plain-text API key as presented by the client
 * @returns The hex-encoded SHA-256 digest
 */
export function hashApiKey(plainKey: string): string {
  return sha256Hex(plainKey)
}
