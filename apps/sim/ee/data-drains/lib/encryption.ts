import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'

/**
 * Encrypts an arbitrary JSON-serializable credentials object into a single
 * `iv:ciphertext:authTag` string suitable for storage in
 * `data_drains.destination_credentials`. Wraps the shared AES-256-GCM helper.
 */
export async function encryptCredentials<T>(plaintext: T): Promise<string> {
  const { encrypted } = await encryptSecret(JSON.stringify(plaintext))
  return encrypted
}

/**
 * Decrypts the inverse of `encryptCredentials`. The caller is expected to run
 * the destination's `credentialsSchema` on the result to defend against
 * encryption-format drift.
 */
export async function decryptCredentials<T>(ciphertext: string): Promise<T> {
  const { decrypted } = await decryptSecret(ciphertext)
  return JSON.parse(decrypted) as T
}
