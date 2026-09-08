/**
 * @vitest-environment node
 */
import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const handlerMocks = vi.hoisted(() => ({
  betterAuthGET: vi.fn(),
  betterAuthPOST: vi.fn(),
  credentialGroupCallback: vi.fn(),
  credentialGroupRateLimit: vi.fn(),
  ensureAnonymousUserExists: vi.fn(),
  createAnonymousSession: vi.fn(() => ({
    user: { id: 'anon' },
    session: { id: 'anon-session' },
  })),
  oauthEnabled: vi.fn(),
}))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({
    GET: handlerMocks.betterAuthGET,
    POST: handlerMocks.betterAuthPOST,
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: { handler: {} },
}))
vi.mock('@/lib/auth/oauth-provider-feature', () => ({
  isOAuthProviderEnabled: handlerMocks.oauthEnabled,
}))

vi.mock('@/lib/auth/anonymous', () => ({
  ensureAnonymousUserExists: handlerMocks.ensureAnonymousUserExists,
  createAnonymousSession: handlerMocks.createAnonymousSession,
}))

vi.mock('@/lib/credential-groups/oauth-state', () => ({
  isCredentialGroupOAuthState: (state: string) => state.startsWith('cg_'),
}))

vi.mock('@/lib/credential-groups/providers', () => ({
  CREDENTIAL_GROUP_PROVIDER_IDS: ['gmail', 'google-calendar', 'confluence', 'jira', 'slack'],
  CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS: ['gmail', 'google-calendar', 'confluence', 'jira'],
  getCredentialGroupStandardOAuthProviderFromProviderId: (providerId: string) => {
    const providers: Record<string, string> = {
      'google-email': 'gmail',
      'google-calendar': 'google-calendar',
      confluence: 'confluence',
      jira: 'jira',
    }
    const provider = providers[providerId]
    if (!provider) throw new Error(`Unsupported managed OAuth provider: ${providerId}`)
    return provider
  },
}))

vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforcePublicCredentialGroupIpRateLimit: handlerMocks.credentialGroupRateLimit,
}))

vi.mock('@/app/api/credential-groups/oauth-callback', () => ({
  handleCredentialGroupOAuthCallback: handlerMocks.credentialGroupCallback,
}))

import { GET, POST } from '@/app/api/auth/[...all]/route'

afterAll(resetEnvFlagsMock)
beforeEach(() => handlerMocks.oauthEnabled.mockResolvedValue(true))

describe('auth catch-all route managed OAuth callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlerMocks.credentialGroupRateLimit.mockResolvedValue(null)
    handlerMocks.credentialGroupCallback.mockResolvedValue(new Response(null, { status: 204 }))
  })

  it.each([
    ['google-email', 'gmail'],
    ['google-calendar', 'google-calendar'],
    ['confluence', 'confluence'],
    ['jira', 'jira'],
  ])('dispatches a managed %s callback by its state prefix', async (providerId, provider) => {
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      `http://localhost:3000/api/auth/oauth2/callback/${providerId}?state=cg_attempt&code=code-1`
    )

    const response = await GET(request)

    expect(response.status).toBe(204)
    expect(handlerMocks.credentialGroupRateLimit).toHaveBeenCalledWith(request, 'oauth-callback')
    expect(handlerMocks.credentialGroupCallback).toHaveBeenCalledWith({
      request,
      provider,
      query: { state: 'cg_attempt', code: 'code-1' },
      limited: null,
    })
    expect(handlerMocks.betterAuthGET).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'preserves connector callbacks when the provider is enabled=%s',
    async (enabled) => {
      handlerMocks.oauthEnabled.mockResolvedValue(enabled)
      handlerMocks.betterAuthGET.mockResolvedValueOnce(new Response(null, { status: 204 }))
      const request = createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/auth/oauth2/callback/jira?state=better-auth-state&code=code-1'
      )

      const response = await GET(request)

      expect(response.status).toBe(204)
      expect(handlerMocks.betterAuthGET).toHaveBeenCalledWith(request)
      expect(handlerMocks.credentialGroupCallback).not.toHaveBeenCalled()
      expect(handlerMocks.oauthEnabled).not.toHaveBeenCalled()
    }
  )

  it('rejects a managed state sent to an unsupported connector callback', async () => {
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/auth/oauth2/callback/unknown?state=cg_attempt&code=code-1'
    )

    const response = await GET(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported managed OAuth provider.',
    })
    expect(handlerMocks.betterAuthGET).not.toHaveBeenCalled()
    expect(handlerMocks.credentialGroupCallback).not.toHaveBeenCalled()
  })
})

describe('auth catch-all route (DISABLE_AUTH get-session)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isAuthDisabled: false })
  })

  it('returns anonymous session in better-auth response envelope when auth is disabled', async () => {
    setEnvFlags({ isAuthDisabled: true })

    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/auth/get-session'
    )

    const res = await GET(req)
    const json = await res.json()

    expect(handlerMocks.ensureAnonymousUserExists).toHaveBeenCalledTimes(1)
    expect(handlerMocks.betterAuthGET).not.toHaveBeenCalled()
    expect(json).toEqual({
      user: { id: 'anon' },
      session: { id: 'anon-session' },
    })
  })

  it('delegates to better-auth handler when auth is enabled', async () => {
    setEnvFlags({ isAuthDisabled: false })

    const { NextResponse } = await import('next/server')
    handlerMocks.betterAuthGET.mockResolvedValueOnce(
      new NextResponse(JSON.stringify({ data: { ok: true } }), {
        headers: { 'content-type': 'application/json' },
      })
    )

    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/auth/get-session'
    )

    const res = await GET(req)
    const json = await res.json()

    expect(handlerMocks.ensureAnonymousUserExists).not.toHaveBeenCalled()
    expect(handlerMocks.betterAuthGET).toHaveBeenCalledTimes(1)
    expect(json).toEqual({ data: { ok: true } })
  })
})

describe('auth catch-all route organization mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks Better Auth organization mutation endpoints that bypass app lifecycle rules', async () => {
    const req = createMockRequest(
      'POST',
      undefined,
      {},
      'http://localhost:3000/api/auth/organization/create'
    )

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(handlerMocks.betterAuthPOST).not.toHaveBeenCalled()
    expect(json).toEqual({
      error: 'Organization mutations are handled by application API routes.',
    })
  })

  it('allows safe Better Auth organization session endpoints', async () => {
    const { NextResponse } = await import('next/server')
    handlerMocks.betterAuthPOST.mockResolvedValueOnce(
      new NextResponse(JSON.stringify({ data: { ok: true } }), {
        headers: { 'content-type': 'application/json' },
      })
    )

    const req = createMockRequest(
      'POST',
      undefined,
      {},
      'http://localhost:3000/api/auth/organization/set-active'
    )

    const res = await POST(req)
    const json = await res.json()

    expect(handlerMocks.betterAuthPOST).toHaveBeenCalledTimes(1)
    expect(json).toEqual({ data: { ok: true } })
  })
})

describe('auth catch-all route SSO provider mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    'sso/update-provider',
    'sso/delete-provider',
    'sso/request-domain-verification',
    'sso/verify-domain',
  ])('blocks the plugin-served %s endpoint', async (path) => {
    const req = createMockRequest('POST', undefined, {}, `http://localhost:3000/api/auth/${path}`)

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(handlerMocks.betterAuthPOST).not.toHaveBeenCalled()
    expect(json).toEqual({
      error: 'SSO provider mutations are handled by application API routes.',
    })
  })

  it.each([
    'sso/saml2/callback/acme',
    'sso/saml2/sp/acs/acme',
    'sso/saml2/sp/slo/acme',
    'sso/saml2/logout/acme',
  ])('allows the SAML protocol endpoint %s', async (path) => {
    const { NextResponse } = await import('next/server')
    handlerMocks.betterAuthPOST.mockResolvedValueOnce(
      new NextResponse(JSON.stringify({ data: { ok: true } }), {
        headers: { 'content-type': 'application/json' },
      })
    )

    const req = createMockRequest('POST', undefined, {}, `http://localhost:3000/api/auth/${path}`)

    const res = await POST(req)
    const json = await res.json()

    expect(handlerMocks.betterAuthPOST).toHaveBeenCalledTimes(1)
    expect(json).toEqual({ data: { ok: true } })
  })

  it('leaves the SSO sign-in endpoint reachable', async () => {
    const { NextResponse } = await import('next/server')
    handlerMocks.betterAuthPOST.mockResolvedValueOnce(
      new NextResponse(JSON.stringify({ data: { url: 'https://idp.example.com' } }), {
        headers: { 'content-type': 'application/json' },
      })
    )

    const req = createMockRequest(
      'POST',
      undefined,
      {},
      'http://localhost:3000/api/auth/sign-in/sso'
    )

    const res = await POST(req)

    expect(handlerMocks.betterAuthPOST).toHaveBeenCalledTimes(1)
    expect(await res.json()).toEqual({ data: { url: 'https://idp.example.com' } })
  })
})

describe('OAuth provider client endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlerMocks.betterAuthPOST.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    )
  })

  it.each(['.well-known/openid-configuration', 'oauth2/end-session', 'oauth2/userinfo'])(
    'does not expose the OIDC-only %s endpoint',
    async (path) => {
      const getResponse = await GET(
        createMockRequest('GET', undefined, {}, `http://localhost:3000/api/auth/${path}`)
      )
      const postResponse = await POST(
        createMockRequest('POST', {}, {}, `http://localhost:3000/api/auth/${path}`)
      )

      expect(getResponse.status).toBe(404)
      expect(postResponse.status).toBe(404)
      expect(getResponse.headers.get('cache-control')).toBe('no-store')
      expect(handlerMocks.betterAuthGET).not.toHaveBeenCalled()
      expect(handlerMocks.betterAuthPOST).not.toHaveBeenCalled()
    }
  )

  /**
   * The plugin gates client creation on a session alone, so without this any
   * signed-in user could register a client with arbitrary redirect URIs and
   * the full scope set. Nothing must reach the plugin.
   */
  it.each([
    'oauth2/create-client',
    'oauth2/update-client',
    'oauth2/delete-client',
    'oauth2/client/rotate-secret',
    'oauth2/register',
    'oauth2/introspect',
    'oauth2/token',
    'oauth2/revoke',
    'oauth2/anything-a-future-version-adds',
  ])('refuses POST /%s without reaching Better Auth', async (path) => {
    const req = createMockRequest('POST', {}, {}, `http://localhost:3000/api/auth/${path}`)

    const res = await POST(req)

    expect(res.status).toBe(404)
    expect(handlerMocks.betterAuthPOST).not.toHaveBeenCalled()
  })

  it.each([
    'oauth2/consent',
    'oauth2/continue',
    'oauth2/public-client-prelogin',
    'oauth2/callback/jira',
  ])('lets the protocol endpoint %s through', async (path) => {
    const req = createMockRequest('POST', {}, {}, `http://localhost:3000/api/auth/${path}`)

    await POST(req)

    expect(handlerMocks.betterAuthPOST).toHaveBeenCalledTimes(1)
  })

  it.each(['oauth2/consent', 'oauth2/continue', 'oauth2/public-client-prelogin'])(
    'stops serving %s after the runtime flag changes',
    async (path) => {
      const request = () =>
        createMockRequest('POST', {}, {}, `http://localhost:3000/api/auth/${path}`)
      expect((await POST(request())).status).toBe(200)
      handlerMocks.betterAuthPOST.mockClear()

      handlerMocks.oauthEnabled.mockResolvedValue(false)
      const disabled = await POST(request())
      expect(disabled.status).toBe(404)
      expect(disabled.headers.get('cache-control')).toBe('no-store')
      expect(handlerMocks.betterAuthPOST).not.toHaveBeenCalled()

      handlerMocks.oauthEnabled.mockResolvedValue(true)
      expect((await POST(request())).status).toBe(200)
      expect(handlerMocks.betterAuthPOST).toHaveBeenCalledOnce()
    }
  )

  it.each([true, false])(
    'preserves connector POST callbacks when the provider is enabled=%s',
    async (enabled) => {
      handlerMocks.oauthEnabled.mockResolvedValue(enabled)
      const request = createMockRequest(
        'POST',
        {},
        {},
        'http://localhost:3000/api/auth/oauth2/callback/jira'
      )
      expect((await POST(request)).status).toBe(200)
      expect(handlerMocks.betterAuthPOST).toHaveBeenCalledExactlyOnceWith(request)
      expect(handlerMocks.oauthEnabled).not.toHaveBeenCalled()
    }
  )

  it.each([true, false])(
    'preserves authenticated connector linking when the OAuth provider is enabled=%s',
    async (enabled) => {
      handlerMocks.oauthEnabled.mockResolvedValue(enabled)
      const request = createMockRequest(
        'POST',
        { providerId: 'google-email', callbackURL: 'http://localhost:3000/workspace' },
        { cookie: 'better-auth.session_token=existing-session' },
        'http://localhost:3000/api/auth/oauth2/link'
      )

      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(handlerMocks.betterAuthPOST).toHaveBeenCalledExactlyOnceWith(request)
      expect(handlerMocks.oauthEnabled).not.toHaveBeenCalled()
    }
  )
})
