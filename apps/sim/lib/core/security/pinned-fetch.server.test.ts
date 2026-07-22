/**
 * @vitest-environment node
 */
import { envFlagsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAgent, mockUndiciFetch, capturedAgentOptions, agentCloses } = vi.hoisted(() => {
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
    mockUndiciFetch: vi.fn(),
    capturedAgentOptions,
    agentCloses,
  }
})

vi.mock('undici', () => ({ Agent: mockAgent, fetch: mockUndiciFetch }))
vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

import { createPinnedFetch } from '@/lib/core/security/input-validation.server'

type LookupCallback = (err: Error | null, address: string, family: number) => void
type PinnedLookup = (hostname: string, options: { all?: boolean }, callback: LookupCallback) => void

describe('createPinnedFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedAgentOptions.length = 0
    agentCloses.length = 0
    mockUndiciFetch.mockResolvedValue(new Response('ok'))
  })

  it('builds an undici Agent whose pinned lookup always resolves to the validated IP', async () => {
    createPinnedFetch('203.0.113.10')

    expect(capturedAgentOptions).toHaveLength(1)
    const { connect } = capturedAgentOptions[0] as { connect: { lookup: PinnedLookup } }
    expect(typeof connect.lookup).toBe('function')

    const resolved = await new Promise<{ address: string; family: number }>((resolve) => {
      connect.lookup('rebind.attacker.tld', {}, (_err, address, family) =>
        resolve({ address, family })
      )
    })
    expect(resolved).toEqual({ address: '203.0.113.10', family: 4 })
  })

  it('defaults allowH2 to false so existing consumers are unchanged', () => {
    createPinnedFetch('203.0.113.10')
    const opts = capturedAgentOptions[0] as { allowH2?: boolean }
    expect(opts.allowH2).toBe(false)
  })

  it('opts the Agent into HTTP/2 when allowH2 is requested', () => {
    createPinnedFetch('203.0.113.10', { allowH2: true })
    const opts = capturedAgentOptions[0] as { allowH2?: boolean }
    expect(opts.allowH2).toBe(true)
  })

  it('uses IPv6 family when the validated IP is IPv6', async () => {
    createPinnedFetch('2606:4700:4700::1111')
    const { connect } = capturedAgentOptions[0] as { connect: { lookup: PinnedLookup } }
    const resolved = await new Promise<{ address: string; family: number }>((resolve) => {
      connect.lookup('example.com', {}, (_err, address, family) => resolve({ address, family }))
    })
    expect(resolved).toEqual({ address: '2606:4700:4700::1111', family: 6 })
  })

  it('forwards the pinned dispatcher on every call while preserving init options', async () => {
    const pinned = createPinnedFetch('203.0.113.10')
    const controller = new AbortController()

    await pinned('https://myresource.openai.azure.com/openai/v1/responses', {
      method: 'POST',
      headers: { 'api-key': 'secret' },
      body: '{}',
      signal: controller.signal,
    })

    expect(mockUndiciFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockUndiciFetch.mock.calls[0]
    expect(url).toBe('https://myresource.openai.azure.com/openai/v1/responses')
    const typedInit = init as RequestInit & { dispatcher?: unknown }
    expect(typedInit.dispatcher).toBeInstanceOf(mockAgent)
    expect(typedInit.method).toBe('POST')
    expect(typedInit.headers).toEqual({ 'api-key': 'secret' })
    expect(typedInit.body).toBe('{}')
    expect(typedInit.signal).toBe(controller.signal)
  })

  it('handles an undefined init by still attaching the dispatcher', async () => {
    const pinned = createPinnedFetch('203.0.113.10')
    await pinned('https://example.com')
    const init = mockUndiciFetch.mock.calls[0][1] as { dispatcher?: unknown }
    expect(init.dispatcher).toBeInstanceOf(mockAgent)
  })

  it('reuses one captured dispatcher across all calls of a single instance', async () => {
    const pinned = createPinnedFetch('203.0.113.10')
    await pinned('https://example.com/a')
    await pinned('https://example.com/b')

    expect(capturedAgentOptions).toHaveLength(1)
    const d1 = (mockUndiciFetch.mock.calls[0][1] as { dispatcher: unknown }).dispatcher
    const d2 = (mockUndiciFetch.mock.calls[1][1] as { dispatcher: unknown }).dispatcher
    expect(d1).toBe(d2)
  })

  it('creates an independent dispatcher per instance', async () => {
    const a = createPinnedFetch('203.0.113.10')
    const b = createPinnedFetch('203.0.113.10')
    await a('https://example.com/a')
    await b('https://example.com/b')

    expect(capturedAgentOptions).toHaveLength(2)
    const d1 = (mockUndiciFetch.mock.calls[0][1] as { dispatcher: unknown }).dispatcher
    const d2 = (mockUndiciFetch.mock.calls[1][1] as { dispatcher: unknown }).dispatcher
    expect(d1).not.toBe(d2)
  })

  it('returns the response produced by undici fetch', async () => {
    mockUndiciFetch.mockResolvedValueOnce(new Response('pong', { status: 201 }))
    const pinned = createPinnedFetch('203.0.113.10')
    const response = await pinned('https://example.com')
    expect(response.status).toBe(201)
    expect(await response.text()).toBe('pong')
  })
})
