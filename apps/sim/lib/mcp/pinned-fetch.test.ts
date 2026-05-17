/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAgent, mockCreatePinnedLookup, mockUndiciFetch, capturedAgentOptions } = vi.hoisted(
  () => {
    const capturedAgentOptions: unknown[] = []
    class MockAgent {
      constructor(options: unknown) {
        capturedAgentOptions.push(options)
      }
    }
    return {
      mockAgent: MockAgent,
      mockCreatePinnedLookup: vi.fn(),
      mockUndiciFetch: vi.fn(),
      capturedAgentOptions,
    }
  }
)

vi.mock('undici', () => ({ Agent: mockAgent, fetch: mockUndiciFetch }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  createPinnedLookup: mockCreatePinnedLookup,
}))

import { createMcpPinnedFetch } from '@/lib/mcp/pinned-fetch'

describe('createMcpPinnedFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedAgentOptions.length = 0
    mockCreatePinnedLookup.mockReturnValue('pinned-lookup-fn')
    mockUndiciFetch.mockResolvedValue(new Response('ok'))
  })

  it('builds an undici Agent with the pinned lookup for the resolved IP', () => {
    createMcpPinnedFetch('203.0.113.10')
    expect(mockCreatePinnedLookup).toHaveBeenCalledWith('203.0.113.10')
    expect(capturedAgentOptions).toHaveLength(1)
    expect(capturedAgentOptions[0]).toEqual({ connect: { lookup: 'pinned-lookup-fn' } })
  })

  it('forwards the dispatcher on every fetch call', async () => {
    const fetchLike = createMcpPinnedFetch('203.0.113.10')
    await fetchLike('https://example.com/mcp', { method: 'POST' })
    expect(mockUndiciFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockUndiciFetch.mock.calls[0]
    expect(url).toBe('https://example.com/mcp')
    expect((init as { dispatcher?: unknown }).dispatcher).toBeInstanceOf(mockAgent)
    expect((init as { method?: string }).method).toBe('POST')
  })

  it('preserves caller-provided init options (headers, signal)', async () => {
    const fetchLike = createMcpPinnedFetch('203.0.113.10')
    const controller = new AbortController()
    await fetchLike('https://example.com/mcp', {
      method: 'GET',
      headers: { 'x-test': '1' },
      signal: controller.signal,
    })
    const init = mockUndiciFetch.mock.calls[0][1] as RequestInit & { dispatcher?: unknown }
    expect(init.headers).toEqual({ 'x-test': '1' })
    expect(init.signal).toBe(controller.signal)
    expect(init.dispatcher).toBeInstanceOf(mockAgent)
  })

  it('handles undefined init gracefully', async () => {
    const fetchLike = createMcpPinnedFetch('203.0.113.10')
    await fetchLike('https://example.com/mcp')
    const init = mockUndiciFetch.mock.calls[0][1] as { dispatcher?: unknown }
    expect(init.dispatcher).toBeInstanceOf(mockAgent)
  })

  it('reuses the same dispatcher across calls (one Agent per fetch instance)', async () => {
    const fetchLike = createMcpPinnedFetch('203.0.113.10')
    await fetchLike('https://example.com/a')
    await fetchLike('https://example.com/b')
    expect(capturedAgentOptions).toHaveLength(1)
    const d1 = (mockUndiciFetch.mock.calls[0][1] as { dispatcher: unknown }).dispatcher
    const d2 = (mockUndiciFetch.mock.calls[1][1] as { dispatcher: unknown }).dispatcher
    expect(d1).toBe(d2)
  })
})
