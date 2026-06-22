/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreatePinnedFetch, mockCreateSsrfGuardedMcpFetch, mockPinnedFetch, mockGuardedFetch } =
  vi.hoisted(() => {
    const mockPinnedFetch = vi.fn()
    const mockGuardedFetch = vi.fn()
    return {
      mockPinnedFetch,
      mockGuardedFetch,
      mockCreatePinnedFetch: vi.fn(() => mockPinnedFetch),
      mockCreateSsrfGuardedMcpFetch: vi.fn(() => mockGuardedFetch),
    }
  })

vi.mock('@/lib/core/security/input-validation.server', () => ({
  createPinnedFetch: mockCreatePinnedFetch,
}))
vi.mock('@/lib/mcp/pinned-fetch', () => ({
  createSsrfGuardedMcpFetch: mockCreateSsrfGuardedMcpFetch,
}))

import { detectMcpAuthType } from '@/lib/mcp/oauth/probe'

function makeResponse(init: { status?: number; headers?: Record<string, string> }): Response {
  const status = init.status ?? 200
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(init.headers ?? {}),
  } as unknown as Response
}

describe('detectMcpAuthType — connection pinning (SSRF / DNS-rebinding)', () => {
  let globalFetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    globalFetchSpy = vi.fn()
    vi.stubGlobal('fetch', globalFetchSpy)
  })

  it('pins the probe to the pre-validated IP when resolvedIP is supplied', async () => {
    mockPinnedFetch.mockResolvedValue(makeResponse({ status: 200 }))

    const authType = await detectMcpAuthType('https://rebind.example.com/mcp', '203.0.113.10')

    expect(authType).toBe('none')
    expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10')
    expect(mockCreateSsrfGuardedMcpFetch).not.toHaveBeenCalled()
    expect(mockPinnedFetch).toHaveBeenCalledTimes(1)
    // The unpinned global fetch must never be used — that was the SSRF sink.
    expect(globalFetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to the SSRF-guarded fetch when no resolvedIP is supplied', async () => {
    mockGuardedFetch.mockResolvedValue(makeResponse({ status: 200 }))

    const authType = await detectMcpAuthType('https://example.com/mcp')

    expect(authType).toBe('none')
    expect(mockCreateSsrfGuardedMcpFetch).toHaveBeenCalledTimes(1)
    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
    expect(mockGuardedFetch).toHaveBeenCalledTimes(1)
    expect(globalFetchSpy).not.toHaveBeenCalled()
  })

  it('classifies an RFC 9728 OAuth challenge as oauth via the pinned fetch', async () => {
    mockPinnedFetch.mockResolvedValue(
      makeResponse({
        status: 401,
        headers: {
          'www-authenticate':
            'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
        },
      })
    )

    const authType = await detectMcpAuthType('https://example.com/mcp', '203.0.113.10')

    expect(authType).toBe('oauth')
    expect(globalFetchSpy).not.toHaveBeenCalled()
  })

  it('does not probe (no network call) for non-https, non-loopback URLs', async () => {
    const authType = await detectMcpAuthType('http://example.com/mcp', '203.0.113.10')

    expect(authType).toBe('headers')
    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
    expect(mockCreateSsrfGuardedMcpFetch).not.toHaveBeenCalled()
    expect(globalFetchSpy).not.toHaveBeenCalled()
  })

  it('reuses the pinned fetch for best-effort session cleanup (DELETE)', async () => {
    mockPinnedFetch
      .mockResolvedValueOnce(makeResponse({ status: 200, headers: { 'mcp-session-id': 'sess-1' } }))
      .mockResolvedValueOnce(makeResponse({ status: 200 }))

    const authType = await detectMcpAuthType('https://example.com/mcp', '203.0.113.10')

    expect(authType).toBe('none')
    // POST probe + DELETE cleanup, both through the pinned fetch.
    await vi.waitFor(() => expect(mockPinnedFetch).toHaveBeenCalledTimes(2))
    const deleteCall = mockPinnedFetch.mock.calls[1]
    expect(deleteCall[1]).toMatchObject({ method: 'DELETE' })
    expect(globalFetchSpy).not.toHaveBeenCalled()
  })
})
