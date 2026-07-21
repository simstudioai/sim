/**
 * @vitest-environment node
 *
 * Regression test: `revokeMcpOauthTokens` must route both metadata discovery
 * and the RFC 7009 revocation POST through the SSRF-guarded fetch, since
 * `revocation_endpoint` comes from attacker-controlled server metadata. Uses
 * the real `createSsrfGuardedMcpFetch` so it fails if revoke.ts regresses to a
 * raw `fetch`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const BLOCKED_ENDPOINT = 'http://169.254.170.2/v2/credentials/'
const PUBLIC_SERVER_URL = 'https://mcp.attacker.com'
const PUBLIC_SERVER_IP = '203.0.113.10'

const {
  mockUndiciFetch,
  mockValidateMcpServerSsrf,
  mockDiscoverOAuthServerInfo,
  mockLoadOauthRow,
  mockDecryptSecret,
  mockDbSelect,
} = vi.hoisted(() => ({
  mockUndiciFetch: vi.fn(),
  mockValidateMcpServerSsrf: vi.fn(),
  mockDiscoverOAuthServerInfo: vi.fn(),
  mockLoadOauthRow: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockDbSelect: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  createPinnedFetchWithDispatcher: vi.fn(() => ({
    fetch: mockUndiciFetch,
    dispatcher: { destroy: vi.fn(() => Promise.resolve()) },
  })),
}))
vi.mock('@/lib/mcp/domain-check', () => ({
  validateMcpServerSsrf: mockValidateMcpServerSsrf,
}))
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  discoverOAuthServerInfo: mockDiscoverOAuthServerInfo,
}))
vi.mock('@/lib/mcp/oauth/storage', () => ({
  loadOauthRow: mockLoadOauthRow,
}))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))
vi.mock('@sim/db', () => ({
  db: { select: mockDbSelect },
}))

import { revokeMcpOauthTokens } from './revoke'

function wireServerRow(row: Record<string, unknown>) {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => Promise.resolve([row]),
  }
  mockDbSelect.mockReturnValue(builder)
}

describe('revokeMcpOauthTokens — SSRF guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockLoadOauthRow.mockResolvedValue({
      tokens: { access_token: 'access-secret', refresh_token: 'refresh-secret' },
      clientInformation: { client_id: 'client-123' },
    })

    wireServerRow({
      url: PUBLIC_SERVER_URL,
      oauthClientId: 'client-123',
      oauthClientSecret: null,
    })

    mockDiscoverOAuthServerInfo.mockResolvedValue({
      authorizationServerMetadata: {
        issuer: PUBLIC_SERVER_URL,
        revocation_endpoint: BLOCKED_ENDPOINT,
      },
    })

    mockUndiciFetch.mockResolvedValue(new Response('ok'))

    // Catches a regression to raw globalThis.fetch without hitting the network.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    // Public server host resolves; the revocation endpoint is blocked.
    mockValidateMcpServerSsrf.mockImplementation(async (target: string) => {
      if (target.startsWith(BLOCKED_ENDPOINT) || target.includes('169.254.')) {
        throw new Error('MCP server URL resolves to a blocked IP address')
      }
      return PUBLIC_SERVER_IP
    })
  })

  it('routes metadata discovery through the SSRF-guarded fetch', async () => {
    await revokeMcpOauthTokens('server-1')

    expect(mockDiscoverOAuthServerInfo).toHaveBeenCalledTimes(1)
    const [, options] = mockDiscoverOAuthServerInfo.mock.calls[0]
    expect(typeof options?.fetchFn).toBe('function')
  })

  it('validates the attacker-controlled revocation_endpoint before issuing the request', async () => {
    await revokeMcpOauthTokens('server-1')

    expect(mockValidateMcpServerSsrf).toHaveBeenCalledWith(BLOCKED_ENDPOINT)
  })

  it('never issues an outbound request to the blocked revocation endpoint', async () => {
    await revokeMcpOauthTokens('server-1')

    const allCalls = [
      ...mockUndiciFetch.mock.calls,
      ...(globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls,
    ]
    for (const call of allCalls) {
      const target = typeof call[0] === 'string' ? call[0] : String(call[0])
      expect(target).not.toContain('169.254.170.2')
    }
  })

  it('swallows the SSRF rejection — revocation is best-effort and never throws', async () => {
    await expect(revokeMcpOauthTokens('server-1')).resolves.toBeUndefined()
  })

  it('still issues the revocation POST when the endpoint resolves to a public IP', async () => {
    const publicEndpoint = 'https://mcp.attacker.com/oauth/revoke'
    mockDiscoverOAuthServerInfo.mockResolvedValue({
      authorizationServerMetadata: {
        issuer: PUBLIC_SERVER_URL,
        revocation_endpoint: publicEndpoint,
      },
    })

    await revokeMcpOauthTokens('server-1')

    expect(mockValidateMcpServerSsrf).toHaveBeenCalledWith(publicEndpoint)
    const revokeCalls = mockUndiciFetch.mock.calls.filter((call) => {
      const target = typeof call[0] === 'string' ? call[0] : String(call[0])
      return target === publicEndpoint
    })
    expect(revokeCalls.length).toBeGreaterThan(0)
    expect(revokeCalls[0][1]).toMatchObject({ method: 'POST' })
  })
})
