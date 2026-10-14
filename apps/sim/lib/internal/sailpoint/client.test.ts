import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSailPointAccessToken,
  resolveSailPointHosts,
  sailpointFetch,
} from '@/lib/internal/sailpoint/client'

const mockFetch = vi.fn<typeof fetch>()

function tokenResponse(token: string, expiresIn = 3600): Response {
  return Response.json({ access_token: token, expires_in: expiresIn })
}

/** Tokens are cached per credential for the module's lifetime, so each test owns its secret. */
function credentialsFor(clientSecret: string) {
  return { tenant: 'acme', clientId: 'client', clientSecret }
}

describe('SailPoint client', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.useRealTimers()
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

    expect(await getSailPointAccessToken(credentialsFor('isolate-one'))).toBe('first')
    expect(await getSailPointAccessToken(credentialsFor('isolate-two'))).toBe('second')
    expect(await getSailPointAccessToken(credentialsFor('isolate-one'))).toBe('first')
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
    const credentials = credentialsFor('single-flight')
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
    const credentials = credentialsFor('abort-one-waiter')
    const controller = new AbortController()
    const first = getSailPointAccessToken(credentials, controller.signal)
    const second = getSailPointAccessToken(credentials)

    controller.abort(new Error('caller stopped'))
    await expect(first).rejects.toThrow('caller stopped')
    release?.(tokenResponse('shared'))
    await expect(second).resolves.toBe('shared')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('caps in-flight exchanges across distinct credentials and frees slots as they settle', async () => {
    const releases: Array<(response: Response) => void> = []
    mockFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(resolve)
        })
    )
    const pending = Array.from({ length: 100 }, (_, index) =>
      getSailPointAccessToken(credentialsFor(`in-flight-${index}`))
    )

    await expect(getSailPointAccessToken(credentialsFor('in-flight-overflow'))).rejects.toThrow(
      'Too many concurrent SailPoint token exchanges'
    )
    expect(mockFetch).toHaveBeenCalledTimes(100)

    for (const release of releases) release(tokenResponse('token'))
    await Promise.all(pending)
    mockFetch.mockResolvedValueOnce(tokenResponse('after-drain'))
    expect(await getSailPointAccessToken(credentialsFor('in-flight-after-drain'))).toBe(
      'after-drain'
    )
  })

  it('does not cache a failed exchange', async () => {
    mockFetch
      .mockResolvedValueOnce(Response.json({ error: 'invalid_client' }, { status: 401 }))
      .mockResolvedValueOnce(tokenResponse('recovered'))
    const credentials = credentialsFor('failed-exchange')

    await expect(getSailPointAccessToken(credentials)).rejects.toThrow('invalid_client')
    expect(await getSailPointAccessToken(credentials)).toBe('recovered')
  })

  it('expires cached tokens before their provider expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    mockFetch
      .mockResolvedValueOnce(tokenResponse('old', 100))
      .mockResolvedValueOnce(tokenResponse('new', 100))
    const credentials = credentialsFor('expiry')

    expect(await getSailPointAccessToken(credentials)).toBe('old')
    vi.setSystemTime(new Date('2026-01-01T00:01:29.000Z'))
    expect(await getSailPointAccessToken(credentials)).toBe('old')
    vi.setSystemTime(new Date('2026-01-01T00:01:31.000Z'))
    expect(await getSailPointAccessToken(credentials)).toBe('new')
  })

  it('aborts during rate-limit backoff without another provider call', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('token'))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '30' } }))
    const controller = new AbortController()
    const pending = sailpointFetch(
      credentialsFor('rate-limit'),
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

  it('refreshes the token once when the provider rejects it', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('revoked'))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(tokenResponse('fresh'))
      .mockResolvedValueOnce(Response.json({ id: 'identity' }))

    const result = await sailpointFetch(credentialsFor('refresh-on-401'), (hosts) => ({
      url: `${hosts.apiBaseUrl}/identities/v1/id`,
      init: { method: 'GET' },
    }))

    expect(result.data).toEqual({ id: 'identity' })
    expect(new Headers(mockFetch.mock.calls[3][1]?.headers).get('Authorization')).toBe(
      'Bearer fresh'
    )
  })

  it('rejects redirects for token and authenticated provider requests', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse('token'))
      .mockResolvedValueOnce(Response.json({ id: 'identity' }))

    await sailpointFetch(credentialsFor('redirects'), (hosts) => ({
      url: `${hosts.apiBaseUrl}/identities/v1/id`,
      init: { method: 'GET' },
    }))

    expect(mockFetch.mock.calls[0][1]?.redirect).toBe('error')
    expect(mockFetch.mock.calls[1][1]?.redirect).toBe('error')
  })
})
