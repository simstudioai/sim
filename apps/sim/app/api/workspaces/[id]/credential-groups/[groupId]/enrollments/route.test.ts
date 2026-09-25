import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getSession: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/credential-groups/application/manage-enrollments', () => ({
  inviteCredentialGroupEnrollmentsSettings: {
    operation: { id: 'credential_groups.invites.send_batch' },
    execute: mocks.execute,
  },
}))

vi.mock('@/lib/credential-groups/rate-limit', () => {
  class CredentialGroupInvitationRateLimitError extends Error {
    readonly statusCode = 429

    constructor(
      readonly retryAfterSeconds: number,
      readonly resetAt: Date
    ) {
      super('Rate limit exceeded')
    }
  }
  return {
    CredentialGroupInvitationRateLimitError,
    enforceCredentialGroupInvitationRouteRateLimit: mocks.rateLimit,
  }
})

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
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.rateLimit.mockResolvedValue(undefined)
    mocks.execute.mockResolvedValue({
      results: [{ email: 'alex@example.com', success: false, error: 'Delivery failed' }],
      sentCount: 0,
      failedCount: 1,
    })
  })

  it('rejects a batch larger than 100 before admission or delivery', async () => {
    const response = await POST(
      createRequest({
        emails: Array.from({ length: 101 }, (_, index) => `user-${index}@example.com`),
      }),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
