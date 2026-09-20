/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockDecryptSecret } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDecryptSecret: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
/** The shared env mock's ENCRYPTION_KEY is not 64 hex characters, so real crypto would throw. */
vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: vi.fn(),
  decryptSecret: mockDecryptSecret,
}))

import { GET } from '@/app/api/auth/sso/providers/route'

const IV = 'a'.repeat(32)
const TAG = 'b'.repeat(32)
const sealed = (secret: string) => `${IV}:${Buffer.from(secret).toString('hex')}:${TAG}`

const CLIENT_SECRET = 'a-long-client-secret-wxyz'

const providerRow = {
  id: 'row-1',
  providerId: 'acme-okta',
  domain: 'acme.com',
  issuer: 'https://acme.okta.test',
  oidcConfig: JSON.stringify({ clientId: 'client', clientSecret: sealed(CLIENT_SECRET) }),
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
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockDecryptSecret.mockImplementation(async (value: string) => ({
      decrypted: Buffer.from(value.split(':')[1], 'hex').toString('utf8'),
    }))
  })

  it('refuses a caller without a session before reading any provider', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await GET(createMockRequest('GET'))
    expect(res.status).toBe(401)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
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
    expect(providers[0].oidcConfig).not.toContain(sealed(CLIENT_SECRET))
    const condition = JSON.stringify(dbChainMockFns.where.mock.calls[0][0])
    expect(condition).toContain('user-1')
  })

  it('hints a secret stored before encryption existed', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      {
        ...providerRow,
        oidcConfig: JSON.stringify({ clientId: 'client', clientSecret: CLIENT_SECRET }),
      },
    ])

    const res = await GET(createMockRequest('GET'))

    const { providers } = await res.json()
    expect(JSON.parse(providers[0].oidcConfig)).toMatchObject({ clientSecretHint: 'wxyz' })
    expect(providers[0].oidcConfig).not.toContain(CLIENT_SECRET)
    expect(mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('redacts SAML key material and keeps the certificate', async () => {
    queueTableRows(schemaMock.ssoProvider, [
      {
        ...providerRow,
        oidcConfig: null,
        samlConfig: JSON.stringify({
          cert: 'public-cert',
          entryPoint: 'https://acme.okta.test/sso',
          privateKey: sealed('sp-signing-key'),
          decryptionPvk: sealed('sp-decryption-key'),
        }),
      },
    ])

    const res = await GET(createMockRequest('GET'))

    const { providers } = await res.json()
    const samlConfig = JSON.parse(providers[0].samlConfig)
    expect(samlConfig).toMatchObject({
      cert: 'public-cert',
      entryPoint: 'https://acme.okta.test/sso',
      privateKey: '[REDACTED]',
      decryptionPvk: '[REDACTED]',
    })
    expect(providers[0].samlConfig).not.toContain('sp-signing-key')
    expect(providers[0].providerType).toBe('saml')
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
