/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAgent,
  mockUndiciRequest,
  mockRedirectInterceptor,
  capturedAgentOptions,
  capturedRedirectOptions,
} = vi.hoisted(() => {
  const capturedAgentOptions: unknown[] = []
  const capturedRedirectOptions: unknown[] = []
  class MockAgent {
    constructor(options: unknown) {
      capturedAgentOptions.push(options)
    }
    // The pinned builder follows redirects by composing this Agent with the redirect
    // interceptor; the composed dispatcher is what reaches undici.request.
    compose(interceptor: unknown) {
      return { __composed: true, base: this, interceptor }
    }
    close() {
      return Promise.resolve()
    }
    destroy() {
      return Promise.resolve()
    }
  }
  const mockRedirectInterceptor = vi.fn((options: unknown) => {
    capturedRedirectOptions.push(options)
    return { __redirectInterceptor: true }
  })
  return {
    mockAgent: MockAgent,
    mockUndiciRequest: vi.fn(),
    mockRedirectInterceptor,
    capturedAgentOptions,
    capturedRedirectOptions,
  }
})

vi.mock('undici', () => ({
  Agent: mockAgent,
  request: mockUndiciRequest,
  interceptors: { redirect: mockRedirectInterceptor },
}))

declare module '@/lib/core/security/input-validation.server?pinned-fetch-test' {
  // biome-ignore lint/suspicious/noExportsInTest: ambient re-declaration for the query-suffixed specifier
  export * from '@/lib/core/security/input-validation.server'
}

import { createPinnedFetch } from '@/lib/core/security/input-validation.server?pinned-fetch-test'

type LookupCallback = (err: Error | null, address: string, family: number) => void
type PinnedLookup = (hostname: string, options: { all?: boolean }, callback: LookupCallback) => void

function byteStream(text: string): Readable {
  const stream = new Readable({ read() {} })
  stream.push(Buffer.from(text))
  stream.push(null)
  return stream
}

function undiciReply(statusCode: number, headers: Record<string, string>, body: Readable) {
  return { statusCode, headers, body, trailers: {}, opaque: null, context: {} }
}

describe('createPinnedFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedAgentOptions.length = 0
    capturedRedirectOptions.length = 0
    mockUndiciRequest.mockResolvedValue(undiciReply(200, {}, byteStream('ok')))
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

  it('follows redirects through the pinned Agent (interceptor composed with the app max)', () => {
    createPinnedFetch('203.0.113.10')
    expect(mockRedirectInterceptor).toHaveBeenCalledTimes(1)
    expect(capturedRedirectOptions[0]).toEqual({ maxRedirections: 5 })
  })

  it('dispatches through the composed (redirect-following) dispatcher, preserving init', async () => {
    const pinned = createPinnedFetch('203.0.113.10')
    const controller = new AbortController()

    await pinned('https://myresource.openai.azure.com/openai/v1/responses', {
      method: 'POST',
      headers: { 'api-key': 'secret' },
      body: '{}',
      signal: controller.signal,
    })

    expect(mockUndiciRequest).toHaveBeenCalledTimes(1)
    const [url, options] = mockUndiciRequest.mock.calls[0]
    expect(url).toBe('https://myresource.openai.azure.com/openai/v1/responses')
    expect((options.dispatcher as { __composed?: boolean }).__composed).toBe(true)
    expect((options.dispatcher as { base: unknown }).base).toBeInstanceOf(mockAgent)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'api-key': 'secret' })
    expect(options.body).toBe('{}')
    expect(options.signal).toBe(controller.signal)
  })

  it('handles an undefined init by still dispatching through the pinned dispatcher', async () => {
    const pinned = createPinnedFetch('203.0.113.10')
    await pinned('https://example.com')
    const options = mockUndiciRequest.mock.calls[0][1] as { dispatcher: { __composed?: boolean } }
    expect(options.dispatcher.__composed).toBe(true)
  })

  it('reuses one composed dispatcher across all calls of a single instance', async () => {
    const pinned = createPinnedFetch('203.0.113.10')
    await pinned('https://example.com/a')
    await pinned('https://example.com/b')

    expect(capturedAgentOptions).toHaveLength(1)
    const d1 = (mockUndiciRequest.mock.calls[0][1] as { dispatcher: unknown }).dispatcher
    const d2 = (mockUndiciRequest.mock.calls[1][1] as { dispatcher: unknown }).dispatcher
    expect(d1).toBe(d2)
  })

  it('creates an independent dispatcher per instance', async () => {
    const a = createPinnedFetch('203.0.113.10')
    const b = createPinnedFetch('203.0.113.10')
    await a('https://example.com/a')
    await b('https://example.com/b')

    expect(capturedAgentOptions).toHaveLength(2)
    const d1 = (mockUndiciRequest.mock.calls[0][1] as { dispatcher: unknown }).dispatcher
    const d2 = (mockUndiciRequest.mock.calls[1][1] as { dispatcher: unknown }).dispatcher
    expect(d1).not.toBe(d2)
  })

  it('returns a streaming Response built from the undici.request body', async () => {
    mockUndiciRequest.mockResolvedValueOnce(undiciReply(201, {}, byteStream('pong')))
    const pinned = createPinnedFetch('203.0.113.10')
    const response = await pinned('https://example.com')
    expect(response.status).toBe(201)
    expect(await response.text()).toBe('pong')
  })
})
