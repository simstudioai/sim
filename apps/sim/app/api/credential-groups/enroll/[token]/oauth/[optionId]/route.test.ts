/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetContext, mockStartOAuth, mockIpRateLimit, mockEnrollmentRateLimit } = vi.hoisted(
  () => ({
    mockGetContext: vi.fn(),
    mockStartOAuth: vi.fn(),
    mockIpRateLimit: vi.fn(),
    mockEnrollmentRateLimit: vi.fn(),
  })
)

vi.mock('@/lib/credential-groups/enrollments', () => ({
  getCredentialGroupOAuthContext: mockGetContext,
}))

vi.mock('@/lib/credential-groups/oauth', () => ({
  startCredentialGroupOAuth: mockStartOAuth,
}))

vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforcePublicCredentialGroupIpRateLimit: mockIpRateLimit,
  enforceCredentialGroupEnrollmentOAuthRateLimit: mockEnrollmentRateLimit,
}))

import { GET } from '@/app/api/credential-groups/enroll/[token]/oauth/[optionId]/route'

const context = {
  params: Promise.resolve({ token: 'invitation-token', optionId: 'option-1' }),
}

function request() {
  return new NextRequest(
    'http://localhost:3000/api/credential-groups/enroll/invitation-token/oauth/option-1'
  )
}

describe('credential group OAuth start route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIpRateLimit.mockResolvedValue(null)
    mockEnrollmentRateLimit.mockResolvedValue(null)
    mockGetContext.mockResolvedValue({ enrollmentId: 'enrollment-1' })
    mockStartOAuth.mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?state=state-1')
  })

  it('redirects a valid enrollment to Google', async () => {
    const response = await GET(request(), context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('https://accounts.google.com/')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mockStartOAuth).toHaveBeenCalledWith(
      { enrollmentId: 'enrollment-1' },
      'invitation-token'
    )
  })

  it('returns the same 404 for an unavailable enrollment or option', async () => {
    mockGetContext.mockResolvedValue(null)

    const response = await GET(request(), context)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    expect(mockStartOAuth).not.toHaveBeenCalled()
  })

  it('stops before token lookup when the public IP budget is exhausted', async () => {
    mockIpRateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(429)
    expect(mockGetContext).not.toHaveBeenCalled()
  })
})
