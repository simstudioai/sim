import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApprovalUrl, pollOnce } from './cli-auth'

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

describe('buildApprovalUrl', () => {
  it('preserves the origin prefix and never includes the poll secret', () => {
    const url = buildApprovalUrl(ORIGIN, REQUEST, 'challenge', 'ABCD-2345')
    expect(url).toMatch(/^https:\/\/www\.sim\.test\/prefix\/cli\/auth\?/)
    expect(url).toContain('challenge=challenge')
    expect(url).not.toContain(VERIFIER)
  })
})

describe('pollOnce', () => {
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
})
