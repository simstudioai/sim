/**
 * @vitest-environment node
 */
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateGuardedFetchWithDispatcher,
  mockValidateMcpServerSsrf,
  sentinelFetch,
  mockDestroy,
} = vi.hoisted(() => ({
  mockCreateGuardedFetchWithDispatcher: vi.fn(),
  mockValidateMcpServerSsrf: vi.fn(),
  sentinelFetch: vi.fn(),
  mockDestroy: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  createSsrfGuardedFetchWithDispatcher: mockCreateGuardedFetchWithDispatcher,
  isPrivateOrReservedIP: (ip: string) =>
    ip.startsWith('127.') || ip.startsWith('10.') || ip === '::1',
}))
vi.mock('@/lib/mcp/domain-check', () => ({
  validateMcpServerSsrf: mockValidateMcpServerSsrf,
}))

import { createGuardedMcpFetch, createSsrfGuardedMcpFetch } from '@/lib/mcp/pinned-fetch'

/** The per-request guarded Agent is always built with a DoS-backstop response cap. */
const withResponseCap = expect.objectContaining({ maxResponseSize: expect.any(Number) })

describe('createGuardedMcpFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDestroy.mockResolvedValue(undefined)
    mockCreateGuardedFetchWithDispatcher.mockReturnValue({
      fetch: sentinelFetch,
      dispatcher: { destroy: mockDestroy },
    })
  })

  it('builds the transport on the guarded connector with no response cap (streaming)', () => {
    const { close } = createGuardedMcpFetch()

    // No options: no `allowH2` opt-in (h1.1 default) and no maxResponseSize —
    // the long-lived transport must stream unbounded SSE.
    expect(mockCreateGuardedFetchWithDispatcher).toHaveBeenCalledWith()

    // close() tears down the pooled sockets (incl. the long-lived SSE) on disconnect.
    void close()
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })
})

describe('createSsrfGuardedMcpFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDestroy.mockResolvedValue(undefined)
    mockCreateGuardedFetchWithDispatcher.mockReturnValue({
      fetch: sentinelFetch,
      dispatcher: { destroy: mockDestroy },
    })
    sentinelFetch.mockImplementation(async () => new Response('ok'))
  })

  it('validates each request URL and issues it over the guarded connector', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    const fetchLike = createSsrfGuardedMcpFetch()
    await fetchLike('https://attacker.example/revoke', { method: 'POST' })

    expect(mockValidateMcpServerSsrf).toHaveBeenCalledWith('https://attacker.example/revoke')
    // The guarded Agent is always built with the DoS-backstop response-size cap.
    expect(mockCreateGuardedFetchWithDispatcher).toHaveBeenCalledWith(withResponseCap)
    expect(sentinelFetch).toHaveBeenCalledWith(
      'https://attacker.example/revoke',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) })
    )
  })

  it('relabels an oversized response to a descriptive McpError', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    // undici surfaces the cap breach as a fetch TypeError with a coded cause.
    sentinelFetch.mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'UND_ERR_RES_EXCEEDED_MAX_SIZE' },
      })
    )
    const fetchLike = createSsrfGuardedMcpFetch()

    await expect(fetchLike('https://as.example/token', { method: 'POST' })).rejects.toThrow(
      /exceeded \d+ bytes/
    )
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it('tears down the per-request pinned Agent after a successful request', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    const fetchLike = createSsrfGuardedMcpFetch()
    await fetchLike('https://attacker.example/token', { method: 'POST' })

    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it('tears down the pinned Agent even when the request fails', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    sentinelFetch.mockRejectedValue(new Error('socket hang up'))
    const fetchLike = createSsrfGuardedMcpFetch()

    await expect(fetchLike('https://attacker.example/token')).rejects.toThrow('socket hang up')
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it('returns a detached, in-memory copy of the response body', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    sentinelFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ token_endpoint: 'https://as.example/token' }), {
          headers: { 'content-type': 'application/json' },
        })
    )
    const fetchLike = createSsrfGuardedMcpFetch()
    const res = await fetchLike('https://as.example/.well-known/oauth-authorization-server')

    // The body is readable even though the underlying socket/Agent is already destroyed.
    expect(mockDestroy).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toEqual({ token_endpoint: 'https://as.example/token' })
  })

  it('reconstructs a null-body (204) response without throwing', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    // A 204 has no body; the detached copy must not pass an (empty) body to Response.
    sentinelFetch.mockImplementation(async () => new Response(null, { status: 204 }))
    const fetchLike = createSsrfGuardedMcpFetch()
    const res = await fetchLike('https://as.example/revoke', { method: 'POST' })

    expect(res.status).toBe(204)
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it('returns a streaming response live (un-buffered) over the unpinned fallback', async () => {
    // resolvedIP null → global fetch; a text/event-stream reply (the auth-type probe)
    // must be handed back as-is so the caller reads headers without draining the stream.
    // Identity (same object) proves it was NOT re-wrapped into a buffered copy.
    mockValidateMcpServerSsrf.mockResolvedValue(null)
    const streamingRes = new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      headers: { 'content-type': 'text/event-stream' },
    })
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => streamingRes)
    try {
      const fetchLike = createSsrfGuardedMcpFetch()
      const res = await fetchLike('https://allowed.internal/mcp', { method: 'POST' })

      expect(res).toBe(streamingRes)
      // No per-request Agent on the unpinned path, so nothing to tear down.
      expect(mockDestroy).not.toHaveBeenCalled()
    } finally {
      globalFetch.mockRestore()
    }
  })

  it('streams (does not buffer) a pinned text/event-stream reply and tears down after it drains', async () => {
    // The guard resolves the IP itself, so the probe's initialize over the guarded path
    // DOES get a pinned Agent. A streaming reply must still be handed back live (not
    // buffered — that could stall/misclassify), with the Agent torn down once it drains.
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    const sseRes = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'))
          c.close()
        },
      }),
      { headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' } }
    )
    sentinelFetch.mockImplementation(async () => sseRes)
    const fetchLike = createSsrfGuardedMcpFetch()
    const res = await fetchLike('https://mcp.example/mcp', { method: 'POST' })

    // Live (tee'd, not a buffered copy), headers preserved for the probe's classification.
    expect(res).not.toBe(sseRes)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('mcp-session-id')).toBe('sess-1')
    // Teardown happens in the background once the stream drains.
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1))
  })

  it('buffers (does not return live) a non-streaming JSON response', async () => {
    // Contrast with the streaming case: a JSON body is re-wrapped into a detached copy,
    // so the returned object is NOT the original.
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    const jsonRes = new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
    })
    sentinelFetch.mockImplementation(async () => jsonRes)
    const fetchLike = createSsrfGuardedMcpFetch()
    const res = await fetchLike('https://as.example/token', { method: 'POST' })

    expect(res).not.toBe(jsonRes)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it('attaches an abort signal to every guarded request even without a caller signal', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    const fetchLike = createSsrfGuardedMcpFetch()
    await fetchLike('https://attacker.example/discover')

    const [, init] = sentinelFetch.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('surfaces an McpError when a request exceeds the deadline', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    // Hang until the guard's own deadline aborts the request.
    sentinelFetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal
          if (signal?.aborted) {
            reject(signal.reason)
            return
          }
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const fetchLike = createSsrfGuardedMcpFetch(5)

    await expect(fetchLike('https://slow.example/token', { method: 'POST' })).rejects.toThrow(
      /timed out after 5ms/
    )
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it('bounds a stalled response body read by the deadline, not just time-to-headers', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    // Headers arrive immediately, but the body never completes — the exact shape of the
    // "Connecting… forever" hang. The deadline must still fire.
    sentinelFetch.mockImplementation(
      async () => new Response(new ReadableStream<Uint8Array>({ start() {} }))
    )
    const fetchLike = createSsrfGuardedMcpFetch(5)

    await expect(fetchLike('https://slow-body.example/token', { method: 'POST' })).rejects.toThrow(
      /timed out after 5ms/
    )
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it('bounds a stalled SSRF/DNS validation by the deadline', async () => {
    // Validation never resolves (mimics a hanging dns.lookup, which takes no signal).
    mockValidateMcpServerSsrf.mockReturnValue(new Promise(() => {}))
    const fetchLike = createSsrfGuardedMcpFetch(5)

    await expect(fetchLike('https://slow-dns.example/token')).rejects.toThrow(/timed out after 5ms/)
    // Never got past validation, so no request was issued and no Agent was created.
    expect(mockCreateGuardedFetchWithDispatcher).not.toHaveBeenCalled()
    expect(sentinelFetch).not.toHaveBeenCalled()
    expect(mockDestroy).not.toHaveBeenCalled()
  })

  it('does not orphan the validation promise when the signal is already aborted', async () => {
    // Caller aborts before the guard runs, then validation rejects. Without adopting
    // the in-flight validation, its rejection would surface as an unhandled rejection.
    mockValidateMcpServerSsrf.mockRejectedValue(new Error('blocked late'))
    const controller = new AbortController()
    controller.abort(new Error('pre-aborted'))
    const fetchLike = createSsrfGuardedMcpFetch(60_000)

    await expect(
      fetchLike('https://slow.example/token', { signal: controller.signal })
    ).rejects.toThrow('pre-aborted')
    expect(mockCreateGuardedFetchWithDispatcher).not.toHaveBeenCalled()
    // Let the swallowed validation rejection settle so a leak would surface here.
    await sleep(0)
  })

  it('cancels a stalled validation when the caller aborts (not just the deadline)', async () => {
    // Validation hangs; the caller's abort — well before the 60s deadline — must settle it.
    mockValidateMcpServerSsrf.mockReturnValue(new Promise(() => {}))
    const controller = new AbortController()
    const fetchLike = createSsrfGuardedMcpFetch(60_000)
    const pending = fetchLike('https://slow-dns.example/token', { signal: controller.signal })
    controller.abort(new Error('caller cancelled'))

    await expect(pending).rejects.toThrow('caller cancelled')
    expect(mockCreateGuardedFetchWithDispatcher).not.toHaveBeenCalled()
  })

  it('propagates a caller-initiated abort unchanged (composed with the deadline)', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    sentinelFetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal
          if (signal?.aborted) {
            reject(signal.reason)
            return
          }
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const controller = new AbortController()
    // Long deadline so the caller's abort — not the timeout — is what settles the request.
    const fetchLike = createSsrfGuardedMcpFetch(60_000)
    const pending = fetchLike('https://slow.example/token', { signal: controller.signal })
    controller.abort(new Error('caller cancelled'))

    await expect(pending).rejects.toThrow('caller cancelled')
  })

  it('rejects URLs that resolve to blocked IPs without issuing the request', async () => {
    mockValidateMcpServerSsrf.mockRejectedValue(new Error('blocked'))
    const fetchLike = createSsrfGuardedMcpFetch()

    await expect(
      fetchLike('http://169.254.169.254/latest/meta-data/', { method: 'POST' })
    ).rejects.toThrow('blocked')
    expect(mockCreateGuardedFetchWithDispatcher).not.toHaveBeenCalled()
    expect(sentinelFetch).not.toHaveBeenCalled()
  })

  it('accepts URL objects and validates their href', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    const fetchLike = createSsrfGuardedMcpFetch()
    await fetchLike(new URL('https://attacker.example/discover'))

    expect(mockValidateMcpServerSsrf).toHaveBeenCalledWith('https://attacker.example/discover')
    expect(mockCreateGuardedFetchWithDispatcher).toHaveBeenCalledWith(withResponseCap)
  })

  it('falls back to global fetch when validation returns no IP', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue(null)
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('ok'))
    try {
      const fetchLike = createSsrfGuardedMcpFetch()
      await fetchLike('https://allowed.internal/mcp')

      expect(mockCreateGuardedFetchWithDispatcher).not.toHaveBeenCalled()
      expect(globalFetch).toHaveBeenCalledTimes(1)
      // No pinned Agent was created, so there is nothing to tear down.
      expect(mockDestroy).not.toHaveBeenCalled()
    } finally {
      globalFetch.mockRestore()
    }
  })
})

describe('self-hosted private-resolution carve-out', () => {
  it('routes a loopback-resolving host over global fetch (guarded lookup would filter it)', async () => {
    // Self-hosted DNS alias -> 127.0.0.1: policy allows it, so the guard must not
    // strand the connect. Falls back to global fetch, same as the allowlist path.
    mockValidateMcpServerSsrf.mockResolvedValue('127.0.0.1')
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('ok'))
    try {
      const fetchLike = createSsrfGuardedMcpFetch()
      await fetchLike('https://my-local-alias/mcp')
      expect(mockCreateGuardedFetchWithDispatcher).not.toHaveBeenCalled()
      expect(globalFetch).toHaveBeenCalledTimes(1)
    } finally {
      globalFetch.mockRestore()
    }
  })
})
