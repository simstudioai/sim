import { createLogger } from '@sim/logger'
import { decrypt, encrypt } from '@sim/security/encryption'
import { toError } from '@sim/utils/errors'
import { randomInt } from '@sim/utils/random'
import { env } from '@/lib/core/config/env'

const logger = createLogger('Encryption')

/**
 * Whether `ENCRYPTION_KEY` is usable, without throwing.
 *
 * `env.ts` only validates it as `min(32)`, so a deployment can boot with a key this module
 * will reject on first use. Callers that must degrade rather than fail — writing plaintext
 * instead of losing a user's OAuth connect — check this first. Non-hex is rejected here
 * because `Buffer.from(key, 'hex')` would silently produce a short buffer.
 */
export function hasUsableEncryptionKey(): boolean {
  const key = env.ENCRYPTION_KEY
  return typeof key === 'string' && key.length === 64 && /^[0-9a-f]+$/i.test(key)
}

function getEncryptionKey(): Buffer {
  if (!hasUsableEncryptionKey()) {
    throw new Error('ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)')
  }
  return Buffer.from(env.ENCRYPTION_KEY as string, 'hex')
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
    result += chars.charAt(randomInt(0, chars.length))
  }

  return result
}
