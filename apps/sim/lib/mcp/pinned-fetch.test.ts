/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAgent, mockCreatePinnedLookup, mockUndiciFetch, capturedAgentOptions, agentCloses } =
  vi.hoisted(() => {
    const capturedAgentOptions: unknown[] = []
    const agentCloses: unknown[] = []
    class MockAgent {
      constructor(options: unknown) {
        capturedAgentOptions.push(options)
      }
      close() {
        agentCloses.push(this)
        return Promise.resolve()
      }
    }
    return {
      mockAgent: MockAgent,
      mockCreatePinnedLookup: vi.fn(),
      mockUndiciFetch: vi.fn(),
      capturedAgentOptions,
      agentCloses,
    }
  })

const { mockValidateMcpServerSsrf } = vi.hoisted(() => ({
  mockValidateMcpServerSsrf: vi.fn(),
}))

vi.mock('undici', () => ({ Agent: mockAgent, fetch: mockUndiciFetch }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  createPinnedLookup: mockCreatePinnedLookup,
}))
vi.mock('@/lib/mcp/domain-check', () => ({
  validateMcpServerSsrf: mockValidateMcpServerSsrf,
}))

import {
  __resetPinnedAgentsForTests,
  createMcpPinnedFetch,
  createSsrfGuardedMcpFetch,
} from '@/lib/mcp/pinned-fetch'

describe('createMcpPinnedFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedAgentOptions.length = 0
    agentCloses.length = 0
    __resetPinnedAgentsForTests()
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

  it('reuses the same dispatcher across calls within a fetch instance', async () => {
    const fetchLike = createMcpPinnedFetch('203.0.113.10')
    await fetchLike('https://example.com/a')
    await fetchLike('https://example.com/b')
    expect(capturedAgentOptions).toHaveLength(1)
    const d1 = (mockUndiciFetch.mock.calls[0][1] as { dispatcher: unknown }).dispatcher
    const d2 = (mockUndiciFetch.mock.calls[1][1] as { dispatcher: unknown }).dispatcher
    expect(d1).toBe(d2)
  })

  it('pools agents by resolvedIP across createMcpPinnedFetch calls', async () => {
    const a = createMcpPinnedFetch('203.0.113.10')
    const b = createMcpPinnedFetch('203.0.113.10')
    await a('https://example.com/a')
    await b('https://example.com/b')
    expect(capturedAgentOptions).toHaveLength(1)
    const d1 = (mockUndiciFetch.mock.calls[0][1] as { dispatcher: unknown }).dispatcher
    const d2 = (mockUndiciFetch.mock.calls[1][1] as { dispatcher: unknown }).dispatcher
    expect(d1).toBe(d2)
  })

  it('creates separate agents for different resolved IPs', async () => {
    const a = createMcpPinnedFetch('203.0.113.10')
    const b = createMcpPinnedFetch('198.51.100.20')
    await a('https://example.com/a')
    await b('https://example.com/b')
    expect(capturedAgentOptions).toHaveLength(2)
    const d1 = (mockUndiciFetch.mock.calls[0][1] as { dispatcher: unknown }).dispatcher
    const d2 = (mockUndiciFetch.mock.calls[1][1] as { dispatcher: unknown }).dispatcher
    expect(d1).not.toBe(d2)
  })

  it('does not close evicted agents — captured closures keep working', async () => {
    // Build an early closure whose agent will get evicted by later IPs.
    const earlyClient = createMcpPinnedFetch('10.0.0.1')
    // Fill the cache past its 64-entry limit so the early entry is evicted.
    for (let i = 0; i < 64; i++) createMcpPinnedFetch(`10.1.${Math.floor(i / 256)}.${i % 256}`)

    // Eviction must NOT have closed any agents.
    expect(agentCloses).toHaveLength(0)
    // The early closure's captured dispatcher is still callable.
    await earlyClient('https://example.com/still-works')
    expect(mockUndiciFetch).toHaveBeenCalledTimes(1)
  })
})

describe('createSsrfGuardedMcpFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedAgentOptions.length = 0
    __resetPinnedAgentsForTests()
    mockCreatePinnedLookup.mockReturnValue('pinned-lookup-fn')
    mockUndiciFetch.mockResolvedValue(new Response('ok'))
  })

  it('validates each request URL and pins to the resolved IP', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    const fetchLike = createSsrfGuardedMcpFetch()
    await fetchLike('https://attacker.example/revoke', { method: 'POST' })

    expect(mockValidateMcpServerSsrf).toHaveBeenCalledWith('https://attacker.example/revoke')
    expect(mockUndiciFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockUndiciFetch.mock.calls[0]
    expect(url).toBe('https://attacker.example/revoke')
    expect((init as { dispatcher?: unknown }).dispatcher).toBeInstanceOf(mockAgent)
    expect((init as { method?: string }).method).toBe('POST')
  })

  it('rejects URLs that resolve to blocked IPs without issuing the request', async () => {
    mockValidateMcpServerSsrf.mockRejectedValue(new Error('blocked'))
    const fetchLike = createSsrfGuardedMcpFetch()

    await expect(
      fetchLike('http://169.254.169.254/latest/meta-data/', { method: 'POST' })
    ).rejects.toThrow('blocked')
    expect(mockUndiciFetch).not.toHaveBeenCalled()
  })

  it('accepts URL objects and validates their href', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    const fetchLike = createSsrfGuardedMcpFetch()
    await fetchLike(new URL('https://attacker.example/discover'))

    expect(mockValidateMcpServerSsrf).toHaveBeenCalledWith('https://attacker.example/discover')
    expect(mockUndiciFetch).toHaveBeenCalledTimes(1)
  })
})
