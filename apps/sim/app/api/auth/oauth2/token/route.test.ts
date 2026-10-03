import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { rateLimiterMock, rateLimiterMockFns } from '@sim/testing/mocks/rate-limiter.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  betterAuthPost: vi.fn(async () => new Response('delegated', { status: 201 })),
  rotate: vi.fn(),
  validateClient: vi.fn(),
}))

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({ POST: mocks.betterAuthPost }),
}))
vi.mock('@/lib/auth/oauth-provider-adapter-guard', () => ({
  withOAuthProviderIssuanceCompensation: (work: () => Promise<Response>) => work(),
}))
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)
vi.mock('@/lib/auth/oauth-token-family', () => ({
  rotateOAuthRefreshToken: mocks.rotate,
  validateOAuthClientCredentials: mocks.validateClient,
}))

import { bindOAuthIssuedResource, getOAuthIssuedResource } from '@/lib/auth/oauth-resource'
import { POST } from '@/app/api/auth/oauth2/token/route'

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.example')

function tokenRequest(body: string) {
  return new NextRequest('http://localhost/api/auth/oauth2/token', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

afterAll(resetEnvFlagsMock)

describe('OAuth token route', () => {
  beforeEach(() => {
    setEnvFlags({ isAuthDisabled: false })
    mocks.rotate.mockResolvedValue({
      success: true,
      value: {
        accessToken: 'sim_oat_next',
        refreshToken: 'sim_ort_next',
        expiresIn: 3600,
        expiresAt: 2_000_000_000,
        scope: 'offline_access api:read',
      },
    })
    mocks.validateClient.mockResolvedValue({ success: true, value: undefined })
  })

  it('rejects an authorization-code client using the wrong registered auth method', async () => {
    mocks.validateClient.mockResolvedValue({
      success: false,
      error: 'invalid_client',
      description: 'Client authentication method does not match registration.',
    })
    const basic = Buffer.from('client:secret').toString('base64')
    const request = tokenRequest('grant_type=authorization_code&code=code')
    request.headers.set('authorization', `Basic ${basic}`)

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('Basic')
    expect(mocks.betterAuthPost).not.toHaveBeenCalled()
  })

  it('normalizes delegated invalid-code and PKCE failures', async () => {
    mocks.betterAuthPost.mockResolvedValueOnce(
      Response.json({ error: 'invalid_grant', error_description: 'invalid code' }, { status: 401 })
    )
    const invalidCode = await POST(
      tokenRequest('grant_type=authorization_code&client_id=sim-cli&code=bad')
    )
    expect(invalidCode.status).toBe(400)
    expect(invalidCode.headers.get('cache-control')).toBe('no-store')
    expect(invalidCode.headers.get('pragma')).toBe('no-cache')

    mocks.betterAuthPost.mockResolvedValueOnce(
      Response.json(
        { error: 'invalid_request', error_description: 'code verification failed' },
        { status: 401 }
      )
    )
    const invalidVerifier = await POST(
      tokenRequest('grant_type=authorization_code&client_id=sim-cli&code=bad')
    )
    expect(invalidVerifier.status).toBe(400)
    await expect(invalidVerifier.json()).resolves.toMatchObject({ error: 'invalid_grant' })
  })

  it.each([
    ['invalid_request', 'Either code_verifier or client_secret is required'],
    ['invalid_request', 'PKCE is required for this client'],
    ['invalid_request', 'redirect_uri mismatch'],
    ['invalid_user', 'missing user, user may have been deleted'],
    ['invalid_user', 'session no longer exists'],
  ])('normalizes a consumed code failure from %s to invalid_grant', async (error, description) => {
    mocks.betterAuthPost.mockResolvedValueOnce(
      Response.json({ error, error_description: description }, { status: 401 })
    )

    const response = await POST(
      tokenRequest('grant_type=authorization_code&client_id=sim-cli&code=code')
    )

    expect(response.status).toBe(400)
    expect(response.headers.has('www-authenticate')).toBe(false)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      error_description: description,
    })
  })

  it.each(['short', `${'a'.repeat(42)}=`, 'a'.repeat(129)])(
    'rejects a malformed PKCE verifier before a code can be consumed',
    async (codeVerifier) => {
      const response = await POST(
        tokenRequest(
          `grant_type=authorization_code&client_id=sim-cli&code=code&code_verifier=${encodeURIComponent(codeVerifier)}`
        )
      )

      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('no-store')
      await expect(response.json()).resolves.toEqual({
        error: 'invalid_grant',
        error_description: 'Code verifier is invalid.',
      })
      expect(mocks.validateClient).not.toHaveBeenCalled()
      expect(mocks.betterAuthPost).not.toHaveBeenCalled()
    }
  )

  it('does not challenge an authenticated client for a code bound to another client', async () => {
    mocks.betterAuthPost.mockResolvedValueOnce(
      Response.json(
        { error: 'invalid_client', error_description: 'invalid client_id' },
        { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="oauth2"' } }
      )
    )
    const request = tokenRequest('grant_type=authorization_code&code=code')
    request.headers.set('authorization', `Basic ${Buffer.from('client:secret').toString('base64')}`)

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(response.headers.has('www-authenticate')).toBe(false)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_grant' })
  })

  it('normalizes Better Auth validation errors without exposing its internal shape', async () => {
    mocks.betterAuthPost.mockResolvedValueOnce(
      Response.json(
        {
          message: '[body.redirect_uri] Invalid URL; received not-a-url',
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      )
    )

    const response = await POST(
      tokenRequest(
        'grant_type=authorization_code&client_id=sim-cli&code=code&redirect_uri=not-a-url'
      )
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'Token request is invalid.',
    })
  })

  it('redacts delegated JSON server failures to a bounded OAuth error', async () => {
    mocks.betterAuthPost.mockResolvedValueOnce(
      Response.json(
        { message: 'internal database details', stack: 'secret stack' },
        { status: 503 }
      )
    )

    const response = await POST(
      tokenRequest('grant_type=authorization_code&client_id=sim-cli&code=code')
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'server_error',
      error_description: 'Token exchange failed.',
    })
  })

  it.each(['authorization_code', 'refresh_token'])(
    'rejects an unenforceable resource audience for %s grants',
    async (grantType) => {
      const response = await POST(
        tokenRequest(
          `grant_type=${grantType}&client_id=sim-cli&code=code&refresh_token=sim_ort_current&resource=https%3A%2F%2Fapi.example`
        )
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: 'invalid_target' })
      expect(mocks.betterAuthPost).not.toHaveBeenCalled()
      expect(mocks.rotate).not.toHaveBeenCalled()
    }
  )

  it('binds the verified code resource while keeping native opaque issuance resource-free', async () => {
    const resource = 'https://sim.example/api/mcp/search/organizations/one'
    mocks.betterAuthPost.mockImplementationOnce(async (request: Request) => {
      const form = new URLSearchParams(await request.text())
      expect(form.has('resource')).toBe(false)
      bindOAuthIssuedResource({
        verificationValue: { query: { resource } },
        scopes: ['search:read'],
      })
      expect(getOAuthIssuedResource(['search:read'])).toBe(resource)
      return new Response('{}', { status: 200 })
    })
    const response = await POST(
      tokenRequest(
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'search-client',
          code: 'code',
          resource,
        }).toString()
      )
    )
    expect(response.status).toBe(200)
  })

  it.each(['authorization_code', 'refresh_token'])(
    'rejects removed workspace resources before %s issuance',
    async (grantType) => {
      const response = await POST(
        tokenRequest(
          new URLSearchParams({
            grant_type: grantType,
            client_id: 'search-client',
            code: 'code',
            refresh_token: 'sim_ort_original',
            resource: 'https://sim.example/api/mcp/search/workspace-one',
          }).toString()
        )
      )
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: 'invalid_target' })
      expect(mocks.betterAuthPost).not.toHaveBeenCalled()
      expect(mocks.rotate).not.toHaveBeenCalled()
    }
  )

  it('applies rate admission before parsing and prevents caching a refusal', async () => {
    rateLimiterMockFns.mockEnforceIpRateLimit.mockResolvedValueOnce(
      new Response('limited', { status: 429 })
    )
    const request = createMockRequest({
      method: 'POST',
      url: 'http://localhost/api/auth/oauth2/token',
      headers: { 'content-type': 'application/json' },
      rawBody: '{}',
    })

    const response = await POST(request)

    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
  })

  it.each([
    ['authorization code exchange', () => mocks.betterAuthPost.mockRejectedValueOnce(new Error())],
    ['refresh rotation', () => mocks.rotate.mockRejectedValueOnce(new Error())],
  ])('normalizes an unexpected %s failure', async (grant, fail) => {
    fail()
    const body =
      grant === 'authorization code exchange'
        ? 'grant_type=authorization_code&client_id=sim-cli&code=code'
        : 'grant_type=refresh_token&client_id=sim-cli&refresh_token=sim_ort_current'

    const response = await POST(tokenRequest(body))

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    await expect(response.json()).resolves.toEqual({
      error: 'server_error',
      error_description: 'Token endpoint failed.',
    })
  })

  it('requires authentication before token admission or issuance', async () => {
    setEnvFlags({ isAuthDisabled: true })
    const response = await POST(
      tokenRequest('grant_type=refresh_token&client_id=sim-cli&refresh_token=sim_ort_old')
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.rotate).not.toHaveBeenCalled()
    expect(rateLimiterMockFns.mockEnforceIpRateLimit).not.toHaveBeenCalled()
    expect(mocks.betterAuthPost).not.toHaveBeenCalled()
  })
})
