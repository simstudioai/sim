/** @vitest-environment node */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ register: vi.fn(), rateLimit: vi.fn() }))
vi.mock('better-auth/next-js', () => ({ toNextJsHandler: () => ({ POST: mocks.register }) }))
vi.mock('@/lib/core/rate-limiter', () => ({ enforceIpRateLimit: mocks.rateLimit }))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))

import { POST } from '@/app/api/auth/oauth2/register/route'

const client = {
  client_name: 'Test MCP client',
  redirect_uris: ['http://127.0.0.1:43123/callback'],
}
function request(body: object = client, headers: Record<string, string> = {}) {
  return new NextRequest('https://sim.test/api/auth/oauth2/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

afterAll(resetEnvFlagsMock)
beforeEach(() => {
  vi.clearAllMocks()
  setEnvFlags({ isAuthDisabled: false })
  mocks.rateLimit.mockResolvedValue(null)
  mocks.register.mockImplementation(async (req: Request) =>
    Response.json(
      {
        ...(await req.clone().json()),
        client_id: 'client-1',
        client_id_issued_at: 1788000000,
        token_endpoint_auth_method: 'none',
      },
      { status: 201 }
    )
  )
})

describe('MCP public client registration', () => {
  it('registers a bounded public Search client without ambient credentials or privileged metadata', async () => {
    const response = await POST(
      request(
        { ...client, skip_consent: true, require_pkce: false, metadata: { elevated: true } },
        {
          Cookie: 'session=private',
          Authorization: 'Bearer private',
          'x-forwarded-for': '203.0.113.10',
        }
      )
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      ...client,
      client_id: 'client-1',
      token_endpoint_auth_method: 'none',
      scope: 'search:read offline_access',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
    const forwarded: Request = mocks.register.mock.calls[0][0]
    expect(forwarded.headers.has('cookie')).toBe(false)
    expect(forwarded.headers.has('authorization')).toBe(false)
    expect(forwarded.headers.get('x-forwarded-for')).toBe('203.0.113.10')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns only registered Search scopes when clients request all issuer scopes', async () => {
    const response = await POST(
      request({ ...client, scope: 'offline_access api:read api:write search:read' })
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ scope: 'search:read offline_access' })
    const forwarded: Request = mocks.register.mock.calls[0][0]
    expect(await forwarded.json()).toMatchObject({
      scope: 'search:read offline_access',
      require_pkce: true,
    })
  })

  it('registers Cursor browser and native callbacks together with PKCE required', async () => {
    const redirectUris = [
      'cursor://anysphere.cursor-mcp/oauth/callback',
      'https://www.cursor.com/agents/mcp/oauth/callback',
      'http://localhost:8787/callback',
    ]
    const response = await POST(request({ client_name: 'Cursor', redirect_uris: redirectUris }))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ redirect_uris: redirectUris })
    const forwarded: Request = mocks.register.mock.calls[0][0]
    expect(await forwarded.json()).toMatchObject({
      redirect_uris: redirectUris,
      require_pkce: true,
      token_endpoint_auth_method: 'none',
    })
  })

  it.each(['client_secret_post', 'client_secret_basic'])(
    'lets the provider negotiate Claude-style %s registration to a public client',
    async (authMethod) => {
      const response = await POST(
        request({
          client_name: 'Claude',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
          token_endpoint_auth_method: authMethod,
          scope: 'search:read offline_access',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          application_type: 'web',
          client_secret: 'must-not-be-forwarded',
        })
      )
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.token_endpoint_auth_method).toBe('none')
      expect(body).not.toHaveProperty('client_secret')
      const forwarded: Request = mocks.register.mock.calls[0][0]
      expect(await forwarded.json()).toEqual({
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        token_endpoint_auth_method: authMethod,
        scope: 'search:read offline_access',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        require_pkce: true,
      })
    }
  )

  it.each([
    { ...client, scope: 'api:write' },
    { ...client, token_endpoint_auth_method: 'private_key_jwt' },
    { ...client, token_endpoint_auth_method: 'unsupported' },
    { ...client, grant_types: ['client_credentials'] },
    { ...client, redirect_uris: ['http://evil.example/callback'] },
    { ...client, redirect_uris: ['https://*.example/callback'] },
    { ...client, redirect_uris: ['https://example.com/callback#fragment'] },
    { ...client, redirect_uris: ['https://user:password@example.com/callback'] },
    { ...client, redirect_uris: ['cursor://anysphere.cursor-mcp/other'] },
    { ...client, redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback?target=other'] },
    { ...client, redirect_uris: ['cursor://other/oauth/callback'] },
    { ...client, redirect_uris: ['javascript:alert(1)'] },
    { ...client, redirect_uris: ['file:///oauth/callback'] },
    { ...client, redirect_uris: ['data:text/html,callback'] },
    { ...client, redirect_uris: ['unknown-app://oauth/callback'] },
    { ...client, redirect_uris: Array(11).fill('https://example.com/callback') },
    { ...client, client_name: 'a'.repeat(129) },
  ])('rejects unsupported or unsafe client metadata: %o', async (body) => {
    expect((await POST(request(body))).status).toBe(400)
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('admits before reading metadata or creating a client', async () => {
    mocks.rateLimit.mockResolvedValue(Response.json({ error: 'Rate limited' }, { status: 429 }))
    expect((await POST(request())).status).toBe(429)
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('does not enable OAuth in auth-disabled deployments', async () => {
    setEnvFlags({ isAuthDisabled: true })
    expect((await POST(request())).status).toBe(404)
    expect(mocks.register).not.toHaveBeenCalled()
  })
})
