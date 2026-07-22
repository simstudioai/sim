/**
 * @vitest-environment node
 */
import { createEnvMock, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  dbState,
  memberTable,
  mockGetSession,
  mockIsOrganizationOnEnterprisePlan,
  mockRegisterSSOProvider,
  mockSecureFetchWithPinnedIP,
  mockValidateUrlWithDNS,
  ssoProviderTable,
} = vi.hoisted(() => ({
  dbState: {
    members: [] as Array<{ role: string }>,
    providers: [] as Array<Record<string, unknown>>,
  },
  memberTable: {
    userId: 'member.userId',
    organizationId: 'member.organizationId',
    role: 'member.role',
  },
  mockGetSession: vi.fn(),
  mockIsOrganizationOnEnterprisePlan: vi.fn(),
  mockRegisterSSOProvider: vi.fn(),
  mockSecureFetchWithPinnedIP: vi.fn(),
  mockValidateUrlWithDNS: vi.fn(),
  ssoProviderTable: {
    id: 'sso.id',
    providerId: 'sso.providerId',
    domain: 'sso.domain',
    organizationId: 'sso.organizationId',
  },
}))

function makeBuilder(rows: unknown[]): Promise<unknown[]> & {
  where: () => ReturnType<typeof makeBuilder>
  limit: () => Promise<unknown[]>
} {
  const builder = Promise.resolve(rows) as Promise<unknown[]> & {
    where: () => ReturnType<typeof makeBuilder>
    limit: () => Promise<unknown[]>
  }
  builder.where = () => makeBuilder(rows)
  builder.limit = () => Promise.resolve(rows)
  return builder
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
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: mockValidateUrlWithDNS,
  secureFetchWithPinnedIP: mockSecureFetchWithPinnedIP,
}))

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({ SSO_ENABLED: 'true', SSO_DOMAIN_VERIFICATION_ENABLED: 'true' })
)

import { POST } from '@/app/api/auth/sso/register/route'

const OIDC_BODY = {
  providerType: 'oidc' as const,
  providerId: 'acme-oidc',
  issuer: 'https://idp.acme.com',
  domain: 'acme.com',
  orgId: 'org-1',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  authorizationEndpoint: 'https://idp.acme.com/authorize',
  tokenEndpoint: 'https://idp.acme.com/token',
  userInfoEndpoint: 'https://idp.acme.com/userinfo',
  jwksEndpoint: 'https://idp.acme.com/jwks',
}

const SAML_BODY = {
  providerType: 'saml' as const,
  providerId: 'acme-saml',
  issuer: 'https://idp.acme.com',
  domain: 'acme.com',
  orgId: 'org-1',
  entryPoint: 'https://idp.acme.com/sso',
  cert: 'public-test-certificate',
}

function request(body: Record<string, unknown>) {
  return createMockRequest('POST', body, { cookie: 'session=one' })
}

describe('POST /api/auth/sso/register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.members = [{ role: 'owner' }]
    dbState.providers = []
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '1.2.3.4' })
    mockSecureFetchWithPinnedIP.mockRejectedValue(new Error('Discovery unavailable'))
    mockRegisterSSOProvider.mockResolvedValue({
      providerId: 'acme-oidc',
      domainVerified: false,
      domainVerificationToken: 'verification-token',
    })
  })

  it('rejects members and non-members', async () => {
    for (const members of [[], [{ role: 'member' }]]) {
      dbState.members = members
      const response = await POST(request(OIDC_BODY))
      expect(response.status).toBe(403)
    }
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects organizations without Enterprise authorization', async () => {
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)
    const response = await POST(request(OIDC_BODY))
    expect(response.status).toBe(403)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects comma lists and public suffixes', async () => {
    for (const domain of ['acme.com,subsidiary.com', 'com']) {
      const response = await POST(request({ ...OIDC_BODY, domain }))
      expect(response.status).toBe(400)
    }
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it.each([OIDC_BODY, SAML_BODY])(
    'rejects built-in trusted IDs for $providerType registration',
    async (body) => {
      const response = await POST(request({ ...body, providerId: 'google' }))
      await expect(response.json()).resolves.toMatchObject({ code: 'SSO_PROVIDER_ID_RESERVED' })
      expect(response.status).toBe(400)
      expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
    }
  )

  it('rejects non-web SAML issuer and entry-point schemes', async () => {
    const samlBody = {
      providerType: 'saml',
      providerId: 'acme-saml',
      issuer: 'https://idp.acme.com',
      domain: 'acme.com',
      orgId: 'org-1',
      entryPoint: 'https://idp.acme.com/sso',
      cert: 'public-test-certificate',
    }
    for (const body of [
      { ...samlBody, issuer: 'not a url' },
      { ...samlBody, issuer: 'javascript:alert(1)' },
      { ...samlBody, entryPoint: 'data:text/html,invalid' },
    ]) {
      const response = await POST(request(body))
      expect(response.status).toBe(400)
    }
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects parent and child domain overlap owned by another tenant', async () => {
    for (const existingDomain of ['acme.com', 'login.acme.com']) {
      dbState.providers = [
        {
          id: 'existing',
          providerId: 'other',
          domain: existingDomain,
          organizationId: 'org-other',
        },
      ]
      const domain = existingDomain === 'acme.com' ? 'login.acme.com' : 'acme.com'
      const response = await POST(request({ ...OIDC_BODY, domain }))
      expect(response.status).toBe(409)
    }
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('enforces one provider per organization', async () => {
    dbState.providers = [
      {
        id: 'existing',
        providerId: 'existing-id',
        domain: 'other.com',
        organizationId: 'org-1',
      },
    ]
    const response = await POST(request(OIDC_BODY))
    expect(response.status).toBe(409)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('creates a pending provider and forwards request headers', async () => {
    const response = await POST(request({ ...OIDC_BODY, domain: 'ACME.COM' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      providerId: 'acme-oidc',
      domainVerified: false,
    })
    expect(payload).not.toHaveProperty('domainVerificationToken')
    expect(mockRegisterSSOProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ domain: 'acme.com' }),
        headers: expect.objectContaining({ cookie: 'session=one' }),
      })
    )
  })

  it('maps adapter uniqueness races to 409', async () => {
    mockRegisterSSOProvider.mockRejectedValue({ code: '23505' })
    const response = await POST(request(OIDC_BODY))
    expect(response.status).toBe(409)
  })
})
