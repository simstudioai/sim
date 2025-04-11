import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getApiKey } from './utils'

// Skip the tests that need proper module mocking
describe('getApiKey', () => {
  // Save original env and reset between tests
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Reset env vars after each test
    process.env = { ...originalEnv }
  })

  it('should return user-provided key for non-gpt-4o models', () => {
    const key = getApiKey('openai', 'o1', 'user-key')
    expect(key).toBe('user-key')
  })

  it('should throw error if no key provided for non-gpt-4o models', () => {
    expect(() => getApiKey('openai', 'o1')).toThrow('API key is required for openai o1')
  })

  it('should require user key for gpt-4o on non-hosted environments', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

    // Should work with user key
    const key = getApiKey('openai', 'gpt-4o', 'user-key')
    expect(key).toBe('user-key')

    // Should throw without user key
    expect(() => getApiKey('openai', 'gpt-4o')).toThrow('API key is required for openai gpt-4o')
  })
})
