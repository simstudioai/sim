import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildConnectorProviders } from '@/lib/auth/connectors/providers'
import { refreshOAuthToken } from '@/lib/oauth/oauth'

beforeEach(() => {
  setEnv({ FIGMA_CLIENT_ID: 'fixture-client', FIGMA_CLIENT_SECRET: 'fixture-secret' })
})
afterEach(() => {
  resetEnvMock()
})

function connector() {
  const provider = buildConnectorProviders().find((entry) => entry.providerId === 'figma')
  if (!provider?.getUserInfo) throw new Error('Figma connector is unavailable')
  return provider
}

describe('Figma OAuth protocol', () => {
  it('exchanges codes with the documented form and records granted scopes when Figma omits them', async () => {
    let request: Request | undefined
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init)
      return Response.json({
        access_token: 'initial-access',
        refresh_token: 'reusable-refresh',
        expires_in: 7776000,
      })
    })
    const getToken = connector().getToken
    if (!getToken) throw new Error('Figma code exchange is unavailable')
    const tokens = await getToken({
      code: 'fixture-code',
      redirectURI: 'http://localhost:3102/api/auth/oauth2/callback/figma',
    })
    expect(tokens.accessToken).toBe('initial-access')
    expect(tokens.refreshToken).toBe('reusable-refresh')
    expect(tokens.scopes).toEqual([
      'current_user:read',
      'file_metadata:read',
      'file_content:read',
      'file_comments:read',
      'file_comments:write',
      'file_versions:read',
      'library_content:read',
    ])
    if (!request) throw new Error('Code exchange did not make a request')
    expect(request.url).toBe('https://api.figma.com/v1/oauth/token')
    expect(request.headers.get('Authorization')).toBe(
      `Basic ${Buffer.from('fixture-client:fixture-secret').toString('base64')}`
    )
    const body = new URLSearchParams(await request.text())
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code',
      code: 'fixture-code',
      redirect_uri: 'http://localhost:3102/api/auth/oauth2/callback/figma',
    })
  })

  it('refreshes with Basic authentication and a refresh-token-only form, preserving reusable tokens', async () => {
    let request: Request | undefined
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init)
      return Response.json({ access_token: 'fresh-access', expires_in: 7776000 })
    })
    const result = await refreshOAuthToken('figma', 'reusable-refresh')
    expect(result).toEqual({
      ok: true,
      accessToken: 'fresh-access',
      expiresIn: 7776000,
      refreshToken: 'reusable-refresh',
    })
    if (!request) throw new Error('Refresh did not make a request')
    expect(request.url).toBe('https://api.figma.com/v1/oauth/refresh')
    expect(request.headers.get('Authorization')).toBe(
      `Basic ${Buffer.from('fixture-client:fixture-secret').toString('base64')}`
    )
    expect(request.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded')
    expect(await request.text()).toBe('refresh_token=reusable-refresh')
  })

  it('keeps large profile identifiers as strings and isolates connector identity from Sim sign-in', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        id: '123456789012345678901',
        handle: 'Fixture Designer',
        img_url: 'https://example.com/avatar.png',
        email: 'designer@example.com',
      })
    )
    const info = await connector().getUserInfo?.({ accessToken: 'fixture-access' })
    expect(info?.id).toContain('123456789012345678901')
    expect(info?.name).toBe('Fixture Designer')
    expect(info?.email).not.toBe('designer@example.com')
    expect(info?.emailVerified).toBe(false)
  })

  it.each([{ id: 123, handle: 'Designer' }, { handle: 'Designer' }, null])(
    'rejects invalid profile identity: %j',
    async (profile) => {
      vi.stubGlobal('fetch', async () => Response.json(profile))
      expect(await connector().getUserInfo?.({ accessToken: 'fixture-access' })).toBeNull()
    }
  )
})
