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

    it('allows env var URLs', () => {
      expect(isMcpDomainAllowed('{{MCP_SERVER_URL}}')).toBe(true)
    })

    it('allows URLs with env vars anywhere', () => {
      expect(isMcpDomainAllowed('https://server.com/{{PATH}}')).toBe(true)
    })
  })

  describe('when allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(['allowed.com', 'internal.company.com'])
    })

    describe('basic domain matching', () => {
      it('allows URLs on the allowlist', () => {
        expect(isMcpDomainAllowed('https://allowed.com/mcp')).toBe(true)
        expect(isMcpDomainAllowed('https://internal.company.com/tools')).toBe(true)
      })

      it('allows URLs with paths on allowlisted domains', () => {
        expect(isMcpDomainAllowed('https://allowed.com/deep/path/to/mcp')).toBe(true)
      })

      it('allows URLs with query params on allowlisted domains', () => {
        expect(isMcpDomainAllowed('https://allowed.com/mcp?key=value&foo=bar')).toBe(true)
      })

      it('allows URLs with ports on allowlisted domains', () => {
        expect(isMcpDomainAllowed('https://allowed.com:8080/mcp')).toBe(true)
      })

      it('allows HTTP URLs on allowlisted domains', () => {
        expect(isMcpDomainAllowed('http://allowed.com/mcp')).toBe(true)
      })

      it('matches case-insensitively', () => {
        expect(isMcpDomainAllowed('https://ALLOWED.COM/mcp')).toBe(true)
        expect(isMcpDomainAllowed('https://Allowed.Com/mcp')).toBe(true)
      })

      it('rejects URLs not on the allowlist', () => {
        expect(isMcpDomainAllowed('https://evil.com/mcp')).toBe(false)
      })

      it('rejects subdomains of allowed domains', () => {
        expect(isMcpDomainAllowed('https://sub.allowed.com/mcp')).toBe(false)
      })

      it('rejects URLs with allowed domain in path only', () => {
        expect(isMcpDomainAllowed('https://evil.com/allowed.com/mcp')).toBe(false)
      })
    })

    describe('fail-closed behavior', () => {
      it('rejects undefined URL', () => {
        expect(isMcpDomainAllowed(undefined)).toBe(false)
      })

      it('rejects empty string URL', () => {
        expect(isMcpDomainAllowed('')).toBe(false)
      })

      it('rejects malformed URLs', () => {
        expect(isMcpDomainAllowed('not-a-url')).toBe(false)
      })

      it('rejects URLs with no protocol', () => {
        expect(isMcpDomainAllowed('allowed.com/mcp')).toBe(false)
      })
    })

    describe('env var handling — hostname bypass', () => {
      it('allows entirely env var URL', () => {
        expect(isMcpDomainAllowed('{{MCP_SERVER_URL}}')).toBe(true)
      })

      it('allows env var URL with whitespace', () => {
        expect(isMcpDomainAllowed('  {{MCP_SERVER_URL}}  ')).toBe(true)
      })

      it('allows multiple env vars composing the entire URL', () => {
        expect(isMcpDomainAllowed('{{PROTOCOL}}{{HOST}}{{PATH}}')).toBe(true)
      })

      it('allows env var in hostname portion', () => {
        expect(isMcpDomainAllowed('https://{{MCP_HOST}}/mcp')).toBe(true)
      })

      it('allows env var as subdomain', () => {
        expect(isMcpDomainAllowed('https://{{TENANT}}.company.com/mcp')).toBe(true)
      })

      it('allows env var in port (authority)', () => {
        expect(isMcpDomainAllowed('https://{{HOST}}:{{PORT}}/mcp')).toBe(true)
      })

      it('allows env var as the full authority', () => {
        expect(isMcpDomainAllowed('https://{{MCP_HOST}}:{{MCP_PORT}}/api/mcp')).toBe(true)
      })
    })

    describe('env var handling — no bypass when only in path/query', () => {
      it('rejects disallowed domain with env var in path', () => {
        expect(isMcpDomainAllowed('https://evil.com/{{MCP_PATH}}')).toBe(false)
      })

      it('rejects disallowed domain with env var in query', () => {
        expect(isMcpDomainAllowed('https://evil.com/mcp?key={{API_KEY}}')).toBe(false)
      })

      it('rejects disallowed domain with env var in fragment', () => {
        expect(isMcpDomainAllowed('https://evil.com/mcp#{{SECTION}}')).toBe(false)
      })

      it('allows allowlisted domain with env var in path', () => {
        expect(isMcpDomainAllowed('https://allowed.com/{{MCP_PATH}}')).toBe(true)
      })

      it('allows allowlisted domain with env var in query', () => {
        expect(isMcpDomainAllowed('https://allowed.com/mcp?key={{API_KEY}}')).toBe(true)
      })

      it('rejects disallowed domain with env var in both path and query', () => {
        expect(isMcpDomainAllowed('https://evil.com/{{PATH}}?token={{TOKEN}}&key={{KEY}}')).toBe(
          false
        )
      })

      it('rejects disallowed domain with env var in query but no path', () => {
        expect(isMcpDomainAllowed('https://evil.com?token={{SECRET}}')).toBe(false)
      })

      it('rejects disallowed domain with env var in fragment but no path', () => {
        expect(isMcpDomainAllowed('https://evil.com#{{SECTION}}')).toBe(false)
      })
    })

    describe('env var security edge cases', () => {
      it('rejects URL with env var only after allowed domain in path', () => {
        expect(isMcpDomainAllowed('https://evil.com/allowed.com/{{VAR}}')).toBe(false)
      })

      it('rejects URL trying to use env var to sneak past domain check via userinfo', () => {
        // https://evil.com@allowed.com would have hostname "allowed.com" per URL spec,
        // but https://{{VAR}}@evil.com has env var in authority so it bypasses
        expect(isMcpDomainAllowed('https://{{VAR}}@evil.com/mcp')).toBe(true)
      })
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

    it('does not throw for empty string', () => {
      expect(() => validateMcpDomain('')).not.toThrow()
    })
  })

  describe('when allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(['allowed.com'])
    })

    describe('basic validation', () => {
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

      it('includes "(empty)" in error for undefined URL', () => {
        expect(() => validateMcpDomain(undefined)).toThrow(/\(empty\)/)
      })
    })

    describe('env var handling', () => {
      it('does not throw for entirely env var URL', () => {
        expect(() => validateMcpDomain('{{MCP_SERVER_URL}}')).not.toThrow()
      })

      it('does not throw for env var in hostname', () => {
        expect(() => validateMcpDomain('https://{{MCP_HOST}}/mcp')).not.toThrow()
      })

      it('does not throw for env var in authority', () => {
        expect(() => validateMcpDomain('https://{{HOST}}:{{PORT}}/mcp')).not.toThrow()
      })

      it('throws for disallowed URL with env var only in path', () => {
        expect(() => validateMcpDomain('https://evil.com/{{MCP_PATH}}')).toThrow(
          McpDomainNotAllowedError
        )
      })

      it('throws for disallowed URL with env var only in query', () => {
        expect(() => validateMcpDomain('https://evil.com/mcp?key={{API_KEY}}')).toThrow(
          McpDomainNotAllowedError
        )
      })

      it('does not throw for allowed URL with env var in path', () => {
        expect(() => validateMcpDomain('https://allowed.com/{{PATH}}')).not.toThrow()
      })

      it('throws for disallowed URL with env var in query but no path', () => {
        expect(() => validateMcpDomain('https://evil.com?token={{SECRET}}')).toThrow(
          McpDomainNotAllowedError
        )
      })

      it('throws for disallowed URL with env var in fragment but no path', () => {
        expect(() => validateMcpDomain('https://evil.com#{{SECTION}}')).toThrow(
          McpDomainNotAllowedError
        )
      })
    })
  })
})
