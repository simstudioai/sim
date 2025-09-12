import { describe, expect, it, vi } from 'vitest'
import { authenticateApiKey, createApiKey, encryptApiKeyForStorage, isEncryptedKey } from './auth'

// Mock the env module
vi.mock('@/lib/env', () => ({
  env: {
    API_ENCRYPTION_KEY: undefined as string | undefined,
  },
}))

describe('API Key Authentication', () => {
  it('should detect encrypted keys correctly', () => {
    expect(isEncryptedKey('iv:encrypted:authTag')).toBe(true)
    expect(isEncryptedKey('plain-text-key')).toBe(false)
    expect(isEncryptedKey('sk_live_123456')).toBe(false)
  })

  it('should authenticate plain text keys (legacy)', async () => {
    const plainKey = 'sk_live_test_123456'
    const storedPlainKey = 'sk_live_test_123456'

    const result = await authenticateApiKey(plainKey, storedPlainKey)
    expect(result).toBe(true)
  })

  it('should reject invalid plain text keys', async () => {
    const inputKey = 'sk_live_test_123456'
    const storedKey = 'sk_live_test_different'

    const result = await authenticateApiKey(inputKey, storedKey)
    expect(result).toBe(false)
  })

  it('should authenticate encrypted keys', async () => {
    const plainKey = 'sim_test_123456'
    const encryptedKey = await encryptApiKeyForStorage(plainKey)

    const result = await authenticateApiKey(plainKey, encryptedKey)
    expect(result).toBe(true)
  })

  it('should reject invalid encrypted keys', async () => {
    const correctKey = 'sim_test_123456'
    const wrongKey = 'sim_test_different'
    const encryptedKey = await encryptApiKeyForStorage(correctKey)

    const result = await authenticateApiKey(wrongKey, encryptedKey)
    expect(result).toBe(false)
  })

  it('should create API key with encryption when API_ENCRYPTION_KEY is set', async () => {
    // Mock env with encryption key set
    const { env } = await import('@/lib/env')
    vi.mocked(env).API_ENCRYPTION_KEY = 'a'.repeat(64) // 64 char hex string

    const { key, encryptedKey } = await createApiKey(true)

    expect(key).toBeDefined()
    expect(key.startsWith('sk-sim-')).toBe(true) // Should use encrypted format
    expect(encryptedKey).toBeDefined()
    expect(isEncryptedKey(encryptedKey!)).toBe(true)

    const isValid = await authenticateApiKey(key, encryptedKey!)
    expect(isValid).toBe(true)

    // Reset mock
    vi.mocked(env).API_ENCRYPTION_KEY = undefined
  })

  it('should create API key without encryption storage', async () => {
    const { key, encryptedKey } = await createApiKey(false)

    expect(key).toBeDefined()
    expect(encryptedKey).toBeUndefined()
  })

  it('should create legacy format API key when API_ENCRYPTION_KEY is not set', async () => {
    // Mock env with no encryption key set
    const { env } = await import('@/lib/env')
    vi.mocked(env).API_ENCRYPTION_KEY = undefined

    const { key, encryptedKey } = await createApiKey(true)

    expect(key).toBeDefined()
    expect(key.startsWith('sim_')).toBe(true) // Should use legacy format
    expect(encryptedKey).toBeDefined()
    expect(encryptedKey).toBe(key) // Should be stored as plain text
    expect(isEncryptedKey(encryptedKey!)).toBe(false)

    const isValid = await authenticateApiKey(key, encryptedKey!)
    expect(isValid).toBe(true)
  })

  it.concurrent('should migrate plain key to encrypted format', async () => {
    const plainKey = 'sim_test_123456'
    const encryptedKey = await encryptApiKeyForStorage(plainKey)

    expect(isEncryptedKey(encryptedKey)).toBe(true)

    const isValid = await authenticateApiKey(plainKey, encryptedKey)
    expect(isValid).toBe(true)
  })

  it.concurrent('should handle backward compatibility - mixed key types', async () => {
    const plainKey = 'sim_test_123456'

    // Test plain text storage (legacy)
    const plainResult = await authenticateApiKey(plainKey, plainKey)
    expect(plainResult).toBe(true)

    // Test encrypted storage (modern)
    const encryptedStoredKey = await encryptApiKeyForStorage(plainKey)
    const encryptedResult = await authenticateApiKey(plainKey, encryptedStoredKey)
    expect(encryptedResult).toBe(true)

    expect(plainResult).toBe(encryptedResult)
  })
})
