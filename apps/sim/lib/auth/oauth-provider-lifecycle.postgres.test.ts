/**
 * @vitest-environment node
 */
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { generateId } from '@sim/utils/id'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.mock('@sim/audit', () => auditMock)

const databaseUrl = process.env.OAUTH_TOKEN_FAMILY_TEST_DATABASE_URL

async function loadRuntime() {
  const [
    { db },
    schema,
    { eq, inArray },
    { oauthProvider },
    { createSimAuthAdapter },
    { withOAuthProviderIssuanceCompensation },
    { rotateOAuthRefreshToken },
    { listAuthorizedAppsUseCase, revokeAuthorizedAppUseCase },
    { reconcileOAuthProviderLifecycle },
    { default: postgres },
    { hashOAuthToken },
    { runCleanupOAuthTokens, OAUTH_TOKEN_RETENTION_DAYS },
  ] = await Promise.all([
    import('@sim/db'),
    import('@sim/db/schema'),
    import('drizzle-orm'),
    import('@better-auth/oauth-provider'),
    import('@/lib/auth/sim-auth-adapter'),
    import('@/lib/auth/oauth-provider-adapter-guard'),
    import('@/lib/auth/oauth-token-family'),
    import('@/lib/users/application/authorized-apps'),
    import('@sim/db/oauth-provider-lifecycle'),
    import('postgres'),
    import('@/lib/auth/oauth-access-token'),
    import('@/background/cleanup-oauth-tokens'),
  ])
  const adapter = createSimAuthAdapter({
    plugins: [
      oauthProvider({
        loginPage: '/oauth/sign-in',
        consentPage: '/oauth/consent',
        disableJwtPlugin: true,
        scopes: ['offline_access', 'api:read', 'api:write'],
      }),
    ],
  })
  const sql = postgres(databaseUrl!, { max: 1 })
  return {
    db,
    schema,
    eq,
    inArray,
    adapter,
    sql,
    reconcileOAuthProviderLifecycle,
    withOAuthProviderIssuanceCompensation,
    rotateOAuthRefreshToken,
    revokeAuthorizedAppUseCase,
    listAuthorizedAppsUseCase,
    hashOAuthToken,
    runCleanupOAuthTokens,
    OAUTH_TOKEN_RETENTION_DAYS,
  }
}

describe.skipIf(!databaseUrl)('OAuth lifecycle on the provisioned PostgreSQL schema', () => {
  let runtime: Awaited<ReturnType<typeof loadRuntime>>
  let userId: string
  let clientId: string
  let createdClientIds: string[]
  let createdUserIds: string[]
  const scopes = ['offline_access', 'api:read', 'api:write']

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl
    runtime = await loadRuntime()
  }, 30_000)

  beforeEach(async () => {
    vi.clearAllMocks()
    userId = generateId()
    clientId = generateId()
    createdClientIds = [clientId]
    createdUserIds = [userId]
    const now = new Date()
    await runtime.db.insert(runtime.schema.user).values({
      id: userId,
      name: 'OAuth lifecycle test',
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await runtime.db.insert(runtime.schema.oauthClient).values({
      id: clientId,
      clientId,
      name: 'OAuth lifecycle client',
      public: true,
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      redirectUris: ['http://127.0.0.1/callback'],
      scopes,
    })
  })

  afterEach(async () => {
    const { db, schema, inArray } = runtime
    await db
      .delete(schema.oauthClient)
      .where(inArray(schema.oauthClient.clientId, createdClientIds))
    await db.delete(schema.user).where(inArray(schema.user.id, createdUserIds))
  })

  afterAll(async () => {
    await runtime?.sql.end()
  })

  const consentData = (grantedScopes = scopes) => ({
    clientId,
    userId,
    referenceId: null,
    scopes: grantedScopes,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  async function grantConsent(grantedScopes = scopes) {
    return runtime.adapter.create<{ id: string }>({
      model: 'oauthConsent',
      data: consentData(grantedScopes),
    })
  }

  async function issueFamily(issuedAt = new Date()) {
    const token = generateId()
    const { id } = await runtime.adapter.create<{ id: string }>({
      model: 'oauthRefreshToken',
      data: {
        token: runtime.hashOAuthToken(token),
        clientId,
        userId,
        scopes,
        createdAt: issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 86_400_000),
      },
    })
    await runtime.db.insert(runtime.schema.oauthAccessToken).values({
      id: generateId(),
      token: generateId(),
      clientId,
      userId,
      refreshId: id,
      scopes,
      createdAt: issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 3_600_000),
    })
    return { id, refreshToken: `sim_ort_${token}` }
  }

  async function expectNoTokens() {
    const { db, schema, eq } = runtime
    expect(
      await db
        .select()
        .from(schema.oauthTokenFamily)
        .where(eq(schema.oauthTokenFamily.clientId, clientId))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(schema.oauthRefreshToken)
        .where(eq(schema.oauthRefreshToken.clientId, clientId))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(schema.oauthAccessToken)
        .where(eq(schema.oauthAccessToken.clientId, clientId))
    ).toHaveLength(0)
  }

  it('atomically converges concurrent consent submissions on one grant', async () => {
    const grants = await Promise.all([grantConsent(), grantConsent()])
    expect(grants[0].id).toBe(grants[1].id)
    const { db, schema, eq } = runtime
    expect(
      await db.select().from(schema.oauthConsent).where(eq(schema.oauthConsent.clientId, clientId))
    ).toHaveLength(1)
  })

  it('pages tied microsecond timestamps completely and searches beyond page one without leaking other users', async () => {
    const { db, schema, sql } = runtime
    const clientIds = Array.from({ length: 53 }, () => generateId()).sort()
    const foreignClientId = generateId()
    const foreignUserId = generateId()
    createdClientIds.push(...clientIds, foreignClientId)
    createdUserIds.push(foreignUserId)
    const now = new Date()
    await db.insert(schema.user).values({
      id: foreignUserId,
      name: 'Another account',
      email: `${foreignUserId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    const literalName = 'Literal 100%_\\ Archive'
    await db.insert(schema.oauthClient).values(
      [...clientIds, foreignClientId].map((id, index) => ({
        id,
        clientId: id,
        name: index === 0 || id === foreignClientId ? literalName : `Paged app ${index}`,
        redirectUris: ['http://127.0.0.1/callback'],
      }))
    )
    await db.insert(schema.oauthConsent).values(
      [...clientIds, foreignClientId].map((id) => ({
        id: generateId(),
        clientId: id,
        userId: id === foreignClientId ? foreignUserId : userId,
        scopes: ['api:read'],
        createdAt: now,
        updatedAt: now,
      }))
    )
    for (const [index, id] of clientIds.entries()) {
      await sql`
        UPDATE oauth_consent
        SET created_at = timestamp '2026-01-01 00:00:00' + ${index % 5} * interval '1 microsecond'
        WHERE client_id = ${id}
      `
    }

    const principal = { kind: 'session' as const, userId, sessionId: generateId() }
    const firstPage = await runtime.listAuthorizedAppsUseCase.execute({ principal, input: {} })
    expect(firstPage.apps).toHaveLength(25)
    expect(firstPage.nextCursor).not.toBeNull()
    expect(firstPage.apps.some((app) => app.clientId === clientIds[0])).toBe(false)
    const seen = firstPage.apps.map((app) => app.clientId)
    let cursor = firstPage.nextCursor
    for (let page = 0; cursor && page < 5; page += 1) {
      const result = await runtime.listAuthorizedAppsUseCase.execute({
        principal,
        input: { cursor },
      })
      expect(result.apps.length).toBeLessThanOrEqual(25)
      seen.push(...result.apps.map((app) => app.clientId))
      cursor = result.nextCursor
    }
    expect(cursor).toBeNull()
    expect(new Set(seen).size).toBe(53)
    expect(seen.sort()).toEqual(clientIds)

    for (const search of ['Archive', '%_\\', clientIds[0]]) {
      const result = await runtime.listAuthorizedAppsUseCase.execute({
        principal,
        input: { search },
      })
      expect(result.apps.map((app) => app.clientId)).toEqual([clientIds[0]])
      expect(result.nextCursor).toBeNull()
    }
  })

  it('rolls transactional consent changes and their token cascades back together', async () => {
    const consent = await grantConsent()
    const family = await issueFamily()
    await expect(
      runtime.adapter.transaction(async (tx) => {
        await tx.create({ model: 'oauthConsent', data: consentData(['api:read']) })
        throw new Error('Abort the surrounding provider transaction')
      })
    ).rejects.toThrow('Abort the surrounding provider transaction')

    const { db, schema, eq } = runtime
    const [grant] = await db
      .select()
      .from(schema.oauthConsent)
      .where(eq(schema.oauthConsent.id, consent.id))
    expect(grant.scopes).toEqual(scopes)
    expect(
      await db
        .select()
        .from(schema.oauthTokenFamily)
        .where(eq(schema.oauthTokenFamily.id, family.id))
    ).toHaveLength(1)
  })

  it('refuses issuance without consent and never leaves a provisional family behind', async () => {
    await expect(issueFamily()).rejects.toThrow()
    await expectNoTokens()
    await grantConsent(['api:read'])
    await expect(issueFamily()).rejects.toThrow()
    await expectNoTokens()
  })

  it('serializes consent narrowing against refresh so no broader descendants survive', async () => {
    const grant = await grantConsent()
    const family = await issueFamily()
    const { db, schema, eq } = runtime
    await Promise.all([
      runtime.rotateOAuthRefreshToken({
        credentials: { clientId, method: 'none' },
        refreshToken: family.refreshToken,
      }),
      db
        .update(schema.oauthConsent)
        .set({ scopes: ['api:read'] })
        .where(eq(schema.oauthConsent.id, grant.id)),
    ])
    await expectNoTokens()
  })

  it('revokes actual authorized-app grants and every independent login during refresh', async () => {
    await grantConsent()
    const first = await issueFamily()
    await issueFamily()
    const results = await Promise.all([
      runtime.rotateOAuthRefreshToken({
        credentials: { clientId, method: 'none' },
        refreshToken: first.refreshToken,
      }),
      runtime.revokeAuthorizedAppUseCase.execute({
        principal: { kind: 'session', userId, sessionId: generateId() },
        input: { clientId },
      }),
    ])
    expect(results[1]).toMatchObject({ clientId })
    await expectNoTokens()
    const { db, schema, eq } = runtime
    expect(
      await db.select().from(schema.oauthConsent).where(eq(schema.oauthConsent.clientId, clientId))
    ).toHaveLength(0)
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: userId, resourceId: clientId })
    )
  })

  it('compensates failed nontransactional issuance without revoking an independent login', async () => {
    await grantConsent()
    const independent = await issueFamily()
    const response = await runtime.withOAuthProviderIssuanceCompensation(async () => {
      await issueFamily()
      return new Response(null, { status: 500 })
    })
    expect(response.status).toBe(500)
    await expect(
      runtime.withOAuthProviderIssuanceCompensation(async () => {
        await issueFamily()
        throw new Error('Provider response failed')
      })
    ).rejects.toThrow('Provider response failed')
    const { db, schema, eq } = runtime
    const families = await db
      .select()
      .from(schema.oauthTokenFamily)
      .where(eq(schema.oauthTokenFamily.clientId, clientId))
    expect(families.map((family) => family.id)).toEqual([independent.id])
    const tokens = await db
      .select()
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.clientId, clientId))
    expect(tokens).toHaveLength(1)
  })

  it('cleans expired families and every descendant while retaining active grants and the retention tail', async () => {
    await grantConsent()
    const { db, schema, eq, inArray } = runtime
    const stale = await issueFamily()
    await expect(
      runtime.rotateOAuthRefreshToken({
        credentials: { clientId, method: 'none' },
        refreshToken: stale.refreshToken,
      })
    ).resolves.toMatchObject({ success: true })
    const descendants = await db
      .select({ id: schema.oauthRefreshToken.id })
      .from(schema.oauthRefreshToken)
      .where(eq(schema.oauthRefreshToken.familyId, stale.id))
    expect(descendants).toHaveLength(2)
    const descendantIds = descendants.map(({ id }) => id)
    const expiredAt = new Date(Date.now() - (runtime.OAUTH_TOKEN_RETENTION_DAYS + 1) * 86_400_000)
    const oldTimestamps = {
      createdAt: new Date(expiredAt.getTime() - 86_400_000),
      expiresAt: expiredAt,
    }
    await db
      .update(schema.oauthTokenFamily)
      .set(oldTimestamps)
      .where(eq(schema.oauthTokenFamily.id, stale.id))
    await db
      .update(schema.oauthRefreshToken)
      .set(oldTimestamps)
      .where(inArray(schema.oauthRefreshToken.id, descendantIds))
    await db
      .update(schema.oauthAccessToken)
      .set(oldTimestamps)
      .where(inArray(schema.oauthAccessToken.refreshId, descendantIds))

    const active = await issueFamily()
    const recentlyExpired = await issueFamily(new Date(Date.now() - 2 * 86_400_000))
    const activeUnlinkedId = generateId()
    const staleUnlinkedId = generateId()
    const staleLinkedId = generateId()
    await db.insert(schema.oauthAccessToken).values(
      [activeUnlinkedId, staleUnlinkedId, staleLinkedId].map((id) => ({
        id,
        token: generateId(),
        clientId,
        userId,
        refreshId: id === staleLinkedId ? active.id : null,
        scopes,
        createdAt: oldTimestamps.createdAt,
        expiresAt: id === activeUnlinkedId ? new Date(Date.now() + 3_600_000) : expiredAt,
      }))
    )

    await expect(runtime.runCleanupOAuthTokens()).resolves.toMatchObject({
      tokenFamilies: 1,
      accessTokens: 2,
    })
    const remainingFamilies = await db
      .select({ id: schema.oauthTokenFamily.id })
      .from(schema.oauthTokenFamily)
      .where(eq(schema.oauthTokenFamily.clientId, clientId))
    expect(remainingFamilies.map(({ id }) => id).sort()).toEqual(
      [active.id, recentlyExpired.id].sort()
    )
    expect(
      await db
        .select({ id: schema.oauthRefreshToken.id })
        .from(schema.oauthRefreshToken)
        .where(inArray(schema.oauthRefreshToken.id, descendantIds))
    ).toHaveLength(0)
    const remainingAccess = await db
      .select({ id: schema.oauthAccessToken.id, refreshId: schema.oauthAccessToken.refreshId })
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.clientId, clientId))
    expect(remainingAccess).toHaveLength(3)
    expect(remainingAccess).toEqual(
      expect.arrayContaining([
        { id: activeUnlinkedId, refreshId: null },
        expect.objectContaining({ refreshId: active.id }),
        expect.objectContaining({ refreshId: recentlyExpired.id }),
      ])
    )
  })

  it('reconciles repeatedly without changing the existing CLI registration or grants', async () => {
    await grantConsent()
    const family = await issueFamily()
    const { db, schema, eq } = runtime
    const [original] = await db
      .select()
      .from(schema.oauthClient)
      .where(eq(schema.oauthClient.clientId, 'sim-cli'))
    expect(original).toBeDefined()
    const customization = {
      name: 'Locally customized Sim CLI',
      metadata: { operatorLabel: generateId() },
      updatedAt: new Date('2025-01-02T03:04:05.000Z'),
    }
    try {
      await db
        .update(schema.oauthClient)
        .set(customization)
        .where(eq(schema.oauthClient.clientId, 'sim-cli'))
      await runtime.reconcileOAuthProviderLifecycle(runtime.sql)
      await runtime.reconcileOAuthProviderLifecycle(runtime.sql)
      const [after] = await db
        .select()
        .from(schema.oauthClient)
        .where(eq(schema.oauthClient.clientId, 'sim-cli'))
      expect(after).toEqual({ ...original, ...customization })
      expect(
        await db
          .select()
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.id, family.id))
      ).toHaveLength(1)
      await expect(
        runtime.rotateOAuthRefreshToken({
          credentials: { clientId, method: 'none' },
          refreshToken: family.refreshToken,
        })
      ).resolves.toMatchObject({ success: true })
    } finally {
      await db
        .update(schema.oauthClient)
        .set({ name: original.name, metadata: original.metadata, updatedAt: original.updatedAt })
        .where(eq(schema.oauthClient.clientId, 'sim-cli'))
    }
  })
})
