import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  complete: vi.fn(),
  ipRateLimit: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/enrollment-auth', () => ({
  authenticateCredentialGroupEnrollment: mocks.authenticate,
}))

vi.mock('@/lib/credential-groups/application/public-enrollment', () => ({
  completePublicCredentialGroupEnrollment: { execute: mocks.complete },
}))

vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforcePublicCredentialGroupIpRateLimit: mocks.ipRateLimit,
}))

import { POST } from '@/app/api/credential-groups/enroll/[token]/complete/route'

const principal = {
  kind: 'credential_group_enrollment',
  workspaceId: 'workspace-1',
  credentialGroupId: 'group-1',
  enrollmentId: 'enrollment-1',
  email: 'alex@example.com',
  invitationTokenHash: 'hash-1',
} as const
const context = { params: Promise.resolve({ token: 'invitation-token' }) }

function request() {
  return new NextRequest(
    'http://localhost:3000/api/credential-groups/enroll/invitation-token/complete',
    { method: 'POST' }
  )
}

describe('credential group enrollment completion route', () => {
  beforeEach(() => {
    mocks.ipRateLimit.mockResolvedValue(null)
    mocks.authenticate.mockResolvedValue(principal)
    mocks.complete.mockResolvedValue({ completed: true })
  })

  it('returns to an unavailable enrollment when completion loses authorization', async () => {
    mocks.complete.mockResolvedValue({ completed: null })

    const response = await POST(request(), context)

    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?oauth=unavailable'
    )
  })

  it('stops before token lookup when the public IP budget is exhausted', async () => {
    mocks.ipRateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    )

    const response = await POST(request(), context)

    expect(response.status).toBe(429)
    expect(mocks.authenticate).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
  })
})
