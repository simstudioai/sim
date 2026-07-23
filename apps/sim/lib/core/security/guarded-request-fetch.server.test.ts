/**
 * @vitest-environment node
 *
 * Covers the `undici.request()`-backed guarded fetch: `createSsrfGuardedFetchWithDispatcher`
 * builds its `fetch` on `undici.request` (not `undici.fetch`) because undici's `fetch` never
 * delivers a streaming `response.body` under the Bun runtime the server runs on. These tests
 * drive the real builder with a mocked `undici.request` and assert the constructed `Response`
 * preserves status/headers/url, streams its body, follows redirects via `followRedirectsGuarded`,
 * serves buffered reads, and settles the reader when the source is destroyed without an error.
 */
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAgent, mockUndiciRequest } = vi.hoisted(() => {
  class MockAgent {
    close() {
      return Promise.resolve()
    }
    destroy() {
      return Promise.resolve()
    }
  }
  return { mockAgent: MockAgent, mockUndiciRequest: vi.fn() }
})

vi.mock('undici', () => ({ Agent: mockAgent, request: mockUndiciRequest, fetch: vi.fn() }))

declare module '@/lib/core/security/input-validation.server?guarded-request-test' {
  // biome-ignore lint/suspicious/noExportsInTest: ambient re-declaration for the query-suffixed specifier
  export * from '@/lib/core/security/input-validation.server'
}

import { createSsrfGuardedFetchWithDispatcher } from '@/lib/core/security/input-validation.server?guarded-request-test'

/** A byte stream that yields a single `Buffer` chunk then ends — mirrors undici's body. */
function byteStream(text: string): Readable {
  const stream = new Readable({ read() {} })
  stream.push(Buffer.from(text))
  stream.push(null)
  return stream
}

function undiciReply(
  statusCode: number,
  headers: Record<string, string | string[]>,
  body: Readable
) {
  return { statusCode, headers, body, trailers: {}, opaque: null, context: {} }
}

describe('createSsrfGuardedFetchWithDispatcher (undici.request backed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('constructs a Response with the reply status, headers, url, and a streaming body', async () => {
    mockUndiciRequest.mockResolvedValueOnce(
      undiciReply(
        200,
        { 'content-type': 'text/event-stream', 'mcp-session-id': 's-1' },
        byteStream('event: message\ndata: {"id":1}\n\n')
      )
    )
    const { fetch } = createSsrfGuardedFetchWithDispatcher()

    const response = await fetch('https://mcp.example.com/serve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0"}',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('mcp-session-id')).toBe('s-1')
    expect(response.url).toBe('https://mcp.example.com/serve')

    const text = await response.text()
    expect(text).toContain('"id":1')

    // Does NOT auto-follow redirects — followRedirectsGuarded drives them instead.
    expect(mockUndiciRequest).toHaveBeenCalledTimes(1)
    const [, options] = mockUndiciRequest.mock.calls[0]
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'content-type': 'application/json' })
    expect(options.body).toBe('{"jsonrpc":"2.0"}')
    expect(options.maxRedirections).toBeUndefined()
  })

  it('follows a redirect through followRedirectsGuarded and reports the final url', async () => {
    mockUndiciRequest
      .mockResolvedValueOnce(
        undiciReply(302, { location: 'https://mcp.example.com/final' }, byteStream('redirect'))
      )
      .mockResolvedValueOnce(undiciReply(200, {}, byteStream('final-body')))
    const { fetch } = createSsrfGuardedFetchWithDispatcher()

    const response = await fetch('https://mcp.example.com/start', { method: 'GET' })

    expect(mockUndiciRequest).toHaveBeenCalledTimes(2)
    expect(response.status).toBe(200)
    expect(response.url).toBe('https://mcp.example.com/final')
    expect(await response.text()).toBe('final-body')
  })

  it('supports buffered reads (.json()) through the constructed body', async () => {
    mockUndiciRequest.mockResolvedValueOnce(
      undiciReply(
        200,
        { 'content-type': 'application/json' },
        byteStream(JSON.stringify({ ok: true }))
      )
    )
    const { fetch } = createSsrfGuardedFetchWithDispatcher()

    const response = await fetch('https://mcp.example.com/data', { method: 'GET' })

    expect(await response.json()).toEqual({ ok: true })
  })

  it('normalizes a Headers instance and an ArrayBuffer body for undici.request', async () => {
    mockUndiciRequest.mockResolvedValueOnce(undiciReply(200, {}, byteStream('x')))
    const { fetch } = createSsrfGuardedFetchWithDispatcher()

    await fetch('https://mcp.example.com/x', {
      method: 'POST',
      headers: new Headers({ authorization: 'Bearer t' }),
      body: new TextEncoder().encode('payload').buffer,
    })

    const [, options] = mockUndiciRequest.mock.calls[0]
    expect(options.headers).toEqual({ authorization: 'Bearer t' })
    expect(Buffer.isBuffer(options.body)).toBe(true)
    expect(Buffer.from(options.body).toString()).toBe('payload')
  })

  it('serializes a URLSearchParams body and defaults the form content-type (OAuth token exchange)', async () => {
    mockUndiciRequest.mockResolvedValueOnce(undiciReply(200, {}, byteStream('{}')))
    const { fetch } = createSsrfGuardedFetchWithDispatcher()

    await fetch('https://auth.example.com/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'r-1' }),
    })

    const [, options] = mockUndiciRequest.mock.calls[0]
    expect(options.body).toBe('grant_type=refresh_token&refresh_token=r-1')
    expect(options.headers['content-type']).toBe('application/x-www-form-urlencoded;charset=UTF-8')
  })

  it('does not override an explicit content-type on a URLSearchParams body', async () => {
    mockUndiciRequest.mockResolvedValueOnce(undiciReply(200, {}, byteStream('{}')))
    const { fetch } = createSsrfGuardedFetchWithDispatcher()

    await fetch('https://auth.example.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code' }),
    })

    const [, options] = mockUndiciRequest.mock.calls[0]
    expect(options.body).toBe('grant_type=authorization_code')
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(options.headers['content-type']).toBeUndefined()
  })

  it('copies each chunk so a recycled source buffer cannot corrupt queued data', async () => {
    const source = new Readable({ read() {} })
    mockUndiciRequest.mockResolvedValueOnce(undiciReply(200, {}, source))
    const { fetch } = createSsrfGuardedFetchWithDispatcher()

    const response = await fetch('https://mcp.example.com/stream', { method: 'GET' })
    const reader = response.body!.getReader()

    // Emit a chunk, then mutate the SAME backing buffer (as undici's pool reuse would).
    const buf = Buffer.from('AB')
    source.push(buf)
    const first = await reader.read()
    buf[0] = 0x00 // corrupt the source buffer after the chunk was enqueued
    expect(Buffer.from(first.value!).toString()).toBe('AB') // copy is unaffected
    source.push(null)
    await reader.read()
  })

  it('rejects the reader when the source is destroyed without an error (abort/reset)', async () => {
    const source = new Readable({ read() {} }) // stays open, never pushes
    mockUndiciRequest.mockResolvedValueOnce(undiciReply(200, {}, source))
    const { fetch } = createSsrfGuardedFetchWithDispatcher()

    const response = await fetch('https://mcp.example.com/hang', { method: 'GET' })
    const reader = response.body!.getReader()
    const read = reader.read()
    source.destroy() // no error argument — mirrors an aborted/reset socket

    await expect(read).rejects.toThrow(/closed before completing/)
  })
})
