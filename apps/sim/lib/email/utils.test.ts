import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the env module
vi.mock('@/lib/env', () => ({
  env: {
    FROM_EMAIL_ADDRESS: undefined,
    EMAIL_DOMAIN: undefined,
  },
}))

// Mock the getEmailDomain function
vi.mock('@/lib/urls/utils', () => ({
  getEmailDomain: vi.fn().mockReturnValue('fallback.com'),
}))

describe('getFromEmailAddress', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.resetModules()
  })

  it('should return FROM_EMAIL_ADDRESS when set', async () => {
    // Mock env with FROM_EMAIL_ADDRESS
    vi.doMock('@/lib/env', () => ({
      env: {
        FROM_EMAIL_ADDRESS: 'Sim <noreply@sim.ai>',
        EMAIL_DOMAIN: 'example.com',
      },
    }))

    const { getFromEmailAddress } = await import('./utils')
    const result = getFromEmailAddress()

    expect(result).toBe('Sim <noreply@sim.ai>')
  })

  it('should return simple email format when FROM_EMAIL_ADDRESS is set without display name', async () => {
    vi.doMock('@/lib/env', () => ({
      env: {
        FROM_EMAIL_ADDRESS: 'noreply@sim.ai',
        EMAIL_DOMAIN: 'example.com',
      },
    }))

    const { getFromEmailAddress } = await import('./utils')
    const result = getFromEmailAddress()

    expect(result).toBe('noreply@sim.ai')
  })

  it('should return Azure ACS format when FROM_EMAIL_ADDRESS is set', async () => {
    vi.doMock('@/lib/env', () => ({
      env: {
        FROM_EMAIL_ADDRESS: 'DoNotReply@customer.azurecomm.net',
        EMAIL_DOMAIN: 'example.com',
      },
    }))

    const { getFromEmailAddress } = await import('./utils')
    const result = getFromEmailAddress()

    expect(result).toBe('DoNotReply@customer.azurecomm.net')
  })

  it('should construct from EMAIL_DOMAIN when FROM_EMAIL_ADDRESS is not set', async () => {
    vi.doMock('@/lib/env', () => ({
      env: {
        FROM_EMAIL_ADDRESS: undefined,
        EMAIL_DOMAIN: 'example.com',
      },
    }))

    const { getFromEmailAddress } = await import('./utils')
    const result = getFromEmailAddress()

    expect(result).toBe('noreply@example.com')
  })

  it('should use getEmailDomain fallback when both FROM_EMAIL_ADDRESS and EMAIL_DOMAIN are not set', async () => {
    vi.doMock('@/lib/env', () => ({
      env: {
        FROM_EMAIL_ADDRESS: undefined,
        EMAIL_DOMAIN: undefined,
      },
    }))

    const mockGetEmailDomain = vi.fn().mockReturnValue('fallback.com')
    vi.doMock('@/lib/urls/utils', () => ({
      getEmailDomain: mockGetEmailDomain,
    }))

    const { getFromEmailAddress } = await import('./utils')
    const result = getFromEmailAddress()

    expect(result).toBe('noreply@fallback.com')
    expect(mockGetEmailDomain).toHaveBeenCalled()
  })

  it('should prioritize FROM_EMAIL_ADDRESS over EMAIL_DOMAIN when both are set', async () => {
    vi.doMock('@/lib/env', () => ({
      env: {
        FROM_EMAIL_ADDRESS: 'Custom <custom@custom.com>',
        EMAIL_DOMAIN: 'ignored.com',
      },
    }))

    const { getFromEmailAddress } = await import('./utils')
    const result = getFromEmailAddress()

    expect(result).toBe('Custom <custom@custom.com>')
  })

  it('should handle empty string FROM_EMAIL_ADDRESS by falling back to EMAIL_DOMAIN', async () => {
    vi.doMock('@/lib/env', () => ({
      env: {
        FROM_EMAIL_ADDRESS: '',
        EMAIL_DOMAIN: 'fallback.com',
      },
    }))

    const { getFromEmailAddress } = await import('./utils')
    const result = getFromEmailAddress()

    expect(result).toBe('noreply@fallback.com')
  })

  it('should handle whitespace-only FROM_EMAIL_ADDRESS by falling back to EMAIL_DOMAIN', async () => {
    vi.doMock('@/lib/env', () => ({
      env: {
        FROM_EMAIL_ADDRESS: '   ',
        EMAIL_DOMAIN: 'fallback.com',
      },
    }))

    const { getFromEmailAddress } = await import('./utils')
    const result = getFromEmailAddress()

    expect(result).toBe('noreply@fallback.com')
  })
})
