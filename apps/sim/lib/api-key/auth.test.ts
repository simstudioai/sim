/**
 * Tests for API key storage-format and length validation.
 */

import { randomBytes } from 'crypto'
import { describe, expect, it, vi } from 'vitest'

const cryptoMock = vi.hoisted(() => ({
  isEncryptedApiKeyFormat: (key: string) => key.startsWith('sk-sim-'),
  isLegacyApiKeyFormat: (key: string) => key.startsWith('sim_') && !key.startsWith('sk-sim-'),
  generateApiKey: () => `sim_${randomBytes(24).toString('base64url')}`,
  generateEncryptedApiKey: () => `sk-sim-${randomBytes(24).toString('base64url')}`,
  encryptApiKey: async (apiKey: string) => ({
    encrypted: `mock-iv:${Buffer.from(apiKey).toString('hex')}:mock-tag`,
    iv: 'mock-iv',
  }),
  decryptApiKey: async (encryptedValue: string) => {
    if (!encryptedValue.includes(':') || encryptedValue.split(':').length !== 3) {
      return { decrypted: encryptedValue }
    }
    const parts = encryptedValue.split(':')
    const hexPart = parts[1]
    return { decrypted: Buffer.from(hexPart, 'hex').toString('utf8') }
  },
}))

vi.mock('@/lib/api-key/crypto', () => cryptoMock)

import { isEncryptedKey, isValidApiKeyFormat } from '@/lib/api-key/auth'

describe('isEncryptedKey', () => {
  it('detects only the three-part iv:encrypted:authTag storage format', () => {
    expect(isEncryptedKey('iv:data:tag')).toBe(true)
    expect(isEncryptedKey('sim_abcdef123456')).toBe(false)
    expect(isEncryptedKey('part1:part2')).toBe(false)
    expect(isEncryptedKey('a:b:c:d')).toBe(false)
  })
})

describe('isValidApiKeyFormat', () => {
  it('enforces the 11 to 199 character bounds', () => {
    expect(isValidApiKeyFormat('a'.repeat(11))).toBe(true)
    expect(isValidApiKeyFormat('a'.repeat(199))).toBe(true)
    expect(isValidApiKeyFormat('a'.repeat(10))).toBe(false)
    expect(isValidApiKeyFormat('a'.repeat(200))).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isValidApiKeyFormat(null as unknown as string)).toBe(false)
    expect(isValidApiKeyFormat(123 as unknown as string)).toBe(false)
  })
})
