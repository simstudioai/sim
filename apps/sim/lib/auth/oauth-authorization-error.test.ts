/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  oauthAuthorizationErrorResponse,
  oauthRedirectUriMatches,
} from '@/lib/auth/oauth-authorization-error'

function request(entries: [string, string][]): NextRequest {
  const url = new URL('https://sim.test/api/auth/oauth2/authorize')
  for (const [key, value] of entries) url.searchParams.append(key, value)
  return new NextRequest(url)
}

describe('oauthRedirectUriMatches', () => {
  it('matches exact callbacks and permits only loopback port variance', () => {
    expect(oauthRedirectUriMatches('https://app.test/callback', 'https://app.test/callback')).toBe(
      true
    )
    expect(
      oauthRedirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1:43123/callback')
    ).toBe(true)
    expect(
      oauthRedirectUriMatches('http://127.2.3.4/callback', 'http://127.2.3.4:43123/callback')
    ).toBe(true)
    expect(oauthRedirectUriMatches('http://[::1]/callback', 'http://[::1]:43123/callback')).toBe(
      true
    )
    expect(oauthRedirectUriMatches('https://app.test/callback', 'https://evil.test/callback')).toBe(
      false
    )
    expect(
      oauthRedirectUriMatches(
        'https://127.attacker.example/callback',
        'https://127.attacker.example:43123/callback'
      )
    ).toBe(false)
    expect(oauthRedirectUriMatches('http://127.0.0.1/callback', 'http://127.0.0.1/other')).toBe(
      false
    )
  })
})

describe('oauthAuthorizationErrorResponse', () => {
  beforeEach(resetDbChainMock)

  it('redirects a registered callback with the original state', async () => {
    queueTableRows(schemaMock.oauthClient, [
      { disabled: false, redirectUris: ['http://127.0.0.1/callback'] },
    ])

    const response = await oauthAuthorizationErrorResponse(
      request([
        ['client_id', 'sim-cli'],
        ['redirect_uri', 'http://127.0.0.1:43123/callback'],
        ['state', 'state-1'],
      ]),
      'invalid_request',
      'Code challenge is invalid.'
    )
    const location = new URL(response.headers.get('location') ?? '')

    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(location.origin).toBe('http://127.0.0.1:43123')
    expect(location.searchParams.get('error')).toBe('invalid_request')
    expect(location.searchParams.get('error_description')).toBe('Code challenge is invalid.')
    expect(location.searchParams.get('state')).toBe('state-1')
    expect(location.searchParams.get('iss')).toMatch(/\/api\/auth$/)
  })

  it.each([
    ['missing client', undefined],
    ['disabled client', { disabled: true, redirectUris: ['https://app.test/callback'] }],
    ['unregistered callback', { disabled: false, redirectUris: ['https://app.test/other'] }],
  ])('does not redirect a %s', async (_case, client) => {
    if (client) queueTableRows(schemaMock.oauthClient, [client])

    const response = await oauthAuthorizationErrorResponse(
      request([
        ['client_id', 'client-1'],
        ['redirect_uri', 'https://app.test/callback'],
        ['state', 'state-1'],
      ]),
      'invalid_request',
      'Request is invalid.'
    )

    expect(response.status).toBe(400)
    expect(response.headers.has('location')).toBe(false)
  })

  it.each(['client_id', 'redirect_uri'])(
    'does not choose between repeated %s values',
    async (repeated) => {
      const entries: [string, string][] = [
        ['client_id', 'client-1'],
        ['redirect_uri', 'https://app.test/callback'],
      ]
      entries.push([repeated, repeated === 'client_id' ? 'client-2' : 'https://evil.test/callback'])

      const response = await oauthAuthorizationErrorResponse(
        request(entries),
        'invalid_request',
        'Request is invalid.'
      )

      expect(response.status).toBe(400)
      expect(response.headers.has('location')).toBe(false)
    }
  )

  it('omits an ambiguous repeated state from an otherwise safe redirect', async () => {
    queueTableRows(schemaMock.oauthClient, [
      { disabled: false, redirectUris: ['https://app.test/callback'] },
    ])

    const response = await oauthAuthorizationErrorResponse(
      request([
        ['client_id', 'client-1'],
        ['redirect_uri', 'https://app.test/callback'],
        ['state', 'one'],
        ['state', 'two'],
      ]),
      'invalid_request',
      'OAuth parameter state appears more than once.'
    )

    expect(new URL(response.headers.get('location') ?? '').searchParams.has('state')).toBe(false)
  })

  it('returns a sanitized protocol error when callback validation fails', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await oauthAuthorizationErrorResponse(
      request([
        ['client_id', 'client-1'],
        ['redirect_uri', 'https://app.test/callback'],
      ]),
      'invalid_request',
      'Request is invalid.'
    )

    expect(response.status).toBe(500)
    expect(response.headers.has('location')).toBe(false)
    await expect(response.json()).resolves.toEqual({
      error: 'server_error',
      error_description: 'Authorization request failed.',
    })
  })
})
