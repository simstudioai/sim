/**
 * @vitest-environment node
 */
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreatePinnedFetch, mockValidateMcpServerSsrf, sentinelFetch } = vi.hoisted(() => ({
  mockCreatePinnedFetch: vi.fn(),
  mockValidateMcpServerSsrf: vi.fn(),
  sentinelFetch: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  createPinnedFetch: mockCreatePinnedFetch,
}))
vi.mock('@/lib/mcp/domain-check', () => ({
  validateMcpServerSsrf: mockValidateMcpServerSsrf,
}))

import { createSsrfGuardedMcpFetch } from '@/lib/mcp/pinned-fetch'

describe('createSsrfGuardedMcpFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreatePinnedFetch.mockReturnValue(sentinelFetch)
    sentinelFetch.mockResolvedValue(new Response('ok'))
  })

  it('validates each request URL and pins to the resolved IP', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    const fetchLike = createSsrfGuardedMcpFetch()
    await fetchLike('https://attacker.example/revoke', { method: 'POST' })

    expect(mockValidateMcpServerSsrf).toHaveBeenCalledWith('https://attacker.example/revoke')
    expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10')
    expect(sentinelFetch).toHaveBeenCalledWith(
      'https://attacker.example/revoke',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) })
    )
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
  })

  it('bounds a stalled SSRF/DNS validation by the deadline', async () => {
    // Validation never resolves (mimics a hanging dns.lookup, which takes no signal).
    mockValidateMcpServerSsrf.mockReturnValue(new Promise(() => {}))
    const fetchLike = createSsrfGuardedMcpFetch(5)

    await expect(fetchLike('https://slow-dns.example/token')).rejects.toThrow(/timed out after 5ms/)
    // Never got past validation, so no request was issued.
    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
    expect(sentinelFetch).not.toHaveBeenCalled()
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
    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
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
    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
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
    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
    expect(sentinelFetch).not.toHaveBeenCalled()
  })

  it('accepts URL objects and validates their href', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue('203.0.113.10')
    const fetchLike = createSsrfGuardedMcpFetch()
    await fetchLike(new URL('https://attacker.example/discover'))

    expect(mockValidateMcpServerSsrf).toHaveBeenCalledWith('https://attacker.example/discover')
    expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10')
  })

  it('falls back to global fetch when validation returns no IP', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue(null)
    const fetchLike = createSsrfGuardedMcpFetch()
    await fetchLike('https://allowed.internal/mcp')

    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
  })
})
