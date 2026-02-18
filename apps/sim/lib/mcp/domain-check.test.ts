/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAllowedMcpDomainsFromEnv = vi.fn<() => string[] | null>()
const mockGetBaseUrl = vi.fn<() => string>()

vi.doMock('@/lib/core/config/feature-flags', () => ({
  getAllowedMcpDomainsFromEnv: mockGetAllowedMcpDomainsFromEnv,
}))

vi.doMock('@/lib/core/utils/urls', () => ({
  getBaseUrl: mockGetBaseUrl,
}))

const { McpDomainNotAllowedError, isMcpDomainAllowed, validateMcpDomain } = await import(
  './domain-check'
)

describe('McpDomainNotAllowedError', () => {
  it.concurrent('creates error with correct name and message', () => {
    const error = new McpDomainNotAllowedError('evil.com')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(McpDomainNotAllowedError)
    expect(error.name).toBe('McpDomainNotAllowedError')
    expect(error.message).toContain('evil.com')
  })
})

describe('isMcpDomainAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when no allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(null)
    })

    it('allows any URL', () => {
      expect(isMcpDomainAllowed('https://any-server.com/mcp')).toBe(true)
    })

    it('allows undefined URL', () => {
      expect(isMcpDomainAllowed(undefined)).toBe(true)
    })

    it('allows empty string URL', () => {
      expect(isMcpDomainAllowed('')).toBe(true)
    })
  })

  describe('when allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(['allowed.com', 'internal.company.com'])
      mockGetBaseUrl.mockReturnValue('https://platform.example.com')
    })

    it('allows URLs on the allowlist', () => {
      expect(isMcpDomainAllowed('https://allowed.com/mcp')).toBe(true)
      expect(isMcpDomainAllowed('https://internal.company.com/tools')).toBe(true)
    })

    it('rejects URLs not on the allowlist', () => {
      expect(isMcpDomainAllowed('https://evil.com/mcp')).toBe(false)
    })

    it('rejects undefined URL (fail-closed)', () => {
      expect(isMcpDomainAllowed(undefined)).toBe(false)
    })

    it('rejects empty string URL (fail-closed)', () => {
      expect(isMcpDomainAllowed('')).toBe(false)
    })

    it('rejects malformed URLs', () => {
      expect(isMcpDomainAllowed('not-a-url')).toBe(false)
    })

    it('matches case-insensitively', () => {
      expect(isMcpDomainAllowed('https://ALLOWED.COM/mcp')).toBe(true)
    })

    it('always allows the platform hostname', () => {
      expect(isMcpDomainAllowed('https://platform.example.com/mcp')).toBe(true)
    })

    it('allows platform hostname even when not in the allowlist', () => {
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(['other.com'])
      expect(isMcpDomainAllowed('https://platform.example.com/mcp')).toBe(true)
    })
  })

  describe('when getBaseUrl is not configured', () => {
    beforeEach(() => {
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(['allowed.com'])
      mockGetBaseUrl.mockImplementation(() => {
        throw new Error('Not configured')
      })
    })

    it('still allows URLs on the allowlist', () => {
      expect(isMcpDomainAllowed('https://allowed.com/mcp')).toBe(true)
    })

    it('still rejects URLs not on the allowlist', () => {
      expect(isMcpDomainAllowed('https://evil.com/mcp')).toBe(false)
    })
  })
})

describe('validateMcpDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when no allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(null)
    })

    it('does not throw for any URL', () => {
      expect(() => validateMcpDomain('https://any-server.com/mcp')).not.toThrow()
    })

    it('does not throw for undefined URL', () => {
      expect(() => validateMcpDomain(undefined)).not.toThrow()
    })
  })

  describe('when allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(['allowed.com'])
      mockGetBaseUrl.mockReturnValue('https://platform.example.com')
    })

    it('does not throw for allowed URLs', () => {
      expect(() => validateMcpDomain('https://allowed.com/mcp')).not.toThrow()
    })

    it('throws McpDomainNotAllowedError for disallowed URLs', () => {
      expect(() => validateMcpDomain('https://evil.com/mcp')).toThrow(McpDomainNotAllowedError)
    })

    it('throws for undefined URL (fail-closed)', () => {
      expect(() => validateMcpDomain(undefined)).toThrow(McpDomainNotAllowedError)
    })

    it('throws for malformed URLs', () => {
      expect(() => validateMcpDomain('not-a-url')).toThrow(McpDomainNotAllowedError)
    })

    it('includes the rejected domain in the error message', () => {
      expect(() => validateMcpDomain('https://evil.com/mcp')).toThrow(/evil\.com/)
    })

    it('does not throw for platform hostname', () => {
      expect(() => validateMcpDomain('https://platform.example.com/mcp')).not.toThrow()
    })
  })
})
