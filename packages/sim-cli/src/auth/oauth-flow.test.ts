import { createHash } from 'node:crypto'
import { get, type IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../http/client'
import {
  buildAuthorizeUrl,
  buildRedirectUri,
  createPkce,
  discoverOAuthProvider,
  exchangeCode,
  isLikelyRemoteSession,
  loginWithBrowser,
  OAUTH_CLIENT_ID,
  OAuthTokenError,
  refreshTokens,
} from './oauth-flow'

const ENDPOINT = 'https://sim.test'

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status }) as Response
}

const TOKENS = {
  access_token: 'sim_oat_access',
  refresh_token: 'sim_ort_refresh',
  expires_in: 3600,
  scope: 'offline_access api:read',
  token_type: 'Bearer',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createPkce', () => {
  it('derives an S256 challenge from a fresh 256-bit verifier', () => {
    const pkce = createPkce()
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(pkce.challenge).toBe(
      createHash('sha256').update(pkce.verifier, 'ascii').digest('base64url')
    )
    expect(pkce.state).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(createPkce().verifier).not.toBe(pkce.verifier)
  })
})

describe('buildAuthorizeUrl', () => {
  it('names the seeded public client, S256, and a loopback IP-literal redirect', () => {
    const pkce = createPkce()
    const url = new URL(
      buildAuthorizeUrl(ENDPOINT, {
        redirectUri: buildRedirectUri(54321),
        scopes: ['offline_access', 'api:read'],
        pkce,
      })
    )
    expect(url.pathname).toBe('/api/auth/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe(OAUTH_CLIENT_ID)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321/callback')
    expect(url.searchParams.get('scope')).toBe('offline_access api:read')
    expect(url.searchParams.get('code_challenge')).toBe(pkce.challenge)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe(pkce.state)
  })
})

describe('discoverOAuthProvider', () => {
  it('does not downgrade to API keys when discovery exceeds the response limit', async () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { 'content-length': String(64 * 1024 + 1) },
        })
    )

    await expect(discoverOAuthProvider(ENDPOINT)).resolves.toBe('unreachable')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('reports a server that publishes a token endpoint as available', async () => {
    vi.stubGlobal('fetch', async () =>
      reply(200, {
        issuer: `${ENDPOINT}/api/auth`,
        token_endpoint: `${ENDPOINT}/api/auth/oauth2/token`,
      })
    )
    await expect(discoverOAuthProvider(ENDPOINT)).resolves.toBe('available')
  })

  it('treats a 404 as a server without the provider, which selects the handoff', async () => {
    vi.stubGlobal('fetch', async () => reply(404, { error: 'OAuth provider is not enabled' }))
    await expect(discoverOAuthProvider(ENDPOINT)).resolves.toBe('unavailable')
  })

  it('separates an unreachable endpoint from one that lacks the feature', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(discoverOAuthProvider(ENDPOINT)).resolves.toBe('unreachable')
  })
})

describe('token endpoint', () => {
  it.each([undefined, '1'])(
    'cancels an oversized chunked token response with content-length=%s',
    async (contentLength) => {
      const cancel = vi.fn()
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(32 * 1024))
        },
        cancel,
      })
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(body, {
            headers: contentLength ? { 'content-length': contentLength } : {},
          })
      )

      await expect(refreshTokens(ENDPOINT, 'r')).rejects.toThrow('exceeds 64 KiB')
      expect(cancel).toHaveBeenCalledOnce()
    }
  )

  it('posts the code with its verifier as a form and reads the pair back', async () => {
    const fetchMock = vi.fn(async () => reply(200, TOKENS))
    vi.stubGlobal('fetch', fetchMock)
    const before = Date.now()

    const tokens = await exchangeCode(ENDPOINT, {
      code: 'abc',
      redirectUri: 'http://127.0.0.1:1/callback',
      verifier: 'v',
      requestedScopes: ['offline_access', 'api:read'],
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${ENDPOINT}/api/auth/oauth2/token`)
    expect(init.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' })
    expect(init.redirect).toBe('manual')
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'authorization_code',
      client_id: OAUTH_CLIENT_ID,
      code: 'abc',
      redirect_uri: 'http://127.0.0.1:1/callback',
      code_verifier: 'v',
    })
    expect(tokens).toMatchObject({ accessToken: 'sim_oat_access', refreshToken: 'sim_ort_refresh' })
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000)
  })

  it('surfaces the RFC 6749 error code on a refusal', async () => {
    vi.stubGlobal('fetch', async () =>
      reply(400, { error: 'invalid_grant', error_description: 'refresh token revoked' })
    )
    const failure = await refreshTokens(ENDPOINT, 'dead').catch((error) => error)
    expect(failure).toBeInstanceOf(OAuthTokenError)
    expect(failure.oauthError).toBe('invalid_grant')
    expect(failure.message).toBe('refresh token revoked')
  })

  it('refuses a pair missing its refresh token rather than storing half a login', async () => {
    vi.stubGlobal('fetch', async () => reply(200, { access_token: 'only', expires_in: 60 }))
    await expect(refreshTokens(ENDPOINT, 'r')).rejects.toThrow('Nothing was stored')
  })

  it('does not follow a redirect that would carry the verifier elsewhere', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } })
    )
    await expect(refreshTokens(ENDPOINT, 'r')).rejects.toThrow('does not follow redirects')
  })
})

describe('loginWithBrowser', () => {
  /** Drives the loopback listener the way a browser would, by following the authorize URL's redirect params. */
  async function completeInBrowser(
    outcome: (params: URLSearchParams, state: string) => Record<string, string>
  ) {
    const fetchMock = vi.fn(async () => reply(200, TOKENS))
    vi.stubGlobal('fetch', fetchMock)

    let receiveCallback!: (response: IncomingMessage) => void
    const callback = new Promise<IncomingMessage>((resolve) => {
      receiveCallback = resolve
    })
    const login = loginWithBrowser(ENDPOINT, {
      scopes: ['offline_access', 'api:read'],
      onAuthorizeUrl: (url) => {
        const authorize = new URL(url)
        const redirectUri = new URL(authorize.searchParams.get('redirect_uri') as string)
        const state = authorize.searchParams.get('state') as string
        for (const [key, value] of Object.entries(outcome(authorize.searchParams, state))) {
          redirectUri.searchParams.set(key, value)
        }
        /** Node's real HTTP client, not the stubbed fetch, exercises the listener. */
        get(redirectUri, (response) => {
          receiveCallback(response)
          response.resume()
        })
      },
      timeoutMs: 5000,
    })
    return { login, fetchMock, callback }
  }

  it('listens on 127.0.0.1, verifies state, and redeems the code with the verifier', async () => {
    const { login, fetchMock, callback } = await completeInBrowser((_params, state) => ({
      code: 'the-code',
      state,
    }))

    const tokens = await login
    expect(tokens.accessToken).toBe('sim_oat_access')
    const response = await callback
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(`${ENDPOINT}/cli/auth/done`)
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['cache-control']).toBe('no-store')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const form = Object.fromEntries(new URLSearchParams(String(init.body)))
    expect(form.code).toBe('the-code')
    expect(form.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(form.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('ignores a redirect whose state this terminal did not issue, and keeps waiting', async () => {
    /**
     * Anything on the machine can reach a loopback port, so a forged callback
     * must not be able to end someone's sign-in. The forged hit is answered
     * and dropped; the real browser then arrives and the login completes.
     *
     * The forged request is awaited to completion before the real one is sent.
     * Firing both and letting them race meant a run where the real callback
     * landed first passed every assertion below without the mismatch branch
     * ever executing.
     */
    const fetchMock = vi.fn(async () => reply(200, TOKENS))
    vi.stubGlobal('fetch', fetchMock)

    let forgedStatus: number | undefined
    const login = loginWithBrowser(ENDPOINT, {
      scopes: ['offline_access', 'api:read'],
      onAuthorizeUrl: (url) => {
        const authorize = new URL(url)
        const redirectUri = new URL(authorize.searchParams.get('redirect_uri') as string)
        const state = authorize.searchParams.get('state') as string
        void (async () => {
          const { get } = await import('node:http')
          const forged = new URL(redirectUri)
          forged.searchParams.set('code', 'forged-code')
          forged.searchParams.set('state', 'forged')
          forgedStatus = await new Promise<number>((resolve) => {
            get(forged, (response) => {
              response.resume()
              response.once('end', () => resolve(response.statusCode ?? 0))
            })
          })
          const real = new URL(redirectUri)
          real.searchParams.set('code', 'the-code')
          real.searchParams.set('state', state)
          get(real, (response) => response.resume())
        })()
      },
      timeoutMs: 5000,
    })

    const tokens = await login
    expect(forgedStatus).toBe(400)
    expect(tokens.accessToken).toBe('sim_oat_access')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(Object.fromEntries(new URLSearchParams(String(init.body))).code).toBe('the-code')
  })

  it('reports a declined consent as a cancellation, not a server failure', async () => {
    const { login, fetchMock, callback } = await completeInBrowser((_params, state) => ({
      error: 'access_denied',
      error_description: 'Do not forward provider data to the completion page',
      state,
    }))

    const failure = await login.catch((error) => error)
    expect(failure).toBeInstanceOf(SimApiError)
    expect(failure.message).toBe('Sign-in was declined in the browser.')
    expect(fetchMock).not.toHaveBeenCalled()
    const response = await callback
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(`${ENDPOINT}/cli/auth/done?status=cancelled`)
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('gives up after the timeout with the browserless fallback named', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(
      loginWithBrowser(ENDPOINT, {
        scopes: ['offline_access', 'api:read'],
        onAuthorizeUrl: () => {},
        timeoutMs: 20,
      })
    ).rejects.toThrow('--browserless')
  })
})

describe('isLikelyRemoteSession', () => {
  it('detects an SSH session from its environment', () => {
    expect(isLikelyRemoteSession({ SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' })).toBe(true)
  })

  it('treats a Linux desktop session as local', () => {
    expect(isLikelyRemoteSession({ DISPLAY: ':0' }, 'linux')).toBe(false)
    expect(isLikelyRemoteSession({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(false)
  })

  /** The branch the automatic pairing-code fallback actually turns on. */
  it('treats a headless Linux box as remote', () => {
    expect(isLikelyRemoteSession({}, 'linux')).toBe(true)
  })

  it('treats a desktop OS as local even with no display variables', () => {
    expect(isLikelyRemoteSession({}, 'darwin')).toBe(false)
    expect(isLikelyRemoteSession({}, 'win32')).toBe(false)
  })
})
