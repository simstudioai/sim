/** @vitest-environment node */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getManagedOAuthConnectorPolicy } from '@/lib/auth/connectors/managed-oauth'
import { buildConnectorProviders } from '@/lib/auth/connectors/providers'
import {
  createGitHubRepositoriesProvider,
  parseGitHubRepositoriesTokenResponse,
  verifyGitHubRepositoriesIdentity,
} from '@/lib/oauth/github-repositories'
import { refreshOAuthToken } from '@/lib/oauth/oauth'

const tokenResponse = {
  access_token: 'ghu_access',
  refresh_token: 'ghr_refresh',
  expires_in: 28800,
  refresh_token_expires_in: 15897600,
  token_type: 'bearer',
  scope: '',
}
const user = { id: 1234, login: 'octocat', type: 'User', name: 'Octocat' }
const primary = { email: 'personal@example.com', primary: true, verified: true }
const work = { email: 'work@example.com', primary: false, verified: true }

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}

beforeEach(() => {
  setEnv({
    GITHUB_CLIENT_ID: 'sign-in-client',
    GITHUB_CLIENT_SECRET: 'sign-in-secret',
    GITHUB_APP_CLIENT_ID: 'app-client',
    GITHUB_APP_CLIENT_SECRET: 'app-secret',
  })
})

afterEach(() => {
  resetEnvMock()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('GitHub App provider', () => {
  it('registers a distinct scopeless provider without reusing sign-in credentials', () => {
    const provider = buildConnectorProviders().find(
      (candidate) => candidate.providerId === 'github-repositories'
    )
    expect(provider).toMatchObject({
      clientId: 'app-client',
      clientSecret: 'app-secret',
      scopes: [],
      pkce: true,
    })
    expect(buildConnectorProviders().some((candidate) => candidate.providerId === 'github')).toBe(
      false
    )
  })

  it('stays unavailable when only sign-in credentials are configured', () => {
    setEnv({ GITHUB_APP_CLIENT_ID: undefined, GITHUB_APP_CLIENT_SECRET: undefined })
    expect(
      buildConnectorProviders().some((candidate) => candidate.providerId === 'github-repositories')
    ).toBe(false)
  })

  it('exchanges a PKCE code and preserves both token expirations', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T00:00:00Z'))
    const fetchMock = vi.fn().mockResolvedValue(response(tokenResponse))
    vi.stubGlobal('fetch', fetchMock)
    const provider = createGitHubRepositoriesProvider({
      clientId: 'app-client',
      clientSecret: 'app-secret',
      redirectURI: 'https://sim.example/callback',
    })
    const result = await provider.getToken?.({
      code: 'code',
      codeVerifier: 'verifier',
      redirectURI: 'https://sim.example/managed-callback',
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://github.com/login/oauth/access_token')
    expect(init.headers.Accept).toBe('application/json')
    expect(Object.fromEntries(init.body)).toEqual({
      client_id: 'app-client',
      client_secret: 'app-secret',
      code: 'code',
      code_verifier: 'verifier',
      redirect_uri: 'https://sim.example/managed-callback',
    })
    expect(result).toMatchObject({
      accessToken: 'ghu_access',
      refreshToken: 'ghr_refresh',
      scopes: [],
      accessTokenExpiresAt: new Date('2026-09-05T08:00:00Z'),
      refreshTokenExpiresAt: new Date(Date.now() + 15897600 * 1000),
    })
  })

  it('requires PKCE before sending a code or client secret', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const provider = createGitHubRepositoriesProvider({
      clientId: 'app-client',
      clientSecret: 'app-secret',
      redirectURI: 'https://sim.example/callback',
    })
    await expect(
      provider.getToken?.({ code: 'code', redirectURI: 'https://sim.example/callback' })
    ).rejects.toThrow('PKCE')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { access_token: 'gho_oauth-app-token' },
    { access_token: 'ghs_installation-token' },
    { refresh_token: undefined },
    { refresh_token_expires_in: undefined },
    { expires_in: 0 },
    { scope: 'repo' },
  ])('rejects non-App or non-expiring token response %j', (override) => {
    expect(() => parseGitHubRepositoriesTokenResponse({ ...tokenResponse, ...override })).toThrow()
  })

  it('marks bad refresh tokens as terminal and keeps empty-scope policy explicit', () => {
    const policy = getManagedOAuthConnectorPolicy('github-repositories')!
    expect(policy).toMatchObject({ scopeless: true, requiresRefreshToken: true, pkce: true })
    expect(policy.isTerminalRefreshError('bad_refresh_token')).toBe(true)
    expect(policy.isTerminalRefreshError('temporarily_unavailable')).toBe(false)
    expect(policy.hasRequiredScopes([], [])).toBe(true)
    expect(policy.hasRequiredScopes([], ['repo'])).toBe(false)
  })
})

describe('GitHub identity verification', () => {
  it('uses stable subject and verified primary email for an ordinary connection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ...user, email: 'untrusted@example.com' }))
      .mockResolvedValueOnce(response([work, primary]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(verifyGitHubRepositoriesIdentity('ghu_access')).resolves.toMatchObject({
      providerSubjectId: '1234',
      email: primary.email,
      emailVerified: true,
      grantedScopes: [],
      providerTenantId: null,
    })
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer ghu_access' }),
      redirect: 'error',
    })
  })

  it('allows an invitation to match a verified secondary work email', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(user))
        .mockResolvedValueOnce(response([primary, work]))
    )
    const policy = getManagedOAuthConnectorPolicy('github-repositories')!
    await expect(
      policy.verifyIdentity({
        tokens: { accessToken: 'ghu_access' },
        clientId: 'app-client',
        expectedEmail: 'Work@Example.com',
      })
    ).resolves.toMatchObject({ email: work.email, providerSubjectId: '1234' })
  })

  it('checks later email pages without following provider-supplied destinations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(user))
      .mockResolvedValueOnce(response(Array.from({ length: 100 }, () => primary)))
      .mockResolvedValueOnce(response([work]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(verifyGitHubRepositoriesIdentity('ghu_access', work.email)).resolves.toMatchObject(
      {
        email: work.email,
      }
    )
    expect(fetchMock.mock.calls[2]![0]).toBe(
      'https://api.github.com/user/emails?per_page=100&page=2'
    )
  })

  it.each([[primary], [{ ...work, verified: false }], []])(
    'refuses absent or unverified invited email %j',
    async (emails) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(response(user)).mockResolvedValueOnce(response(emails))
      )
      await expect(verifyGitHubRepositoriesIdentity('ghu_access', work.email)).rejects.toThrow()
    }
  )

  it('rejects a bot identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ...user, type: 'Bot' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(verifyGitHubRepositoriesIdentity('ghu_access')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403])('fails closed when GitHub rejects identity with %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, status)))
    await expect(verifyGitHubRepositoriesIdentity('ghu_access')).rejects.toThrow(`HTTP ${status}`)
  })
})

describe('GitHub token refresh', () => {
  it('rotates tokens with the separate App client and preserves refresh expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(tokenResponse))
    vi.stubGlobal('fetch', fetchMock)
    await expect(refreshOAuthToken('github-repositories', 'ghr_old')).resolves.toEqual({
      ok: true,
      accessToken: 'ghu_access',
      refreshToken: 'ghr_refresh',
      expiresIn: 28800,
      refreshTokenExpiresIn: 15897600,
    })
    const [, init] = fetchMock.mock.calls[0]!
    expect(Object.fromEntries(new URLSearchParams(init.body))).toMatchObject({
      client_id: 'app-client',
      client_secret: 'app-secret',
      grant_type: 'refresh_token',
      refresh_token: 'ghr_old',
    })
    expect(init.headers.Accept).toBe('application/json')
  })

  it('recognizes HTTP-200 OAuth rejection as a terminal refresh failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'bad_refresh_token' })))
    await expect(refreshOAuthToken('github-repositories', 'ghr_old')).resolves.toMatchObject({
      ok: false,
      errorCode: 'bad_refresh_token',
    })
  })

  it('rejects an incomplete rotation instead of retaining an invalidated token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ ...tokenResponse, refresh_token: undefined }))
    )
    await expect(refreshOAuthToken('github-repositories', 'ghr_old')).resolves.toMatchObject({
      ok: false,
    })
  })
})
