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
  mockRequestDomainVerification,
  mockVerifyDomain,
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
  mockRequestDomainVerification: vi.fn(),
  mockVerifyDomain: vi.fn(),
  ssoProviderTable: {
    id: 'sso.id',
    issuer: 'sso.issuer',
    domain: 'sso.domain',
    domainVerified: 'sso.domainVerified',
    oidcConfig: 'sso.oidcConfig',
    samlConfig: 'sso.samlConfig',
    userId: 'sso.userId',
    providerId: 'sso.providerId',
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
  auth: {
    api: {
      requestDomainVerification: mockRequestDomainVerification,
      verifyDomain: mockVerifyDomain,
    },
  },
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({ SSO_ENABLED: 'true', SSO_DOMAIN_VERIFICATION_ENABLED: 'true' })
)

import { POST as requestVerification } from '@/app/api/auth/sso/providers/[id]/domain-verification/request/route'
import { POST as verifyDomain } from '@/app/api/auth/sso/providers/[id]/domain-verification/verify/route'

const PROVIDER = {
  id: 'row-1',
  issuer: 'https://idp.example.com',
  domain: 'acme.com',
  domainVerified: false,
  oidcConfig: null,
  samlConfig: '{}',
  userId: 'creator-1',
  providerId: 'acme-saml',
  organizationId: 'org-1',
}
const context = { params: Promise.resolve({ id: 'row-1' }) }

describe('SSO domain verification façades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.members = [{ role: 'admin' }]
    dbState.providers = [PROVIDER]
    mockGetSession.mockResolvedValue({ user: { id: 'creator-1' } })
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
    mockRequestDomainVerification.mockResolvedValue({ domainVerificationToken: 'secret-token' })
    mockVerifyDomain.mockResolvedValue(undefined)
  })

  it('preserves Better Auth creator identity authorization', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'different-admin' } })
    const response = await requestVerification(createMockRequest('POST'), context)
    expect(response.status).toBe(403)
    expect(mockRequestDomainVerification).not.toHaveBeenCalled()
  })

  it('returns DNS instructions only to the creator', async () => {
    const response = await requestVerification(
      createMockRequest('POST', undefined, { cookie: 'session=one' }),
      context
    )
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      recordName: '_better-auth-token-acme-saml.acme.com',
      recordValue: '_better-auth-token-acme-saml=secret-token',
    })
    expect(mockRequestDomainVerification).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.objectContaining({ cookie: 'session=one' }) })
    )
  })

  it('delegates DNS verification to Better Auth', async () => {
    const response = await verifyDomain(createMockRequest('POST'), context)
    expect(response.status).toBe(200)
    expect(mockVerifyDomain).toHaveBeenCalledWith(
      expect.objectContaining({ body: { providerId: 'acme-saml' } })
    )
  })
})
