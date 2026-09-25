import { setEnvFlags } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { NextRequest } from 'next/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockRegisterSSOProvider } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRegisterSSOProvider: vi.fn(),
}))

/** Better Auth's registration is replaced by the row it writes, untrusted until the route grants it. */
vi.mock('@/lib/core/config/env-flags', async () => (await import('@sim/testing')).envFlagsMock)
vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
  auth: { api: { registerSSOProvider: mockRegisterSSOProvider, updateSSOProvider: vi.fn() } },
}))
vi.mock('@/lib/billing', () => ({ hasSSOAccess: vi.fn(async () => true) }))
/** Identity provider endpoints are validated by DNS, which test hosts do not have. */
vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: vi.fn(async () => ({ isValid: true, resolvedIP: '203.0.113.10' })),
  secureFetchWithPinnedIP: vi.fn(async () => {
    throw new Error('Discovery is not used when endpoints are given')
  }),
}))
/** Admission is per address or user and is not what this suite proves. */
vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = vi.fn(async () => ({ allowed: true, remaining: 1, resetAt: new Date() }))
  },
  enforceIpRateLimit: vi.fn(async () => null),
  enforceUserRateLimit: vi.fn(async () => null),
}))

const databaseUrl = process.env.TEST_DATABASE_URL

async function loadRuntime() {
  const [
    { db },
    schema,
    { and, eq, inArray },
    resolveRoute,
    listRoute,
    providerRoute,
    registerRoute,
  ] = await Promise.all([
    import('@sim/db'),
    import('@sim/db/schema'),
    import('drizzle-orm'),
    import('@/app/api/auth/sso/resolve/route'),
    import('@/app/api/auth/sso/providers/route'),
    import('@/app/api/auth/sso/providers/[providerId]/route'),
    import('@/app/api/auth/sso/register/route'),
  ])
  return {
    db,
    schema,
    and,
    eq,
    inArray,
    resolve: (request: NextRequest) => resolveRoute.POST(request, {}),
    list: (request: NextRequest) => listRoute.GET(request, {}),
    patch: providerRoute.PATCH,
    remove: providerRoute.DELETE,
    register: (request: NextRequest) => registerRoute.POST(request, {}),
  }
}

describe.skipIf(!databaseUrl)('Primary SSO provider per organization domain in PostgreSQL', () => {
  let runtime: Awaited<ReturnType<typeof loadRuntime>>
  let organizationId: string
  let otherOrganizationId: string
  let userId: string
  let suffix: string

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl
    runtime = await loadRuntime()
  }, 30_000)

  beforeEach(async () => {
    const { db, schema } = runtime
    suffix = generateId().slice(0, 8)
    organizationId = generateId()
    otherOrganizationId = generateId()
    userId = generateId()
    const now = new Date()
    await db.insert(schema.user).values({
      id: userId,
      name: 'Primary provider test',
      email: `${userId}@primary-provider.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(schema.organization).values(
      [organizationId, otherOrganizationId].map((id) => ({
        id,
        name: 'Primary provider test',
        slug: id,
        createdAt: now,
      }))
    )
    await db
      .insert(schema.member)
      .values({ id: generateId(), userId, organizationId, role: 'owner', createdAt: now })
    mockGetSession.mockResolvedValue({ user: { id: userId }, session: { id: generateId() } })
    setEnvFlags({ isSsoEnabled: true })
    mockRegisterSSOProvider.mockImplementation(
      async ({ body }: { body: { providerId: string; issuer: string; domain: string } }) => {
        const rowId = generateId()
        await runtime.db.insert(runtime.schema.ssoProvider).values({
          id: rowId,
          issuer: body.issuer,
          domain: body.domain,
          userId,
          providerId: body.providerId,
          organizationId,
          oidcConfig: '{}',
          domainVerified: false,
        })
        return { id: rowId, providerId: body.providerId }
      }
    )
  })

  afterEach(async () => {
    const { db, schema, eq, inArray } = runtime
    await db
      .delete(schema.ssoProvider)
      .where(inArray(schema.ssoProvider.organizationId, [organizationId, otherOrganizationId]))
    await db
      .delete(schema.organization)
      .where(inArray(schema.organization.id, [organizationId, otherOrganizationId]))
    await db.delete(schema.user).where(eq(schema.user.id, userId))
  })

  /** The domain every provider in a test shares, unique per test so runs never collide. */
  const domain = () => `acme-${suffix}.test`
  const id = (name: string) => `${name}-${suffix}`

  async function insertDomain(
    options: { status?: string; organization?: string; name?: string } = {}
  ) {
    const { db, schema } = runtime
    const status = options.status ?? 'verified'
    await db.insert(schema.ssoDomain).values({
      id: generateId(),
      organizationId: options.organization ?? organizationId,
      domain: options.name ?? domain(),
      status,
      verificationToken: generateId(),
      verifiedAt: status === 'verified' ? new Date() : null,
    })
  }

  async function insertProvider(options: {
    name: string
    organization?: string | null
    domainVerified?: boolean
    providerDomain?: string
  }) {
    const { db, schema } = runtime
    await db.insert(schema.ssoProvider).values({
      id: generateId(),
      issuer: `https://${options.name}.idp.test`,
      domain: options.providerDomain ?? domain(),
      userId,
      providerId: id(options.name),
      organizationId: options.organization === undefined ? organizationId : options.organization,
      oidcConfig: '{}',
      domainVerified: options.domainVerified ?? true,
    })
  }

  async function signInProvider(providerId?: string) {
    const response = await runtime.resolve(
      new NextRequest('https://test.sim.ai/api/auth/sso/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `ada@${domain()}`, ...(providerId ? { providerId } : {}) }),
      })
    )
    const body = await response.json()
    return response.status === 200 ? (body.providerId as string) : response.status
  }

  /** The providers the list route marks primary. */
  async function listedPrimaries() {
    const response = await runtime.list(
      new NextRequest(`https://test.sim.ai/api/auth/sso/providers?organizationId=${organizationId}`)
    )
    const { providers } = (await response.json()) as {
      providers: Array<{ providerId: string; isPrimary?: boolean }>
    }
    return providers.filter((provider) => provider.isPrimary).map((provider) => provider.providerId)
  }

  const context = (providerId: string) => ({ params: Promise.resolve({ providerId }) })

  async function makePrimary(name: string) {
    const response = await runtime.patch(
      new NextRequest(`https://test.sim.ai/api/auth/sso/providers/${id(name)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isPrimary: true }),
      }),
      context(id(name))
    )
    return response.status
  }

  async function deleteProvider(name: string) {
    const response = await runtime.remove(
      new NextRequest(`https://test.sim.ai/api/auth/sso/providers/${id(name)}`, {
        method: 'DELETE',
      }),
      context(id(name))
    )
    return response.status
  }

  async function namedPrimary(organization = organizationId) {
    const { db, schema, eq } = runtime
    const [row] = await db
      .select({ primaryProviderId: schema.ssoDomain.primaryProviderId })
      .from(schema.ssoDomain)
      .where(eq(schema.ssoDomain.organizationId, organization))
    return row?.primaryProviderId ?? null
  }

  async function register(name: string) {
    const response = await runtime.register(
      new NextRequest('https://test.sim.ai/api/auth/sso/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerType: 'oidc',
          providerId: id(name),
          issuer: `https://${name}.idp.test`,
          domain: domain(),
          orgId: organizationId,
          clientId: 'client-id',
          clientSecret: 'client-secret',
          authorizationEndpoint: `https://${name}.idp.test/authorize`,
          tokenEndpoint: `https://${name}.idp.test/token`,
          userInfoEndpoint: `https://${name}.idp.test/userinfo`,
          jwksEndpoint: `https://${name}.idp.test/jwks`,
        }),
      })
    )
    return response.status
  }

  it('signs a lone provider in exactly as before', async () => {
    await insertDomain()
    await insertProvider({ name: 'entra' })
    expect(await signInProvider()).toBe(id('entra'))
    expect(await listedPrimaries()).toEqual([id('entra')])
    expect(await namedPrimary()).toBeNull()
  })

  it('signs a legacy provider in when its organization has no domain record', async () => {
    await insertProvider({ name: 'entra' })
    expect(await signInProvider()).toBe(id('entra'))
    expect(await listedPrimaries()).toEqual([id('entra')])
  })

  it('falls back to the first verified provider by id while the domain names none', async () => {
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertProvider({ name: 'aaa-okta' })
    await insertProvider({ name: 'okta' })

    expect(await signInProvider()).toBe(id('aaa-okta'))
    expect(await listedPrimaries()).toEqual([id('aaa-okta')])
  })

  it('switches sign-in to the provider made primary, and back', async () => {
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertProvider({ name: 'okta' })

    expect(await makePrimary('okta')).toBe(200)
    expect(await signInProvider()).toBe(id('okta'))
    expect(await listedPrimaries()).toEqual([id('okta')])

    expect(await makePrimary('entra')).toBe(200)
    expect(await signInProvider()).toBe(id('entra'))
    expect(await listedPrimaries()).toEqual([id('entra')])
  })

  it('makes a provider primary whose stored domain is spelled differently', async () => {
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertProvider({ name: 'okta', providerDomain: ` *.${domain().toUpperCase()} ` })

    expect(await makePrimary('okta')).toBe(200)
    expect(await signInProvider()).toBe(id('okta'))
    expect(await listedPrimaries()).toEqual([id('okta')])
  })

  it('refuses to make a provider primary before its domain is verified', async () => {
    await insertDomain({ status: 'pending' })
    await insertProvider({ name: 'entra', domainVerified: false })
    await insertProvider({ name: 'okta', domainVerified: false })

    expect(await makePrimary('okta')).toBe(409)
    expect(await namedPrimary()).toBeNull()
    expect(await signInProvider()).toBe(404)
    expect(await listedPrimaries()).toEqual([])
  })

  it('refuses to make an unverified provider primary on a verified domain', async () => {
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertProvider({ name: 'okta', domainVerified: false })

    expect(await makePrimary('okta')).toBe(409)
    expect(await namedPrimary()).toBeNull()
    expect(await signInProvider()).toBe(id('entra'))
  })

  it('hands sign-in to the remaining provider when the primary is deleted', async () => {
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertProvider({ name: 'okta' })
    await makePrimary('okta')

    expect(await deleteProvider('okta')).toBe(200)
    expect(await namedPrimary()).toBeNull()
    expect(await signInProvider()).toBe(id('entra'))
    expect(await listedPrimaries()).toEqual([id('entra')])
  })

  it('keeps the primary when another provider on its domain is deleted', async () => {
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertProvider({ name: 'okta' })
    await makePrimary('okta')

    expect(await deleteProvider('entra')).toBe(200)
    expect(await namedPrimary()).toBe(id('okta'))
    expect(await signInProvider()).toBe(id('okta'))
  })

  it('stops honoring the name once the primary serves another domain', async () => {
    const { db, schema, eq } = runtime
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertProvider({ name: 'okta' })
    await makePrimary('okta')

    await db
      .update(schema.ssoProvider)
      .set({ domain: `moved-${suffix}.test` })
      .where(eq(schema.ssoProvider.providerId, id('okta')))

    expect(await signInProvider()).toBe(id('entra'))
    /** The moved provider now signs in its own domain, alone there. */
    expect(await listedPrimaries()).toEqual([id('entra'), id('okta')])
  })

  it('honors a test link for a provider waiting beside the primary', async () => {
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertProvider({ name: 'okta' })
    expect(await signInProvider(id('okta'))).toBe(id('okta'))
    expect(await signInProvider()).toBe(id('entra'))
  })

  it("never follows a test link into another organization's provider", async () => {
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertDomain({ organization: otherOrganizationId, name: `elsewhere-${suffix}.test` })
    await insertProvider({
      name: 'foreign',
      organization: otherOrganizationId,
      providerDomain: `elsewhere-${suffix}.test`,
    })
    expect(await signInProvider(id('foreign'))).toBe(404)
  })

  it('never follows a test link to an unverified provider', async () => {
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertProvider({ name: 'okta', domainVerified: false })
    expect(await signInProvider(id('okta'))).toBe(404)
  })

  it('refuses a member who is not an owner or admin, and records who switched', async () => {
    const { db, schema, and, eq } = runtime
    await insertDomain()
    await insertProvider({ name: 'entra' })
    await insertProvider({ name: 'okta' })
    await db.update(schema.member).set({ role: 'member' }).where(eq(schema.member.userId, userId))

    expect(await makePrimary('okta')).toBe(403)
    expect(await namedPrimary()).toBeNull()

    await db.update(schema.member).set({ role: 'admin' }).where(eq(schema.member.userId, userId))
    expect(await makePrimary('okta')).toBe(200)
    await vi.waitFor(async () => {
      const [entry] = await db
        .select({ metadata: schema.auditLog.metadata })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.action, 'organization.sso.primary_provider_changed'),
            eq(schema.auditLog.actorId, userId)
          )
        )
      expect(entry?.metadata).toMatchObject({ providerId: id('okta'), organizationId })
    })
  })

  it("refuses to let an admin of one organization change another's primary", async () => {
    await insertDomain({ organization: otherOrganizationId, name: `elsewhere-${suffix}.test` })
    await insertProvider({
      name: 'foreign',
      organization: otherOrganizationId,
      providerDomain: `elsewhere-${suffix}.test`,
    })
    /** Choosing a primary conceals another organization's providers; deleting keeps its existing refusal. */
    expect(await makePrimary('foreign')).toBe(404)
    expect(await deleteProvider('foreign')).toBe(403)
    expect(await namedPrimary(otherOrganizationId)).toBeNull()
  })

  describe('registration', () => {
    it('registers a first provider without naming a primary', async () => {
      await insertDomain()
      expect(await register('entra')).toBe(200)
      expect(await namedPrimary()).toBeNull()
      expect(await signInProvider()).toBe(id('entra'))
    })

    it('keeps sign-in on the current provider when one that sorts first is added', async () => {
      await insertDomain()
      await insertProvider({ name: 'entra' })

      expect(await register('aaa-okta')).toBe(200)
      expect(await namedPrimary()).toBe(id('entra'))
      expect(await signInProvider()).toBe(id('entra'))
      expect(await listedPrimaries()).toEqual([id('entra')])
      expect(await signInProvider(id('aaa-okta'))).toBe(id('aaa-okta'))
    })

    it('keeps a primary an admin already chose', async () => {
      await insertDomain()
      await insertProvider({ name: 'entra' })
      await insertProvider({ name: 'okta' })
      await makePrimary('okta')

      expect(await register('aaa-onelogin')).toBe(200)
      expect(await namedPrimary()).toBe(id('okta'))
      expect(await signInProvider()).toBe(id('okta'))
    })

    it('pins the current provider when the named primary no longer signs the domain in', async () => {
      const { db, schema, eq } = runtime
      await insertDomain()
      await insertProvider({ name: 'entra' })
      await db
        .update(schema.ssoDomain)
        .set({ primaryProviderId: id('deleted-okta') })
        .where(eq(schema.ssoDomain.organizationId, organizationId))

      expect(await register('aaa-onelogin')).toBe(200)
      expect(await namedPrimary()).toBe(id('entra'))
      expect(await signInProvider()).toBe(id('entra'))
    })

    it('does not let a new provider inherit a stale name for its own id', async () => {
      const { db, schema, eq } = runtime
      await insertDomain()
      await insertProvider({ name: 'entra' })
      await db
        .update(schema.ssoDomain)
        .set({ primaryProviderId: id('aaa-okta') })
        .where(eq(schema.ssoDomain.organizationId, organizationId))

      expect(await register('aaa-okta')).toBe(200)
      expect(await namedPrimary()).toBe(id('entra'))
      expect(await signInProvider()).toBe(id('entra'))
    })

    it('keeps sign-in when an untrusted provider already on the domain is saved again', async () => {
      await insertDomain()
      await insertProvider({ name: 'entra' })
      await insertProvider({ name: 'aaa-okta', domainVerified: false })

      expect(await register('aaa-okta')).toBe(200)
      expect(await namedPrimary()).toBe(id('entra'))
      expect(await signInProvider()).toBe(id('entra'))
    })

    it("refuses a domain the caller's personal provider signs in, as before", async () => {
      await insertDomain()
      await insertProvider({ name: 'zeta-personal', organization: null })
      expect(await register('aaa-okta')).toBe(409)
      expect(await signInProvider()).toBe(id('zeta-personal'))
    })

    it('refuses a domain another organization signs in through', async () => {
      await insertDomain()
      await insertProvider({
        name: 'foreign',
        organization: otherOrganizationId,
        providerDomain: domain(),
      })
      expect(await register('okta')).toBe(409)
    })
  })
})
