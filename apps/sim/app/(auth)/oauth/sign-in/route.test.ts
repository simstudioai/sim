/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ enabled: true, registrationDisabled: false }))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isOAuthProviderEnabled() {
    return flags.enabled
  },
  get isRegistrationDisabled() {
    return flags.registrationDisabled
  },
}))

import { GET } from '@/app/(auth)/oauth/sign-in/route'

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
    flags.enabled = true
    flags.registrationDisabled = false
  })

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

  it('uses login when registration is disabled and hides a disabled provider', async () => {
    flags.registrationDisabled = true
    const enabled = await GET(request('client_id=sim-cli'))
    expect(redirectParts(enabled).destination.pathname).toBe('/login')

    flags.enabled = false
    const disabled = await GET(request('client_id=sim-cli'))
    expect(disabled.status).toBe(302)
    expect(new URL(disabled.headers.get('location') as string).pathname).toBe('/')
  })
})
