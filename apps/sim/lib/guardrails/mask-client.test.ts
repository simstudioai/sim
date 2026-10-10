import { resetUrlsMock, urlsMockFns } from '@sim/testing'
import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { utilsHelpersMock, utilsHelpersMockFns } from '@sim/testing/mocks/utils-helpers.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

afterAll(resetUrlsMock)

const mockToken = authInternalMockFns.mockGenerateInternalToken

const mockBaseUrl = urlsMockFns.mockGetInternalApiBaseUrl

vi.mock('@/lib/auth/internal', () => authInternalMock)
vi.mock('@sim/utils/helpers', () => utilsHelpersMock)

import { maskPIIBatchViaHttp } from '@/lib/guardrails/mask-client'

const mockSleep = utilsHelpersMockFns.mockSleep

describe('maskPIIBatchViaHttp', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockToken.mockResolvedValue('tok')
    mockBaseUrl.mockReturnValue('http://app.internal:3000')
    fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const { texts } = JSON.parse(init.body) as { texts: string[] }
      return new Response(JSON.stringify({ masked: texts.map((t) => `M(${t})`) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('splits by count into multiple requests, preserving global order', async () => {
    const texts = Array.from({ length: 5000 }, (_, i) => `t${i}`)

    const { masked: out } = await maskPIIBatchViaHttp(texts, [])

    expect(out).toHaveLength(5000)
    expect(out[0]).toBe('M(t0)')
    expect(out[4999]).toBe('M(t4999)')
    expect(fetchMock).toHaveBeenCalledTimes(3) // 2000-per-request cap
  })

  it('throws immediately on a deterministic 4xx without retrying', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad request', { status: 400 }))

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/mask-batch request failed/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockSleep).not.toHaveBeenCalled()
  })

  it('retries a transient 5xx with backoff and then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(new Response('deploying', { status: 503 }))

    const { masked } = await maskPIIBatchViaHttp(['a'], [])

    expect(masked).toEqual(['M(a)'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockSleep).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry budget is exhausted on a persistent 5xx', async () => {
    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }))

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/mask-batch request failed/)
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(mockSleep).toHaveBeenCalledTimes(7)
  })

  describe('with a failed-chunk placeholder', () => {
    const PLACEHOLDER = '[FAILED]'
    const CHUNK_SIZE = 2000
    const CONCURRENCY = 64
    /**
     * Fills every concurrent slot with chunks the service fails, then queues two more
     * chunks (`'queued'`) that it would mask if they were ever sent.
     */
    const failingThenQueued = () => [
      ...Array.from({ length: CHUNK_SIZE * CONCURRENCY }, () => 'failing'),
      ...Array.from({ length: CHUNK_SIZE + 1 }, () => 'queued'),
    ]
    const serviceFailingWith = (status: number) =>
      fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
        const { texts } = JSON.parse(init.body) as { texts: string[] }
        if (texts[0] !== 'queued') return new Response('failed', { status })
        return Response.json({ masked: texts.map((t) => `M(${t})`) })
      })

    it('scrubs queued chunks without sending them once an outage outlives its retries', async () => {
      serviceFailingWith(503)

      const { masked } = await maskPIIBatchViaHttp(failingThenQueued(), [], undefined, undefined, {
        failedChunkPlaceholder: PLACEHOLDER,
      })

      expect(masked.every((value) => value === PLACEHOLDER)).toBe(true)
    })

    it('still masks queued chunks after a persistent 500, which is not an outage', async () => {
      serviceFailingWith(500)

      const { masked } = await maskPIIBatchViaHttp(failingThenQueued(), [], undefined, undefined, {
        failedChunkPlaceholder: PLACEHOLDER,
      })

      expect(masked.slice(0, CHUNK_SIZE * CONCURRENCY).every((v) => v === PLACEHOLDER)).toBe(true)
      expect(masked.slice(CHUNK_SIZE * CONCURRENCY).every((v) => v === 'M(queued)')).toBe(true)
    })
  })

  it('does not retry a null 200 body (deterministic, not a transient TypeError)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })
    )

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/unexpected result/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockSleep).not.toHaveBeenCalled()
  })
})
