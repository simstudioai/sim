import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decrypt, encrypt, isSealed, seal, unseal } from './encryption'

const KEY = Buffer.from('0'.repeat(64), 'hex')

describe('encrypt', () => {
  it('produces distinct ciphertexts for the same input', async () => {
    const a = await encrypt('same', KEY)
    const b = await encrypt('same', KEY)
    expect(a.encrypted).not.toBe(b.encrypted)
  })
})

describe('decrypt', () => {
  it('round-trips arbitrary UTF-8 input', async () => {
    const plaintext = 'Hello, !"#$%&\'()*+,-./0123456789:;<=>?@'
    const { encrypted } = await encrypt(plaintext, KEY)
    const { decrypted } = await decrypt(encrypted, KEY)
    expect(decrypted).toBe(plaintext)
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

describe('seal', () => {
  it('seals equal plaintexts to equal envelopes so stored values match by SQL equality', () => {
    expect(seal('refresh-token', KEY)).toBe(seal('refresh-token', KEY))
    expect(seal('refresh-token', KEY)).not.toBe(seal('refresh-tokem', KEY))
  })

  it('never leaves the plaintext readable in the envelope', () => {
    const plaintext = 'xoxe-1-plaintext-token'
    const sealed = seal(plaintext, KEY)
    expect(isSealed(sealed)).toBe(true)
    expect(sealed).not.toContain(plaintext)
    expect(sealed).not.toContain(Buffer.from(plaintext).toString('hex'))
  })
})

describe('unseal', () => {
  it.each(['', 'ya29.a0:with:colons', 'unicode ✓ token'])('round-trips %j', (plaintext) => {
    expect(unseal(seal(plaintext, KEY), KEY)).toBe(plaintext)
  })

  it('treats a hex-only or colon-separated raw token as unsealed', () => {
    expect(isSealed('0123456789abcdef0123456789abcdef')).toBe(false)
    expect(isSealed('aa:bb:cc')).toBe(false)
    expect(() => unseal('aa:bb:cc', KEY)).toThrow()
  })

  it('rejects an envelope sealed under a different key', () => {
    expect(() => unseal(seal('token', KEY), randomBytes(32))).toThrow(/different key/)
  })

  it('rejects a tampered ciphertext or auth tag', () => {
    const parts = seal('token-value', KEY).split(':')
    const flip = (hex: string) => `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`
    const ciphertextIndex = parts.length - 2
    const tagIndex = parts.length - 1
    for (const index of [ciphertextIndex, tagIndex]) {
      const tampered = [...parts]
      tampered[index] = flip(tampered[index])
      expect(() => unseal(tampered.join(':'), KEY)).toThrow()
    }
  })

  it('treats a raw token that only starts like an envelope as unsealed', () => {
    for (const value of ['enc:v1:raw-provider-token', `${seal('token', KEY)}:extra`]) {
      expect(isSealed(value)).toBe(false)
      expect(() => unseal(value, KEY)).toThrow(/not a sealed envelope/)
    }
  })
})
