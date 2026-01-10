import { loggerMock } from '@sim/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockEnv = vi.hoisted(() => ({
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value),
  isFalsy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'false' || value === '0' : value === false,
}))

vi.mock('@sim/logger', () => loggerMock)

import { decryptSecret, encryptSecret, generatePassword } from './encryption'

describe('encryptSecret', () => {
  it('should encrypt a secret and return encrypted value with IV', async () => {
    const secret = 'my-secret-value'
    const result = await encryptSecret(secret)

    expect(result.encrypted).toBeDefined()
    expect(result.iv).toBeDefined()
    expect(result.encrypted).toContain(':')
    expect(result.iv).toHaveLength(32)
  })

  it('should produce different encrypted values for the same input', async () => {
    const secret = 'same-secret'
    const result1 = await encryptSecret(secret)
    const result2 = await encryptSecret(secret)

    expect(result1.encrypted).not.toBe(result2.encrypted)
    expect(result1.iv).not.toBe(result2.iv)
  })

  it('should encrypt empty strings', async () => {
    const result = await encryptSecret('')
    expect(result.encrypted).toBeDefined()
    expect(result.iv).toBeDefined()
  })

  it('should encrypt long secrets', async () => {
    const longSecret = 'a'.repeat(10000)
    const result = await encryptSecret(longSecret)
    expect(result.encrypted).toBeDefined()
  })

  it('should encrypt secrets with special characters', async () => {
    const specialSecret = '!@#$%^&*()_+-=[]{}|;\':",.<>?/`~\n\t\r'
    const result = await encryptSecret(specialSecret)
    expect(result.encrypted).toBeDefined()
  })

  it('should encrypt unicode characters', async () => {
    const unicodeSecret = 'Hello !"#$%&\'()*+,-./0123456789:;<=>?@'
    const result = await encryptSecret(unicodeSecret)
    expect(result.encrypted).toBeDefined()
  })
})

describe('decryptSecret', () => {
  it('should decrypt an encrypted secret back to original value', async () => {
    const originalSecret = 'my-secret-value'
    const { encrypted } = await encryptSecret(originalSecret)
    const { decrypted } = await decryptSecret(encrypted)

    expect(decrypted).toBe(originalSecret)
  })

  it('should decrypt very short secrets', async () => {
    const { encrypted } = await encryptSecret('a')
    const { decrypted } = await decryptSecret(encrypted)
    expect(decrypted).toBe('a')
  })

  it('should decrypt long secrets', async () => {
    const longSecret = 'b'.repeat(10000)
    const { encrypted } = await encryptSecret(longSecret)
    const { decrypted } = await decryptSecret(encrypted)
    expect(decrypted).toBe(longSecret)
  })

  it('should decrypt secrets with special characters', async () => {
    const specialSecret = '!@#$%^&*()_+-=[]{}|;\':",.<>?/`~\n\t\r'
    const { encrypted } = await encryptSecret(specialSecret)
    const { decrypted } = await decryptSecret(encrypted)
    expect(decrypted).toBe(specialSecret)
  })

  it('should throw error for invalid encrypted format (missing parts)', async () => {
    await expect(decryptSecret('invalid')).rejects.toThrow(
      'Invalid encrypted value format. Expected "iv:encrypted:authTag"'
    )
  })

  it('should throw error for invalid encrypted format (only two parts)', async () => {
    await expect(decryptSecret('part1:part2')).rejects.toThrow(
      'Invalid encrypted value format. Expected "iv:encrypted:authTag"'
    )
  })

  it('should throw error for tampered ciphertext', async () => {
    const { encrypted } = await encryptSecret('original-secret')
    const parts = encrypted.split(':')
    parts[1] = `tampered${parts[1].slice(8)}`
    const tamperedEncrypted = parts.join(':')

    await expect(decryptSecret(tamperedEncrypted)).rejects.toThrow()
  })

  it('should throw error for tampered auth tag', async () => {
    const { encrypted } = await encryptSecret('original-secret')
    const parts = encrypted.split(':')
    parts[2] = '00000000000000000000000000000000'
    const tamperedEncrypted = parts.join(':')

    await expect(decryptSecret(tamperedEncrypted)).rejects.toThrow()
  })

  it('should throw error for invalid IV', async () => {
    const { encrypted } = await encryptSecret('original-secret')
    const parts = encrypted.split(':')
    parts[0] = '00000000000000000000000000000000'
    const tamperedEncrypted = parts.join(':')

    await expect(decryptSecret(tamperedEncrypted)).rejects.toThrow()
  })
})

describe('generatePassword', () => {
  it('should generate password with default length of 24', () => {
    const password = generatePassword()
    expect(password).toHaveLength(24)
  })

  it('should generate password with custom length', () => {
    const password = generatePassword(32)
    expect(password).toHaveLength(32)
  })

  it('should generate password with minimum length', () => {
    const password = generatePassword(1)
    expect(password).toHaveLength(1)
  })

  it('should generate different passwords on each call', () => {
    const passwords = new Set()
    for (let i = 0; i < 100; i++) {
      passwords.add(generatePassword())
    }
    expect(passwords.size).toBeGreaterThan(90)
  })

  it('should only contain allowed characters', () => {
    const allowedChars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+='
    const password = generatePassword(1000)

    for (const char of password) {
      expect(allowedChars).toContain(char)
    }
  })

  it('should handle zero length', () => {
    const password = generatePassword(0)
    expect(password).toBe('')
  })
})

describe('encryption key validation', () => {
  const originalEnv = { ...mockEnv }

  afterEach(() => {
    mockEnv.ENCRYPTION_KEY = originalEnv.ENCRYPTION_KEY
  })

  it('should throw error when ENCRYPTION_KEY is not set', async () => {
    mockEnv.ENCRYPTION_KEY = ''
    await expect(encryptSecret('test')).rejects.toThrow(
      'ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)'
    )
  })

  it('should throw error when ENCRYPTION_KEY is wrong length', async () => {
    mockEnv.ENCRYPTION_KEY = '0123456789abcdef'
    await expect(encryptSecret('test')).rejects.toThrow(
      'ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)'
    )
  })
})
