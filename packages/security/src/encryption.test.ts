import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decrypt, encrypt } from './encryption'

const KEY = Buffer.from('0'.repeat(64), 'hex')

describe('encrypt', () => {
  it('returns iv:ciphertext:authTag and a 32-char hex IV', async () => {
    const result = await encrypt('secret', KEY)
    expect(result.encrypted.split(':')).toHaveLength(3)
    expect(result.iv).toHaveLength(32)
  })

  it('produces distinct ciphertexts for the same input', async () => {
    const a = await encrypt('same', KEY)
    const b = await encrypt('same', KEY)
    expect(a.encrypted).not.toBe(b.encrypted)
  })

  it('rejects keys that are not 32 bytes', async () => {
    await expect(encrypt('x', Buffer.alloc(16))).rejects.toThrow(/32 bytes/)
  })
})

describe('decrypt', () => {
  it('round-trips arbitrary UTF-8 input', async () => {
    const plaintext = 'Hello, !"#$%&\'()*+,-./0123456789:;<=>?@'
    const { encrypted } = await encrypt(plaintext, KEY)
    const { decrypted } = await decrypt(encrypted, KEY)
    expect(decrypted).toBe(plaintext)
  })

  it('round-trips empty strings', async () => {
    const { encrypted } = await encrypt('', KEY)
    const { decrypted } = await decrypt(encrypted, KEY)
    expect(decrypted).toBe('')
  })

  it('round-trips long inputs', async () => {
    const plaintext = 'a'.repeat(10_000)
    const { encrypted } = await encrypt(plaintext, KEY)
    const { decrypted } = await decrypt(encrypted, KEY)
    expect(decrypted).toBe(plaintext)
  })

  it('throws on malformed input', async () => {
    await expect(decrypt('invalid', KEY)).rejects.toThrow(
      'Invalid encrypted value format. Expected "iv:encrypted:authTag"'
    )
    await expect(decrypt('part1:part2', KEY)).rejects.toThrow(
      'Invalid encrypted value format. Expected "iv:encrypted:authTag"'
    )
  })

  it('throws when ciphertext is tampered', async () => {
    const { encrypted } = await encrypt('original', KEY)
    const parts = encrypted.split(':')
    parts[1] = `deadbeef${parts[1].slice(8)}`
    await expect(decrypt(parts.join(':'), KEY)).rejects.toThrow()
  })

  it('throws when auth tag is tampered', async () => {
    const { encrypted } = await encrypt('original', KEY)
    const parts = encrypted.split(':')
    parts[2] = '0'.repeat(32)
    await expect(decrypt(parts.join(':'), KEY)).rejects.toThrow()
  })

  it('throws when decrypted with a different key', async () => {
    const { encrypted } = await encrypt('original', KEY)
    const otherKey = randomBytes(32)
    await expect(decrypt(encrypted, otherKey)).rejects.toThrow()
  })
})
