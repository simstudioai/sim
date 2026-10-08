import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { getErrorMessage } from '@sim/utils/errors'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { env } from '@/lib/core/config/env'
import type { CredentialGroupOAuthContext } from '@/lib/credential-groups/enrollments'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { refreshOAuthToken } from '@/lib/oauth'

/** Exercises real token exchange, JWT verification and refresh over HTTP with an isolated issuer. */
const clients = {
  onedrive: 'existing-client',
  outlook: 'existing-client',
  'onedrive-personal': 'personal-client',
  'outlook-personal': 'personal-client',
  'microsoft-word-personal': 'personal-client',
} as const
const originalFetch = globalThis.fetch
const grants = new Map<string, URL>()
const report: { name: string; status: string; durationMs: number; error?: string }[] = []
const keyPair = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'fixture-key' }
let serverOrigin: string
let rejectedRequests = 0

const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json')
  try {
    if (request.url === '/common/discovery/v2.0/keys') {
      response.end(JSON.stringify({ keys: [jwk] }))
      return
    }
    if (request.url === '/oidc/userinfo') {
      response.end(JSON.stringify({ sub: 'fixture-subject' }))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > 16384) throw new Error('Oversized token request')
      chunks.push(bytes)
    }
    const body = new URLSearchParams(Buffer.concat(chunks).toString())
    const grant = grants.get(body.get('code') ?? body.get('refresh_token') ?? '')
    if (!grant) throw new Error('Unknown grant')
    const redirectUri = grant.searchParams.get('redirect_uri')
    if (!redirectUri) throw new Error('Grant has no callback URI')
    const callback = new URL(redirectUri)
    const provider = callback.pathname.split('/').at(-1) as keyof typeof clients
    const client = clients[provider]
    const basic = request.headers.authorization?.startsWith('Basic ')
      ? Buffer.from(request.headers.authorization.slice(6), 'base64').toString().split(':')
      : undefined
    const authority = provider.endsWith('-personal') ? 'consumers' : 'common'
    if (
      request.url !== `/${authority}/oauth2/v2.0/token` ||
      (basic?.[0] ?? body.get('client_id')) !== client ||
      (basic?.[1] ?? body.get('client_secret')) !== `${client}-secret`
    )
      throw new Error('Grant was sent to the wrong client or authority')
    const codeExchange = body.get('grant_type') === 'authorization_code'
    if (
      codeExchange &&
      (body.get('redirect_uri') !== callback.toString() ||
        createHash('sha256')
          .update(body.get('code_verifier') ?? '')
          .digest('base64url') !== grant.searchParams.get('code_challenge'))
    )
      throw new Error('Callback or PKCE binding was lost')
    const idToken = await new SignJWT({
      oid: 'fixture-person',
      tid: 'fixture-tenant',
      sub: 'fixture-subject',
      email: 'person@fixture.test',
      email_verified: true,
      name: 'Fixture Person',
      nonce: grant.searchParams.get('nonce'),
    })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setAudience(client)
      .setIssuer('https://login.microsoftonline.com/fixture-tenant/v2.0')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keyPair.privateKey)
    const refreshToken = `${provider}-${codeExchange ? 'refresh' : 'rotated'}`
    grants.set(refreshToken, grant)
    response.end(
      JSON.stringify({
        token_type: 'Bearer',
        access_token: `${provider}-access`,
        refresh_token: refreshToken,
        expires_in: 3600,
        scope: grant.searchParams.get('scope'),
        id_token: idToken,
      })
    )
  } catch (error) {
    rejectedRequests++
    response
      .writeHead(400)
      .end(JSON.stringify({ error: 'invalid_grant', error_description: getErrorMessage(error) }))
  }
})

beforeAll(async () => {
  Object.assign(env, {
    MICROSOFT_CLIENT_ID: 'existing-client',
    MICROSOFT_CLIENT_SECRET: 'existing-client-secret',
    MICROSOFT_PERSONAL_CLIENT_ID: 'personal-client',
    MICROSOFT_PERSONAL_CLIENT_SECRET: 'personal-client-secret',
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Issuer did not bind')
  serverOrigin = `http://127.0.0.1:${address.port}`
  /** Only transport destinations change; provider construction, exchange and verification stay real. */
  globalThis.fetch = (input, init) => {
    const remote = new URL(input instanceof Request ? input.url : input)
    if (!['login.microsoftonline.com', 'graph.microsoft.com'].includes(remote.hostname)) {
      throw new Error('Unexpected provider destination')
    }
    const localUrl = new URL(`${remote.pathname}${remote.search}`, serverOrigin)
    return originalFetch(input instanceof Request ? new Request(localUrl, input) : localUrl, init)
  }
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections()
  })
  if (process.env.MICROSOFT_PERSONAL_OAUTH_REPORT_PATH) {
    await writeFile(
      process.env.MICROSOFT_PERSONAL_OAUTH_REPORT_PATH,
      JSON.stringify(report, null, 2)
    )
  }
})

describe('Microsoft client isolation over HTTP', () => {
  it.each(Object.keys(clients) as (keyof typeof clients)[])(
    '%s authorizes and rotates only through its issuing app',
    async (provider) => {
      const started = performance.now()
      try {
        const adapter = getCredentialGroupProviderAdapter(provider)
        const policy = await adapter.getPolicy(undefined, {})
        const context: CredentialGroupOAuthContext = {
          enrollmentId: 'enrollment',
          credentialGroupId: 'group',
          credentialGroupName: 'Group',
          workspaceName: 'Workspace',
          workspaceOwnerId: null,
          email: 'person@fixture.test',
          enrollmentStatus: 'in_progress',
          options: [],
          option: { id: 'option', ...policy, label: 'Account', required: true, status: 'active' },
        }
        const prepared = await adapter.prepareAuthorization(context, policy)
        const authorization = new URL(
          await prepared.buildAuthorizationUrl({ state: 'fixture-state', nonce: 'fixture-nonce' })
        )
        expect(authorization.searchParams.get('client_id')).toBe(clients[provider])
        expect(authorization.pathname).toBe(
          `/${provider.endsWith('-personal') ? 'consumers' : 'common'}/oauth2/v2.0/authorize`
        )
        expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
        grants.set(`${provider}-code`, authorization)
        const attempt: CredentialGroupOAuthAttempt = {
          userId: 'fixture-user',
          state: 'fixture-state',
          provider,
          nonceHash: createHash('sha256').update('fixture-nonce').digest('hex'),
          email: context.email,
          enrollmentId: context.enrollmentId,
          credentialGroupId: context.credentialGroupId,
          optionId: 'option',
          authorizationAppId: policy.authorizationAppId,
          scopeVersion: policy.scopeVersion,
          requiredScopes: policy.requiredScopes,
          redirectUri: prepared.redirectUri,
          codeVerifier: prepared.codeVerifier,
          invitationToken: 'fixture-invitation',
          createdAt: Date.now(),
        }
        const grant = await adapter.exchangeAndVerify({
          context,
          attempt,
          code: `${provider}-code`,
          policy,
        })
        expect(grant.providerId).toBe(provider)
        expect(grant.providerSubjectId).toBe('fixture-person')
        expect(grant.refreshToken).toBe(`${provider}-refresh`)
        const refreshToken = grant.refreshToken
        if (!refreshToken) throw new Error('Provider omitted the refresh token')
        const refreshed = await adapter.refreshToken(refreshToken)
        expect(refreshed).toMatchObject({
          ok: true,
          refreshToken: `${provider}-rotated`,
          accessToken: `${provider}-access`,
        })
        await expect(
          adapter.exchangeAndVerify({
            context,
            attempt: { ...attempt, nonceHash: 'wrong-nonce' },
            code: `${provider}-code`,
            policy,
          })
        ).rejects.toThrow('invalid identity token')
        const wrongProvider = provider.endsWith('-personal') ? 'onedrive' : 'onedrive-personal'
        expect(await refreshOAuthToken(wrongProvider, refreshToken)).toMatchObject({
          ok: false,
        })
        if (provider.endsWith('-personal')) {
          const rejectedBefore = rejectedRequests
          Object.assign(env, {
            MICROSOFT_PERSONAL_CLIENT_ID: undefined,
            MICROSOFT_PERSONAL_CLIENT_SECRET: undefined,
          })
          try {
            expect(await refreshOAuthToken(provider, refreshToken)).toMatchObject({
              ok: false,
            })
            expect(rejectedRequests).toBe(rejectedBefore)
          } finally {
            Object.assign(env, {
              MICROSOFT_PERSONAL_CLIENT_ID: 'personal-client',
              MICROSOFT_PERSONAL_CLIENT_SECRET: 'personal-client-secret',
            })
          }
        }
        report.push({ name: provider, status: 'passed', durationMs: performance.now() - started })
      } catch (error) {
        report.push({
          name: provider,
          status: 'failed',
          durationMs: performance.now() - started,
          error: getErrorMessage(error),
        })
        throw error
      }
    }
  )
})
