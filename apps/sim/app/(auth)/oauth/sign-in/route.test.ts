/**
 * @vitest-environment node
 */
import { createEnvMock, envFlagsMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({
  authDisabled: false,
  registrationDisabled: false,
  appUrl: 'https://sim.test',
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  get isAuthDisabled() {
    return flags.authDisabled
  },
  get isRegistrationDisabled() {
    return flags.registrationDisabled
  },
}))

vi.mock('@/lib/core/config/env', () => {
  const mock = createEnvMock({ NEXT_PUBLIC_APP_URL: 'https://sim.test' })
  return {
    ...mock,
    getEnv: (key: string) => (key === 'NEXT_PUBLIC_APP_URL' ? flags.appUrl : mock.getEnv(key)),
  }
})

vi.unmock('@/lib/core/utils/urls')

import { GET } from '@/app/(auth)/oauth/sign-in/route'
import { proxy } from '@/proxy'

function request(query: string): NextRequest {
  return new NextRequest(`https://sim.test/oauth/sign-in?${query}`)
}

function redirectParts(response: Response): { destination: URL; callback: URL } {
  const destination = new URL(response.headers.get('location') as string)
  const callbackUrl = destination.searchParams.get('callbackUrl')
  if (!callbackUrl) throw new Error('redirect did not carry a callbackUrl')
  return { destination, callback: new URL(callbackUrl, destination.origin) }
}

describe('OAuth login bridge', () => {
  beforeEach(() => {
    flags.authDisabled = false
    flags.registrationDisabled = false
    flags.appUrl = 'https://sim.test'
  })

  it.each([true, false])(
    'keeps the configured auth origin when Next normalizes loopback hosts (authDisabled=%s)',
    async (authDisabled) => {
      flags.authDisabled = authDisabled
      flags.appUrl = 'http://127.0.0.1:37488'
      const incoming = new NextRequest(`${flags.appUrl}/oauth/sign-in?client_id=sim-cli`)
      expect(incoming.nextUrl.origin).toBe('http://localhost:37488')

      const response = await GET(incoming)
      const destination = new URL(response.headers.get('location')!)
      expect(destination.origin).toBe(flags.appUrl)
      expect(destination.pathname).toBe(authDisabled ? '/' : '/signup')
      if (!authDisabled) expect(redirectParts(response).callback.origin).toBe(flags.appUrl)
    }
  )

  it('consumes prompt=login and preserves a later consent prompt', async () => {
    const response = await GET(
      request(
        'client_id=sim-cli&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback&prompt=login%20consent&sig=signed&ba_iat=1'
      )
    )
    const { destination, callback } = redirectParts(response)

    expect(response.status).toBe(302)
    expect(destination.pathname).toBe('/login')
    expect(callback.pathname).toBe('/api/auth/oauth2/authorize')
    expect(callback.searchParams.get('prompt')).toBe('consent')
    expect(callback.searchParams.get('client_id')).toBe('sim-cli')
    expect(callback.searchParams.has('sig')).toBe(false)
    expect(callback.searchParams.has('ba_iat')).toBe(false)
  })

  it('consumes prompt=create after directing the user through signup', async () => {
    const response = await GET(request('client_id=sim-cli&prompt=create'))
    const { destination, callback } = redirectParts(response)

    expect(destination.pathname).toBe('/signup')
    expect(callback.searchParams.has('prompt')).toBe(false)
  })

  it('uses login when registration is disabled and hides OAuth when authentication is disabled', async () => {
    flags.registrationDisabled = true
    const enabled = await GET(request('client_id=sim-cli'))
    expect(redirectParts(enabled).destination.pathname).toBe('/login')

    flags.authDisabled = true
    const disabled = await GET(request('client_id=sim-cli'))
    expect(disabled.status).toBe(302)
    expect(new URL(disabled.headers.get('location') as string).pathname).toBe('/')
  })

  it.each([
    ['login consent', '/login', 'consent'],
    ['create', '/signup', null],
    ['', '/signup', null],
  ])('reaches the form with an existing session for prompt=%s', async (prompt, path, remaining) => {
    const authorize = new URLSearchParams({
      client_id: 'sim-cli',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:5187/callback',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      state: 'request-state',
      prompt,
      sig: 'signed-query',
    })
    const { destination, callback } = redirectParts(await GET(request(authorize.toString())))
    const response = await proxy(
      new NextRequest(destination, {
        headers: { cookie: 'better-auth.session_token=existing.session' },
      })
    )

    expect(destination.pathname).toBe(path)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(callback.searchParams.get('state')).toBe('request-state')
    expect(callback.searchParams.get('code_challenge')).toBe('challenge')
    expect(callback.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5187/callback')
    expect(callback.searchParams.get('prompt')).toBe(remaining)
  })

  it.each(['/login', '/signup'])('preserves ordinary authenticated %s redirects', async (path) => {
    for (const callbackUrl of [
      '',
      '/workspace/workspace-1',
      'https://other.test/api/auth/oauth2/authorize',
    ]) {
      const destination = new URL(path, 'https://sim.test')
      if (callbackUrl) destination.searchParams.set('callbackUrl', callbackUrl)
      const response = await proxy(
        new NextRequest(destination, {
          headers: { cookie: 'better-auth.session_token=existing.session' },
        })
      )
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('https://sim.test/home')
    }
  })

  it('uses the same redirect precedence as the form and requires authentication for OAuth', async () => {
    const destination = new URL('/login', 'https://sim.test')
    destination.searchParams.set('callbackUrl', '/api/auth/oauth2/authorize?client_id=sim-cli')
    destination.searchParams.set('redirect', '/workspace')
    const headers = { cookie: 'better-auth.session_token=existing.session' }
    expect((await proxy(new NextRequest(destination, { headers }))).status).toBe(307)

    destination.searchParams.delete('redirect')
    flags.authDisabled = true
    expect((await proxy(new NextRequest(destination, { headers }))).status).toBe(307)
  })
})
