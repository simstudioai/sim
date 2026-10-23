import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'

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

const SEALED_PREFIX = 'enc:v1:'
const SEALED_IV_BYTES = 12
const SEALED_KEY_ID_BYTES = 4

interface SealingKeys {
  keyId: string
  cipherKey: Buffer
  ivKey: Buffer
}

function deriveSealingKeys(key: Buffer): SealingKeys {
  assertKey(key)
  const derive = (info: string, length: number) =>
    Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), `sim:sealed:v1:${info}`, length))
  return {
    keyId: derive('key-id', SEALED_KEY_ID_BYTES).toString('hex'),
    cipherKey: derive('cipher', 32),
    ivKey: derive('iv', 32),
  }
}

/** Whether `value` is an envelope produced by {@link seal}. */
export function isSealed(value: string): boolean {
  return value.startsWith(SEALED_PREFIX)
}

/**
 * Deterministic AES-256-GCM envelope, `enc:v1:<keyId>:<iv>:<ciphertext>:<authTag>` (hex). The IV
 * is an HMAC of the plaintext under a subkey derived from `key` (the SIV construction), so equal
 * plaintexts seal to equal envelopes and a stored envelope can be matched with SQL equality. That
 * reveals only whether two sealed values are equal: use it for high-entropy secrets such as OAuth
 * tokens, never for low-entropy values. `keyId` identifies the key for a future rotation.
 */
export function seal(plaintext: string, key: Buffer): string {
  const { keyId, cipherKey, ivKey } = deriveSealingKeys(key)
  const iv = createHmac('sha256', ivKey)
    .update(plaintext, 'utf8')
    .digest()
    .subarray(0, SEALED_IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', cipherKey, iv, { authTagLength: 16 })
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${SEALED_PREFIX}${keyId}:${iv.toString('hex')}:${ciphertext.toString('hex')}:${cipher.getAuthTag().toString('hex')}`
}

/**
 * Opens an envelope produced by {@link seal}. Throws when the value is not an envelope, was sealed
 * under a different key, or fails GCM authentication.
 */
export function unseal(value: string, key: Buffer): string {
  if (!isSealed(value)) throw new Error('Value is not a sealed envelope')
  const [keyId, ivHex, ciphertextHex, authTagHex, ...rest] = value
    .slice(SEALED_PREFIX.length)
    .split(':')
  if (!keyId || !ivHex || ciphertextHex === undefined || !authTagHex || rest.length > 0) {
    throw new Error('Malformed sealed envelope')
  }
  const keys = deriveSealingKeys(key)
  if (keyId !== keys.keyId) throw new Error('Sealed envelope was sealed under a different key')
  const decipher = createDecipheriv('aes-256-gcm', keys.cipherKey, Buffer.from(ivHex, 'hex'), {
    authTagLength: 16,
  })
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}
