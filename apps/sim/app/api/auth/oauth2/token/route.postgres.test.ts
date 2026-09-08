/**
 * @vitest-environment node
 */
import { randomBytes } from 'node:crypto'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.unmock('@/lib/auth')
vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isBillingEnabled: true,
}))

const databaseUrl = process.env.OAUTH_TOKEN_FAMILY_TEST_DATABASE_URL

interface TokenResponseBody {
  access_token: string
  refresh_token: string
  scope: string
}

describe.skipIf(!databaseUrl)('OAuth token route in PostgreSQL', () => {
  it.each(['http://127.0.0.1:48881/callback', 'cursor://anysphere.cursor-mcp/oauth/callback'])(
    'persists Search audiences through native PKCE issuance and refresh with %s',
    async (redirectUri) => {
      process.env.DATABASE_URL = databaseUrl
      const authSecret = 'test-secret-that-is-at-least-32-chars-long'
      process.env.BETTER_AUTH_SECRET = authSecret
      const [{ db }, schema, { eq, like, sql }, { makeSignature }, { auth }, { POST }, tokenStore] =
        await Promise.all([
          import('@sim/db'),
          import('@sim/db/schema'),
          import('drizzle-orm'),
          import('better-auth/crypto'),
          import('@/lib/auth'),
          import('@/app/api/auth/oauth2/token/route'),
          import('@/lib/auth/oauth-access-token'),
        ])
      const userId = generateId()
      const clientId = generateId()
      const sessionId = generateId()
      const sessionToken = generateId()
      const baseUrl = 'https://test.sim.ai'
      const resource = `${baseUrl}/api/mcp/search/organizations/${generateId()}`
      const otherResource = `${baseUrl}/api/mcp/search/organizations/${generateId()}`
      const scopes = ['search:read', 'offline_access']
      const now = new Date()
      const signature = await makeSignature(sessionToken, authSecret)
      const cookie = `__Secure-better-auth.session_token=${encodeURIComponent(`${sessionToken}.${signature}`)}`

      const formRequest = (values: Record<string, string>) =>
        new NextRequest(`${baseUrl}/api/auth/oauth2/token`, {
          method: 'POST',
          body: new URLSearchParams(values).toString(),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        })

      const issueCode = async () => {
        const verifier = randomBytes(32).toString('base64url')
        const challenge = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
        const url = new URL('/api/auth/oauth2/authorize', baseUrl)
        url.search = new URLSearchParams({
          client_id: clientId,
          response_type: 'code',
          redirect_uri: redirectUri,
          scope: scopes.join(' '),
          code_challenge: Buffer.from(challenge).toString('base64url'),
          code_challenge_method: 'S256',
          resource,
          state: generateId(),
          prompt: 'consent',
        }).toString()
        const response = await auth.handler(new Request(url, { headers: { cookie } }))
        expect(response.status).toBe(302)
        const consentLocation = new URL(response.headers.get('location') ?? '', baseUrl)
        expect(consentLocation.pathname).toBe('/oauth/consent')
        expect(consentLocation.searchParams.get('resource')).toBe(resource)
        expect(consentLocation.searchParams.getAll('ba_param')).toContain('resource')
        expect(consentLocation.searchParams.has('sig')).toBe(true)
        const signedQuery = consentLocation.search.slice(1)
        const submitConsent = (query: string) =>
          auth.handler(
            new Request(`${baseUrl}/api/auth/oauth2/consent`, {
              method: 'POST',
              headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
              body: JSON.stringify({ accept: true, oauth_query: query }),
            })
          )
        for (const replacement of [null, otherResource]) {
          const tampered = new URLSearchParams(signedQuery)
          if (replacement) tampered.set('resource', replacement)
          else tampered.delete('resource')
          const rejected = await submitConsent(tampered.toString())
          expect(rejected.status).toBe(400)
          await expect(rejected.json()).resolves.toMatchObject({ error: 'invalid_signature' })
        }
        const accepted = await submitConsent(signedQuery)
        expect(accepted.status).toBe(200)
        const acceptedBody = (await accepted.json()) as { redirect: boolean; url: string }
        expect(acceptedBody.redirect).toBe(true)
        const location = new URL(acceptedBody.url, baseUrl)
        const code = location.searchParams.get('code')
        expect(code, `Expected authorization code, got ${location.pathname}`).toBeTruthy()
        return {
          grant_type: 'authorization_code',
          client_id: clientId,
          redirect_uri: redirectUri,
          code: code!,
          code_verifier: verifier,
        }
      }

      try {
        await db.insert(schema.user).values({
          id: userId,
          name: 'Search OAuth resource test',
          email: `${userId}@example.com`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })
        await db.insert(schema.session).values({
          id: sessionId,
          token: sessionToken,
          userId,
          expiresAt: new Date(now.getTime() + 86_400_000),
          createdAt: now,
          updatedAt: now,
        })
        await db.insert(schema.oauthClient).values({
          id: clientId,
          clientId,
          name: 'Search OAuth resource test',
          public: true,
          type: 'native',
          requirePKCE: true,
          tokenEndpointAuthMethod: 'none',
          grantTypes: ['authorization_code', 'refresh_token'],
          redirectUris: [redirectUri],
          scopes,
        })
        await db.insert(schema.oauthConsent).values({
          id: generateId(),
          clientId,
          userId,
          scopes,
          createdAt: now,
          updatedAt: now,
        })

        for (const table of [schema.oauthAccessToken, schema.oauthRefreshToken]) {
          await expect(
            db.execute(sql`
            INSERT INTO ${table} (id, token, client_id, user_id, created_at, expires_at, scopes)
            VALUES (${generateId()}, ${generateId()}, ${clientId}, ${userId}, now(),
              now() + interval '1 hour', ARRAY['search:read', 'offline_access']::text[])
          `)
          ).rejects.toMatchObject({ cause: { code: '23514' } })
        }
        expect(
          await db
            .select()
            .from(schema.oauthTokenFamily)
            .where(eq(schema.oauthTokenFamily.clientId, clientId))
        ).toHaveLength(0)

        for (const requestedResource of [undefined, otherResource]) {
          const response = await POST(
            formRequest({
              ...(await issueCode()),
              ...(requestedResource && { resource: requestedResource }),
            })
          )
          expect(response.status).toBe(400)
          await expect(response.json()).resolves.toMatchObject({ error: 'invalid_target' })
        }
        expect(
          await db
            .select()
            .from(schema.oauthAccessToken)
            .where(eq(schema.oauthAccessToken.clientId, clientId))
        ).toHaveLength(0)
        expect(
          await db
            .select()
            .from(schema.oauthRefreshToken)
            .where(eq(schema.oauthRefreshToken.clientId, clientId))
        ).toHaveLength(0)

        const issued = await POST(formRequest({ ...(await issueCode()), resource }))
        expect(issued.status).toBe(200)
        const tokens = (await issued.json()) as TokenResponseBody
        const accessRows = await db
          .select()
          .from(schema.oauthAccessToken)
          .where(eq(schema.oauthAccessToken.clientId, clientId))
        const refreshRows = await db
          .select()
          .from(schema.oauthRefreshToken)
          .where(eq(schema.oauthRefreshToken.clientId, clientId))
        expect(accessRows).toHaveLength(1)
        expect(refreshRows).toHaveLength(1)
        expect(accessRows[0]?.resource).toBe(resource)
        expect(refreshRows[0]?.resource).toBe(resource)
        await expect(
          tokenStore.verifyOAuthAccessToken(tokens.access_token, { resource })
        ).resolves.toMatchObject({ userId })
        await expect(tokenStore.verifyOAuthAccessToken(tokens.access_token)).rejects.toMatchObject({
          reason: 'wrong_resource',
        })
        await expect(
          tokenStore.verifyOAuthAccessToken(tokens.access_token, { resource: otherResource })
        ).rejects.toMatchObject({ reason: 'wrong_resource' })

        const refresh = {
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: tokens.refresh_token,
        }
        const wrong = await POST(formRequest({ ...refresh, resource: otherResource }))
        expect(wrong.status).toBe(400)
        await expect(wrong.json()).resolves.toMatchObject({ error: 'invalid_target' })
        const renewed = await POST(formRequest(refresh))
        expect(renewed.status).toBe(200)
        const next = (await renewed.json()) as TokenResponseBody
        await expect(
          tokenStore.verifyOAuthAccessToken(next.access_token, { resource })
        ).resolves.toMatchObject({ userId })
        await expect(tokenStore.verifyOAuthAccessToken(next.access_token)).rejects.toMatchObject({
          reason: 'wrong_resource',
        })

        const replayed = await POST(formRequest(refresh))
        expect(replayed.status).toBe(400)
        await expect(
          tokenStore.verifyOAuthAccessToken(next.access_token, { resource })
        ).rejects.toMatchObject({ reason: 'unknown' })
      } finally {
        await db.delete(schema.verification).where(like(schema.verification.value, `%${userId}%`))
        await db.delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, clientId))
        await db.delete(schema.user).where(eq(schema.user.id, userId))
      }
    },
    30_000
  )

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
      { isCapabilityWithheldForUser },
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
      import('@/lib/permission-groups/user-scope.server'),
    ])

    const testId = randomBytes(8).toString('hex')
    const userId = `oauth-route-test-user-${testId}`
    const sessionId = `oauth-route-test-session-${testId}`
    const sessionToken = `oauth-route-test-session-token-${testId}`
    const consentId = `oauth-route-test-consent-${testId}`
    const organizationId = `oauth-route-test-org-${testId}`
    const groupId = `oauth-route-test-group-${testId}`
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

    const createAuthorizeUrl = async (verifier: string) => {
      const challenge = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      const authorizeUrl = new URL('/api/auth/oauth2/authorize', baseUrl)
      authorizeUrl.searchParams.set('client_id', provider.SIM_CLI_CLIENT_ID)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('redirect_uri', redirectUri)
      authorizeUrl.searchParams.set('scope', grantedScopes.join(' '))
      authorizeUrl.searchParams.set('code_challenge', Buffer.from(challenge).toString('base64url'))
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')
      authorizeUrl.searchParams.set('state', `state-${testId}`)
      return authorizeUrl
    }

    const issueAuthorizationCode = async (verifier: string): Promise<string> => {
      const authorizeUrl = await createAuthorizeUrl(verifier)
      const response = await auth.handler(
        new Request(authorizeUrl, { headers: { cookie: sessionCookie } })
      )
      expect(response.status).toBe(302)
      const location = response.headers.get('location')
      expect(location).toBeTruthy()
      const code = new URL(location as string, baseUrl).searchParams.get('code')
      expect(code, 'Expected an authorization code redirect').toBeTruthy()
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
      await db.insert(schema.organization).values({
        id: organizationId,
        name: 'OAuth route permission fixture',
        slug: organizationId,
        createdAt: now,
      })
      await db
        .insert(schema.member)
        .values({ id: `oauth-route-member-${testId}`, userId, organizationId, role: 'owner' })
      await db
        .insert(schema.userStats)
        .values({ id: `oauth-route-stats-${testId}`, userId, billingBlocked: false })
      await db.insert(schema.subscription).values({
        id: `oauth-route-subscription-${testId}`,
        plan: 'enterprise',
        referenceId: organizationId,
        status: 'active',
        seats: 5,
        periodStart: now,
        periodEnd: sessionExpiresAt,
        metadata: {
          plan: 'enterprise',
          referenceId: organizationId,
          seats: 5,
          monthlyPrice: 100,
        },
      })
      await db.insert(schema.permissionGroup).values({
        id: groupId,
        organizationId,
        createdBy: userId,
        name: 'Default',
        isDefault: true,
        config: {},
      })
      expect(await isCapabilityWithheldForUser(userId, 'oauth_apps.use')).toBe(false)
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

      const activeTokens = (await racingResponses
        .find((response) => response.status === 200)
        ?.json()) as TokenResponseBody
      const withheldVerifier = `${testId}-withheld-verifier-with-more-than-forty-three-characters`
      const withheldCode = await issueAuthorizationCode(withheldVerifier)
      const consentUrl = await createAuthorizeUrl(withheldVerifier)
      consentUrl.searchParams.set('prompt', 'consent')
      const consentPage = await auth.handler(
        new Request(consentUrl, { headers: { cookie: sessionCookie } })
      )
      expect(consentPage.status).toBe(302)
      const signedQuery = new URL(consentPage.headers.get('location')!, baseUrl).search.slice(1)
      expect(new URLSearchParams(signedQuery).has('sig')).toBe(true)
      const submitConsent = (accept: boolean) =>
        auth.handler(
          new Request(`${baseUrl}/api/auth/oauth2/consent`, {
            method: 'POST',
            headers: { cookie: sessionCookie, 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ accept, oauth_query: signedQuery }),
          })
        )

      await db
        .update(schema.permissionGroup)
        .set({ config: { disableOAuthAppAccess: true } })
        .where(eq(schema.permissionGroup.id, groupId))
      expect(await isCapabilityWithheldForUser(userId, 'oauth_apps.use')).toBe(true)
      const blockedCachedConsent = await auth.handler(
        new Request(await createAuthorizeUrl(withheldVerifier), {
          headers: { cookie: sessionCookie },
        })
      )
      expect(blockedCachedConsent.status).toBe(403)
      await expect(blockedCachedConsent.json()).resolves.toMatchObject({ error: 'access_denied' })
      const blockedAccept = await submitConsent(true)
      expect(blockedAccept.status).toBe(403)
      await expect(blockedAccept.json()).resolves.toMatchObject({ error: 'access_denied' })

      const denial = await submitConsent(false)
      expect(denial.status).toBe(200)
      const denialBody = (await denial.json()) as { redirect: boolean; url: string }
      expect(denialBody.redirect).toBe(true)
      const denialUrl = new URL(denialBody.url)
      expect(`${denialUrl.origin}${denialUrl.pathname}`).toBe(redirectUri)
      expect(denialUrl.searchParams.get('error')).toBe('access_denied')
      expect(denialUrl.searchParams.get('state')).toBe(`state-${testId}`)
      expect(denialUrl.searchParams.get('iss')).toBe(`${baseUrl}/api/auth`)
      expect(denialUrl.searchParams.has('code')).toBe(false)
      expect(
        await db
          .select({ scopes: schema.oauthConsent.scopes })
          .from(schema.oauthConsent)
          .where(eq(schema.oauthConsent.id, consentId))
      ).toEqual([{ scopes: grantedScopes }])

      const blockedCodeExchange = await exchangeToken(
        createFormRequest(
          '/api/auth/oauth2/token',
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: provider.SIM_CLI_CLIENT_ID,
            code: withheldCode,
            code_verifier: withheldVerifier,
            redirect_uri: redirectUri,
          })
        )
      )
      expect(blockedCodeExchange.status).toBe(400)
      const blockedCodeBody = await blockedCodeExchange.json()
      expect(blockedCodeBody).toMatchObject({ error: 'invalid_grant' })
      expect(blockedCodeBody).not.toHaveProperty('access_token')
      expect(blockedCodeBody).not.toHaveProperty('refresh_token')

      const blockedRefresh = await exchangeToken(
        createFormRequest(
          '/api/auth/oauth2/token',
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: provider.SIM_CLI_CLIENT_ID,
            refresh_token: activeTokens.refresh_token,
          })
        )
      )
      expect(blockedRefresh.status).toBe(400)
      await expect(blockedRefresh.json()).resolves.toMatchObject({ error: 'invalid_grant' })
      expect(
        await db
          .select({ generation: schema.oauthTokenFamily.currentGeneration })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.userId, userId))
      ).toEqual([{ generation: 0 }])
      const revokedWhileWithheld = await revokeToken(
        createFormRequest(
          '/api/auth/oauth2/revoke',
          new URLSearchParams({
            client_id: provider.SIM_CLI_CLIENT_ID,
            token: activeTokens.refresh_token,
          })
        )
      )
      expect(revokedWhileWithheld.status).toBe(200)
      expect(await revokedWhileWithheld.text()).toBe('')
      expect(
        await db
          .select({ id: schema.oauthTokenFamily.id })
          .from(schema.oauthTokenFamily)
          .where(eq(schema.oauthTokenFamily.userId, userId))
      ).toHaveLength(0)
    } finally {
      if (issuedCodeHashes.length) {
        await db
          .delete(schema.verification)
          .where(inArray(schema.verification.identifier, issuedCodeHashes))
      }
      await db.delete(schema.verification).where(like(schema.verification.value, `%${userId}%`))
      await db.delete(schema.user).where(eq(schema.user.id, userId))
      await db
        .delete(schema.subscription)
        .where(eq(schema.subscription.referenceId, organizationId))
      await db.delete(schema.organization).where(eq(schema.organization.id, organizationId))
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
