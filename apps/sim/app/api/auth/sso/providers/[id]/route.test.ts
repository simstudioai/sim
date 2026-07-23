/**
 * @vitest-environment node
 */
import { createEnvMock, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  accountTable,
  dbState,
  memberTable,
  mockDeleteSSOProvider,
  mockGetSession,
  mockIsOrganizationOnEnterprisePlan,
  mockUpdateSSOProvider,
  mockWithSSOProviderMutationLock,
  ssoProviderTable,
} = vi.hoisted(() => ({
  accountTable: {
    id: 'account.id',
    providerId: 'account.providerId',
  },
  dbState: {
    accounts: [] as Array<{ id: string }>,
    members: [] as Array<{ role: string }>,
    providers: [] as Array<Record<string, unknown>>,
  },
  memberTable: {
    userId: 'member.userId',
    organizationId: 'member.organizationId',
    role: 'member.role',
  },
  mockDeleteSSOProvider: vi.fn(),
  mockGetSession: vi.fn(),
  mockIsOrganizationOnEnterprisePlan: vi.fn(),
  mockUpdateSSOProvider: vi.fn(),
  mockWithSSOProviderMutationLock: vi.fn((callback: () => Promise<unknown>) => callback()),
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
        makeBuilder(
          table === memberTable
            ? dbState.members
            : table === accountTable
              ? dbState.accounts
              : dbState.providers
        ),
    }),
  },
  account: accountTable,
  member: memberTable,
  ssoProvider: ssoProviderTable,
  withSSOProviderMutationLock: mockWithSSOProviderMutationLock,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
  auth: {
    api: {
      updateSSOProvider: mockUpdateSSOProvider,
      deleteSSOProvider: mockDeleteSSOProvider,
    },
  },
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mockIsOrganizationOnEnterprisePlan,
}))

vi.mock('@/lib/core/config/env', () =>
  createEnvMock({ SSO_ENABLED: 'true', SSO_DOMAIN_VERIFICATION_ENABLED: 'true' })
)

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://app.example.com',
}))

import { env } from '@/lib/core/config/env'
import { DELETE, PATCH } from '@/app/api/auth/sso/providers/[id]/route'

const PROVIDER = {
  id: 'row-1',
  issuer: 'https://old-idp.example.com',
  domain: 'old.example.com',
  domainVerified: true,
  oidcConfig: null,
  samlConfig: JSON.stringify({ entryPoint: 'https://old-idp.example.com/sso' }),
  userId: 'creator-1',
  providerId: 'acme-saml',
  organizationId: 'org-1',
}

const SAML_UPDATE = {
  issuer: 'https://idp.example.com',
  domain: 'new.example.com',
  mapping: {
    id: 'name-id',
    email: 'email',
    name: 'name',
    image: 'picture',
  },
  entryPoint: 'https://idp.example.com/sso',
  cert: '-----BEGIN CERTIFICATE-----\nPUBLIC\n-----END CERTIFICATE-----',
  wantAssertionsSigned: true,
}

const context = { params: Promise.resolve({ id: 'row-1' }) }

describe('/api/auth/sso/providers/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.accounts = []
    dbState.members = [{ role: 'admin' }]
    dbState.providers = [PROVIDER]
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
    mockUpdateSSOProvider.mockResolvedValue({ domainVerified: false })
    mockDeleteSSOProvider.mockResolvedValue({ success: true })
  })

  it('updates through PATCH with the resolved immutable provider ID', async () => {
    const response = await PATCH(createMockRequest('PATCH', SAML_UPDATE), context)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.domainVerified).toBe(false)
    expect(mockUpdateSSOProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          providerId: 'acme-saml',
          domain: 'new.example.com',
          samlConfig: expect.objectContaining({
            spMetadata: {
              metadata: expect.stringContaining(
                'https://app.example.com/api/auth/sso/saml2/callback/acme-saml'
              ),
            },
            idpMetadata: {
              metadata: expect.stringContaining('https://idp.example.com/sso'),
            },
          }),
        }),
      })
    )
  })

  it('re-checks domain overlap inside the mutation lock before updating', async () => {
    mockWithSSOProviderMutationLock.mockImplementationOnce(
      async (callback: () => Promise<unknown>) => {
        dbState.providers = [
          PROVIDER,
          {
            id: 'concurrent',
            issuer: 'https://other-idp.example.com',
            domain: 'login.new.example.com',
            oidcConfig: '{}',
            samlConfig: null,
            userId: 'creator-2',
            providerId: 'concurrent-provider',
            organizationId: 'org-2',
          },
        ]
        return callback()
      }
    )

    const response = await PATCH(createMockRequest('PATCH', SAML_UPDATE), context)

    expect(response.status).toBe(409)
    expect(mockWithSSOProviderMutationLock).toHaveBeenCalledOnce()
    expect(mockUpdateSSOProvider).not.toHaveBeenCalled()
  })

  it('recomputes the identity guard from the provider row loaded inside the lock', async () => {
    mockWithSSOProviderMutationLock.mockImplementationOnce(
      async (callback: () => Promise<unknown>) => {
        dbState.providers = [
          {
            ...PROVIDER,
            issuer: 'https://concurrent-idp.example.com',
            domain: 'concurrent.example.com',
          },
        ]
        dbState.accounts = [{ id: 'concurrent-link' }]
        return callback()
      }
    )

    const response = await PATCH(
      createMockRequest('PATCH', {
        ...SAML_UPDATE,
        issuer: PROVIDER.issuer,
        domain: PROVIDER.domain,
      }),
      context
    )

    expect(response.status).toBe(409)
    expect(mockUpdateSSOProvider).not.toHaveBeenCalled()
  })

  it('reports the compatibility-active state while verification enforcement is disabled', async () => {
    const previousValue = env.SSO_DOMAIN_VERIFICATION_ENABLED
    env.SSO_DOMAIN_VERIFICATION_ENABLED = undefined
    try {
      const response = await PATCH(createMockRequest('PATCH', SAML_UPDATE), context)
      await expect(response.json()).resolves.toMatchObject({ domainVerified: true })
    } finally {
      env.SSO_DOMAIN_VERIFICATION_ENABLED = previousValue
    }
  })

  it('rejects attempts to change the provider type', async () => {
    const response = await PATCH(
      createMockRequest('PATCH', {
        issuer: 'https://idp.example.com',
        domain: 'new.example.com',
        mapping: { id: 'sub', email: 'email', name: 'name', image: 'picture' },
        clientId: 'client',
        clientSecret: 'secret',
        scopes: ['openid'],
        pkce: true,
        authorizationEndpoint: 'https://idp.example.com/auth',
        tokenEndpoint: 'https://idp.example.com/token',
        jwksEndpoint: 'https://idp.example.com/jwks',
      }),
      context
    )
    expect(response.status).toBe(400)
    expect(mockUpdateSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects members before invoking Better Auth', async () => {
    dbState.members = [{ role: 'member' }]
    const response = await PATCH(createMockRequest('PATCH', SAML_UPDATE), context)
    expect(response.status).toBe(403)
    expect(mockUpdateSSOProvider).not.toHaveBeenCalled()
  })

  it('rejects administrators who do not belong to the provider organization', async () => {
    dbState.members = []
    const response = await PATCH(createMockRequest('PATCH', SAML_UPDATE), context)
    expect(response.status).toBe(403)
    expect(mockUpdateSSOProvider).not.toHaveBeenCalled()
  })

  it('deletes with the resolved provider ID', async () => {
    const response = await DELETE(createMockRequest('DELETE'), context)
    expect(response.status).toBe(200)
    expect(mockDeleteSSOProvider).toHaveBeenCalledWith(
      expect.objectContaining({ body: { providerId: 'acme-saml' } })
    )
  })

  it('allows administrator cleanup after the organization loses Enterprise', async () => {
    mockIsOrganizationOnEnterprisePlan.mockResolvedValue(false)

    const updateResponse = await PATCH(createMockRequest('PATCH', SAML_UPDATE), context)
    expect(updateResponse.status).toBe(403)
    expect(mockUpdateSSOProvider).not.toHaveBeenCalled()

    const deleteResponse = await DELETE(createMockRequest('DELETE'), context)
    expect(deleteResponse.status).toBe(200)
    expect(mockDeleteSSOProvider).toHaveBeenCalledWith(
      expect.objectContaining({ body: { providerId: 'acme-saml' } })
    )
  })

  it('blocks identity changes and deletion while Better Auth account links exist', async () => {
    dbState.accounts = [{ id: 'linked-account' }]

    const updateResponse = await PATCH(createMockRequest('PATCH', SAML_UPDATE), context)
    expect(updateResponse.status).toBe(409)
    expect(mockUpdateSSOProvider).not.toHaveBeenCalled()

    const deleteResponse = await DELETE(createMockRequest('DELETE'), context)
    expect(deleteResponse.status).toBe(409)
    expect(mockDeleteSSOProvider).not.toHaveBeenCalled()
  })

  it('blocks an identity update when a link appears while waiting for the mutation lock', async () => {
    mockWithSSOProviderMutationLock.mockImplementationOnce(
      async (callback: () => Promise<unknown>) => {
        dbState.accounts = [{ id: 'concurrent-link' }]
        return callback()
      }
    )

    const response = await PATCH(createMockRequest('PATCH', SAML_UPDATE), context)

    expect(response.status).toBe(409)
    expect(mockUpdateSSOProvider).not.toHaveBeenCalled()
  })

  it('blocks deletion when a link appears while waiting for the mutation lock', async () => {
    mockWithSSOProviderMutationLock.mockImplementationOnce(
      async (callback: () => Promise<unknown>) => {
        dbState.accounts = [{ id: 'concurrent-link' }]
        return callback()
      }
    )

    const response = await DELETE(createMockRequest('DELETE'), context)

    expect(response.status).toBe(409)
    expect(mockDeleteSSOProvider).not.toHaveBeenCalled()
  })
})
