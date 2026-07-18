/**
 * @vitest-environment node
 */
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
    expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10', { allowH2: true })
    expect(sentinelFetch).toHaveBeenCalledWith('https://attacker.example/revoke', {
      method: 'POST',
    })
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
    expect(mockCreatePinnedFetch).toHaveBeenCalledWith('203.0.113.10', { allowH2: true })
  })

  it('falls back to global fetch when validation returns no IP', async () => {
    mockValidateMcpServerSsrf.mockResolvedValue(null)
    const fetchLike = createSsrfGuardedMcpFetch()
    await fetchLike('https://allowed.internal/mcp')

    expect(mockCreatePinnedFetch).not.toHaveBeenCalled()
  })
})
