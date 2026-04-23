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
export async function decryptSecret(encryptedValue: string): Promise<{ decrypted: string }> {
  try {
    return await decrypt(encryptedValue, getEncryptionKey())
  } catch (error) {
    logger.error('Decryption error:', { error: toError(error).message })
    throw error
  }
}

/**
 * Generates a secure random password
 * @param length - The length of the password (default: 24)
 * @returns A new secure password string
 */
export function generatePassword(length = 24): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+='
  let result = ''

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return result
}
