import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM encryption primitive. Produces a self-contained string in the
 * format `iv:ciphertext:authTag` (all hex-encoded) that can be stored and
 * later passed directly to {@link decrypt}.
 *
 * @param plaintext - UTF-8 string to encrypt
 * @param key - 32-byte encryption key
 */
export async function encrypt(
  plaintext: string,
  key: Buffer
): Promise<{ encrypted: string; iv: string }> {
  assertKey(key)

  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()
  const ivHex = iv.toString('hex')

  return {
    encrypted: `${ivHex}:${encrypted}:${authTag.toString('hex')}`,
    iv: ivHex,
  }
}

/**
 * AES-256-GCM decryption primitive. Expects input produced by {@link encrypt}
 * in the format `iv:ciphertext:authTag`. Throws when the format is malformed
 * or when the GCM auth tag does not verify (tampered ciphertext, wrong key).
 */
export async function decrypt(encryptedValue: string, key: Buffer): Promise<{ decrypted: string }> {
  assertKey(key)

  const parts = encryptedValue.split(':')
  if (parts.length < 3) {
    throw new Error('Invalid encrypted value format. Expected "iv:encrypted:authTag"')
  }

  const ivHex = parts[0]
  const authTagHex = parts[parts.length - 1]
  const encrypted = parts.slice(1, -1).join(':')

  if (!ivHex || !authTagHex) {
    throw new Error('Invalid encrypted value format. Expected "iv:encrypted:authTag"')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return { decrypted }
}

function assertKey(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (256 bits)')
  }
}
