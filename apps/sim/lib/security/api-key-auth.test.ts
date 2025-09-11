import { describe, expect, it } from 'vitest'
import {
  authenticateApiKey,
  createApiKey,
  hashApiKey,
  isHashedKey,
  isValidApiKeyFormat,
  migrateKeyToHashed,
} from './api-key-auth'

describe('API Key Authentication', () => {
  it.concurrent('should detect hashed keys correctly', () => {
    expect(isHashedKey('$2a$12$abcdef')).toBe(true)
    expect(isHashedKey('$2b$12$abcdef')).toBe(true)
    expect(isHashedKey('$2y$12$abcdef')).toBe(true)
    expect(isHashedKey('plain-text-key')).toBe(false)
    expect(isHashedKey('sk_live_123456')).toBe(false)
  })

  it.concurrent('should authenticate plain text keys (legacy)', async () => {
    const plainKey = 'sk_live_test_123456'
    const storedPlainKey = 'sk_live_test_123456'

    const result = await authenticateApiKey(plainKey, storedPlainKey)
    expect(result).toBe(true)
  })

  it.concurrent('should reject invalid plain text keys', async () => {
    const inputKey = 'sk_live_test_123456'
    const storedKey = 'sk_live_test_different'

    const result = await authenticateApiKey(inputKey, storedKey)
    expect(result).toBe(false)
  })

  it.concurrent('should authenticate hashed keys', async () => {
    const plainKey = 'sk_live_test_123456'
    const hashedKey = await hashApiKey(plainKey)

    const result = await authenticateApiKey(plainKey, hashedKey)
    expect(result).toBe(true)
  })

  it.concurrent('should reject invalid hashed keys', async () => {
    const correctKey = 'sk_live_test_123456'
    const wrongKey = 'sk_live_test_different'
    const hashedKey = await hashApiKey(correctKey)

    const result = await authenticateApiKey(wrongKey, hashedKey)
    expect(result).toBe(false)
  })

  it.concurrent('should create API key with hashing', async () => {
    const { key, hashedKey } = await createApiKey(true)

    expect(key).toBeDefined()
    expect(hashedKey).toBeDefined()
    expect(isHashedKey(hashedKey!)).toBe(true)

    const isValid = await authenticateApiKey(key, hashedKey!)
    expect(isValid).toBe(true)
  })

  it.concurrent('should create API key without hashing', async () => {
    const { key, hashedKey } = await createApiKey(false)

    expect(key).toBeDefined()
    expect(hashedKey).toBeUndefined()
  })

  it.concurrent('should migrate plain key to hashed format', async () => {
    const plainKey = 'sk_live_test_123456'
    const hashedKey = await migrateKeyToHashed(plainKey)

    expect(isHashedKey(hashedKey)).toBe(true)

    const isValid = await authenticateApiKey(plainKey, hashedKey)
    expect(isValid).toBe(true)
  })

  it.concurrent('should validate API key format', () => {
    expect(isValidApiKeyFormat('sk_live_test_123456')).toBe(true)
    expect(isValidApiKeyFormat('')).toBe(false)
    expect(isValidApiKeyFormat('short')).toBe(false)
    expect(isValidApiKeyFormat('a'.repeat(250))).toBe(false)
    expect(isValidApiKeyFormat('valid-key-12345')).toBe(true)
  })

  it.concurrent('should handle backward compatibility - mixed key types', async () => {
    const plainKey = 'sk_live_test_123456'

    const plainResult = await authenticateApiKey(plainKey, plainKey)
    expect(plainResult).toBe(true)

    const hashedStoredKey = await hashApiKey(plainKey)
    const hashedResult = await authenticateApiKey(plainKey, hashedStoredKey)
    expect(hashedResult).toBe(true)

    expect(plainResult).toBe(hashedResult)
  })
})
