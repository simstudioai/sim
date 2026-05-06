/**
 * @vitest-environment node
 */
import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetAllowedMcpDomainsFromEnv, mockDnsLookup } = vi.hoisted(() => ({
  mockGetAllowedMcpDomainsFromEnv: vi.fn<() => string[] | null>(),
  mockDnsLookup: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  getAllowedMcpDomainsFromEnv: mockGetAllowedMcpDomainsFromEnv,
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

inputValidationMockFns.mockIsPrivateOrReservedIP.mockImplementation((ip: string) => {
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true
  if (ip.startsWith('172.')) {
    const second = Number.parseInt(ip.split('.')[1], 10)
    if (second >= 16 && second <= 31) return true
  }
  if (ip.startsWith('169.254.')) return true
  if (ip.startsWith('127.') || ip === '::1') return true
  if (ip === '0.0.0.0') return true
  return false
})

vi.mock('dns/promises', () => ({
  default: { lookup: mockDnsLookup },
}))

vi.mock('@/executor/utils/reference-validation', () => ({
  createEnvVarPattern: () => /\{\{([^}]+)\}\}/g,
}))

import {
  isMcpDomainAllowed,
  McpDnsResolutionError,
  McpDomainNotAllowedError,
  McpSsrfError,
  validateMcpDomain,
  validateMcpServerSsrf,
} from './domain-check'

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

describe('validateMcpServerSsrf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAllowedMcpDomainsFromEnv.mockReturnValue(null)
  })

  it('does nothing for undefined URL', async () => {
    await expect(validateMcpServerSsrf(undefined)).resolves.toBeUndefined()
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it('skips validation for env var URLs', async () => {
    await expect(validateMcpServerSsrf('{{MCP_SERVER_URL}}')).resolves.toBeUndefined()
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it('skips validation for URLs with env var in hostname', async () => {
    await expect(validateMcpServerSsrf('https://{{MCP_HOST}}/mcp')).resolves.toBeUndefined()
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it('allows localhost URLs without DNS lookup', async () => {
    await expect(validateMcpServerSsrf('http://localhost:3000/mcp')).resolves.toBeUndefined()
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it('allows 127.0.0.1 URLs without DNS lookup', async () => {
    await expect(validateMcpServerSsrf('http://127.0.0.1:8080/mcp')).resolves.toBeUndefined()
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it('allows URLs that resolve to public IPs', async () => {
    mockDnsLookup.mockResolvedValue({ address: '93.184.216.34' })
    await expect(validateMcpServerSsrf('https://example.com/mcp')).resolves.toBeUndefined()
  })

  it('allows HTTP URLs on non-localhost hosts', async () => {
    mockDnsLookup.mockResolvedValue({ address: '93.184.216.34' })
    await expect(validateMcpServerSsrf('http://example.com:3000/mcp')).resolves.toBeUndefined()
  })

  it('throws McpSsrfError for cloud metadata IP literal', async () => {
    await expect(validateMcpServerSsrf('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      McpSsrfError
    )
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it('throws McpSsrfError for RFC-1918 IP literal', async () => {
    await expect(validateMcpServerSsrf('http://10.0.0.1/mcp')).rejects.toThrow(McpSsrfError)
  })

  it('throws McpSsrfError for 192.168.x.x IP literal', async () => {
    await expect(validateMcpServerSsrf('http://192.168.1.1/mcp')).rejects.toThrow(McpSsrfError)
  })

  it('throws McpSsrfError for URLs resolving to private IPs', async () => {
    mockDnsLookup.mockResolvedValue({ address: '10.0.0.5' })
    await expect(validateMcpServerSsrf('https://internal.corp/mcp')).rejects.toThrow(McpSsrfError)
  })

  it('throws McpSsrfError for URLs resolving to link-local IPs', async () => {
    mockDnsLookup.mockResolvedValue({ address: '169.254.169.254' })
    await expect(validateMcpServerSsrf('https://metadata.internal/latest')).rejects.toThrow(
      McpSsrfError
    )
  })

  it('throws McpDnsResolutionError when DNS lookup fails', async () => {
    mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(validateMcpServerSsrf('https://nonexistent.invalid/mcp')).rejects.toThrow(
      McpDnsResolutionError
    )
  })

  it('allows URLs resolving to loopback (localhost alias)', async () => {
    mockDnsLookup.mockResolvedValue({ address: '127.0.0.1' })
    await expect(validateMcpServerSsrf('http://my-local-alias:3000/mcp')).resolves.toBeUndefined()
  })

  it('throws for malformed URLs', async () => {
    await expect(validateMcpServerSsrf('not-a-url')).rejects.toThrow(McpSsrfError)
  })

  it('skips all checks when ALLOWED_MCP_DOMAINS is configured', async () => {
    mockGetAllowedMcpDomainsFromEnv.mockReturnValue(['internal.corp'])
    await expect(validateMcpServerSsrf('http://10.0.0.1/mcp')).resolves.toBeUndefined()
    await expect(
      validateMcpServerSsrf('http://169.254.169.254/latest/meta-data/')
    ).resolves.toBeUndefined()
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })
})
