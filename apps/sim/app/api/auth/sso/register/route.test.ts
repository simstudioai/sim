/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  resetEnvMock,
  schemaMock,
  setEnv,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockRegisterSSOProvider,
  mockUpdateSSOProvider,
  mockHasSSOAccess,
  mockValidateUrlWithDNS,
  mockSecureFetchWithPinnedIP,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRegisterSSOProvider: vi.fn(),
  mockUpdateSSOProvider: vi.fn(),
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

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
  auth: {
    api: {
      registerSSOProvider: mockRegisterSSOProvider,
      updateSSOProvider: mockUpdateSSOProvider,
    },
  },
}))

vi.mock('@/lib/billing', () => ({
  hasSSOAccess: mockHasSSOAccess,
}))

vi.mock('@sim/utils/sso-domain', () => ({
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
    /**
     * The route gates on the resolved `isSsoEnabled` rather than the raw env
     * var, so the suite switch (`ENTERPRISE_ENABLED`) can register SSO too.
     */
    setEnvFlags({ isSsoEnabled: true })
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    mockHasSSOAccess.mockResolvedValue(true)
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '1.2.3.4' })
    mockSecureFetchWithPinnedIP.mockRejectedValue(new Error('discovery not mocked for this test'))
    mockRegisterSSOProvider.mockResolvedValue({ id: 'row-1', providerId: 'acme-oidc' })
    mockUpdateSSOProvider.mockResolvedValue({ providerId: 'acme-oidc' })
    // The trust UPDATE reports the row it matched; by default the provider exists.
    dbChainMockFns.returning.mockResolvedValue([{ id: 'provider-row' }])
    // Default: the org has already verified the domain, so the ownership gate
    // passes and each test exercises the logic beyond it. A successful org-scoped
    // registration reads it three times: the fail-fast entry gate, the
    // authoritative re-check before the write, and the locking read inside the
    // trust transaction. Gate-specific tests reset the queue to assert the
    // unverified paths.
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

  it('re-checks verification before the write and 403s if it was revoked mid-registration', async () => {
    resetDbChainMock()
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueTableRows(schemaMock.ssoDomain, [{ id: 'v' }]) // entry gate: verified
    queueTableRows(schemaMock.ssoDomain, []) // re-check before write: revoked
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe('SSO_DOMAIN_NOT_VERIFIED')
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('rolls back the newly-created provider if verification is revoked after the write', async () => {
    resetDbChainMock()
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueTableRows(schemaMock.ssoDomain, [{ id: 'v' }]) // entry gate: verified
    queueTableRows(schemaMock.ssoDomain, [{ id: 'v' }]) // pre-write re-check: verified
    queueTableRows(schemaMock.ssoDomain, []) // locking read in the grant: proof gone
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe('SSO_DOMAIN_NOT_VERIFIED')
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1) // it was created…
    expect(dbChainMockFns.delete).toHaveBeenCalled() // …then rolled back
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
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
  })

  it('suggests a free, domain-scoped providerId when the requested one is taken', async () => {
    queueMembers([{ organizationId: 'org-b', role: 'owner' }])
    queueProviders([], [{ domain: 'other.com', userId: 'u-other', organizationId: 'org-other' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org-b' }))
    const json = await res.json()
    expect(json.error).toContain('acme-oidc-acme')
  })

  it('does not treat the caller’s own provider as a providerId conflict', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([], [{ domain: 'acme.com', userId: 'u1', organizationId: 'org1' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
  })

  /**
   * Better Auth's `isTrustedProvider` reads this flag, and it is the only thing
   * that lets an SSO sign-in link to a pre-existing same-email account once the
   * plugin stopped honouring `trustedProviders` for SSO. `registerSSOProvider`
   * always persists `false`, so the route must set it after the write.
   */
  it('marks the provider domain-verified after registering', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ domainVerified: true })
  })

  /** updateSSOProvider resets domainVerified to false whenever the domain changes. */
  it('re-marks the provider domain-verified after an update', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([])
    queueTableRows(schemaMock.ssoProvider, [{ id: 'p1' }])
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    expect(mockUpdateSSOProvider).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ domainVerified: true })
  })

  /**
   * The create path rolls the provider back when verification is revoked during the
   * write. The update path has no new row to delete, so it restores the pre-update
   * config and clears the trust flag together. Clearing alone would leave the
   * rejected config stored, and re-verifying the domain regrants trust
   * automatically — silently activating a config the caller was told had failed.
   */
  it('reverts the config and revokes trust when verification is removed mid-update', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    resetDbChainMock()
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueTableRows(schemaMock.ssoDomain, [{ id: 'v' }]) // entry gate
    queueTableRows(schemaMock.ssoDomain, [{ id: 'v' }]) // pre-write re-check
    queueTableRows(schemaMock.ssoDomain, []) // locking read in the grant: proof gone
    queueProviders([])
    queueTableRows(schemaMock.ssoProvider, [
      {
        id: 'p1',
        issuer: 'https://old-issuer.example.com',
        domain: 'acme.com',
        oidcConfig: '{"stored":"oidc"}',
        samlConfig: null,
      },
    ]) // provider already owned → update path

    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(403)
    expect(mockUpdateSSOProvider).toHaveBeenCalledTimes(1)
    // The conditional grant UPDATE is still issued — it simply matches no rows once
    // the proof is gone — so the signal is the restoring write plus the 403.
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      issuer: 'https://old-issuer.example.com',
      domain: 'acme.com',
      oidcConfig: '{"stored":"oidc"}',
      samlConfig: null,
      domainVerified: false,
    })
  })

  it('does not mark domain-verified when the registration is rolled back', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    resetDbChainMock()
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueTableRows(schemaMock.ssoDomain, [{ id: 'verified-domain' }])
    queueTableRows(schemaMock.ssoDomain, [{ id: 'verified-domain' }])
    queueTableRows(schemaMock.ssoDomain, []) // locking read in the grant: proof gone
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(403)
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1) // it was created…
    expect(dbChainMockFns.delete).toHaveBeenCalled() // …then rolled back
  })

  /**
   * A personal provider has no verified domain behind it. On the hosted
   * multi-tenant deployment that must grant no linking authority, or anyone able
   * to register one could claim a domain they do not own and have their own IdP
   * auto-link to existing accounts on it.
   */
  it('does not grant domain trust to a personal provider when hosted', async () => {
    setEnvFlags({ isSsoEnabled: true, isHosted: true })
    const res = await POST(request(OIDC_BODY))
    expect(res.status).toBe(200)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ domainVerified: false })
  })

  it('grants domain trust to a personal provider when self-hosted', async () => {
    setEnvFlags({ isSsoEnabled: true, isHosted: false })
    const res = await POST(request(OIDC_BODY))
    expect(res.status).toBe(200)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ domainVerified: true })
  })

  /**
   * Better Auth merges SAML config with `??`, so dropping an empty identifierFormat
   * would silently retain a previously stored NameID format while the admin had
   * selected the provider default.
   */
  it('forwards an empty SAML identifierFormat so the provider default can be restored', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([])
    await POST(
      request({
        providerType: 'saml',
        providerId: 'acme-saml',
        issuer: 'https://idp.acme.com',
        domain: 'acme.com',
        orgId: 'org1',
        entryPoint: 'https://idp.acme.com/sso',
        cert: 'CERT',
        identifierFormat: '',
      })
    )
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1)
    const sent = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(sent.samlConfig).toHaveProperty('identifierFormat', '')
  })

  /**
   * Persisting generated IdP metadata made re-saving destructive: the form loaded
   * it back, resent it, and it then won over the certificate — so rotating a SAML
   * cert through the form silently did nothing.
   */
  it('writes empty IdP metadata when the admin supplied none, so a stored one clears', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([])
    await POST(
      request({
        providerType: 'saml',
        providerId: 'acme-saml',
        issuer: 'https://idp.acme.com',
        domain: 'acme.com',
        orgId: 'org1',
        entryPoint: 'https://idp.acme.com/sso',
        cert: 'ORIGINAL-CERT',
      })
    )
    const sent = mockRegisterSSOProvider.mock.calls[0][0].body
    // Written as empty rather than omitted: Better Auth merges with `??`, so an
    // omitted key would retain a previously stored document on update.
    expect(sent.samlConfig.idpMetadata).toEqual({ metadata: '' })
    expect(sent.samlConfig.cert).toBe('ORIGINAL-CERT')
  })

  it('persists IdP metadata the admin did supply', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([])
    await POST(
      request({
        providerType: 'saml',
        providerId: 'acme-saml',
        issuer: 'https://idp.acme.com',
        domain: 'acme.com',
        orgId: 'org1',
        entryPoint: 'https://idp.acme.com/sso',
        cert: 'CERT',
        idpMetadata: '<EntityDescriptor>supplied</EntityDescriptor>',
      })
    )
    const sent = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(sent.samlConfig.idpMetadata).toEqual({
      metadata: '<EntityDescriptor>supplied</EntityDescriptor>',
    })
  })

  it('nests the attribute mapping inside oidcConfig (Better Auth reads it there)', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    await POST(
      request({ ...OIDC_BODY, orgId: 'org1', mapping: { id: 'oid', email: 'upn', name: 'name' } })
    )
    expect(mockRegisterSSOProvider).toHaveBeenCalledTimes(1)
    const sent = mockRegisterSSOProvider.mock.calls[0][0].body
    expect(sent.mapping).toBeUndefined() // not passed at the top level (silently ignored there)
    expect(sent.oidcConfig.mapping).toMatchObject({ id: 'oid', email: 'upn', name: 'name' })
  })

  it('routes an edit of an existing owned provider through updateSSOProvider', async () => {
    queueMembers([{ organizationId: 'org1', role: 'owner' }])
    queueProviders([]) // no providerId or domain conflicts on either pass
    queueTableRows(schemaMock.ssoProvider, [{ id: 'p1' }]) // provider already owned → edit
    const res = await POST(request({ ...OIDC_BODY, orgId: 'org1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toContain('updated')
    expect(mockUpdateSSOProvider).toHaveBeenCalledTimes(1)
    expect(mockRegisterSSOProvider).not.toHaveBeenCalled()
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
