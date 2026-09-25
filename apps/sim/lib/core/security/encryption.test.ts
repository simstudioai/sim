import { createEnvMock } from '@sim/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockError } = vi.hoisted(() => ({ mockError: vi.fn() }))
vi.mock('@sim/logger', () => ({ createLogger: () => ({ error: mockError }) }))

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  })
)

import { env } from '@/lib/core/config/env'
import { decryptSecret, encryptSecret, generatePassword } from '@/lib/core/security/encryption'

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret under the app key', async () => {
    const { encrypted } = await encryptSecret('my-secret-value')
    await expect(decryptSecret(encrypted)).resolves.toEqual({ decrypted: 'my-secret-value' })
  })

  it('logs decryption failures unless the caller owns reporting, and throws either way', async () => {
    mockError.mockClear()
    await expect(decryptSecret('invalid')).rejects.toThrow('Invalid encrypted value format')
    expect(mockError).toHaveBeenCalledOnce()

    mockError.mockClear()
    await expect(decryptSecret('invalid', { logFailure: false })).rejects.toThrow(
      'Invalid encrypted value format'
    )
    expect(mockError).not.toHaveBeenCalled()
  })
})

describe('generatePassword', () => {
  it('generates the requested length from the allowed alphabet', () => {
    const allowedChars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+='
    expect(generatePassword()).toHaveLength(24)
    const password = generatePassword(1000)
    expect(password).toHaveLength(1000)
    for (const char of password) {
      expect(allowedChars).toContain(char)
    }
  })
})

describe('encryption key validation', () => {
  const originalEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

  afterEach(() => {
    ;(env as Record<string, string>).ENCRYPTION_KEY = originalEncryptionKey
  })

  it.each(['', '0123456789abcdef'])('rejects ENCRYPTION_KEY %j', async (key) => {
    ;(env as Record<string, string>).ENCRYPTION_KEY = key
    await expect(encryptSecret('test')).rejects.toThrow(
      'ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)'
    )
  })
})
