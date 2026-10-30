import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOAuthServerConfig: vi.fn(),
}))

vi.mock('@/lib/auth/auth', () => ({
  auth: { api: { getOAuthServerConfig: mocks.getOAuthServerConfig } },
}))

import { GET as getRootMetadata } from '@/app/.well-known/oauth-authorization-server/route'

const routes = [['root', getRootMetadata, '/.well-known/oauth-authorization-server']] as const

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
    setEnvFlags({ isAuthDisabled: false })
    mocks.getOAuthServerConfig.mockResolvedValue({
      issuer: 'https://sim.test/api/auth',
      authorization_endpoint: 'https://sim.test/api/auth/oauth2/authorize',
      token_endpoint: 'https://sim.test/api/auth/oauth2/token',
      registration_endpoint: 'https://sim.test/api/auth/oauth2/register',
      revocation_endpoint: 'https://sim.test/api/auth/oauth2/revoke',
      introspection_endpoint: 'https://sim.test/api/auth/oauth2/introspect',
      introspection_endpoint_auth_methods_supported: ['client_secret_basic', 'private_key_jwt'],
      token_endpoint_auth_methods_supported: [
        'none',
        'client_secret_basic',
        'client_secret_post',
        'private_key_jwt',
      ],
      token_endpoint_auth_signing_alg_values_supported: ['ES256'],
      revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'private_key_jwt'],
      dpop_signing_alg_values_supported: ['ES256'],
      backchannel_logout_supported: false,
      scopes_supported: ['offline_access', 'api:read', 'api:write'],
      code_challenge_methods_supported: ['S256'],
    })
  })

  it.each(routes)('serves equivalent metadata from the %s alias', async (_name, route, path) => {
    const response = await callRoute(route, path)
    const metadata = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(metadata).toEqual({
      issuer: 'https://sim.test/api/auth',
      authorization_endpoint: 'https://sim.test/api/auth/oauth2/authorize',
      token_endpoint: 'https://sim.test/api/auth/oauth2/token',
      registration_endpoint: 'https://sim.test/api/auth/oauth2/register',
      revocation_endpoint: 'https://sim.test/api/auth/oauth2/revoke',
      scopes_supported: ['offline_access', 'api:read', 'api:write'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      revocation_endpoint_auth_methods_supported: [
        'none',
        'client_secret_basic',
        'client_secret_post',
      ],
    })
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
