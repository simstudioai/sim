/**
 * @vitest-environment node
 */
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.unmock('@/lib/core/config/env')

const databaseUrl = process.env.OAUTH_TOKEN_FAMILY_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('OAuth token families in PostgreSQL', () => {
  it('rotates, contains replay, revokes one login, and follows consent changes', async () => {
    process.env.DATABASE_URL = databaseUrl
    process.env.BETTER_AUTH_SECRET ||= 'oauth-token-family-integration-test-secret'

    const [{ db }, schema, { eq, sql }, provider, tokenStore] = await Promise.all([
      import('@sim/db'),
      import('@sim/db/schema'),
      import('drizzle-orm'),
      import('@/lib/auth/oauth-provider'),
      import('@/lib/auth/oauth-access-token'),
    ])
    const { revokeOAuthToken, rotateOAuthRefreshToken } = await import(
      '@/lib/auth/oauth-token-family'
    )
    const testId = randomBytes(8).toString('hex')
    const userId = `oauth-family-test-user-${testId}`
    const sessionId = `oauth-family-test-session-${testId}`
    const consentId = `oauth-family-test-consent-${testId}`
    const email = `oauth-family-${testId}@example.com`
    const fullScopes = ['offline_access', 'api:read', 'api:write']
    const credentials = { clientId: 'sim-cli', method: 'none' as const }

    const createInitialFamily = async (label: string): Promise<string> => {
      const refreshId = `oauth-family-test-refresh-${testId}-${label}`
      const tokenBody = randomBytes(32).toString('base64url')
      await db.execute(sql`
        INSERT INTO "oauth_refresh_token" (
          "id", "token", "client_id", "session_id", "user_id", "reference_id",
          "expires_at", "created_at", "revoked", "auth_time", "scopes",
          "family_id", "generation"
        ) VALUES (
          ${refreshId}, ${tokenStore.hashOAuthToken(tokenBody)}, 'sim-cli', ${sessionId},
          ${userId}, NULL, now() + interval '30 days', now(), NULL, now(),
          ARRAY['offline_access', 'api:read', 'api:write']::text[], NULL, NULL
        )
      `)
      return `${provider.OAUTH_REFRESH_TOKEN_PREFIX}${tokenBody}`
    }

    await db.insert(schema.user).values({
      id: userId,
      name: 'OAuth family integration test',
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(schema.session).values({
      id: sessionId,
      token: `oauth-family-test-session-token-${testId}`,
      userId,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(schema.oauthConsent).values({
      id: consentId,
      clientId: 'sim-cli',
      userId,
      referenceId: null,
      scopes: fullScopes,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    try {
      const familyAToken = await createInitialFamily('a')
      const familyAId = `oauth-family-test-refresh-${testId}-a`
      const [familyABefore] = await db
        .select({ expiresAt: schema.oauthTokenFamily.expiresAt })
        .from(schema.oauthTokenFamily)
        .where(eq(schema.oauthTokenFamily.id, familyAId))
      const rotatedA = await rotateOAuthRefreshToken({
        credentials,
        refreshToken: familyAToken,
        requestedScopes: ['offline_access', 'api:read'],
      })
      expect(rotatedA.success).toBe(true)
      if (!rotatedA.success) throw new Error(rotatedA.description)
      expect(rotatedA.value.scope).toBe('offline_access api:read')

      const familyARows = await db
        .select({
          generation: schema.oauthRefreshToken.generation,
          scopes: schema.oauthRefreshToken.scopes,
        })
        .from(schema.oauthRefreshToken)
        .where(eq(schema.oauthRefreshToken.familyId, familyAId))
        .orderBy(schema.oauthRefreshToken.generation)
      expect(familyARows).toEqual([
        { generation: 0, scopes: fullScopes },
        { generation: 1, scopes: fullScopes },
      ])
      const [familyAAfter] = await db
        .select({ expiresAt: schema.oauthTokenFamily.expiresAt })
        .from(schema.oauthTokenFamily)
        .where(eq(schema.oauthTokenFamily.id, familyAId))
      expect(familyAAfter?.expiresAt).toEqual(familyABefore?.expiresAt)

      const familyBToken = await createInitialFamily('b')
      const familyBId = `oauth-family-test-refresh-${testId}-b`
      const replayA = await rotateOAuthRefreshToken({
        credentials,
        refreshToken: familyAToken,
      })
      expect(replayA).toMatchObject({ success: false, error: 'invalid_grant' })
      expect(
        await db
          .select({ id: schema.oauthTokenFamily.id })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.id, familyAId))
      ).toHaveLength(0)
      expect(
        await db
          .select({ id: schema.oauthTokenFamily.id })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.id, familyBId))
      ).toHaveLength(1)

      const concurrent = await Promise.all([
        rotateOAuthRefreshToken({ credentials, refreshToken: familyBToken }),
        rotateOAuthRefreshToken({ credentials, refreshToken: familyBToken }),
      ])
      expect(concurrent.filter((result) => result.success)).toHaveLength(1)
      expect(concurrent.filter((result) => !result.success)).toHaveLength(1)
      expect(
        await db
          .select({ id: schema.oauthTokenFamily.id })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.id, familyBId))
      ).toHaveLength(0)

      const familyCToken = await createInitialFamily('c')
      const familyCId = `oauth-family-test-refresh-${testId}-c`
      const rotatedC = await rotateOAuthRefreshToken({ credentials, refreshToken: familyCToken })
      expect(rotatedC.success).toBe(true)
      if (!rotatedC.success) throw new Error(rotatedC.description)
      expect(await revokeOAuthToken({ credentials, token: rotatedC.value.refreshToken })).toEqual({
        success: true,
        value: undefined,
      })
      expect(
        await db
          .select({ id: schema.oauthTokenFamily.id })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.id, familyCId))
      ).toHaveLength(0)

      const familyDToken = await createInitialFamily('d')
      const familyDId = `oauth-family-test-refresh-${testId}-d`
      expect(
        await revokeOAuthToken({
          credentials,
          token: `${provider.OAUTH_REFRESH_TOKEN_PREFIX}unknown-token`,
        })
      ).toEqual({ success: true, value: undefined })
      expect(
        await db
          .select({ id: schema.oauthTokenFamily.id })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.id, familyDId))
      ).toHaveLength(1)

      await db
        .update(schema.oauthConsent)
        .set({ scopes: ['offline_access', 'api:read'], updatedAt: new Date() })
        .where(eq(schema.oauthConsent.id, consentId))
      expect(
        await db
          .select({ id: schema.oauthTokenFamily.id })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.id, familyDId))
      ).toHaveLength(0)
      expect(familyDToken).toMatch(/^sim_ort_/)

      await db
        .update(schema.oauthConsent)
        .set({ scopes: fullScopes, updatedAt: new Date() })
        .where(eq(schema.oauthConsent.id, consentId))
      await db
        .update(schema.user)
        .set({ banned: true, banExpires: new Date(Date.now() - 1_000) })
        .where(eq(schema.user.id, userId))
      const familyEToken = await createInitialFamily('e')
      await expect(
        rotateOAuthRefreshToken({ credentials, refreshToken: familyEToken })
      ).resolves.toMatchObject({ success: true })

      await db
        .update(schema.user)
        .set({ banned: true, banExpires: new Date(Date.now() + 60_000) })
        .where(eq(schema.user.id, userId))
      const familyFToken = await createInitialFamily('f')
      await expect(
        rotateOAuthRefreshToken({ credentials, refreshToken: familyFToken })
      ).resolves.toMatchObject({ success: false, error: 'invalid_grant' })
    } finally {
      await db.delete(schema.user).where(eq(schema.user.id, userId))
    }
  }, 30_000)
})
