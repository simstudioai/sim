/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetInvitationJoinPreview, mockListPendingInvitationsForEmail } = vi.hoisted(() => ({
  mockGetInvitationJoinPreview: vi.fn(),
  mockListPendingInvitationsForEmail: vi.fn(),
}))

vi.mock('@/lib/invitations/core', () => ({
  getInvitationJoinPreview: mockGetInvitationJoinPreview,
  listPendingInvitationsForEmail: mockListPendingInvitationsForEmail,
}))

import { listPendingInvitationsForViewer } from '@/lib/invitations/pending'

const USER_ID = 'user-1'
const EMAIL = 'invitee@example.com'

function invitation(id: string) {
  return {
    id,
    kind: 'organization' as const,
    email: EMAIL,
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

describe('listPendingInvitationsForViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pairs each row with its own preview, in order', async () => {
    mockListPendingInvitationsForEmail.mockResolvedValue(['a', 'b', 'c'].map(invitation))
    mockGetInvitationJoinPreview.mockImplementation(async (_userId, inv) => ({ for: inv.id }))

    const rows = await listPendingInvitationsForViewer(USER_ID, EMAIL)

    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(rows.map((r) => r.joinPreview)).toEqual([{ for: 'a' }, { for: 'b' }, { for: 'c' }])
  })

  /**
   * The preview is disclosure-only, so one failing row must degrade to `null` rather than
   * hiding the invitation or failing the batch — which is what makes the bounded mapper
   * safe, since it fails all-or-nothing on a throwing mapper.
   */
  it('degrades a failing preview to null without dropping the invitation', async () => {
    mockListPendingInvitationsForEmail.mockResolvedValue(['a', 'b'].map(invitation))
    mockGetInvitationJoinPreview.mockImplementation(async (_userId, inv) => {
      if (inv.id === 'a') throw new Error('preview blew up')
      return { for: inv.id }
    })

    const rows = await listPendingInvitationsForViewer(USER_ID, EMAIL)

    expect(rows).toHaveLength(2)
    expect(rows[0].joinPreview).toBeNull()
    expect(rows[1].joinPreview).toEqual({ for: 'b' })
  })

  /**
   * This runs inside the sidebar prefetch on every workspace page render, and each preview
   * issues several queries — so the fan-out stays bounded rather than holding one pooled
   * connection per pending invitation.
   */
  it('bounds how many previews run at once', async () => {
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

    await listPendingInvitationsForViewer(USER_ID, EMAIL)

    expect(mockGetInvitationJoinPreview).toHaveBeenCalledTimes(12)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('serializes dates to the wire shape', async () => {
    mockListPendingInvitationsForEmail.mockResolvedValue([invitation('a')])
    mockGetInvitationJoinPreview.mockResolvedValue(null)

    const [row] = await listPendingInvitationsForViewer(USER_ID, EMAIL)

    expect(row.expiresAt).toBe('2026-02-01T00:00:00.000Z')
    expect(row.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})
