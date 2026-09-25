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

    const out = await maskPIIBatchViaHttp(texts, [])

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

    const out = await maskPIIBatchViaHttp(['a'], [])

    expect(out).toEqual(['M(a)'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mockSleep).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry budget is exhausted on a persistent 5xx', async () => {
    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }))

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/mask-batch request failed/)
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(mockSleep).toHaveBeenCalledTimes(7)
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
