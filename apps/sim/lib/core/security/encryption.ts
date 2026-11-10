import { createLogger } from '@sim/logger'
import { decrypt, encrypt } from '@sim/security/encryption'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'

const logger = createLogger('Encryption')

function getEncryptionKey(): Buffer {
  const key = env.ENCRYPTION_KEY
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

/**
 * Encrypts a secret using AES-256-GCM with the app's `ENCRYPTION_KEY`.
 * @param secret - The secret to encrypt
 * @returns A promise resolving to the encrypted value (`iv:ciphertext:authTag`) and the IV.
 */
export async function encryptSecret(secret: string): Promise<{ encrypted: string; iv: string }> {
  return encrypt(secret, getEncryptionKey())
}

/**
 * Decrypts a secret previously produced by {@link encryptSecret}. Logs and
 * rethrows on malformed input or tampered ciphertext.
 */
export async function decryptSecret(
  encryptedValue: string,
  options: { logFailure?: boolean } = {}
): Promise<{ decrypted: string }> {
  try {
    return await decrypt(encryptedValue, getEncryptionKey())
  } catch (error) {
    if (options.logFailure !== false) {
      logger.error('Decryption error:', { error: toError(error).message })
    }
    throw error
  }
}
