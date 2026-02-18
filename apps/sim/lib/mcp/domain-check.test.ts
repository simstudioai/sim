/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetAllowedMcpDomainsFromEnv } = vi.hoisted(() => ({
  mockGetAllowedMcpDomainsFromEnv: vi.fn<() => string[] | null>(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  getAllowedMcpDomainsFromEnv: mockGetAllowedMcpDomainsFromEnv,
}))

vi.mock('@/executor/utils/reference-validation', () => ({
  createEnvVarPattern: () => /\{\{([^}]+)\}\}/g,
}))

import { isMcpDomainAllowed, McpDomainNotAllowedError, validateMcpDomain } from './domain-check'

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

    it('allows env var URLs without validating domain', () => {
      expect(isMcpDomainAllowed('{{MCP_SERVER_URL}}')).toBe(true)
    })

    it('allows URLs with embedded env vars', () => {
      expect(isMcpDomainAllowed('https://{{MCP_HOST}}/mcp')).toBe(true)
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

    it('does not throw for env var URLs', () => {
      expect(() => validateMcpDomain('{{MCP_SERVER_URL}}')).not.toThrow()
    })

    it('does not throw for URLs with embedded env vars', () => {
      expect(() => validateMcpDomain('https://{{MCP_HOST}}/mcp')).not.toThrow()
    })
  })
})
