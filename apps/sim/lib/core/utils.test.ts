import { resetEnvMock, setEnv } from '@sim/testing'
import { formatDuration } from '@sim/utils/formatting'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  setEnv({
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    OPENAI_API_KEY_1: 'test-openai-key-1',
    OPENAI_API_KEY_2: 'test-openai-key-2',
    OPENAI_API_KEY_3: 'test-openai-key-3',
    ANTHROPIC_API_KEY_1: 'test-anthropic-key-1',
    ANTHROPIC_API_KEY_2: 'test-anthropic-key-2',
    ANTHROPIC_API_KEY_3: 'test-anthropic-key-3',
    GEMINI_API_KEY_1: 'test-gemini-key-1',
    GEMINI_API_KEY_2: 'test-gemini-key-2',
    GEMINI_API_KEY_3: 'test-gemini-key-3',
    XAI_API_KEY_1: 'test-xai-key-1',
    XAI_API_KEY_2: 'test-xai-key-2',
    XAI_API_KEY_3: 'test-xai-key-3',
    TYPESAFE_API_KEY_1: 'test-typesafe-key-1',
    TYPESAFE_API_KEY_2: 'test-typesafe-key-2',
    TYPESAFE_API_KEY_3: 'test-typesafe-key-3',
    FIREWORKS_API_KEY_1: 'test-fireworks-key-1',
    FIREWORKS_API_KEY_2: 'test-fireworks-key-2',
    FIREWORKS_API_KEY_3: 'test-fireworks-key-3',
  })
})

afterAll(resetEnvMock)

import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { validateName } from '@/lib/core/utils/validation'

vi.mock('crypto', () => ({
  createCipheriv: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue('encrypted-data'),
    final: vi.fn().mockReturnValue('final-data'),
    getAuthTag: vi.fn().mockReturnValue({
      toString: vi.fn().mockReturnValue('auth-tag'),
    }),
  }),
  createDecipheriv: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue('decrypted-data'),
    final: vi.fn().mockReturnValue('final-data'),
    setAuthTag: vi.fn(),
  }),
  randomBytes: vi.fn().mockReturnValue({
    toString: vi.fn().mockReturnValue('random-iv'),
  }),
}))

describe('encryption and decryption', () => {
  it.concurrent('should encrypt secrets correctly', async () => {
    const result = await encryptSecret('my-secret')
    expect(result).toHaveProperty('encrypted')
    expect(result).toHaveProperty('iv')
    expect(result.encrypted).toContain('random-iv')
    expect(result.encrypted).toContain('encrypted-data')
    expect(result.encrypted).toContain('final-data')
    expect(result.encrypted).toContain('auth-tag')
  })

  it.concurrent('should decrypt secrets correctly', async () => {
    const result = await decryptSecret('iv:encrypted:authTag')
    expect(result).toHaveProperty('decrypted')
    expect(result.decrypted).toBe('decrypted-datafinal-data')
  })

  it.concurrent('should throw error for invalid decrypt format', async () => {
    await expect(decryptSecret('invalid-format')).rejects.toThrow('Invalid encrypted value format')
  })
})

describe('formatDuration', () => {
  it.concurrent('should format milliseconds correctly', () => {
    const result = formatDuration(500)
    expect(result).toBe('500ms')
  })

  it.concurrent('should format seconds correctly', () => {
    const result = formatDuration(5000)
    expect(result).toBe('5s')
  })

  it.concurrent('should format minutes and seconds correctly', () => {
    const result = formatDuration(125000) // 2m 5s
    expect(result).toBe('2m 5s')
  })

  it.concurrent('should format hours, minutes correctly', () => {
    const result = formatDuration(3725000) // 1h 2m 5s
    expect(result).toBe('1h 2m')
  })
})

describe('validateName', () => {
  it.concurrent('should remove invalid characters', () => {
    const result = validateName('test@#$%name')
    expect(result).toBe('testname')
  })

  it.concurrent('should collapse multiple spaces into single spaces', () => {
    const result = validateName('test    multiple     spaces')
    expect(result).toBe('test multiple spaces')
  })

  it.concurrent('should handle mixed whitespace and invalid characters', () => {
    const result = validateName('test@#$  name')
    expect(result).toBe('test name')
  })
})

describe('getRotatingApiKey', () => {
  it.concurrent('rotates the TypeSafe key pool through the shared selector', () => {
    expect(getRotatingApiKey('typesafe')).toMatch(/^test-typesafe-key-[1-3]$/)
  })
  it.concurrent('should return OpenAI API key based on current minute', () => {
    const result = getRotatingApiKey('openai')
    expect(result).toMatch(/^test-openai-key-[1-3]$/)
  })

  it.concurrent('should return Anthropic API key based on current minute', () => {
    const result = getRotatingApiKey('anthropic')
    expect(result).toMatch(/^test-anthropic-key-[1-3]$/)
  })

  it.concurrent('should return Gemini API key based on current minute', () => {
    const result = getRotatingApiKey('gemini')
    expect(result).toMatch(/^test-gemini-key-[1-3]$/)
  })

  it.concurrent('should return xAI API key based on current minute', () => {
    const result = getRotatingApiKey('xai')
    expect(result).toMatch(/^test-xai-key-[1-3]$/)
  })

  it.concurrent('should return Fireworks API key based on current minute', () => {
    const result = getRotatingApiKey('fireworks')
    expect(result).toMatch(/^test-fireworks-key-[1-3]$/)
  })

  it('falls back to the single platform Fireworks key when no rotation slot is set', () => {
    setEnv({
      FIREWORKS_API_KEY_1: undefined,
      FIREWORKS_API_KEY_2: undefined,
      FIREWORKS_API_KEY_3: undefined,
      FIREWORKS_API_KEY: 'test-fireworks-platform-key',
    })

    expect(getRotatingApiKey('fireworks')).toBe('test-fireworks-platform-key')

    setEnv({
      FIREWORKS_API_KEY: undefined,
      FIREWORKS_API_KEY_1: 'test-fireworks-key-1',
      FIREWORKS_API_KEY_2: 'test-fireworks-key-2',
      FIREWORKS_API_KEY_3: 'test-fireworks-key-3',
    })
  })

  it.concurrent('should throw error for unsupported provider', () => {
    expect(() => getRotatingApiKey('unsupported')).toThrow('No rotation implemented for provider')
  })

  it.concurrent('should rotate keys based on minute modulo', () => {
    const result = getRotatingApiKey('openai')
    expect(['test-openai-key-1', 'test-openai-key-2', 'test-openai-key-3']).toContain(result)
  })
})
