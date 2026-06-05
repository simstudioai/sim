/**
 * Tests for API key authentication utilities.
 *
 * Tests cover:
 * - API key format detection (legacy vs encrypted)
 * - Authentication against stored keys
 * - Key encryption and decryption
 * - Display formatting
 * - Edge cases
 */

import { randomBytes } from 'crypto'
import { createEncryptedApiKey, createLegacyApiKey } from '@sim/testing'
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

import {
  formatApiKeyForDisplay,
  getApiKeyLast4,
  isEncryptedKey,
  isValidApiKeyFormat,
} from '@/lib/api-key/auth'

const { generateApiKey, generateEncryptedApiKey, isEncryptedApiKeyFormat, isLegacyApiKeyFormat } =
  cryptoMock

describe('isEncryptedKey', () => {
  it('should detect encrypted storage format (iv:encrypted:authTag)', () => {
    const encryptedStorage = 'abc123:encrypted-data:tag456'
    expect(isEncryptedKey(encryptedStorage)).toBe(true)
  })

  it('should detect plain text storage (no colons)', () => {
    const plainKey = 'sim_abcdef123456'
    expect(isEncryptedKey(plainKey)).toBe(false)
  })

  it('should detect plain text with single colon', () => {
    const singleColon = 'part1:part2'
    expect(isEncryptedKey(singleColon)).toBe(false)
  })

  it('should detect encrypted format with exactly 3 parts', () => {
    const threeParts = 'iv:data:tag'
    expect(isEncryptedKey(threeParts)).toBe(true)
  })

  it('should reject format with more than 3 parts', () => {
    const fourParts = 'a:b:c:d'
    expect(isEncryptedKey(fourParts)).toBe(false)
  })

  it('should reject empty string', () => {
    expect(isEncryptedKey('')).toBe(false)
  })
})

describe('isEncryptedApiKeyFormat (key prefix)', () => {
  it('should detect sk-sim- prefix as encrypted format', () => {
    const { key } = createEncryptedApiKey()
    expect(isEncryptedApiKeyFormat(key)).toBe(true)
  })

  it('should not detect sim_ prefix as encrypted format', () => {
    const { key } = createLegacyApiKey()
    expect(isEncryptedApiKeyFormat(key)).toBe(false)
  })

  it('should not detect random string as encrypted format', () => {
    expect(isEncryptedApiKeyFormat('random-string')).toBe(false)
  })
})

describe('isLegacyApiKeyFormat', () => {
  it('should detect sim_ prefix as legacy format', () => {
    const { key } = createLegacyApiKey()
    expect(isLegacyApiKeyFormat(key)).toBe(true)
  })

  it('should not detect sk-sim- prefix as legacy format', () => {
    const { key } = createEncryptedApiKey()
    expect(isLegacyApiKeyFormat(key)).toBe(false)
  })

  it('should not detect random string as legacy format', () => {
    expect(isLegacyApiKeyFormat('random-string')).toBe(false)
  })
})

describe('isValidApiKeyFormat', () => {
  it('should accept valid length keys', () => {
    expect(isValidApiKeyFormat(`sim_${'a'.repeat(20)}`)).toBe(true)
  })

  it('should reject too short keys', () => {
    expect(isValidApiKeyFormat('short')).toBe(false)
  })

  it('should reject too long keys (>200 chars)', () => {
    expect(isValidApiKeyFormat('a'.repeat(201))).toBe(false)
  })

  it('should accept keys at boundary (11 chars)', () => {
    expect(isValidApiKeyFormat('a'.repeat(11))).toBe(true)
  })

  it('should reject keys at boundary (10 chars)', () => {
    expect(isValidApiKeyFormat('a'.repeat(10))).toBe(false)
  })

  it('should reject non-string input', () => {
    expect(isValidApiKeyFormat(null as any)).toBe(false)
    expect(isValidApiKeyFormat(undefined as any)).toBe(false)
    expect(isValidApiKeyFormat(123 as any)).toBe(false)
  })

  it('should reject empty string', () => {
    expect(isValidApiKeyFormat('')).toBe(false)
  })
})

describe('getApiKeyLast4', () => {
  it('should return last 4 characters of key', () => {
    expect(getApiKeyLast4('sim_abcdefghijklmnop')).toBe('mnop')
  })

  it('should return last 4 characters of encrypted format key', () => {
    expect(getApiKeyLast4('sk-sim-abcdefghijkl')).toBe('ijkl')
  })

  it('should return entire key if less than 4 chars', () => {
    expect(getApiKeyLast4('abc')).toBe('abc')
  })

  it('should handle exactly 4 chars', () => {
    expect(getApiKeyLast4('abcd')).toBe('abcd')
  })
})

describe('formatApiKeyForDisplay', () => {
  it('should format encrypted format key with sk-sim- prefix', () => {
    const key = 'sk-sim-abcdefghijklmnopqrstuvwx'
    const formatted = formatApiKeyForDisplay(key)
    expect(formatted).toBe('sk-sim-...uvwx')
  })

  it('should format legacy key with sim_ prefix', () => {
    const key = 'sim_abcdefghijklmnopqrstuvwx'
    const formatted = formatApiKeyForDisplay(key)
    expect(formatted).toBe('sim_...uvwx')
  })

  it('should format unknown format key with just ellipsis', () => {
    const key = 'custom-key-format-abcd'
    const formatted = formatApiKeyForDisplay(key)
    expect(formatted).toBe('...abcd')
  })

  it('should show last 4 characters correctly', () => {
    const key = 'sk-sim-xxxxxxxxxxxxxxxxr6AA'
    const formatted = formatApiKeyForDisplay(key)
    expect(formatted).toContain('r6AA')
  })
})

describe('generateApiKey', () => {
  it('should generate key with sim_ prefix', () => {
    const key = generateApiKey()
    expect(key).toMatch(/^sim_/)
  })

  it('should generate unique keys', () => {
    const key1 = generateApiKey()
    const key2 = generateApiKey()
    expect(key1).not.toBe(key2)
  })

  it('should generate key of valid length', () => {
    const key = generateApiKey()
    expect(key.length).toBeGreaterThan(10)
    expect(key.length).toBeLessThan(100)
  })
})

describe('generateEncryptedApiKey', () => {
  it('should generate key with sk-sim- prefix', () => {
    const key = generateEncryptedApiKey()
    expect(key).toMatch(/^sk-sim-/)
  })

  it('should generate unique keys', () => {
    const key1 = generateEncryptedApiKey()
    const key2 = generateEncryptedApiKey()
    expect(key1).not.toBe(key2)
  })

  it('should generate key of valid length', () => {
    const key = generateEncryptedApiKey()
    expect(key.length).toBeGreaterThan(10)
    expect(key.length).toBeLessThan(100)
  })
})
