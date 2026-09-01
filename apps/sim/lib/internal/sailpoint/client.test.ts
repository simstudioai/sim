/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSailPointTokenStateForTests,
  getSailPointAccessToken,
  getSailPointTokenStateForTests,
  resolveSailPointHosts,
  sailpointFetch,
} from '@/lib/internal/sailpoint/client'

const mockFetch = vi.fn<typeof fetch>()

function tokenResponse(token: string, expiresIn = 3600): Response {
  return Response.json({ access_token: token, expires_in: expiresIn })
}

describe('SailPoint client', () => {
  beforeEach(() => {
    clearSailPointTokenStateForTests()
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('accepts only commercial and government tenant hosts', () => {
    expect(resolveSailPointHosts('acme').host).toBe('acme.api.identitynow.com')
    expect(resolveSailPointHosts('https://agency.api.identitynowgov.com').host).toBe(
      'agency.api.identitynowgov.com'
    )
    expect(() => resolveSailPointHosts('acme.api.identitynow.com.evil.test')).toThrow(
      'not an allowed'
    )
  })

  it('isolates cache entries by the exact credential secret', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('first'))
      .mockResolvedValueOnce(tokenResponse('second'))

    const common = { tenant: 'acme', clientId: 'client' }
    expect(await getSailPointAccessToken({ ...common, clientSecret: 'one' })).toBe('first')
    expect(await getSailPointAccessToken({ ...common, clientSecret: 'two' })).toBe('second')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('single-flights concurrent exchanges for the same credentials', async () => {
    let release: ((response: Response) => void) | undefined
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        })
    )
    const credentials = { tenant: 'acme', clientId: 'client', clientSecret: 'secret' }
    const first = getSailPointAccessToken(credentials)
    const second = getSailPointAccessToken(credentials)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    release?.(tokenResponse('shared'))
    await expect(Promise.all([first, second])).resolves.toEqual(['shared', 'shared'])
  })

  it('expires cached tokens before their provider expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    mockFetch
      .mockResolvedValueOnce(tokenResponse('old', 100))
      .mockResolvedValueOnce(tokenResponse('new', 100))
    const credentials = { tenant: 'acme', clientId: 'client', clientSecret: 'secret' }

    expect(await getSailPointAccessToken(credentials)).toBe('old')
    vi.setSystemTime(new Date('2026-01-01T00:01:31.000Z'))
    expect(await getSailPointAccessToken(credentials)).toBe('new')
  })

  it('evicts the oldest token when the bounded cache is full', async () => {
    mockFetch.mockImplementation(async () => tokenResponse('token'))
    for (let index = 0; index < 101; index += 1) {
      await getSailPointAccessToken({
        tenant: 'acme',
        clientId: `client-${index}`,
        clientSecret: 'secret',
      })
    }
    expect(getSailPointTokenStateForTests()).toEqual({ cacheSize: 100, exchangeSize: 0 })
  })

  it('rejects provider responses larger than the shared JSON cap', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse('token')).mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(10 * 1024 * 1024 + 1) },
      })
    )
    const credentials = { tenant: 'acme', clientId: 'client', clientSecret: 'secret' }

    await expect(
      sailpointFetch(credentials, (hosts) => ({
        url: `${hosts.apiBaseUrl}/identities/v1`,
        init: { method: 'GET' },
      }))
    ).rejects.toThrow(/maximum|limit|exceeds/i)
  })
})
