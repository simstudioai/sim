/**
 * @vitest-environment node
 */
import { createEnvMock, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockRegisterSSOProvider,
  mockHasSSOAccess,
  mockValidateUrlWithDNS,
  dbState,
  memberTable,
  ssoProviderTable,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRegisterSSOProvider: vi.fn(),
  mockHasSSOAccess: vi.fn(),
  mockValidateUrlWithDNS: vi.fn(),
  dbState: { members: [] as any[], providers: [] as any[] },
  memberTable: {
    userId: 'member.userId',
    organizationId: 'member.organizationId',
    role: 'member.role',
  },
  ssoProviderTable: {
    id: 'sso.id',
    providerId: 'sso.providerId',
    domain: 'sso.domain',
    issuer: 'sso.issuer',
    userId: 'sso.userId',
    organizationId: 'sso.organizationId',
    oidcConfig: 'sso.oidcConfig',
    samlConfig: 'sso.samlConfig',
  },
}))

function makeBuilder(rows: any[]): any {
  const thenable: any = Promise.resolve(rows)
  thenable.where = (condition: any) => {
    const values = condition?.values
    if (Array.isArray(values) && values.length > 0) {
      const target = String(values[values.length - 1]).toLowerCase()
      return makeBuilder(rows.filter((r) => String(r.domain ?? '').toLowerCase() === target))
    }
    return makeBuilder(rows)
  }
  thenable.limit = () => Promise.resolve(rows)
  thenable.orderBy = () => Promise.resolve(rows)
  return thenable
}

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) =>
        makeBuilder(table === memberTable ? dbState.members : dbState.providers),
    }),
  },
  member: memberTable,
  ssoProvider: ssoProviderTable,
}))

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
  secureFetchWithPinnedIP: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => createEnvMock({ SSO_ENABLED: 'true' }))

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
    dbState.members = []
    dbState.providers = []
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    mockHasSSOAccess.mockResolvedValue(true)
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '1.2.3.4' })
    mockRegisterSSOProvider.mockResolvedValue({ providerId: 'acme-oidc' })
  })

  it('rejects callers without an Enterprise plan', async () => {
    mockHasSSOAccess.mockResolvedValue(false)
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(403)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects callers who are not an admin/owner of the target org', async () => {
    dbState.members = [{ organizationId: 'org1', role: 'member' }]
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(403)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects an invalid domain', async () => {
    dbState.members = [{ organizationId: 'org1', role: 'owner' }]
    const res = await POST(request({ ...OIDC_BODY, domain: 'not-a-domain', orgId: 'org1' }))
    expect(res.status).toBe(400)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects a domain already registered by another organization', async () => {
    dbState.members = [{ organizationId: 'org-attacker', role: 'owner' }]
    dbState.providers = [{ domain: 'acme.com', userId: 'u-victim', organizationId: 'org-victim' }]
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org-attacker' }))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.code).toBe('SSO_DOMAIN_ALREADY_REGISTERED')
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('matches conflicts across casing variants', async () => {
    dbState.members = [{ organizationId: 'org-attacker', role: 'owner' }]
    dbState.providers = [{ domain: 'ACME.com', userId: 'u-victim', organizationId: 'org-victim' }]
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org-attacker' }))
    expect(res.status).toBe(409)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('registers when the domain is unclaimed', async () => {
    dbState.members = [{ organizationId: 'org1', role: 'owner' }]
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1)
  })

  it('allows the owning tenant to update its own provider for the same domain', async () => {
    dbState.members = [{ organizationId: 'org1', role: 'owner' }]
    dbState.providers = [{ domain: 'acme.com', userId: 'u1', organizationId: 'org1' }]
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1)
  })

  it('lets an org admin adopt their own user-scoped provider for the same domain', async () => {
    dbState.members = [{ organizationId: 'org1', role: 'owner' }]
    dbState.providers = [{ domain: 'acme.com', userId: 'u1', organizationId: null }]
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1)
  })

  it("still blocks an org admin from claiming another user's user-scoped domain", async () => {
    dbState.members = [{ organizationId: 'org1', role: 'owner' }]
    dbState.providers = [{ domain: 'acme.com', userId: 'someone-else', organizationId: null }]
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(409)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('normalizes the domain before persisting it', async () => {
    dbState.members = [{ organizationId: 'org1', role: 'owner' }]
    const res = await POST(request({ ...OIDC_BODY, domain: 'ACME.com', orgId: 'org1' }))
    expect(res.status).toBe(200)
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1)
    const config = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(config.domain).toBe('acme.com')
  })
})
