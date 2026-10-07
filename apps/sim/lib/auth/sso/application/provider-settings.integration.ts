import { envFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { generateId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

/** Exercises provider writes, tenant grants, and sign-in routing against real PostgreSQL. */
describe('Organization SSO administration through API credentials', () => {
  const organizationId = generateId()
  const userId = generateId()
  const outsiderId = generateId()
  const suffix = generateId().slice(0, 8)
  const domain = `sso-${suffix}.test`
  const providerId = `saml-${suffix}`
  const apiKeyValue = `sk-sim-${generateId()}`
  const principal = { kind: 'personal_api_key' as const, userId, keyId: generateId() }
  let runtime: Awaited<ReturnType<typeof loadRuntime>>

  async function loadRuntime() {
    const [{ db }, schema, { and, eq, inArray, sql }, providers, requirements, primary] =
      await Promise.all([
        import('@sim/db'),
        import('@sim/db/schema'),
        import('drizzle-orm'),
        import('@/lib/auth/sso/application/provider-settings'),
        import('@/lib/auth/sso/application/sso-requirement'),
        import('@/lib/auth/sso/application/set-primary-provider'),
      ])
    const { saveSsoProvider } = await import('@/lib/auth/sso/application/provider-registration')
    const { presentSsoProvider } = await import('@/lib/api/server/sso-presenters')
    const domainSettings = await import('@/lib/organizations/application/domain-settings')
    const keyCrypto = await import('@/lib/api-key/crypto')
    const apiProviders = await import(
      '@/app/api/v2/organizations/[organizationId]/sso/providers/route'
    )
    return {
      db,
      schema,
      and,
      eq,
      inArray,
      sql,
      ...providers,
      ...requirements,
      ...primary,
      saveSsoProvider,
      presentSsoProvider,
      domainSettings,
      keyCrypto,
      apiProviders,
    }
  }

  beforeAll(async () => {
    setEnvFlags({ isSsoEnabled: true, isBillingEnabled: false, isOrganizationsEnabled: true })
    runtime = await loadRuntime()
    const { db, schema } = runtime
    await db.insert(schema.user).values(
      [userId, outsiderId].map((id) => ({
        id,
        name: id,
        email: `${id}@${domain}`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await db.insert(schema.apiKey).values({
      id: principal.keyId,
      userId,
      name: 'SSO integration',
      key: (await runtime.keyCrypto.encryptApiKey(apiKeyValue)).encrypted,
      keyHash: runtime.keyCrypto.hashApiKey(apiKeyValue),
      type: 'personal',
    })
    await db.insert(schema.organization).values({
      id: organizationId,
      name: 'SSO test',
      slug: organizationId,
      createdAt: new Date(),
    })
    await db.insert(schema.member).values({
      id: generateId(),
      userId,
      organizationId,
      role: 'owner',
      createdAt: new Date(),
    })
    await db.insert(schema.ssoDomain).values({
      id: generateId(),
      organizationId,
      domain,
      status: 'verified',
      verificationToken: generateId(),
      verifiedAt: new Date(),
    })
  }, 60_000)

  beforeEach(async () => {
    const { db, schema, and, eq } = runtime
    await db.delete(schema.ssoProvider).where(eq(schema.ssoProvider.organizationId, organizationId))
    await db
      .update(schema.ssoDomain)
      .set({ primaryProviderId: null })
      .where(eq(schema.ssoDomain.organizationId, organizationId))
    await db
      .delete(schema.ssoDomain)
      .where(
        and(
          eq(schema.ssoDomain.organizationId, organizationId),
          eq(schema.ssoDomain.domain, `aaa-pending-${suffix}.test`)
        )
      )
    await db
      .delete(schema.member)
      .where(
        and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, outsiderId))
      )
    await db
      .update(schema.organization)
      .set({ requireSso: false })
      .where(eq(schema.organization.id, organizationId))
  })

  afterAll(async () => {
    if (!runtime) return
    const { db, schema, eq, inArray } = runtime
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId))
    await db.delete(schema.user).where(inArray(schema.user.id, [userId, outsiderId]))
  })

  const config = () => ({
    organizationId,
    providerId,
    providerType: 'saml' as const,
    issuer: `https://idp.${domain}`,
    domain,
    entryPoint: `https://idp.${domain}/sso`,
    cert: 'test signing certificate',
    mapping: { id: 'sub', email: 'email', name: 'name', image: 'picture' },
    jitProvisioningEnabled: true,
  })

  const oidcConfig = () => ({
    organizationId,
    providerId,
    providerType: 'oidc' as const,
    issuer: 'https://idp.example.com',
    domain,
    clientId: 'initial-client',
    clientSecret: 'initial-secret',
    authorizationEndpoint: 'https://idp.example.com/authorize',
    tokenEndpoint: 'https://idp.example.com/token',
    jwksEndpoint: 'https://idp.example.com/jwks',
    userInfoEndpoint: 'https://idp.example.com/userinfo',
    mapping: config().mapping,
    scopes: ['openid', 'email'],
    pkce: true,
    skipUserInfoEndpoint: false,
    jitProvisioningEnabled: true,
  })

  it('creates and edits a provider without minting a browser session, then deletes it', async () => {
    const { db, schema, eq } = runtime
    const created = await runtime.saveSsoProvider.execute({ principal, input: config() })
    expect(created).toMatchObject({ providerId, created: true })
    const edited = await runtime.saveSsoProvider.execute({
      principal,
      input: { ...config(), cert: 'rotated signing certificate' },
    })
    expect(edited.created).toBe(false)
    const [row] = await db
      .select()
      .from(schema.ssoProvider)
      .where(eq(schema.ssoProvider.providerId, providerId))
    expect(row).toMatchObject({ userId, organizationId, domainVerified: true })
    expect(JSON.parse(row.samlConfig ?? '{}').cert).toBe('rotated signing certificate')
    expect(
      await db.select().from(schema.session).where(eq(schema.session.userId, userId))
    ).toHaveLength(0)
    await runtime.deleteSsoProvider.execute({ principal, input: { organizationId, providerId } })
    expect(
      await db
        .select()
        .from(schema.ssoProvider)
        .where(eq(schema.ssoProvider.providerId, providerId))
    ).toHaveLength(0)
  })

  it('refuses unverified domains and conceals organizations from outsiders', async () => {
    await expect(
      runtime.saveSsoProvider.execute({
        principal,
        input: { ...config(), domain: `unverified-${suffix}.test` },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      runtime.saveSsoProvider.execute({
        principal: { ...principal, userId: outsiderId },
        input: config(),
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('removes a newly registered provider when its domain-trust write fails', async () => {
    const { db, schema, sql, eq } = runtime
    const constraint = sql.identifier(`sso-trust-failure-${suffix}`)
    await db.execute(
      sql`ALTER TABLE ${schema.ssoProvider} ADD CONSTRAINT ${constraint} CHECK (NOT domain_verified) NOT VALID`
    )
    try {
      await expect(
        runtime.saveSsoProvider.execute({ principal, input: config() })
      ).rejects.toMatchObject({ cause: { code: '23514' } })
      expect(
        await db
          .select()
          .from(schema.ssoProvider)
          .where(eq(schema.ssoProvider.providerId, providerId))
      ).toHaveLength(0)
    } finally {
      await db.execute(sql`ALTER TABLE ${schema.ssoProvider} DROP CONSTRAINT ${constraint}`)
    }
  })

  it('preserves plugin validation and linked-account identity boundaries for API writes', async () => {
    await expect(
      runtime.saveSsoProvider.execute({
        principal,
        input: { ...config(), providerId: 'credential' },
      })
    ).rejects.toMatchObject({ statusCode: 422 })
    await expect(
      runtime.saveSsoProvider.execute({
        principal,
        input: { ...config(), signatureAlgorithm: 'invalid-algorithm' },
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      runtime.saveSsoProvider.execute({
        principal,
        input: { ...config(), idpMetadata: 'é'.repeat(60_000) },
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    await runtime.saveSsoProvider.execute({ principal, input: config() })
    const { db, schema, eq } = runtime
    const accountId = generateId()
    await db.insert(schema.account).values({
      id: accountId,
      accountId: 'linked-identity',
      providerId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    try {
      for (const changes of [
        { issuer: `https://other.${domain}` },
        { entryPoint: `https://other.${domain}/sso` },
        { mapping: { ...config().mapping, id: 'different-subject' } },
        { idpMetadata: '<EntityDescriptor entityID="different-provider"/>' },
      ]) {
        await expect(
          runtime.saveSsoProvider.execute({ principal, input: { ...config(), ...changes } })
        ).rejects.toMatchObject({ statusCode: 409 })
        const [row] = await db
          .select()
          .from(schema.ssoProvider)
          .where(eq(schema.ssoProvider.providerId, providerId))
        expect(row.issuer).toBe(config().issuer)
        expect(JSON.parse(row.samlConfig ?? '{}')).toMatchObject({
          entryPoint: config().entryPoint,
          mapping: { id: 'sub' },
          idpMetadata: { metadata: '' },
        })
      }
      await runtime.saveSsoProvider.execute({
        principal,
        input: { ...config(), cert: 'rotated linked certificate' },
      })
      const [rotated] = await db
        .select()
        .from(schema.ssoProvider)
        .where(eq(schema.ssoProvider.providerId, providerId))
      expect(JSON.parse(rotated.samlConfig ?? '{}').cert).toBe('rotated linked certificate')
    } finally {
      await db.delete(schema.account).where(eq(schema.account.id, accountId))
    }
  })

  it('keeps OIDC identity stable for linked accounts while allowing secret rotation and redacted re-saves', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockRejectedValue(
      new Error('Fixture supplies all OIDC endpoints')
    )
    const oidc = oidcConfig()
    await runtime.saveSsoProvider.execute({ principal, input: oidc })
    const { db, schema, eq } = runtime
    const accountId = generateId()
    await db.insert(schema.account).values({
      id: accountId,
      accountId: 'linked-oidc-identity',
      providerId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    try {
      for (const changes of [
        { clientId: 'other-client' },
        { jwksEndpoint: 'https://other.example.com/jwks' },
        { tokenEndpoint: 'https://other.example.com/token' },
        { authorizationEndpoint: 'https://other.example.com/authorize' },
        { userInfoEndpoint: 'https://other.example.com/userinfo' },
        { mapping: { ...oidc.mapping, id: 'other-subject' } },
      ]) {
        await expect(
          runtime.saveSsoProvider.execute({ principal, input: { ...oidc, ...changes } })
        ).rejects.toMatchObject({ statusCode: 409 })
        const [stored] = await db
          .select()
          .from(schema.ssoProvider)
          .where(eq(schema.ssoProvider.providerId, providerId))
        expect(JSON.parse(stored.oidcConfig ?? '{}')).toMatchObject({
          clientId: oidc.clientId,
          clientSecret: oidc.clientSecret,
          jwksEndpoint: oidc.jwksEndpoint,
          tokenEndpoint: oidc.tokenEndpoint,
          authorizationEndpoint: oidc.authorizationEndpoint,
          userInfoEndpoint: oidc.userInfoEndpoint,
          mapping: { id: 'sub' },
        })
      }
      await runtime.saveSsoProvider.execute({
        principal,
        input: { ...oidc, clientSecret: 'rotated-secret' },
      })
      const provider = await runtime.getSsoProvider.execute({
        principal,
        input: { organizationId, providerId },
      })
      const projected = runtime.presentSsoProvider(provider)
      expect(JSON.parse(projected.oidcConfig ?? '{}').clientSecret).toBe('[REDACTED]')
      await runtime.saveSsoProvider.execute({
        principal,
        input: { ...oidc, clientSecret: '[REDACTED]' },
      })
      const [stored] = await db
        .select()
        .from(schema.ssoProvider)
        .where(eq(schema.ssoProvider.providerId, providerId))
      expect(JSON.parse(stored.oidcConfig ?? '{}').clientSecret).toBe('rotated-secret')
    } finally {
      await db.delete(schema.account).where(eq(schema.account.id, accountId))
    }
  })

  it('refuses a provider write when organization administrator access is revoked during discovery', async () => {
    const { db, schema, and, eq } = runtime
    const membership = and(
      eq(schema.member.organizationId, organizationId),
      eq(schema.member.userId, userId)
    )
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockImplementation(async () => {
      await db.update(schema.member).set({ role: 'member' }).where(membership)
      throw new Error('Discovery unavailable after membership changed')
    })
    try {
      await expect(
        runtime.saveSsoProvider.execute({ principal, input: oidcConfig() })
      ).rejects.toMatchObject({ detailCode: 'ORGANIZATION_ADMIN_REQUIRED' })
      expect(
        await db
          .select()
          .from(schema.ssoProvider)
          .where(eq(schema.ssoProvider.organizationId, organizationId))
      ).toHaveLength(0)
    } finally {
      await db.update(schema.member).set({ role: 'owner' }).where(membership)
      inputValidationMockFns.mockSecureFetchWithPinnedIP.mockRejectedValue(
        new Error('Fixture supplies all OIDC endpoints')
      )
    }
  })

  it('enforces the acting user’s provider ceiling and still allows existing configurations to be edited', async () => {
    for (let index = 0; index < 10; index++) {
      await runtime.saveSsoProvider.execute({
        principal,
        input: { ...config(), providerId: `limit-${suffix}-${index}` },
      })
    }
    await expect(
      runtime.saveSsoProvider.execute({ principal, input: config() })
    ).rejects.toMatchObject({ statusCode: 403 })
    await runtime.saveSsoProvider.execute({
      principal,
      input: { ...config(), providerId: `limit-${suffix}-0`, cert: 'rotated at limit' },
    })
    const { db, schema, eq } = runtime
    const providers = await db
      .select()
      .from(schema.ssoProvider)
      .where(eq(schema.ssoProvider.organizationId, organizationId))
    expect(providers).toHaveLength(10)
    expect(
      providers.find((provider) => provider.providerId === `limit-${suffix}-0`)?.samlConfig
    ).toContain('rotated at limit')
  })

  it('allows API administration of the primary provider and requirement while rejecting mismatched organization assertions', async () => {
    await runtime.saveSsoProvider.execute({ principal, input: config() })
    await runtime.setPrimarySsoProvider.execute({
      principal,
      input: { providerId, assertedOrganizationId: organizationId },
    })
    await runtime.setSsoRequirement.execute({
      principal,
      input: { organizationId, requireSso: true },
    })
    expect(
      await runtime.readSsoRequirement.execute({ principal, input: { organizationId } })
    ).toMatchObject({ requireSso: true, isEnforced: true, hasVerifiedProvider: true })
    await expect(
      runtime.setPrimarySsoProvider.execute({
        principal,
        input: { providerId, assertedOrganizationId: generateId() },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('keeps primary selection stable across pages and omits nested private keys', async () => {
    await runtime.saveSsoProvider.execute({ principal, input: config() })
    await runtime.setPrimarySsoProvider.execute({
      principal,
      input: { providerId, assertedOrganizationId: organizationId },
    })
    const otherId = `aaa-${suffix}`
    await runtime.saveSsoProvider.execute({
      principal,
      input: { ...config(), providerId: otherId },
    })
    const { db, schema, eq } = runtime
    await db
      .update(schema.ssoProvider)
      .set({
        samlConfig: JSON.stringify({
          cert: 'public-certificate',
          privateKey: 'root-secret',
          decryptionPvk: 'decrypt-secret',
          spMetadata: {
            metadata: '<xml/>',
            privateKey: 'nested-secret',
            privateKeyPass: 'password-secret',
          },
        }),
      })
      .where(eq(schema.ssoProvider.providerId, otherId))
    const first = await runtime.listSsoProviders.execute({
      principal,
      input: { organizationId, limit: 1, sortBy: 'providerId', sortOrder: 'asc' },
    })
    expect(first.providers.map((provider) => [provider.providerId, provider.isPrimary])).toEqual([
      [otherId, false],
    ])
    const second = await runtime.listSsoProviders.execute({
      principal,
      input: {
        organizationId,
        limit: 1,
        sortBy: 'providerId',
        sortOrder: 'asc',
        cursorKeys: first.nextCursorKeys ?? undefined,
      },
    })
    expect(second.providers.map((provider) => [provider.providerId, provider.isPrimary])).toEqual([
      [providerId, true],
    ])
    expect(second.nextCursorKeys).toBeNull()
    const presented = runtime.presentSsoProvider(first.providers[0])
    expect(presented.samlConfig).not.toContain('secret')
    expect(JSON.parse(presented.samlConfig ?? '{}')).toMatchObject({
      cert: 'public-certificate',
      spMetadata: { metadata: '<xml/>' },
    })
  })

  it('refuses workspace keys and expired or insufficient OAuth grants before resource lookup', async () => {
    const input = { ...config(), organizationId: generateId() }
    await expect(
      runtime.saveSsoProvider.execute({
        principal: { kind: 'workspace_api_key', keyId: generateId(), workspaceId: generateId() },
        input,
      })
    ).rejects.toMatchObject({ detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED' })
    const token = {
      kind: 'oauth_access_token' as const,
      userId,
      tokenId: generateId(),
      clientId: 'integration-client',
      scopes: ['api:read'],
      expiresAt: new Date(Date.now() + 60_000),
    }
    await expect(
      runtime.saveSsoProvider.execute({ principal: token, input })
    ).rejects.toMatchObject({ detailCode: 'INSUFFICIENT_SCOPE' })
    await expect(
      runtime.saveSsoProvider.execute({
        principal: { ...token, scopes: ['api:write'], expiresAt: new Date(0) },
        input,
      })
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('authenticates a real API key and returns the public create and paginated-read envelopes', async () => {
    await runtime.saveSsoProvider.execute({ principal, input: config() })
    const publicProviderId = `api-${suffix}`
    const url = `http://localhost/api/v2/organizations/${organizationId}/sso/providers`
    const context = { params: Promise.resolve({ organizationId }) }
    const body = { ...omit(config(), ['organizationId']), providerId: publicProviderId }
    const response = await runtime.apiProviders.POST(
      new NextRequest(url, {
        method: 'POST',
        headers: {
          'x-api-key': apiKeyValue,
          'x-forwarded-for': '127.0.0.1',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
      context
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      data: { providerId: publicProviderId, providerType: 'saml', created: true },
    })
    const page = await runtime.apiProviders.GET(
      new NextRequest(`${url}?limit=1`, {
        headers: { 'x-api-key': apiKeyValue, 'x-forwarded-for': '127.0.0.1' },
      }),
      context
    )
    expect(page.status).toBe(200)
    const pageBody = await page.json()
    expect(pageBody.data).toHaveLength(1)
    expect(pageBody.nextCursor).toBeTypeOf('string')
    const changedScope = await runtime.apiProviders.GET(
      new NextRequest(
        `${url}?limit=1&sortOrder=desc&cursor=${encodeURIComponent(pageBody.nextCursor)}`,
        { headers: { 'x-api-key': apiKeyValue, 'x-forwarded-for': '127.0.0.1' } }
      ),
      context
    )
    expect(changedScope.status).toBe(400)
    expect(await changedScope.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } })
  })

  it('paginates domain claims and keeps pending DNS challenges restricted to current administrators', async () => {
    const { db, schema } = runtime
    const pendingDomain = `aaa-pending-${suffix}.test`
    await db.insert(schema.ssoDomain).values({
      id: generateId(),
      organizationId,
      domain: pendingDomain,
      status: 'pending',
      verificationToken: 'pending-test-challenge',
    })
    await db.insert(schema.member).values({
      id: generateId(),
      userId: outsiderId,
      organizationId,
      role: 'member',
      createdAt: new Date(),
    })
    const input = { organizationId, limit: 1, sortBy: 'domain' as const, sortOrder: 'asc' as const }
    const first = await runtime.domainSettings.listOrganizationDomains.execute({ principal, input })
    expect(first.domains).toHaveLength(1)
    expect(first.domains[0]).toMatchObject({
      domain: pendingDomain,
      verificationToken: 'pending-test-challenge',
    })
    const second = await runtime.domainSettings.listOrganizationDomains.execute({
      principal,
      input: { ...input, cursorKeys: first.nextCursorKeys ?? undefined },
    })
    expect(second.domains.map((claim) => claim.domain)).toEqual([domain])
    expect(second.nextCursorKeys).toBeNull()
    const memberRead = await runtime.domainSettings.listOrganizationDomains.execute({
      principal: { ...principal, userId: outsiderId },
      input,
    })
    expect(memberRead.domains[0].verificationToken).toBeNull()
  })
})
