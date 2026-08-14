/**
 * @vitest-environment node
 */

import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeCredentialGroupSettings,
  mockEnforceInvitationRateLimit,
  mockGetSession,
  mockInviteEnrollments,
} = vi.hoisted(() => ({
  mockAuthorizeCredentialGroupSettings: vi.fn(),
  mockEnforceInvitationRateLimit: vi.fn(),
  mockGetSession: vi.fn(),
  mockInviteEnrollments: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))

vi.mock('@/lib/credential-groups/access', () => {
  class CredentialGroupAccessError extends Error {
    constructor(
      message: string,
      readonly status: 403 | 404
    ) {
      super(message)
    }
  }
  return {
    authorizeCredentialGroupSettings: mockAuthorizeCredentialGroupSettings,
    CredentialGroupAccessError,
  }
})

vi.mock('@/lib/credential-groups/enrollments', () => {
  class CredentialGroupEnrollmentError extends Error {
    constructor(
      message: string,
      readonly status: 404 | 409 | 502
    ) {
      super(message)
    }
  }
  return {
    inviteCredentialGroupEnrollments: mockInviteEnrollments,
    CredentialGroupEnrollmentError,
  }
})

vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforceCredentialGroupInvitationRateLimit: mockEnforceInvitationRateLimit,
}))

import { POST } from '@/app/api/workspaces/[id]/credential-groups/[groupId]/enrollments/route'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = 'group-1'
const context = { params: Promise.resolve({ id: WORKSPACE_ID, groupId: GROUP_ID }) }

function createRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${WORKSPACE_ID}/credential-groups/${GROUP_ID}/enrollments`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }
  )
}

describe('credential group enrollment invitation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'Taylor', email: 'taylor@example.com' },
    })
    mockAuthorizeCredentialGroupSettings.mockResolvedValue({})
    mockEnforceInvitationRateLimit.mockResolvedValue(null)
    mockInviteEnrollments.mockResolvedValue({
      results: [
        {
          email: 'alex@example.com',
          success: false,
          error: 'Delivery failed',
        },
      ],
      sentCount: 0,
      failedCount: 1,
    })
  })

  it('authenticates before parsing the batch', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await POST(createRequest({}), context)

    expect(response.status).toBe(401)
    expect(mockAuthorizeCredentialGroupSettings).not.toHaveBeenCalled()
    expect(mockInviteEnrollments).not.toHaveBeenCalled()
  })

  it('sends the entire validated batch through the enrollment service', async () => {
    const body = { emails: ['alex@example.com', 'sam@example.com'] }

    const response = await POST(createRequest(body), context)

    expect(response.status).toBe(200)
    expect(mockInviteEnrollments).toHaveBeenCalledWith(
      WORKSPACE_ID,
      GROUP_ID,
      'user-1',
      'Taylor',
      body
    )
    expect(await response.json()).toMatchObject({ sentCount: 0, failedCount: 1 })
  })

  it('rejects a batch larger than 100 before invoking delivery', async () => {
    const response = await POST(
      createRequest({
        emails: Array.from({ length: 101 }, (_, index) => `user-${index}@example.com`),
      }),
      context
    )

    expect(response.status).toBe(400)
    expect(mockInviteEnrollments).not.toHaveBeenCalled()
  })

  it('applies the shared workspace invitation rate limit', async () => {
    mockEnforceInvitationRateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    )

    const response = await POST(createRequest({ emails: ['alex@example.com'] }), context)

    expect(response.status).toBe(429)
    expect(mockEnforceInvitationRateLimit).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(mockInviteEnrollments).not.toHaveBeenCalled()
  })
})
