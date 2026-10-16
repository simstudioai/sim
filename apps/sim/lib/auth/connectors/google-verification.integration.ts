import { createServer } from 'node:http'
import { db } from '@sim/db'
import { account, user } from '@sim/db/schema'
import { emailMailerMock } from '@sim/testing/mocks/email-mailer.mock'
import { emailTemplatesMock } from '@sim/testing/mocks/email-templates.mock'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { generateId } from '@sim/utils/id'
import { hashPassword } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredentialGroupOAuthContext } from '@/lib/credential-groups/enrollments'

const fixture = vi.hoisted(() => ({ enabled: false, baseUrl: '' }))

vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)
vi.mock('@/components/emails', () => emailTemplatesMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isBillingEnabled: false,
  isAppConfigEnabled: true,
}))
vi.mock('@/lib/core/config/appconfig', () => ({
  fetchAppConfigProfile: async (ids: { profile: string }, parse: (value: unknown) => unknown) =>
    parse(
      ids.profile === 'feature-flags'
        ? { 'google-unverified-oauth': { enabled: fixture.enabled } }
        : {}
    ),
}))
vi.mock('@/lib/auth/connectors/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/connectors/providers')>()
  return {
    buildConnectorProviders: () =>
      original.buildConnectorProviders().map((provider) =>
        provider.providerId.startsWith('google-')
          ? {
              ...provider,
              discoveryUrl: undefined,
              authorizationUrl: `${fixture.baseUrl}/authorize`,
              tokenUrl: `${fixture.baseUrl}/token`,
            }
          : provider
      ),
  }
})

describe('Google OAuth verification restrictions at the HTTP boundary', () => {
  let auth: typeof import('@/lib/auth/auth').auth
  let adapters: typeof import('@/lib/credential-groups/standard-oauth-provider')
  let cookie: string
  let refreshForm: URLSearchParams | undefined
  const userId = generateId()
  const password = 'Disposable-fixture-password-42!'
  const email = `${userId}@oauth-verification.test`
  const server = createServer(async (request, response) => {
    if (request.url === '/token') {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk)
      refreshForm = new URLSearchParams(Buffer.concat(chunks).toString())
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          access_token: 'fixture-refreshed-access',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      )
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const result = await auth.handler(
      new Request(`http://localhost:3000${request.url}`, {
        method: request.method,
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
        },
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      })
    )
    response.statusCode = result.status
    result.headers.forEach((value, key) => {
      if (key !== 'set-cookie') response.setHeader(key, value)
    })
    response.setHeader('set-cookie', result.headers.getSetCookie())
    response.end(Buffer.from(await result.arrayBuffer()))
  })

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-verification-fixture-client'
    process.env.GOOGLE_CLIENT_SECRET = 'google-verification-fixture-secret'
    process.env.GOOGLE_VERIFICATION_CLIENT_ID = 'isolated-review-fixture-client'
    process.env.GOOGLE_VERIFICATION_CLIENT_SECRET = 'isolated-review-fixture-secret'
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind')
    fixture.baseUrl = `http://127.0.0.1:${address.port}`
    ;({ auth } = await import('@/lib/auth/auth'))
    adapters = await import('@/lib/credential-groups/standard-oauth-provider')
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      email,
      name: 'OAuth verification fixture',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(account).values({
      id: generateId(),
      accountId: userId,
      userId,
      providerId: 'credential',
      password: await hashPassword(password),
      createdAt: now,
      updatedAt: now,
    })
    const login = await post('/sign-in/email', { email, password })
    expect(login.status).toBe(200)
    cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
  }, 90_000)

  beforeEach(() => {
    fixture.enabled = false
  })

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId))
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeAllConnections()
    })
  })

  function post(path: string, body: object) {
    return fetch(`${fixture.baseUrl}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
      redirect: 'manual',
    })
  }

  it.each(['google-ads', 'google-meet', 'google-chat'])(
    'refuses a new %s connection before returning an authorization URL',
    async (providerId) => {
      const response = await post('/oauth2/link', { providerId, callbackURL: '/' })
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain('/authorize?')
    }
  )

  it.each([
    'https://www.googleapis.com/auth/adwords',
    'https://www.googleapis.com/auth/meetings.space.created',
    'https://www.googleapis.com/auth/meetings.space.readonly',
    'https://www.googleapis.com/auth/chat.spaces.readonly',
    'https://www.googleapis.com/auth/chat.messages.readonly',
  ])('refuses adding the unapproved %s scope through an approved connector', async (scope) => {
    const response = await post('/oauth2/link', {
      providerId: 'google-drive',
      callbackURL: '/',
      scopes: [scope],
    })
    expect(response.status).toBe(403)
  })

  it('refuses an unapproved scope through Google sign-in', async () => {
    const response = await post('/sign-in/social', {
      provider: 'google',
      callbackURL: '/',
      scopes: ['https://www.googleapis.com/auth/adwords'],
    })
    expect(response.status).toBe(403)
  })

  it('refuses space-delimited scope injection through social account linking', async () => {
    const response = await post('/link-social', {
      provider: 'google',
      callbackURL: '/',
      scopes: ['openid https://www.googleapis.com/auth/adwords'],
    })
    expect(response.status).toBe(403)
  })

  it.each([
    [
      '/oauth2/link',
      { providerId: 'google-drive', scopes: ['https://www.googleapis.com/auth/adwords'] },
    ],
    [
      '/sign-in/social',
      { provider: 'google', scopes: ['https://www.googleapis.com/auth/chat.messages.readonly'] },
    ],
    [
      '/oauth2/link',
      { providerId: 'google-chat', scopes: ['https://www.googleapis.com/auth/adwords'] },
    ],
    [
      '/oauth2/link',
      { providerId: 'google-meet', scopes: ['https://www.googleapis.com/auth/drive'] },
    ],
  ])('keeps each client and service scope isolated when enabled: %s %j', async (path, body) => {
    fixture.enabled = true
    const response = await post(path, { ...body, callbackURL: '/' })
    expect(response.status).toBe(403)
  })

  it.each(['google-ads', 'google-meet', 'google-chat', 'google-drive'])(
    'refreshes %s with the same client used for authorization even while new grants are disabled',
    async (providerId) => {
      const originalFetch = globalThis.fetch
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation((input, init) =>
          originalFetch(
            input === 'https://oauth2.googleapis.com/token' ? `${fixture.baseUrl}/token` : input,
            init
          )
        )
      try {
        const { refreshOAuthToken } = await import('@/lib/oauth/oauth')
        expect(await refreshOAuthToken(providerId, 'fixture-refresh-token')).toMatchObject({
          ok: true,
          accessToken: 'fixture-refreshed-access',
        })
        const prefix = providerId === 'google-drive' ? 'google-verification' : 'isolated-review'
        expect(refreshForm?.get('client_id')).toBe(`${prefix}-fixture-client`)
        expect(refreshForm?.get('client_secret')).toBe(`${prefix}-fixture-secret`)
      } finally {
        fetchSpy.mockRestore()
      }
    }
  )

  it('allows ordinary Google sign-in and approved connections', async () => {
    const signIn = await post('/sign-in/social', { provider: 'google', callbackURL: '/' })
    expect(signIn.status).toBe(200)
    expect(new URL((await signIn.json()).url).searchParams.get('client_id')).toBe(
      'google-verification-fixture-client'
    )
    const response = await post('/oauth2/link', { providerId: 'google-drive', callbackURL: '/' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(new URL(body.url).searchParams.get('scope')).toContain('auth/drive')
    expect(new URL(body.url).searchParams.get('client_id')).toBe(
      'google-verification-fixture-client'
    )
  })

  it.each(['google-ads', 'google-meet', 'google-chat'])(
    'uses the isolated client for %s without granting unrelated scopes',
    async (providerId) => {
      fixture.enabled = true
      const response = await post('/oauth2/link', { providerId, callbackURL: '/' })
      expect(response.status).toBe(200)
      const redirect = new URL((await response.json()).url)
      expect(redirect.searchParams.get('client_id')).toBe('isolated-review-fixture-client')
      expect(redirect.searchParams.get('include_granted_scopes')).toBe('false')
      expect(redirect.searchParams.get('scope')).not.toContain('auth/drive')
    }
  )

  it('allows a new connection only while the deployment flag is enabled', async () => {
    fixture.enabled = true
    const response = await post('/oauth2/link', { providerId: 'google-meet', callbackURL: '/' })
    expect(response.status).toBe(200)
    const body = await response.json()
    const redirect = new URL(body.url)
    expect(redirect.searchParams.get('scope')).toContain('auth/meetings.space.created')
    fixture.enabled = false
    const callback = await fetch(
      `${fixture.baseUrl}/api/auth/oauth2/callback/google-meet?state=${encodeURIComponent(redirect.searchParams.get('state') ?? '')}&code=fixture-code`,
      { headers: { cookie }, redirect: 'manual' }
    )
    expect(callback.status).toBe(403)
  })

  it.each(['google-meet', 'google-chat'] as const)(
    'also refuses managed %s enrollment before redirecting',
    async (provider) => {
      const adapter = adapters.createStandardOAuthCredentialGroupProviderAdapter(provider)
      const policy = await adapter.getPolicy(undefined, {})
      const context: CredentialGroupOAuthContext = {
        enrollmentId: 'enrollment-fixture',
        credentialGroupId: 'group-fixture',
        credentialGroupName: 'Fixture',
        workspaceId: 'workspace-fixture',
        workspaceName: 'Fixture',
        workspaceOwnerId: userId,
        email,
        enrollmentStatus: 'in_progress',
        option: {
          id: 'option-fixture',
          provider,
          label: 'Fixture',
          authorizationAppId: policy.authorizationAppId,
          requiredScopes: policy.requiredScopes,
          scopeVersion: policy.scopeVersion,
          required: true,
          status: 'active',
        },
        options: [],
      }
      await expect(adapter.prepareAuthorization(context, policy)).rejects.toMatchObject({
        statusCode: 403,
      })
      fixture.enabled = true
      const prepared = await adapter.prepareAuthorization(context, policy)
      const authorization = new URL(
        await prepared.buildAuthorizationUrl({ state: 'state-fixture', nonce: 'nonce-fixture' })
      )
      expect(authorization.searchParams.get('client_id')).toBe('isolated-review-fixture-client')
      fixture.enabled = false
      await expect(
        adapter.exchangeAndVerify({
          context,
          policy,
          code: 'fixture-code',
          attempt: {
            userId,
            workspaceId: context.workspaceId,
            email,
            state: 'state-fixture',
            provider,
            nonceHash: 'fixture-hash',
            enrollmentId: context.enrollmentId,
            credentialGroupId: context.credentialGroupId,
            optionId: context.option.id,
            authorizationAppId: policy.authorizationAppId,
            scopeVersion: policy.scopeVersion,
            requiredScopes: policy.requiredScopes,
            redirectUri: prepared.redirectUri,
            codeVerifier: prepared.codeVerifier,
            invitationToken: 'invitation-fixture',
            createdAt: Date.now(),
          },
        })
      ).rejects.toMatchObject({ statusCode: 403 })
    }
  )
})
