/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimitDirect, mockGetClientIp } = vi.hoisted(() => ({
  mockCheckRateLimitDirect: vi.fn(),
  mockGetClientIp: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))
vi.mock('@/lib/core/utils/request', () => ({ getClientIp: mockGetClientIp }))

import {
  APPS_PREVIEW_ACTION_LIMIT,
  APPS_PUBLIC_ACTION_LIMIT,
  APPS_PUBLIC_IP_LIMIT,
  enforceAppsActionRateLimit,
  enforceAppsIpRateLimit,
  enforceAppsPreviewActionRateLimit,
} from '@/lib/apps/rate-limit'

const request = new NextRequest('http://localhost/api/apps/gateway')

describe('apps rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetClientIp.mockReturnValue('203.0.113.5')
  })

  it('allows an IP bucket with fail-closed storage semantics', async () => {
    mockCheckRateLimitDirect.mockResolvedValue({
      allowed: true,
      resetAt: new Date('2026-01-01T00:01:00Z'),
    })

    await expect(enforceAppsIpRateLimit('gateway', request)).resolves.toBeNull()
    expect(mockCheckRateLimitDirect).toHaveBeenCalledWith(
      'apps:gateway:ip:203.0.113.5',
      APPS_PUBLIC_IP_LIMIT,
      { failClosed: true }
    )
  })

  it('returns 429 and reset headers when an IP bucket is denied', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    mockCheckRateLimitDirect.mockResolvedValue({
      allowed: false,
      resetAt: new Date('2026-01-01T00:00:10Z'),
    })

    const response = await enforceAppsIpRateLimit('gateway', request)

    expect(response?.status).toBe(429)
    expect(response?.headers.get('Retry-After')).toBe('10')
    expect(await response?.json()).toEqual({
      error: 'Rate limit exceeded',
      retryAfter: Date.parse('2026-01-01T00:00:10Z'),
    })
    vi.useRealTimers()
  })

  it('keys action limits by release, action, and client IP', async () => {
    mockCheckRateLimitDirect.mockResolvedValue({
      allowed: false,
      resetAt: new Date(Date.now() + 1_000),
    })

    const response = await enforceAppsActionRateLimit('release-1', 'submit', request)

    expect(response?.status).toBe(429)
    expect(mockCheckRateLimitDirect).toHaveBeenCalledWith(
      'apps:action:release-1:submit:ip:203.0.113.5',
      APPS_PUBLIC_ACTION_LIMIT,
      { failClosed: true }
    )
  })

  it('keys preview limits by authenticated user, project, and action', async () => {
    mockCheckRateLimitDirect.mockResolvedValue({
      allowed: false,
      resetAt: new Date(Date.now() + 1_000),
    })

    const response = await enforceAppsPreviewActionRateLimit('user-1', 'project-1', 'submit')

    expect(response?.status).toBe(429)
    expect(mockCheckRateLimitDirect).toHaveBeenCalledWith(
      'apps:preview:user-1:project-1:submit',
      APPS_PREVIEW_ACTION_LIMIT,
      { failClosed: true }
    )
  })
})
