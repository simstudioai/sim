/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  startOAuth: vi.fn(),
  ipRateLimit: vi.fn(),
  enrollmentRateLimit: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/enrollment-auth', () => ({
  authenticateCredentialGroupEnrollment: mocks.authenticate,
}))

vi.mock('@/lib/credential-groups/application/public-enrollment', () => ({
  startPublicCredentialGroupOAuth: { execute: mocks.startOAuth },
}))

vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforcePublicCredentialGroupIpRateLimit: mocks.ipRateLimit,
  enforceCredentialGroupEnrollmentOAuthRateLimit: mocks.enrollmentRateLimit,
}))

import { GET } from '@/app/api/credential-groups/enroll/[token]/oauth/[optionId]/route'

const principal = {
  kind: 'credential_group_enrollment',
  workspaceId: 'workspace-1',
  credentialGroupId: 'group-1',
  enrollmentId: 'enrollment-1',
  email: 'alex@example.com',
  invitationTokenHash: 'hash-1',
} as const
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
    mocks.ipRateLimit.mockResolvedValue(null)
    mocks.enrollmentRateLimit.mockResolvedValue(null)
    mocks.authenticate.mockResolvedValue(principal)
    mocks.startOAuth.mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=state-1',
    })
  })

  it('redirects a valid enrollment to Google through its application operation', async () => {
    const oauthRequest = request()
    const response = await GET(oauthRequest, context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('https://accounts.google.com/')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.startOAuth).toHaveBeenCalledWith({
      principal,
      input: { invitationToken: 'invitation-token', optionId: 'option-1' },
      request: oauthRequest,
    })
  })

  it('returns an unavailable enrollment to its public page', async () => {
    mocks.authenticate.mockResolvedValue(null)

    const response = await GET(request(), context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?oauth=unavailable'
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.startOAuth).not.toHaveBeenCalled()
  })

  it('returns a rate-limited OAuth start to its enrollment page before token lookup', async () => {
    mocks.ipRateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?oauth=rate_limited'
    )
    expect(mocks.authenticate).not.toHaveBeenCalled()
  })

  it('returns an exhausted enrollment OAuth budget to the enrollment page', async () => {
    mocks.enrollmentRateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?oauth=rate_limited'
    )
    expect(mocks.startOAuth).not.toHaveBeenCalled()
  })
})
