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
  ssoProviderTable: {
    id: 'sso.id',
    providerId: 'sso.providerId',
    domain: 'sso.domain',
    issuer: 'sso.issuer',
    oidcConfig: 'sso.oidcConfig',
    samlConfig: 'sso.samlConfig',
    userId: 'sso.userId',
    organizationId: 'sso.organizationId',
    domainVerified: 'sso.domainVerified',
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
}))

vi.mock('@/lib/core/config/env', () => createEnvMock({ SSO_DOMAIN_VERIFICATION_ENABLED: 'true' }))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceIpRateLimit: vi.fn(),
}))

import { GET } from '@/app/api/auth/sso/providers/route'

describe('GET /api/auth/sso/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.members = [{ role: 'admin' }]
    dbState.providers = [
      {
        id: 'row-1',
        providerId: 'acme-saml',
        domain: 'acme.com',
        issuer: 'https://idp.example.com',
        oidcConfig: null,
        samlConfig: '{}',
        userId: 'creator-1',
        organizationId: 'org-1',
        domainVerified: false,
      },
    ]
    mockGetSession.mockResolvedValue({ user: { id: 'creator-1' } })
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
  })

  it('returns activation state and creator capability without a verification token', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/auth/sso/providers?organizationId=org-1'
      )
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.providers[0]).toMatchObject({
      domainVerified: false,
      isCreator: true,
      canManageVerification: true,
    })
    expect(payload.providers[0]).not.toHaveProperty('domainVerificationToken')
    expect(payload.providers[0]).not.toHaveProperty('userId')
  })

  it('loads for an admin before the Enterprise plan gate is satisfied', async () => {
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/auth/sso/providers?organizationId=org-1'
      )
    )

    expect(response.status).toBe(200)
    expect(mockIsOrganizationOnEnterprisePlan).not.toHaveBeenCalled()
  })

  it('fails closed for non-admin organization members', async () => {
    dbState.members = [{ role: 'member' }]
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/auth/sso/providers?organizationId=org-1'
      )
    )
    expect(response.status).toBe(403)
  })
})
