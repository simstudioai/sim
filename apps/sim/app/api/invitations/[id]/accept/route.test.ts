/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAcceptInvitation } = vi.hoisted(() => ({
  mockAcceptInvitation: vi.fn(),
}))

vi.mock('@/lib/invitations/core', () => ({
  acceptInvitation: mockAcceptInvitation,
}))

import { POST } from '@/app/api/invitations/[id]/accept/route'

const mockGetSession = authMockFns.mockGetSession

function createInvitationRequest() {
  return createMockRequest(
    'POST',
    { token: 'tok-1' },
    {
      'user-agent': 'InvitationRouteTest/1.0',
      'x-forwarded-for': '203.0.113.10',
    },
    'http://localhost/api/invitations/inv-1/accept'
  )
}

describe('POST /api/invitations/[id]/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: {
        id: 'invitee-user',
        name: 'Invitee User',
        email: 'invitee@example.com',
      },
    })
  })

  it('returns 409 when an organization invitation conflicts with existing membership', async () => {
    mockAcceptInvitation.mockResolvedValue({
      success: false,
      kind: 'already-in-organization',
    })

    const response = await POST(createInvitationRequest(), {
      params: Promise.resolve({ id: 'inv-1' }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'already-in-organization' })
  })

  it('forwards actor identity and request provenance to post-commit acceptance effects', async () => {
    mockAcceptInvitation.mockResolvedValue({
      success: true,
      invitation: {
        id: 'inv-1',
        kind: 'workspace',
        organizationId: 'org-1',
      },
      acceptedWorkspaceIds: ['workspace-1'],
      redirectPath: '/workspace/workspace-1/home',
      membershipAlreadyExists: false,
    })
    const request = createInvitationRequest()

    const response = await POST(request, {
      params: Promise.resolve({ id: 'inv-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockAcceptInvitation).toHaveBeenCalledWith({
      userId: 'invitee-user',
      userEmail: 'invitee@example.com',
      actorName: 'Invitee User',
      invitationId: 'inv-1',
      token: 'tok-1',
      request,
    })
  })
})
