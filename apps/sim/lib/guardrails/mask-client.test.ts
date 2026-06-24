/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockToken, mockBaseUrl } = vi.hoisted(() => ({
  mockToken: vi.fn(),
  mockBaseUrl: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({ generateInternalToken: mockToken }))
vi.mock('@/lib/core/utils/urls', () => ({ getInternalApiBaseUrl: mockBaseUrl }))

import { maskPIIBatchViaHttp } from '@/lib/guardrails/mask-client'

describe('maskPIIBatchViaHttp', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
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

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('masks a small batch in a single request, with an abort timeout', async () => {
    const out = await maskPIIBatchViaHttp(['a', 'b', 'c'], ['EMAIL_ADDRESS'])

    expect(out).toEqual(['M(a)', 'M(b)', 'M(c)'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('splits by count into multiple requests, preserving global order', async () => {
    const texts = Array.from({ length: 5000 }, (_, i) => `t${i}`)

    const out = await maskPIIBatchViaHttp(texts, [])

    expect(out).toHaveLength(5000)
    expect(out[0]).toBe('M(t0)')
    expect(out[4999]).toBe('M(t4999)')
    expect(fetchMock).toHaveBeenCalledTimes(3) // 2000-per-request cap
  })

  it('throws on a non-2xx response so the caller can scrub', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))

    await expect(maskPIIBatchViaHttp(['a'], [])).rejects.toThrow(/mask-batch request failed/)
  })

  it('returns [] without any request for empty input', async () => {
    const out = await maskPIIBatchViaHttp([], [])

    expect(out).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
