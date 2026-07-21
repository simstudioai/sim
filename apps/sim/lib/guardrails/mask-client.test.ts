/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockToken, mockBaseUrl, mockSleep } = vi.hoisted(() => ({
  mockToken: vi.fn(),
  mockBaseUrl: vi.fn(),
  mockSleep: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({ generateInternalToken: mockToken }))
vi.mock('@/lib/core/utils/urls', () => ({ getInternalApiBaseUrl: mockBaseUrl }))
vi.mock('@sim/utils/helpers', () => ({ sleep: mockSleep }))

import { maskPIIBatchViaHttp } from '@/lib/guardrails/mask-client'

describe('maskPIIBatchViaHttp', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockToken.mockResolvedValue('tok')
    mockBaseUrl.mockReturnValue('http://app.internal:3000')
    mockSleep.mockResolvedValue(undefined)
    fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const { texts } = JSON.parse(init.body) as { texts: string[] }
      return new Response(JSON.stringify({ masked: texts.map((t) => `M(${t})`) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('masks a small batch in a single request', async () => {
    const out = await maskPIIBatchViaHttp(['a', 'b', 'c'], ['EMAIL_ADDRESS'])

    expect(out).toEqual(['M(a)', 'M(b)', 'M(c)'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('retries a rejected fetch (network error) and then succeeds', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    const out = await maskPIIBatchViaHttp(['a'], [])

    expect(out).toEqual(['M(a)'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after the retry budget is exhausted on a persistent 5xx', async () => {
    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }))

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/mask-batch request failed/)
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(mockSleep).toHaveBeenCalledTimes(7)
  })

  it('mints a fresh internal token per attempt', async () => {
    fetchMock.mockResolvedValueOnce(new Response('deploying', { status: 503 }))

    await maskPIIBatchViaHttp(['a'], [])

    expect(mockToken).toHaveBeenCalledTimes(2)
  })

  it('does not retry a shape mismatch (deterministic server bug)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ nope: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/unexpected result/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns [] without any request for empty input', async () => {
    const out = await maskPIIBatchViaHttp([], [])

    expect(out).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
