/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSailPointTokenStateForTests,
  getSailPointAccessToken,
  getSailPointTokenStateForTests,
  readTotalCount,
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

  it('lets one token waiter abort without cancelling the shared exchange', async () => {
    let release: ((response: Response) => void) | undefined
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        })
    )
    const credentials = { tenant: 'acme', clientId: 'client', clientSecret: 'secret' }
    const controller = new AbortController()
    const first = getSailPointAccessToken(credentials, controller.signal)
    const second = getSailPointAccessToken(credentials)

    controller.abort(new Error('caller stopped'))
    await expect(first).rejects.toThrow('caller stopped')
    release?.(tokenResponse('shared'))
    await expect(second).resolves.toBe('shared')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(getSailPointTokenStateForTests().exchangeSize).toBe(0)
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

  it('aborts during rate-limit backoff without another provider call', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('token'))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '30' } }))
    const controller = new AbortController()
    const credentials = { tenant: 'acme', clientId: 'client', clientSecret: 'secret' }
    const pending = sailpointFetch(
      credentials,
      (hosts) => ({
        url: `${hosts.apiBaseUrl}/identities/v1`,
        init: { method: 'GET' },
      }),
      { signal: controller.signal }
    )

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    controller.abort(new Error('stop retrying'))
    await expect(pending).rejects.toThrow('stop retrying')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('rejects redirects for token and authenticated provider requests', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('token'))
      .mockResolvedValueOnce(Response.json({ id: 'identity' }))
    const credentials = { tenant: 'acme', clientId: 'client', clientSecret: 'secret' }

    await sailpointFetch(credentials, (hosts) => ({
      url: `${hosts.apiBaseUrl}/identities/v1/id`,
      init: { method: 'GET' },
    }))

    expect(mockFetch.mock.calls[0][1]?.redirect).toBe('error')
    expect(mockFetch.mock.calls[1][1]?.redirect).toBe('error')
  })

  it('accepts only non-negative integer total counts', () => {
    expect(readTotalCount(new Headers({ 'x-total-count': '7' }))).toBe(7)
    expect(readTotalCount(new Headers({ 'x-total-count': '1.5' }))).toBeNull()
    expect(readTotalCount(new Headers({ 'x-total-count': '-1' }))).toBeNull()
  })
})
