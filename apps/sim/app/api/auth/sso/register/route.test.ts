/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvMock,
  schemaMock,
  setEnv,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockRegisterSSOProvider,
  mockHasSSOAccess,
  mockValidateUrlWithDNS,
  mockSecureFetchWithPinnedIP,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRegisterSSOProvider: vi.fn(),
  mockHasSSOAccess: vi.fn(),
  mockValidateUrlWithDNS: vi.fn(),
  mockSecureFetchWithPinnedIP: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

/** Queues the caller's org membership row(s) for the admin/owner check. */
function queueMembers(rows: Array<Record<string, unknown>>) {
  queueTableRows(schemaMock.member, rows)
}

/**
 * Queues existing SSO provider rows for BOTH domain-conflict lookups (the
 * pre-registration check and the post-registration re-check).
 */
function queueProviders(rows: Array<Record<string, unknown>>) {
  queueTableRows(schemaMock.ssoProvider, rows)
  queueTableRows(schemaMock.ssoProvider, rows)
}

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
  auth: { api: { registerSSOProvider: mockRegisterSSOProvider } },
}))

vi.mock('@/lib/billing', () => ({
  hasSSOAccess: mockHasSSOAccess,
}))

vi.mock('@/lib/auth/sso/domain', () => ({
  normalizeSSODomain: (input: unknown): string | null => {
    if (typeof input !== 'string') return null
    const value = input.trim().toLowerCase()
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : null
  },
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: mockValidateUrlWithDNS,
  secureFetchWithPinnedIP: mockSecureFetchWithPinnedIP,
}))

import { POST } from '@/app/api/auth/sso/register/route'

const OIDC_BODY = {
  providerType: 'oidc' as const,
  providerId: 'acme-oidc',
  issuer: 'https://idp.acme.com',
  domain: 'acme.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  authorizationEndpoint: 'https://idp.acme.com/authorize',
  tokenEndpoint: 'https://idp.acme.com/token',
  userInfoEndpoint: 'https://idp.acme.com/userinfo',
  jwksEndpoint: 'https://idp.acme.com/jwks',
}

function request(body: Record<string, unknown>) {
  return createMockRequest('POST', body)
}

describe('POST /api/auth/sso/register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnv({ SSO_ENABLED: 'true' })
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    mockHasSSOAccess.mockResolvedValue(true)
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '1.2.3.4' })
    mockSecureFetchWithPinnedIP.mockRejectedValue(new Error('discovery not mocked for this test'))
    mockRegisterSSOProvider.mockResolvedValue({ providerId: 'acme-oidc' })
    // Default: the org has already verified the domain, so the ownership gate
    // passes and each test exercises the logic beyond it. Gate-specific tests
    // reset the queue to assert the unverified path.
    queueTableRows(schemaMock.ssoDomain, [{ id: 'verified-domain' }])
  })

  afterAll(() => {
    resetDbChainMock()
    resetEnvMock()
  })

  it('rejects callers without an Enterprise plan', async () => {
    mockHasSSOAccess.mockResolvedValue(false)
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(403)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects callers who are not an admin/owner of the target org', async () => {
    queueMembers([{ organizationId: 'org1', role: 'member' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(403)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects an invalid domain', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    const res = await POST(request({ ...OIDC_BODY, domain: 'not-a-domain', orgId: 'org1' }))
    expect(res.status).toBe(400)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects configuring org SSO for a domain the org has not verified', async () => {
    resetDbChainMock()
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueTableRows(schemaMock.ssoDomain, []) // no verified sso_domain row
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe('SSO_DOMAIN_NOT_VERIFIED')
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects a domain already registered by another organization', async () => {
    queueMembers([{ organizationId: 'org-attacker', role: 'owner' }])
    queueProviders([{ domain: 'acme.com', userId: 'u-victim', organizationId: 'org-victim' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org-attacker' }))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.code).toBe('SSO_DOMAIN_ALREADY_REGISTERED')
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('matches conflicts across casing variants', async () => {
    queueMembers([{ organizationId: 'org-attacker', role: 'owner' }])
    queueProviders([{ domain: 'ACME.com', userId: 'u-victim', organizationId: 'org-victim' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org-attacker' }))
    expect(res.status).toBe(409)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
    // The conflict lookup itself must be case-insensitive: lower(domain) = <normalized domain>.
    const conflictWhere = dbChainMockFns.where.mock.calls.find(([condition]) =>
      condition?.strings?.join('?').includes('lower(')
    )
    expect(conflictWhere?.[0]?.values).toContain('acme.com')
  })

  it('registers when the domain is unclaimed', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1)
  })

  it('allows the owning tenant to update its own provider for the same domain', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([{ domain: 'acme.com', userId: 'u1', organizationId: 'org1' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1)
  })

  it('lets an org admin adopt their own user-scoped provider for the same domain', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([{ domain: 'acme.com', userId: 'u1', organizationId: null }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1)
  })

  it("still blocks an org admin from claiming another user's user-scoped domain", async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([{ domain: 'acme.com', userId: 'someone-else', organizationId: null }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(409)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('normalizes the domain before persisting it', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    const res = await POST(request({ ...OIDC_BODY, domain: 'ACME.com', orgId: 'org1' }))
    expect(res.status).toBe(200)
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.domain).toBe('acme.com')
  })

  it('passes skipDiscovery since Sim already resolved and validated the OIDC endpoints', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.oidcConfig.skipDiscovery).toBe(true)
  })

  it('omits userInfoEndpoint when skipUserInfoEndpoint is requested, forcing ID token claims', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    const res = await POST(request({ ...OIDC_BODY, skipUserInfoEndpoint: true, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.oidcConfig.userInfoEndpoint).toBeUndefined()
  })

  it('does not SSRF-validate userInfoEndpoint when skipUserInfoEndpoint is requested', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    mockValidateUrlWithDNS.mockImplementation(async (url: string, label: string) => {
      if (label === 'OIDC userInfoEndpoint') {
        return { isValid: false, error: 'resolves to a private IP address' }
      }
      return { isValid: true, resolvedIP: '1.2.3.4' }
    })
    const res = await POST(request({ ...OIDC_BODY, skipUserInfoEndpoint: true, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.oidcConfig.userInfoEndpoint).toBeUndefined()
  })

  it('does not SSRF-validate a discovered userinfo_endpoint when skipUserInfoEndpoint is requested', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    mockValidateUrlWithDNS.mockImplementation(async (url: string, label: string) => {
      if (label === 'OIDC userinfo_endpoint') {
        return { isValid: false, error: 'resolves to a private IP address' }
      }
      return { isValid: true, resolvedIP: '1.2.3.4' }
    })
    mockSecureFetchWithPinnedIP.mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.acme.com/authorize',
        token_endpoint: 'https://idp.acme.com/token',
        userinfo_endpoint: 'http://169.254.169.254/userinfo',
        jwks_uri: 'https://idp.acme.com/jwks',
      }),
    })
    const discoveredBody = {
      ...OIDC_BODY,
      authorizationEndpoint: undefined,
      tokenEndpoint: undefined,
      jwksEndpoint: undefined,
      skipUserInfoEndpoint: true,
    }
    const res = await POST(request({ ...discoveredBody, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.oidcConfig.userInfoEndpoint).toBeUndefined()
  })

  it('keeps userInfoEndpoint when skipUserInfoEndpoint is not requested', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.oidcConfig.userInfoEndpoint).toBe('https://idp.acme.com/userinfo')
  })

  it('selects tokenEndpointAuthentication from the discovery document when endpoints are auto-discovered', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    mockSecureFetchWithPinnedIP.mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://idp.acme.com/authorize',
        token_endpoint: 'https://idp.acme.com/token',
        userinfo_endpoint: 'https://idp.acme.com/userinfo',
        jwks_uri: 'https://idp.acme.com/jwks',
        token_endpoint_auth_methods_supported: ['client_secret_post'],
      }),
    })
    const discoveredBody = {
      ...OIDC_BODY,
      authorizationEndpoint: undefined,
      tokenEndpoint: undefined,
      jwksEndpoint: undefined,
    }
    const res = await POST(request({ ...discoveredBody, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.oidcConfig.tokenEndpointAuthentication).toBe('client_secret_post')
  })

  it('still selects tokenEndpointAuthentication from discovery when all endpoints are explicit', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    mockSecureFetchWithPinnedIP.mockResolvedValue({
      ok: true,
      json: async () => ({
        token_endpoint_auth_methods_supported: ['client_secret_post'],
      }),
    })
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.oidcConfig.tokenEndpointAuthentication).toBe('client_secret_post')
    expect(config.oidcConfig.authorizationEndpoint).toBe(OIDC_BODY.authorizationEndpoint)
  })

  it('registers successfully when discovery is unreachable and all endpoints are explicit', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    mockSecureFetchWithPinnedIP.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.oidcConfig.skipDiscovery).toBe(true)
    expect(config.oidcConfig.authorizationEndpoint).toBe(OIDC_BODY.authorizationEndpoint)
    expect(config.oidcConfig.tokenEndpointAuthentication).toBe('client_secret_post')
  })

  it('prefers client_secret_post over client_secret_basic when an IdP supports both', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    mockSecureFetchWithPinnedIP.mockResolvedValue({
      ok: true,
      json: async () => ({
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      }),
    })
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.oidcConfig.tokenEndpointAuthentication).toBe('client_secret_post')
  })

  it('defaults to client_secret_post when discovery advertises no auth methods', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    mockSecureFetchWithPinnedIP.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.oidcConfig.tokenEndpointAuthentication).toBe('client_secret_post')
  })

  it('surfaces the specific discovery failure reason when endpoints are missing', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    mockValidateUrlWithDNS.mockImplementation(async (url: string, label: string) => {
      if (label === 'OIDC discovery URL') {
        return { isValid: false, error: 'resolves to a private IP address' }
      }
      return { isValid: true, resolvedIP: '1.2.3.4' }
    })
    const discoveredBody = {
      ...OIDC_BODY,
      authorizationEndpoint: undefined,
      tokenEndpoint: undefined,
      jwksEndpoint: undefined,
    }
    const res = await POST(request({ ...discoveredBody, orgId: 'org1' }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toContain('resolves to a private IP address')
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })
})
