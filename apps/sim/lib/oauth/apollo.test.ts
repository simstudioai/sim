import { describe, expect, it, vi } from 'vitest'
import { createApolloProvider, formatApolloAuthorizationUrl } from '@/lib/oauth/apollo'

const connector = createApolloProvider({
  clientId: 'fixture-client',
  clientSecret: 'fixture-secret',
  redirectURI: 'https://example.invalid/api/auth/oauth2/callback/apollo',
  scopes: ['read_user_profile'],
})

describe('Apollo OAuth protocol', () => {
  it('preserves state and callback encoding inside Apollo’s authorization fragment', () => {
    const callback = 'https://example.invalid/api/auth/oauth2/callback/apollo'
    const state = 'fixture+state/with=padding'
    const generated = new URL('https://app.apollo.io/#/oauth/authorize')
    generated.searchParams.set('client_id', 'fixture-client')
    generated.searchParams.set('redirect_uri', callback)
    generated.searchParams.set('state', state)
    generated.searchParams.set('scope', 'read_user_profile contacts_search')
    generated.searchParams.set('response_type', 'code')

    const authorization = new URL(formatApolloAuthorizationUrl(generated.toString()))
    expect(authorization.origin).toBe('https://app.apollo.io')
    expect(authorization.search).toBe('')
    const [path, query] = authorization.hash.slice(1).split('?')
    expect(path).toBe('/oauth/authorize')
    const params = new URLSearchParams(query)
    expect(params.get('state')).toBe(state)
    expect(params.get('redirect_uri')).toBe(callback)
    expect(params.get('scope')).toBe('read_user_profile contacts_search')
    expect(params.get('client_id')).toBe('fixture-client')
  })

  it('refuses an unexpected authorization destination', () => {
    expect(() =>
      formatApolloAuthorizationUrl('https://example.invalid/?state=fixture#/oauth/authorize')
    ).toThrow('Invalid Apollo authorization URL')
  })

  it('uses the authenticated profile without asserting that Apollo verified its email', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          id: 'fixture-user',
          first_name: 'Example',
          last_name: 'User',
          email: 'fixture@example.invalid',
        })
      )
    )
    if (!connector.getUserInfo) throw new Error('Apollo needs a profile lookup')
    const profile = await connector.getUserInfo({ accessToken: 'fixture-access' })
    expect(profile).toMatchObject({
      name: 'Example User',
      email: 'fixture@example.invalid',
      emailVerified: false,
    })
    expect(profile?.id).toMatch(/^fixture-user-/)
  })

  it.each([
    { email: 'fixture@example.invalid' },
    { id: '', email: 'fixture@example.invalid' },
    { id: 'fixture-user' },
  ])('refuses a profile without a usable provider identity and email', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)))
    if (!connector.getUserInfo) throw new Error('Apollo needs a profile lookup')
    await expect(connector.getUserInfo({ accessToken: 'fixture-access' })).rejects.toThrow(
      'Invalid Apollo user profile'
    )
  })

  it('does not expose an upstream error body containing a credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'fixture-access' }, { status: 401 }))
    )
    if (!connector.getUserInfo) throw new Error('Apollo needs a profile lookup')
    await expect(connector.getUserInfo({ accessToken: 'fixture-access' })).rejects.toThrow(
      'Apollo user profile request failed with HTTP 401'
    )
  })

  it.each([
    () => new Response('{"secret":"fixture-access", malformed json'),
    () =>
      Response.json({
        id: 'fixture-user',
        email: 'fixture@example.invalid',
        extra: 'x'.repeat(65_537),
      }),
  ])('refuses malformed or oversized profiles without echoing their bodies', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    if (!connector.getUserInfo) throw new Error('Apollo needs a profile lookup')
    await expect(connector.getUserInfo({ accessToken: 'fixture-access' })).rejects.toThrow(
      'Invalid Apollo user profile'
    )
  })
})
