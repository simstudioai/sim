import { envFlagsMockFns, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDnsLookup } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
}))

vi.mock('dns/promises', () => ({
  default: { lookup: mockDnsLookup },
}))

vi.mock('@/executor/utils/reference-validation', () => ({
  createEnvVarPattern: () => /\{\{([^{}]+)\}\}/g,
}))

import {
  isMcpDomainAllowed,
  MCP_EGRESS_PROFILE,
  McpDomainNotAllowedError,
  McpSsrfError,
  OAUTH_EGRESS_PROFILE,
  validateMcpDomain,
  validateMcpServerSsrf,
} from './domain-check'

const mockGetAllowedMcpDomainsFromEnv = envFlagsMockFns.getAllowedMcpDomainsFromEnv

afterAll(resetEnvFlagsMock)

describe('isMcpDomainAllowed', () => {
  describe('when no allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(null)
    })

    it('allows any URL', () => {
      expect(isMcpDomainAllowed('https://any-server.com/mcp')).toBe(true)
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

      it('rejects malformed URLs', () => {
        expect(isMcpDomainAllowed('not-a-url')).toBe(false)
      })
    })

    describe('env var handling — hostname bypass', () => {
      it('allows entirely env var URL', () => {
        expect(isMcpDomainAllowed('{{MCP_SERVER_URL}}')).toBe(true)
      })

      it('allows env var in hostname portion', () => {
        expect(isMcpDomainAllowed('https://{{MCP_HOST}}/mcp')).toBe(true)
      })
    })

    describe('env var handling — no bypass when only in path/query', () => {
      it('rejects disallowed domain with env var in path', () => {
        expect(isMcpDomainAllowed('https://evil.com/{{MCP_PATH}}')).toBe(false)
      })

      it('allows allowlisted domain with env var in path', () => {
        expect(isMcpDomainAllowed('https://allowed.com/{{MCP_PATH}}')).toBe(true)
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
  describe('when allowlist is configured', () => {
    beforeEach(() => {
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(['allowed.com'])
    })

    describe('basic validation', () => {
      it('throws McpDomainNotAllowedError for disallowed URLs', () => {
        expect(() => validateMcpDomain('https://evil.com/mcp')).toThrow(McpDomainNotAllowedError)
      })
    })
  })
})

describe('validateMcpServerSsrf', () => {
  beforeEach(() => {
    mockGetAllowedMcpDomainsFromEnv.mockReturnValue(null)
    setEnvFlags({ isHosted: false })
  })

  it('returns null and skips validation for env var URLs', async () => {
    await expect(validateMcpServerSsrf('{{MCP_SERVER_URL}}')).resolves.toBeNull()
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it('pins a localhost URL rather than leaving it unguarded', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    await expect(validateMcpServerSsrf('http://localhost:3000/mcp')).resolves.toBe('127.0.0.1')
  })

  it('prefers IPv4 over IPv6 for a dual-stack host (verbatim returns IPv6 first)', async () => {
    // Cloudflare-fronted hosts resolve IPv6-first; pinning that IPv6 hangs on an IPv4-only
    // egress. The guard must pin the reachable IPv4 instead.
    mockDnsLookup.mockResolvedValue([
      { address: '2606:4700:3037::ac43:cc5f', family: 6 },
      { address: '104.21.22.105', family: 4 },
    ])
    await expect(validateMcpServerSsrf('https://app.withgauge.com/mcp')).resolves.toBe(
      '104.21.22.105'
    )
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

  it('throws McpSsrfError for URLs resolving to private IPs', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    await expect(validateMcpServerSsrf('https://internal.corp/mcp')).rejects.toThrow(McpSsrfError)
  })

  it('refuses a DNS alias that resolves to loopback unless it is allowlisted', async () => {
    // The loopback carve-out keys off the hostname, so a name pointed at
    // loopback is named in EGRESS_ALLOWED_HOSTS or it is not reachable.
    mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    await expect(validateMcpServerSsrf('http://my-local-alias:3000/mcp')).rejects.toThrow(
      McpSsrfError
    )

    setEnvFlags({ egressAllowedHosts: 'my-local-alias' })
    try {
      await expect(validateMcpServerSsrf('http://my-local-alias:3000/mcp')).resolves.toBe(
        '127.0.0.1'
      )
    } finally {
      setEnvFlags({ egressAllowedHosts: undefined })
    }
  })

  describe('hosted environment', () => {
    beforeEach(() => {
      setEnvFlags({ isHosted: true })
    })

    it('rejects localhost URLs on hosted', async () => {
      await expect(validateMcpServerSsrf('http://localhost:3000/mcp')).rejects.toThrow(McpSsrfError)
    })

    it('rejects URLs resolving to loopback on hosted', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
      await expect(validateMcpServerSsrf('http://my-local-alias:3000/mcp')).rejects.toThrow(
        McpSsrfError
      )
    })

    it('pins public IP literals on hosted so redirects cannot escape', async () => {
      await expect(validateMcpServerSsrf('https://93.184.216.34/mcp')).resolves.toBe(
        '93.184.216.34'
      )
      expect(mockDnsLookup).not.toHaveBeenCalled()
    })

    it('refuses plain HTTP on hosted, where a credential would cross the wire in the clear', async () => {
      await expect(validateMcpServerSsrf('http://93.184.216.34/mcp')).rejects.toThrow(
        /must use https/
      )
    })

    it('still refuses loopback on hosted when a domain allowlist is configured', async () => {
      // The domain allowlist governs which domains may be used. It is not a
      // substitute for the address check, which it used to disable entirely.
      mockGetAllowedMcpDomainsFromEnv.mockReturnValue(['localhost'])
      mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
      await expect(validateMcpServerSsrf('http://localhost:3000/mcp')).rejects.toThrow(McpSsrfError)
    })

    it('still blocks DNS resolutions to private IPs on hosted (regression)', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
      await expect(validateMcpServerSsrf('https://internal.corp/mcp')).rejects.toThrow(McpSsrfError)
    })
  })

  describe('self-hosted environment (regression)', () => {
    beforeEach(() => {
      setEnvFlags({ isHosted: false })
    })

    it('still reaches a local MCP server, now pinned rather than unguarded', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
      await expect(validateMcpServerSsrf('http://localhost:3000/mcp')).resolves.toBe('127.0.0.1')
      await expect(validateMcpServerSsrf('http://127.0.0.1:8080/mcp')).resolves.toBe('127.0.0.1')
    })

    it('reaches a private MCP server once the operator allowlists it', async () => {
      setEnvFlags({ egressAllowedIpRanges: '10.0.0.0/8' })
      try {
        await expect(validateMcpServerSsrf('http://10.0.0.9:3000/mcp')).resolves.toBe('10.0.0.9')
      } finally {
        setEnvFlags({ egressAllowedIpRanges: undefined })
      }
    })
  })

  it('applies the address check even when ALLOWED_MCP_DOMAINS is configured', async () => {
    // Configuring the domain list used to disable this entirely, which left an
    // allowlisted domain free to redirect at anything, metadata included.
    mockGetAllowedMcpDomainsFromEnv.mockReturnValue(['internal.corp'])
    await expect(validateMcpServerSsrf('http://10.0.0.1/mcp')).rejects.toThrow(McpSsrfError)
    await expect(validateMcpServerSsrf('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      McpSsrfError
    )
  })
})

describe('the OAuth provenance', () => {
  beforeEach(() => {
    setEnvFlags({ isHosted: false })
  })

  it('is contentFetch, so a hop the metadata names inherits nothing from the server', () => {
    expect(OAUTH_EGRESS_PROFILE).toBe('contentFetch')
    expect(MCP_EGRESS_PROFILE).toBe('selfHostedService')
  })

  it('refuses loopback that the configured-server provenance reaches', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    await expect(validateMcpServerSsrf('http://localhost:3000/mcp')).resolves.toBe('127.0.0.1')
    await expect(
      validateMcpServerSsrf('http://localhost:3000/token', OAUTH_EGRESS_PROFILE)
    ).rejects.toThrow(McpSsrfError)
  })

  it('ignores the operator allowlist that the configured-server provenance honors', async () => {
    setEnvFlags({ egressAllowedIpRanges: '10.0.0.0/8' })
    try {
      mockDnsLookup.mockResolvedValue([{ address: '10.0.0.9', family: 4 }])
      await expect(validateMcpServerSsrf('https://mcp.corp/mcp')).resolves.toBe('10.0.0.9')
      await expect(
        validateMcpServerSsrf('https://idp.corp/token', OAUTH_EGRESS_PROFILE)
      ).rejects.toThrow(McpSsrfError)
    } finally {
      setEnvFlags({ egressAllowedIpRanges: undefined })
    }
  })
})
