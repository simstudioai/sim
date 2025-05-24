import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as environmentModule from '@/lib/environment'
import { getApiKey } from './utils'

const isHostedSpy = vi.spyOn(environmentModule, 'isHosted', 'get')
const mockGetRotatingApiKey = vi.fn().mockReturnValue('rotating-server-key')
const originalRequire = module.require

describe('getApiKey', () => {
  // Save original env and reset between tests
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()

    isHostedSpy.mockReturnValue(false)

    module.require = vi.fn(() => ({
      getRotatingApiKey: mockGetRotatingApiKey,
    }))
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    module.require = originalRequire
  })

  it('should return user-provided key when not in hosted environment', () => {
    isHostedSpy.mockReturnValue(false)

    // For OpenAI
    const key1 = getApiKey('openai', 'gpt-4', 'user-key-openai')
    expect(key1).toBe('user-key-openai')

    // For Anthropic
    const key2 = getApiKey('anthropic', 'claude-3', 'user-key-anthropic')
    expect(key2).toBe('user-key-anthropic')
  })

  it('should throw error if no key provided in non-hosted environment', () => {
    isHostedSpy.mockReturnValue(false)

    expect(() => getApiKey('openai', 'gpt-4')).toThrow('API key is required for openai gpt-4')
    expect(() => getApiKey('anthropic', 'claude-3')).toThrow(
      'API key is required for anthropic claude-3'
    )
  })

  it('should fall back to user key in hosted environment if rotation fails', () => {
    isHostedSpy.mockReturnValue(true)

    module.require = vi.fn(() => {
      throw new Error('Rotation failed')
    })

    const key = getApiKey('openai', 'gpt-4', 'user-fallback-key')
    expect(key).toBe('user-fallback-key')
  })

  it('should throw error in hosted environment if rotation fails and no user key', () => {
    isHostedSpy.mockReturnValue(true)

    module.require = vi.fn(() => {
      throw new Error('Rotation failed')
    })

    expect(() => getApiKey('openai', 'gpt-4')).toThrow('No API key available for openai gpt-4')
  })

  it('should require user key for non-OpenAI/Anthropic providers even in hosted environment', () => {
    isHostedSpy.mockReturnValue(true)

    const key = getApiKey('other-provider', 'some-model', 'user-key')
    expect(key).toBe('user-key')

    expect(() => getApiKey('other-provider', 'some-model')).toThrow(
      'API key is required for other-provider some-model'
    )
  })
})
