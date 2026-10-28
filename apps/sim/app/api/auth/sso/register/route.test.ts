import {
  createMockRequest,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  resetEnvMock,
  schemaMock,
  setEnv,
  setEnvFlags,
} from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** Queues the caller's org membership row(s) for the admin/owner check. */
function queueMembers(rows: Array<Record<string, unknown>>) {
  queueTableRows(schemaMock.member, rows)
  queueTableRows(schemaMock.member, rows)
}

/**
 * Queues the sso_provider lookups a registration performs, in route order:
 * providerId conflict then domain conflict, once before OIDC discovery and again
 * immediately before the write. `providerIdRows` defaults to empty so
 * domain-conflict tests are unaffected by the providerId check.
 */
function queueProviders(
  domainRows: Array<Record<string, unknown>>,
  providerIdRows: Array<Record<string, unknown>> = []
) {
  queueTableRows(schemaMock.ssoProvider, providerIdRows)
  queueTableRows(schemaMock.ssoProvider, domainRows)
  queueTableRows(schemaMock.ssoProvider, providerIdRows)
  queueTableRows(schemaMock.ssoProvider, domainRows)
}

vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { POST } from '@/app/api/auth/sso/register/route'

const mockValidateUrlWithDNS = inputValidationMockFns.mockValidateUrlWithDNS
const mockSecureFetchWithPinnedIP = inputValidationMockFns.mockSecureFetchWithPinnedIP
const mockGetSession = authMockFns.mockGetSession

const OIDC_BODY = {
  providerType: 'oidc' as const,
  providerId: 'acme-oidc',
  issuer: 'https://idp.acme.com',
  domain: 'acme.com',
  orgId: 'org1',
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
    resetDbChainMock()
    setEnv({ SSO_ENABLED: 'true' })
    /**
     * The route gates on the resolved `isSsoEnabled` rather than the raw env
     * var, so the suite switch (`ENTERPRISE_ENABLED`) can register SSO too.
     */
    setEnvFlags({ isSsoEnabled: true })
    mockGetSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 'session-1' } })
    billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled.mockResolvedValue(true)
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '1.2.3.4' })
    mockSecureFetchWithPinnedIP.mockRejectedValue(new Error('discovery not mocked for this test'))
    queueTableRows(schemaMock.ssoDomain, [{ id: 'verified-domain' }])
    queueTableRows(schemaMock.ssoDomain, [{ id: 'verified-domain' }])
    queueTableRows(schemaMock.ssoDomain, [{ id: 'verified-domain' }])
  })

  afterAll(() => {
    resetDbChainMock()
    resetEnvMock()
    resetEnvFlagsMock()
  })

  it('rejects callers without an Enterprise plan', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled.mockResolvedValue(false)
    const res = await POST(request(OIDC_BODY))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'SSO requires an Enterprise plan' })
  })

  it('rejects callers who are not an admin/owner of the target org', async () => {
    queueMembers([{ organizationId: 'org1', role: 'member' }])
    const res = await POST(request(OIDC_BODY))
    expect(res.status).toBe(403)
  })

  it('rejects configuring org SSO for a domain the org has not verified', async () => {
    resetDbChainMock()
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueTableRows(schemaMock.ssoDomain, []) // no verified sso_domain row
    const res = await POST(request(OIDC_BODY))
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe('SSO_DOMAIN_NOT_VERIFIED')
  })

  it('re-checks verification before the write and 403s if it was revoked mid-registration', async () => {
    resetDbChainMock()
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueTableRows(schemaMock.ssoDomain, [{ id: 'v' }]) // entry gate: verified
    queueTableRows(schemaMock.ssoDomain, []) // re-check before write: revoked
    const res = await POST(request(OIDC_BODY))
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe('SSO_DOMAIN_NOT_VERIFIED')
  })

  it('rejects a domain already registered by another organization', async () => {
    queueMembers([{ organizationId: 'org-attacker', role: 'owner' }])
    queueProviders([{ domain: 'acme.com', userId: 'u-victim', organizationId: 'org-victim' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org-attacker' }))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.code).toBe('SSO_DOMAIN_ALREADY_REGISTERED')
  })

  /**
   * Better Auth scopes providerId uniqueness globally, not per tenant, and would
   * otherwise reject this with an opaque 422 that reads like a bug. Sim catches
   * it first and returns a 409 naming a free id.
   */
  it('rejects a providerId already taken by another organization', async () => {
    queueMembers([{ organizationId: 'org-b', role: 'owner' }])
    queueProviders([], [{ domain: 'other.com', userId: 'u-other', organizationId: 'org-other' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org-b' }))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.code).toBe('SSO_PROVIDER_ID_TAKEN')
  })

  it('suggests a free, domain-scoped providerId when the requested one is taken', async () => {
    queueMembers([{ organizationId: 'org-b', role: 'owner' }])
    queueProviders([], [{ domain: 'other.com', userId: 'u-other', organizationId: 'org-other' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org-b' }))
    const json = await res.json()
    expect(json.error).toContain('acme-oidc-acme')
  })

  /**
   * An org-less provider has no `sso_domain` proof behind its domain, and domain
   * trust is what auto-links an SSO sign-in into an existing same-email account,
   * so the route refuses one before any write.
   */
  it('refuses a provider without an organization', async () => {
    const { orgId: _orgId, ...orgLessBody } = OIDC_BODY
    const res = await POST(request(orgLessBody))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Organization ID is required')
  })

  it("refuses a second provider on a domain the caller's own org-less provider signs in", async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([
      { domain: 'acme.com', userId: 'u1', organizationId: null, providerId: 'acme-personal' },
    ])
    const res = await POST(request(OIDC_BODY))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'SSO_DOMAIN_ALREADY_ROUTED' })
  })

  it("still blocks an org admin from claiming another user's user-scoped domain", async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([{ domain: 'acme.com', userId: 'someone-else', organizationId: null }])
    const res = await POST(request(OIDC_BODY))
    expect(res.status).toBe(409)
  })
})
