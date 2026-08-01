import { createCipheriv, createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  decryptChromiumValue,
  deriveEncryptionKey,
  readSafeStoragePassword,
} from '@/main/browser-import/chromium-crypto'

/** Produces a blob in the same shape Chrome writes on macOS. */
function encryptV10(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from('v10'), cipher.update(plaintext), cipher.final()])
}

const KEY = deriveEncryptionKey('test-safe-storage-password')

describe('deriveEncryptionKey', () => {
  it('derives a deterministic AES-128 key', () => {
    expect(KEY).toHaveLength(16)
    expect(deriveEncryptionKey('test-safe-storage-password').equals(KEY)).toBe(true)
    expect(deriveEncryptionKey('a-different-password').equals(KEY)).toBe(false)
  })
})

describe('decryptChromiumValue', () => {
  it('round-trips a v10 value', () => {
    const encrypted = encryptV10(Buffer.from('session-token-abc'), KEY)
    expect(decryptChromiumValue(encrypted, KEY)).toBe('session-token-abc')
  })

  it('strips a domain hash prefix once it verifies against the host', () => {
    const domain = '.example.com'
    const plaintext = Buffer.concat([
      createHash('sha256').update(domain).digest(),
      Buffer.from('bound-value'),
    ])
    expect(decryptChromiumValue(encryptV10(plaintext, KEY), KEY, { domain })).toBe('bound-value')
  })

  it('leaves values from profiles without domain binding intact', () => {
    // Cutting a fixed 32 bytes would silently corrupt every value written by
    // an older Chrome, so the prefix is only removed when it is really a hash.
    const encrypted = encryptV10(Buffer.from('a'.repeat(40)), KEY)
    expect(decryptChromiumValue(encrypted, KEY, { domain: '.example.com' })).toBe('a'.repeat(40))
  })

  it('rejects a blob that is not a supported scheme', () => {
    expect(decryptChromiumValue(Buffer.from('v20somethingelse'), KEY)).toBeNull()
    expect(decryptChromiumValue(Buffer.alloc(0), KEY)).toBeNull()
    expect(decryptChromiumValue(Buffer.from('v10'), KEY)).toBeNull()
  })

  it('rejects a body that is not a whole number of AES blocks', () => {
    expect(
      decryptChromiumValue(Buffer.concat([Buffer.from('v10'), Buffer.alloc(7)]), KEY)
    ).toBeNull()
  })

  it('does not return plaintext when decrypted with the wrong key', () => {
    const encrypted = encryptV10(Buffer.from('session-token-abc'), KEY)
    expect(decryptChromiumValue(encrypted, deriveEncryptionKey('wrong'))).not.toBe(
      'session-token-abc'
    )
  })
})

describe('readSafeStoragePassword', () => {
  const ARC_ITEM = { service: 'Arc Safe Storage', account: 'Arc' }

  it('reads the item belonging to the browser being imported', async () => {
    // Each browser names its own item. Asking for the wrong one would prompt
    // the user about a browser they did not choose.
    const read = vi.fn().mockResolvedValue('arc-password')

    await expect(readSafeStoragePassword(ARC_ITEM, read)).resolves.toBe('arc-password')
    expect(read).toHaveBeenCalledExactlyOnceWith('Arc Safe Storage', 'Arc')
  })

  it('fails closed when the item is denied or missing', async () => {
    const read = vi.fn().mockRejectedValue(new Error('User denied access'))
    await expect(readSafeStoragePassword(ARC_ITEM, read)).resolves.toBeNull()
  })

  it('treats an empty password as unavailable', async () => {
    const read = vi.fn().mockResolvedValue('  ')
    await expect(readSafeStoragePassword(ARC_ITEM, read)).resolves.toBeNull()
  })
})
