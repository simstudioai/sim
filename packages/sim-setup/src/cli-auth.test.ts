import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApprovalUrl, normalizeAuthOrigin, pollOnce } from './cli-auth'
import { SETUP_USER_AGENT } from './version'

const ORIGIN = 'https://www.sim.test/prefix'
const REQUEST = 'request'
const VERIFIER = 'verifier'

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('normalizeAuthOrigin', () => {
  it('keeps a path prefix and removes only trailing slashes', () => {
    expect(normalizeAuthOrigin('https://www.sim.test/prefix///')).toBe(ORIGIN)
  })

  it('rejects malformed and ambiguous service roots', () => {
    expect(() => normalizeAuthOrigin('not-a-url')).toThrow('absolute HTTP(S) URL')
    expect(() => normalizeAuthOrigin('ftp://sim.test')).toThrow('expected HTTP or HTTPS')
    expect(() => normalizeAuthOrigin('https://sim.test?target=other')).toThrow(
      'cannot contain credentials, a query, or a fragment'
    )
  })
})

describe('buildApprovalUrl', () => {
  it('preserves the origin prefix and never includes the poll secret', () => {
    const url = buildApprovalUrl(ORIGIN, REQUEST, 'challenge', 'ABCD-2345')
    expect(url).toMatch(/^https:\/\/www\.sim\.test\/prefix\/cli\/auth\?/)
    expect(url).toContain('challenge=challenge')
    expect(url).not.toContain(VERIFIER)
  })
})

describe('pollOnce', () => {
  it('bounds and identifies the request without following redirects', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, { status: 'complete', key: { apiKey: 'key' } }))

    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).resolves.toEqual({
      status: 'complete',
      apiKey: 'key',
    })
    expect(fetchMock.mock.calls[0][0]).toBe(`${ORIGIN}/api/cli/auth/poll`)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: expect.objectContaining({
        accept: 'application/json',
        'user-agent': SETUP_USER_AGENT,
      }),
      signal: expect.any(AbortSignal),
    })
  })

  it('keeps pending, rate-limited, server, and transport failures retryable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'pending' }))
    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).resolves.toEqual({ status: 'pending' })

    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { error: 'slow down' }, { 'retry-after': '4' })
    )
    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).resolves.toEqual({
      status: 'pending',
      retryAfterMs: 4000,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'deploying' }))
    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).resolves.toEqual({ status: 'pending' })

    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'name collision' }))
    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).resolves.toEqual({ status: 'pending' })

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).resolves.toEqual({ status: 'pending' })

    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).resolves.toEqual({ status: 'pending' })
  })

  it('fails immediately on deliberate refusals and unexpected transport errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: { message: 'Forbidden' } }))
    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).rejects.toThrow('Forbidden')

    fetchMock.mockRejectedValueOnce(new Error('programming failure'))
    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).rejects.toThrow('programming failure')
  })

  it('refuses redirects instead of forwarding the poll secret', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { location: 'https://other.sim.test/api/cli/auth/poll' },
      })
    )

    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).rejects.toThrow(
      'will not forward the poll secret across a redirect'
    )
  })

  it('rejects non-JSON and malformed successful responses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(new Response('<html>wrong host</html>', { status: 200 }))
    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).rejects.toThrow('non-JSON response')

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'complete' }))
    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER)).rejects.toThrow(
      'completed without a valid API key'
    )
  })

  it('rejects an invalid request timeout before calling fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(pollOnce(ORIGIN, REQUEST, VERIFIER, 0)).rejects.toThrow(
      'Poll timeout must be a positive whole number'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
