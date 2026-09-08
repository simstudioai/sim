/**
 * @vitest-environment node
 */
import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.unmock('@/lib/auth')

const databaseUrl = process.env.OAUTH_TOKEN_FAMILY_TEST_DATABASE_URL

interface TokenResponseBody {
  access_token: string
  refresh_token: string
  scope: string
}

describe.skipIf(!databaseUrl)('OAuth token route in PostgreSQL', () => {
  it('issues, rotates, contains replay, and revokes a real Better Auth PKCE grant', async () => {
    process.env.DATABASE_URL = databaseUrl
    const authSecret = 'test-secret-that-is-at-least-32-chars-long'
    process.env.BETTER_AUTH_SECRET = authSecret

    const [
      { db },
      schema,
      { eq, inArray, like },
      { makeSignature },
      { auth },
      { POST: exchangeToken },
      { POST: revokeToken },
      tokenStore,
      provider,
      { requestUtilsMockFns },
    ] = await Promise.all([
      import('@sim/db'),
      import('@sim/db/schema'),
      import('drizzle-orm'),
      import('better-auth/crypto'),
      import('@/lib/auth'),
      import('@/app/api/auth/oauth2/token/route'),
      import('@/app/api/auth/oauth2/revoke/route'),
      import('@/lib/auth/oauth-access-token'),
      import('@/lib/auth/oauth-provider'),
      import('@sim/testing/mocks/request.mock'),
    ])

    const testId = randomBytes(8).toString('hex')
    const userId = `oauth-route-test-user-${testId}`
    const sessionId = `oauth-route-test-session-${testId}`
    const sessionToken = `oauth-route-test-session-token-${testId}`
    const consentId = `oauth-route-test-consent-${testId}`
    const email = `oauth-route-${testId}@example.com`
    const clientIp = `192.0.2.${Number.parseInt(testId.slice(0, 2), 16) || 1}`
    const baseUrl = 'https://test.sim.ai'
    const redirectUri = `http://127.0.0.1:${40_000 + (Number.parseInt(testId.slice(0, 4), 16) % 20_000)}/callback`
    const grantedScopes = ['offline_access', 'api:read', 'api:write']
    const issuedCodeHashes: string[] = []

    const signature = await makeSignature(sessionToken, authSecret)
    const sessionCookie = `__Secure-better-auth.session_token=${encodeURIComponent(`${sessionToken}.${signature}`)}`

    const createFormRequest = (path: string, form: URLSearchParams) =>
      new NextRequest(`${baseUrl}${path}`, {
        method: 'POST',
        body: form.toString(),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-forwarded-for': clientIp,
        },
      })

    const issueAuthorizationCode = async (verifier: string): Promise<string> => {
      const challenge = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      const authorizeUrl = new URL('/api/auth/oauth2/authorize', baseUrl)
      authorizeUrl.searchParams.set('client_id', provider.SIM_CLI_CLIENT_ID)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('redirect_uri', redirectUri)
      authorizeUrl.searchParams.set('scope', grantedScopes.join(' '))
      authorizeUrl.searchParams.set('code_challenge', Buffer.from(challenge).toString('base64url'))
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')
      authorizeUrl.searchParams.set('state', `state-${testId}`)

      const response = await auth.handler(
        new Request(authorizeUrl, { headers: { cookie: sessionCookie } })
      )
      expect(response.status).toBe(302)
      const location = response.headers.get('location')
      expect(location).toBeTruthy()
      const code = new URL(location as string, baseUrl).searchParams.get('code')
      expect(code, `Expected authorization code redirect, received ${location}`).toBeTruthy()
      issuedCodeHashes.push(tokenStore.hashOAuthToken(code as string))
      const authorizationCodes = await db
        .select({ identifier: schema.verification.identifier })
        .from(schema.verification)
        .where(like(schema.verification.value, `%${userId}%`))
      expect(authorizationCodes).toHaveLength(1)
      return code as string
    }

    const exchangeAuthorizationCode = async (code: string, verifier: string) => {
      const response = await exchangeToken(
        createFormRequest(
          '/api/auth/oauth2/token',
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: provider.SIM_CLI_CLIENT_ID,
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
          })
        )
      )
      expect(response.status).toBe(200)
      return (await response.json()) as TokenResponseBody
    }

    requestUtilsMockFns.mockGetClientIp.mockReturnValue(clientIp)
    const now = new Date()
    await db.insert(schema.user).values({
      id: userId,
      name: 'OAuth route integration test',
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    const sessionExpiresAt = new Date(now.getTime() + 86_400_000)
    await db.insert(schema.session).values({
      id: sessionId,
      token: sessionToken,
      userId,
      expiresAt: sessionExpiresAt,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(schema.oauthConsent).values({
      id: consentId,
      clientId: provider.SIM_CLI_CLIENT_ID,
      userId,
      referenceId: null,
      scopes: grantedScopes,
      createdAt: now,
      updatedAt: now,
    })

    try {
      const firstVerifier = `${testId}-first-verifier-with-more-than-forty-three-characters`
      const firstTokens = await exchangeAuthorizationCode(
        await issueAuthorizationCode(firstVerifier),
        firstVerifier
      )
      const [sessionAfterAuthorization] = await db
        .select({ expiresAt: schema.session.expiresAt })
        .from(schema.session)
        .where(eq(schema.session.id, sessionId))
      expect(sessionAfterAuthorization?.expiresAt).toEqual(sessionExpiresAt)
      expect(
        await db
          .select({ id: schema.verification.id })
          .from(schema.verification)
          .where(like(schema.verification.value, `%${userId}%`))
      ).toHaveLength(0)

      expect(firstTokens.access_token).toMatch(/^sim_oat_/)
      expect(firstTokens.refresh_token).toMatch(/^sim_ort_/)
      expect(firstTokens.scope).toBe(grantedScopes.join(' '))

      const firstAccessHash = tokenStore.hashOAuthToken(
        firstTokens.access_token.slice(provider.OAUTH_ACCESS_TOKEN_PREFIX.length)
      )
      const firstRefreshHash = tokenStore.hashOAuthToken(
        firstTokens.refresh_token.slice(provider.OAUTH_REFRESH_TOKEN_PREFIX.length)
      )
      const [firstRefresh] = await db
        .select({
          id: schema.oauthRefreshToken.id,
          token: schema.oauthRefreshToken.token,
          familyId: schema.oauthRefreshToken.familyId,
          generation: schema.oauthRefreshToken.generation,
          scopes: schema.oauthRefreshToken.scopes,
        })
        .from(schema.oauthRefreshToken)
        .where(eq(schema.oauthRefreshToken.token, firstRefreshHash))
      const [firstAccess] = await db
        .select({
          token: schema.oauthAccessToken.token,
          refreshId: schema.oauthAccessToken.refreshId,
          scopes: schema.oauthAccessToken.scopes,
        })
        .from(schema.oauthAccessToken)
        .where(eq(schema.oauthAccessToken.token, firstAccessHash))
      const [firstFamily] = await db
        .select({
          id: schema.oauthTokenFamily.id,
          consentId: schema.oauthTokenFamily.consentId,
          currentGeneration: schema.oauthTokenFamily.currentGeneration,
        })
        .from(schema.oauthTokenFamily)
        .where(eq(schema.oauthTokenFamily.id, firstRefresh?.familyId ?? 'missing'))

      expect(firstRefresh).toMatchObject({
        token: firstRefreshHash,
        generation: 0,
        scopes: grantedScopes,
      })
      expect(firstRefresh?.token).not.toBe(firstTokens.refresh_token)
      expect(firstAccess).toEqual({
        token: firstAccessHash,
        refreshId: firstRefresh?.id,
        scopes: grantedScopes,
      })
      expect(firstAccess?.token).not.toBe(firstTokens.access_token)
      expect(firstFamily).toEqual({
        id: firstRefresh?.id,
        consentId,
        currentGeneration: 0,
      })

      const narrowedRefresh = await exchangeToken(
        createFormRequest(
          '/api/auth/oauth2/token',
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: provider.SIM_CLI_CLIENT_ID,
            refresh_token: firstTokens.refresh_token,
            scope: 'offline_access api:read',
          })
        )
      )
      expect(narrowedRefresh.status).toBe(200)
      const narrowedTokens = (await narrowedRefresh.json()) as TokenResponseBody
      expect(narrowedTokens.scope).toBe('offline_access api:read')

      const nextRefreshHash = tokenStore.hashOAuthToken(
        narrowedTokens.refresh_token.slice(provider.OAUTH_REFRESH_TOKEN_PREFIX.length)
      )
      const nextAccessHash = tokenStore.hashOAuthToken(
        narrowedTokens.access_token.slice(provider.OAUTH_ACCESS_TOKEN_PREFIX.length)
      )
      const [nextRefresh] = await db
        .select({
          id: schema.oauthRefreshToken.id,
          familyId: schema.oauthRefreshToken.familyId,
          generation: schema.oauthRefreshToken.generation,
          scopes: schema.oauthRefreshToken.scopes,
        })
        .from(schema.oauthRefreshToken)
        .where(eq(schema.oauthRefreshToken.token, nextRefreshHash))
      const [nextAccess] = await db
        .select({
          refreshId: schema.oauthAccessToken.refreshId,
          scopes: schema.oauthAccessToken.scopes,
        })
        .from(schema.oauthAccessToken)
        .where(eq(schema.oauthAccessToken.token, nextAccessHash))

      expect(nextRefresh).toMatchObject({
        familyId: firstRefresh?.id,
        generation: 1,
        scopes: grantedScopes,
      })
      expect(nextAccess).toEqual({
        refreshId: nextRefresh?.id,
        scopes: ['offline_access', 'api:read'],
      })

      const replay = await exchangeToken(
        createFormRequest(
          '/api/auth/oauth2/token',
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: provider.SIM_CLI_CLIENT_ID,
            refresh_token: firstTokens.refresh_token,
          })
        )
      )
      expect(replay.status).toBe(400)
      await expect(replay.json()).resolves.toMatchObject({ error: 'invalid_grant' })
      expect(
        await db
          .select({ id: schema.oauthTokenFamily.id })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.id, firstRefresh?.id ?? 'missing'))
      ).toHaveLength(0)

      const secondVerifier = `${testId}-second-verifier-with-more-than-forty-three-characters`
      const secondTokens = await exchangeAuthorizationCode(
        await issueAuthorizationCode(secondVerifier),
        secondVerifier
      )
      expect(
        await db
          .select({ id: schema.verification.id })
          .from(schema.verification)
          .where(like(schema.verification.value, `%${userId}%`))
      ).toHaveLength(0)
      const secondRefreshHash = tokenStore.hashOAuthToken(
        secondTokens.refresh_token.slice(provider.OAUTH_REFRESH_TOKEN_PREFIX.length)
      )
      const [secondRefresh] = await db
        .select({ familyId: schema.oauthRefreshToken.familyId })
        .from(schema.oauthRefreshToken)
        .where(eq(schema.oauthRefreshToken.token, secondRefreshHash))

      const revoked = await revokeToken(
        createFormRequest(
          '/api/auth/oauth2/revoke',
          new URLSearchParams({
            client_id: provider.SIM_CLI_CLIENT_ID,
            token: secondTokens.refresh_token,
          })
        )
      )
      expect(revoked.status).toBe(200)
      expect(await revoked.text()).toBe('')
      expect(
        await db
          .select({ id: schema.oauthTokenFamily.id })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.id, secondRefresh?.familyId ?? 'missing'))
      ).toHaveLength(0)

      const racingVerifier = `${testId}-racing-verifier-with-more-than-forty-three-characters`
      const racingCode = await issueAuthorizationCode(racingVerifier)
      const exchangeSameCode = () =>
        exchangeToken(
          createFormRequest(
            '/api/auth/oauth2/token',
            new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: provider.SIM_CLI_CLIENT_ID,
              code: racingCode,
              code_verifier: racingVerifier,
              redirect_uri: redirectUri,
            })
          )
        )
      const racingResponses = await Promise.all([exchangeSameCode(), exchangeSameCode()])
      expect(racingResponses.map((response) => response.status).sort()).toEqual([200, 400])
      const rejectedExchange = racingResponses.find((response) => response.status === 400)
      await expect(rejectedExchange?.json()).resolves.toMatchObject({ error: 'invalid_grant' })
      expect(
        await db
          .select({ id: schema.oauthTokenFamily.id })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.userId, userId))
      ).toHaveLength(1)
    } finally {
      if (issuedCodeHashes.length) {
        await db
          .delete(schema.verification)
          .where(inArray(schema.verification.identifier, issuedCodeHashes))
      }
      await db.delete(schema.verification).where(like(schema.verification.value, `%${userId}%`))
      await db.delete(schema.user).where(eq(schema.user.id, userId))
      await db
        .delete(schema.rateLimitBucket)
        .where(
          inArray(schema.rateLimitBucket.key, [
            `route:oauth-provider-token:ip:${clientIp}`,
            `route:oauth-provider-revoke:ip:${clientIp}`,
          ])
        )
      requestUtilsMockFns.mockGetClientIp.mockReset()
      requestUtilsMockFns.mockGetClientIp.mockReturnValue('127.0.0.1')
    }
  }, 60_000)
})
