import { execFile } from 'node:child_process'
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Chrome's macOS value encryption (Chromium's `OSCrypt`, scheme `v10`).
 *
 * The key is derived from a random password Chrome stores in the login
 * Keychain. Reading it goes through the documented `security` tool, so macOS
 * applies its own Keychain ACL — the user gets the standard "allow access"
 * prompt for a binary that is not on the item's ACL, and a denial is a hard
 * failure here. Nothing in this module weakens or works around that check.
 *
 * On Windows this scheme does not apply: Chrome's App-Bound Encryption is
 * designed to stop other applications decrypting profile data, and the
 * importer deliberately does not attempt it.
 */

const execFileAsync = promisify(execFile)

/** Fixed Chromium `OSCrypt` parameters for macOS. */
const KEY_SALT = 'saltysalt'
const KEY_ITERATIONS = 1003
const KEY_LENGTH = 16
/** Chromium uses 16 spaces as the IV rather than a per-value nonce. */
const INITIALIZATION_VECTOR = Buffer.alloc(16, 0x20)
const V10_PREFIX = Buffer.from('v10')
const AES_BLOCK_SIZE = 16
/** Length of the SHA-256(domain) modern Chrome prepends to cookie plaintext. */
const DOMAIN_HASH_LENGTH = 32

/**
 * The user could sit on the Keychain prompt for a while, so this is a
 * safety net against a wedged child process, not a UI deadline.
 */
const KEYCHAIN_TIMEOUT_MS = 120_000

export type KeychainPasswordReader = (service: string, account: string) => Promise<string>

const readKeychainItem: KeychainPasswordReader = async (service, account) => {
  const { stdout } = await execFileAsync(
    '/usr/bin/security',
    ['find-generic-password', '-w', '-s', service, '-a', account],
    { timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: 64 * 1024 }
  )
  return stdout.trim()
}

/**
 * The Safe Storage password for one browser's Keychain item, or null when the
 * item does not exist or the user refused access.
 *
 * Each browser names its own item (`Arc Safe Storage`, `Brave Safe Storage`,
 * and so on), so the item is passed in rather than guessed at: asking for the
 * wrong one would prompt the user about a browser they did not choose.
 *
 * The return value is a secret. It must never be logged, persisted, or sent
 * anywhere. Callers should derive a key and drop the reference immediately.
 */
export async function readSafeStoragePassword(
  item: { service: string; account: string },
  read: KeychainPasswordReader = readKeychainItem
): Promise<string | null> {
  try {
    const password = (await read(item.service, item.account)).trim()
    return password.length > 0 ? password : null
  } catch {
    // Item absent, or access denied. Fail closed.
    return null
  }
}

/** Derives the AES-128 key. The result is key material — zero it after use. */
export function deriveEncryptionKey(safeStoragePassword: string): Buffer {
  return pbkdf2Sync(safeStoragePassword, KEY_SALT, KEY_ITERATIONS, KEY_LENGTH, 'sha1')
}

/**
 * Strips Chromium's PKCS#7 padding, tolerating values that carry none.
 *
 * A wrong key usually surfaces here or as mojibake rather than as a thrown
 * error, which is why the caller treats an implausible result as a failed
 * decrypt rather than trusting it.
 */
function stripPkcs7Padding(plaintext: Buffer): Buffer {
  const padding = plaintext.at(-1)
  if (padding === undefined || padding === 0 || padding > AES_BLOCK_SIZE) return plaintext
  if (padding > plaintext.length) return plaintext
  return plaintext.subarray(0, plaintext.length - padding)
}

/**
 * Removes the SHA-256(domain) prefix modern Chrome binds to cookie plaintext,
 * but only after confirming the prefix really is that hash.
 *
 * Verifying rather than blindly dropping 32 bytes is what makes this work
 * across Chrome versions: profiles written before domain binding have no
 * prefix, and cutting one off them would silently corrupt every value.
 */
function stripVerifiedDomainHash(plaintext: Buffer, hostKey: string): Buffer {
  if (plaintext.length < DOMAIN_HASH_LENGTH) return plaintext
  const prefix = plaintext.subarray(0, DOMAIN_HASH_LENGTH)
  const bareHost = hostKey.replace(/^\./, '')
  for (const candidate of [hostKey, bareHost, `.${bareHost}`]) {
    if (createHash('sha256').update(candidate).digest().equals(prefix)) {
      return plaintext.subarray(DOMAIN_HASH_LENGTH)
    }
  }
  return plaintext
}

export interface DecryptOptions {
  /**
   * The row's `host_key`. Supply it for cookies so a domain-bound prefix can
   * be recognised and removed; omit it for values that carry no prefix.
   */
  domain?: string
}

/**
 * Decrypts one `v10` value, or returns null when the blob is not a supported
 * scheme or does not decrypt to usable text.
 *
 * Never throws: a single unreadable row must not abort an import, and the
 * caller counts failures instead. A null is also how a `v20`/app-bound value
 * surfaces, which is the signal that this profile needs a different path
 * rather than a weaker one.
 */
export function decryptChromiumValue(
  encrypted: Buffer,
  key: Buffer,
  { domain }: DecryptOptions = {}
): string | null {
  const body = encrypted.subarray(V10_PREFIX.length)
  if (
    encrypted.length <= V10_PREFIX.length ||
    !encrypted.subarray(0, V10_PREFIX.length).equals(V10_PREFIX) ||
    body.length % AES_BLOCK_SIZE !== 0
  ) {
    return null
  }
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, INITIALIZATION_VECTOR)
    decipher.setAutoPadding(false)
    let plaintext = stripPkcs7Padding(Buffer.concat([decipher.update(body), decipher.final()]))
    if (domain !== undefined) {
      plaintext = stripVerifiedDomainHash(plaintext, domain)
    }
    const value = plaintext.toString('utf8')
    // A wrong key decrypts to bytes that are not a cookie value. Rejecting
    // replacement characters and control bytes keeps that garbage out of the
    // browser profile instead of storing it as a live cookie.
    return value.includes('\uFFFD') || /[\u0000-\u001F\u007F]/.test(value) ? null : value
  } catch {
    return null
  }
}
