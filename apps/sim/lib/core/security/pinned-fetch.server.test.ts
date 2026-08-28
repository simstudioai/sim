/**
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAgent, mockUndiciRequest, capturedAgentOptions } = vi.hoisted(() => {
  const capturedAgentOptions: unknown[] = []
  class MockAgent {
    constructor(options: unknown) {
      capturedAgentOptions.push(options)
    }
    close() {
      return Promise.resolve()
    }
    destroy() {
      return Promise.resolve()
    }
  }
  return {
    mockAgent: MockAgent,
    mockUndiciRequest: vi.fn(),
    capturedAgentOptions,
  }
})

vi.mock('undici', () => ({ Agent: mockAgent, request: mockUndiciRequest }))

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

afterEach(resetEnvFlagsMock)

describe('createPinnedFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedAgentOptions.length = 0
    mockUndiciRequest.mockResolvedValue(undiciReply(200, {}, byteStream('ok')))
  })

  it('builds an undici Agent whose pinned lookup always resolves to the validated IP', async () => {
    createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint' })

    expect(capturedAgentOptions).toHaveLength(1)
    const { connect } = capturedAgentOptions[0] as { connect: { lookup: PinnedLookup } }
    expect(typeof connect.lookup).toBe('function')

    const resolved = await new Promise<{ address: string; family: number }>((resolve) => {
      connect.lookup('rebind.attacker.tld', {}, (_err, address, family) =>
        resolve({ address, family })
      )
    })
    expect(resolved).toEqual({ address: '93.184.216.34', family: 4 })
  })

  it('defaults allowH2 to false so existing consumers are unchanged', () => {
    createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint' })
    const opts = capturedAgentOptions[0] as { allowH2?: boolean }
    expect(opts.allowH2).toBe(false)
  })

  it('opts the Agent into HTTP/2 when allowH2 is requested', () => {
    createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint', allowH2: true })
    const opts = capturedAgentOptions[0] as { allowH2?: boolean }
    expect(opts.allowH2).toBe(true)
  })

  it('uses IPv6 family when the validated IP is IPv6', async () => {
    createPinnedFetch('2606:4700:4700::1111', { profile: 'configuredEndpoint' })
    const { connect } = capturedAgentOptions[0] as { connect: { lookup: PinnedLookup } }
    const resolved = await new Promise<{ address: string; family: number }>((resolve) => {
      connect.lookup('example.com', {}, (_err, address, family) => resolve({ address, family }))
    })
    expect(resolved).toEqual({ address: '2606:4700:4700::1111', family: 6 })
  })

  it('dispatches through the pinned Agent, preserving init', async () => {
    const pinned = createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint' })
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
    expect(options.dispatcher).toBeInstanceOf(mockAgent)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'api-key': 'secret' })
    expect(options.body).toBe('{}')
    expect(options.signal).toBe(controller.signal)
  })

  it('honors redirect: "manual" — returns the 3xx without following (auth-type probe)', async () => {
    mockUndiciRequest.mockResolvedValueOnce(
      undiciReply(302, { location: 'https://login.example.com/' }, byteStream(''))
    )
    const pinned = createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint' })

    const response = await pinned('https://mcp.example.com/', { redirect: 'manual' })

    expect(mockUndiciRequest).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://login.example.com/')
  })

  it('honors redirect mode carried on a Request input (not just init)', async () => {
    mockUndiciRequest.mockResolvedValueOnce(
      undiciReply(302, { location: 'https://login.example.com/' }, byteStream(''))
    )
    const pinned = createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint' })

    const response = await pinned(new Request('https://mcp.example.com/', { redirect: 'manual' }))

    expect(mockUndiciRequest).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(302)
  })

  it('follows redirects by default and DROPS headers on a cross-origin hop (no api-key leak)', async () => {
    mockUndiciRequest
      .mockResolvedValueOnce(
        undiciReply(307, { location: 'https://other-origin.example/final' }, byteStream(''))
      )
      .mockResolvedValueOnce(undiciReply(200, {}, byteStream('done')))
    const pinned = createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint' })

    const response = await pinned('https://azure.example.com/v1/responses', {
      method: 'GET',
      headers: { 'api-key': 'secret' },
    })

    expect(mockUndiciRequest).toHaveBeenCalledTimes(2)
    // Second (cross-origin) hop must not carry the provider credential — no headers forwarded.
    const secondHopHeaders = (mockUndiciRequest.mock.calls[1][1].headers ?? {}) as Record<
      string,
      string
    >
    expect(secondHopHeaders['api-key']).toBeUndefined()
    expect(Object.keys(secondHopHeaders)).toHaveLength(0)
    expect(response.status).toBe(200)
    expect(response.url).toBe('https://other-origin.example/final')
    expect(response.redirected).toBe(true)
    expect(await response.text()).toBe('done')
  })

  it('reaches a private IP-literal URL the operator allowlisted', async () => {
    setEnvFlags({ egressAllowedIpRanges: '10.0.0.0/8' })
    mockUndiciRequest.mockResolvedValueOnce(undiciReply(200, {}, byteStream('mcp')))
    const pinned = createPinnedFetch('10.0.0.5', { profile: 'configuredEndpoint' })

    // A self-hosted MCP on a private address connects because the deployment
    // named that range, not because the address happened to be the pinned one.
    const response = await pinned('http://10.0.0.5:3000/mcp', { method: 'POST', body: '{}' })

    expect(mockUndiciRequest).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('mcp')
  })

  it('follows a redirect that stays inside the allowlisted range', async () => {
    setEnvFlags({ egressAllowedIpRanges: '10.0.0.0/8' })
    mockUndiciRequest
      .mockResolvedValueOnce(
        undiciReply(301, { location: 'http://10.0.0.5:3000/mcp/' }, byteStream(''))
      )
      .mockResolvedValueOnce(undiciReply(200, {}, byteStream('mcp')))
    const pinned = createPinnedFetch('10.0.0.5', { profile: 'configuredEndpoint' })

    const response = await pinned('http://10.0.0.5:3000/mcp', { method: 'GET' })

    expect(mockUndiciRequest).toHaveBeenCalledTimes(2)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('mcp')
  })

  it('still blocks a redirect to a private IP outside the allowlist', async () => {
    setEnvFlags({ egressAllowedIpRanges: '10.0.0.0/8' })
    mockUndiciRequest.mockResolvedValueOnce(
      undiciReply(302, { location: 'http://169.254.169.254/latest/meta-data/' }, byteStream(''))
    )
    const pinned = createPinnedFetch('10.0.0.5', { profile: 'configuredEndpoint' })

    await expect(pinned('http://10.0.0.5:3000/mcp', { method: 'GET' })).rejects.toThrow(
      /cloud metadata endpoint/
    )
    // The initial request happened; the redirect to the metadata IP was refused.
    expect(mockUndiciRequest).toHaveBeenCalledTimes(1)
  })

  it('reuses one dispatcher across all calls of a single instance', async () => {
    const pinned = createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint' })
    await pinned('https://example.com/a')
    await pinned('https://example.com/b')

    expect(capturedAgentOptions).toHaveLength(1)
    const d1 = (mockUndiciRequest.mock.calls[0][1] as { dispatcher: unknown }).dispatcher
    const d2 = (mockUndiciRequest.mock.calls[1][1] as { dispatcher: unknown }).dispatcher
    expect(d1).toBe(d2)
  })

  it('creates an independent dispatcher per instance', async () => {
    const a = createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint' })
    const b = createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint' })
    await a('https://example.com/a')
    await b('https://example.com/b')

    expect(capturedAgentOptions).toHaveLength(2)
    const d1 = (mockUndiciRequest.mock.calls[0][1] as { dispatcher: unknown }).dispatcher
    const d2 = (mockUndiciRequest.mock.calls[1][1] as { dispatcher: unknown }).dispatcher
    expect(d1).not.toBe(d2)
  })

  it('returns a streaming Response built from the undici.request body', async () => {
    mockUndiciRequest.mockResolvedValueOnce(undiciReply(201, {}, byteStream('pong')))
    const pinned = createPinnedFetch('93.184.216.34', { profile: 'configuredEndpoint' })
    const response = await pinned('https://example.com')
    expect(response.status).toBe(201)
    expect(await response.text()).toBe('pong')
  })
})
