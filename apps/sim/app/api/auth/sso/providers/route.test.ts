import {
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { GET } from '@/app/api/auth/sso/providers/route'

const mockGetSession = authMockFns.mockGetSession

const providerRow = {
  id: 'row-1',
  providerId: 'acme-okta',
  domain: 'acme.com',
  issuer: 'https://acme.okta.test',
  oidcConfig: JSON.stringify({ clientId: 'client', clientSecret: 'a-long-client-secret-wxyz' }),
  samlConfig: null,
  userId: 'user-1',
  organizationId: 'org-1',
  jitProvisioningEnabled: true,
  domainVerified: true,
  domainKey: 'acme.com',
  isNamedPrimary: false,
}

describe('GET /api/auth/sso/providers', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('lists only the providers the caller registered when no organization is named', async () => {
    queueTableRows(schemaMock.ssoProvider, [providerRow])
    const res = await GET(createMockRequest('GET'))
    expect(res.status).toBe(200)
    const { providers } = await res.json()
    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({ providerId: 'acme-okta', providerType: 'oidc' })
    expect(JSON.parse(providers[0].oidcConfig)).toMatchObject({ clientSecretHint: 'wxyz' })
    expect(providers[0].oidcConfig).not.toContain('a-long-client-secret')
    const condition = JSON.stringify(dbChainMockFns.where.mock.calls[0][0])
    expect(condition).toContain('user-1')
  })

  it('refuses an organization the caller does not administer', async () => {
    queueTableRows(schemaMock.member, [{ organizationId: 'org-1', role: 'member' }])
    const res = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost/api/auth/sso/providers?organizationId=org-1'
      )
    )
    expect(res.status).toBe(403)
  })
})
