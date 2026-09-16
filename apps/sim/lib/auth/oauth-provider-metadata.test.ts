/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOAuthServerConfig: vi.fn(),
}))

vi.mock('@/lib/auth/auth', () => ({
  auth: { api: { getOAuthServerConfig: mocks.getOAuthServerConfig } },
}))

import { GET as getIssuerDerivedMetadata } from '@/app/.well-known/oauth-authorization-server/api/auth/route'
import { GET as getRootMetadata } from '@/app/.well-known/oauth-authorization-server/route'
import { GET as getIssuerPrefixedMetadata } from '@/app/api/auth/.well-known/oauth-authorization-server/route'

const routes = [
  ['root', getRootMetadata, '/.well-known/oauth-authorization-server'],
  ['issuer-derived', getIssuerDerivedMetadata, '/.well-known/oauth-authorization-server/api/auth'],
  [
    'issuer-prefixed',
    getIssuerPrefixedMetadata,
    '/api/auth/.well-known/oauth-authorization-server',
  ],
] as const

async function callRoute(
  route: (
    request: NextRequest,
    context?: { params?: Promise<Record<string, string>> }
  ) => Promise<Response>,
  path: string
): Promise<Response> {
  return route(new NextRequest(`https://sim.test${path}`), { params: undefined })
}

afterAll(resetEnvFlagsMock)

describe('OAuth provider metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isAuthDisabled: false })
    mocks.getOAuthServerConfig.mockResolvedValue({
      issuer: 'https://sim.test/api/auth',
      authorization_endpoint: 'https://sim.test/api/auth/oauth2/authorize',
      token_endpoint: 'https://sim.test/api/auth/oauth2/token',
      revocation_endpoint: 'https://sim.test/api/auth/oauth2/revoke',
      introspection_endpoint: 'https://sim.test/api/auth/oauth2/introspect',
      introspection_endpoint_auth_methods_supported: ['client_secret_post'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
      revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: ['offline_access', 'api:read', 'api:write'],
    })
  })

  it.each(routes)('serves equivalent metadata from the %s alias', async (_name, route, path) => {
    const response = await callRoute(route, path)
    const metadata = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(metadata).toMatchObject({
      issuer: 'https://sim.test/api/auth',
      authorization_endpoint: 'https://sim.test/api/auth/oauth2/authorize',
      token_endpoint: 'https://sim.test/api/auth/oauth2/token',
      revocation_endpoint: 'https://sim.test/api/auth/oauth2/revoke',
    })
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(['client_secret_post', 'none'])
    expect(metadata.revocation_endpoint_auth_methods_supported).toEqual([
      'none',
      'client_secret_post',
    ])
    expect(metadata.introspection_endpoint).toBeUndefined()
    expect(metadata.introspection_endpoint_auth_methods_supported).toBeUndefined()
    expect(metadata.scopes_supported).toEqual(['offline_access', 'api:read', 'api:write'])
    expect(metadata.userinfo_endpoint).toBeUndefined()
    expect(metadata.jwks_uri).toBeUndefined()
  })

  it.each(routes)(
    'returns 404 from the %s alias when authentication is disabled',
    async (_name, route, path) => {
      setEnvFlags({ isAuthDisabled: true })

      const response = await callRoute(route, path)

      expect(response.status).toBe(404)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(mocks.getOAuthServerConfig).not.toHaveBeenCalled()
    }
  )
})
