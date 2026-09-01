/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetInvitationJoinPreview, mockGetSession, mockListPendingInvitationsForEmail } =
  vi.hoisted(() => ({
    mockGetInvitationJoinPreview: vi.fn(),
    mockGetSession: vi.fn(),
    mockListPendingInvitationsForEmail: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/invitations/core', () => ({
  getInvitationJoinPreview: mockGetInvitationJoinPreview,
  listPendingInvitationsForEmail: mockListPendingInvitationsForEmail,
}))

import { GET } from '@/app/api/invitations/route'

function invitation(id: string) {
  return {
    id,
    kind: 'organization',
    email: 'invitee@example.com',
    organizationId: 'org-1',
    organizationName: 'Org',
    membershipIntent: 'member',
    role: 'member',
    status: 'pending',
    expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    inviterName: 'Ada',
    inviterEmail: 'ada@example.com',
    grants: [{ workspaceId: 'ws-1', workspaceName: 'WS', permission: 'read' }],
  }
}

describe('GET /api/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'invitee@example.com' },
    })
  })

  it('pairs each row with its own preview, in order', async () => {
    mockListPendingInvitationsForEmail.mockResolvedValue(['a', 'b', 'c'].map(invitation))
    mockGetInvitationJoinPreview.mockImplementation(async (_userId, inv) => ({ for: inv.id }))

    const { invitations } = await (await GET(createMockRequest('GET'))).json()

    expect(invitations.map((i: { id: string }) => i.id)).toEqual(['a', 'b', 'c'])
    expect(invitations.map((i: { joinPreview: unknown }) => i.joinPreview)).toEqual([
      { for: 'a' },
      { for: 'b' },
      { for: 'c' },
    ])
  })

  /**
   * The preview is disclosure-only, so one failing row degrades to `null` rather than hiding
   * the invitation — which is what makes the bounded mapper safe, since it fails
   * all-or-nothing on a throwing mapper.
   */
  it('degrades a failing preview to null without dropping the invitation', async () => {
    mockListPendingInvitationsForEmail.mockResolvedValue(['a', 'b'].map(invitation))
    mockGetInvitationJoinPreview.mockImplementation(async (_userId, inv) => {
      if (inv.id === 'a') throw new Error('preview blew up')
      return { for: inv.id }
    })

    const { invitations } = await (await GET(createMockRequest('GET'))).json()

    expect(invitations).toHaveLength(2)
    expect(invitations[0].joinPreview).toBeNull()
    expect(invitations[1].joinPreview).toEqual({ for: 'b' })
  })

  /**
   * Each preview issues several queries of its own, so the fan-out stays bounded rather than
   * holding one pooled connection per pending invitation.
   */
  it('runs previews concurrently, up to a bound', async () => {
    mockListPendingInvitationsForEmail.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => invitation(`inv-${i}`))
    )
    let inFlight = 0
    let peak = 0
    mockGetInvitationJoinPreview.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight--
      return null
    })

    await GET(createMockRequest('GET'))

    expect(mockGetInvitationJoinPreview).toHaveBeenCalledTimes(12)
    expect(peak).toBe(4)
  })
})
