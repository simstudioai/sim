/**
 * @vitest-environment node
 */
import {
  invitation,
  invitationWorkspaceGrant,
  member,
  permissions,
  workspace,
} from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  createSession,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExpireStaleInvitations } = vi.hoisted(() => ({
  mockExpireStaleInvitations: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string | null | undefined) => role === 'owner' || role === 'admin',
}))

vi.mock('@/lib/invitations/core', () => ({
  expireStalePendingInvitationsForOrganization: mockExpireStaleInvitations,
}))

import { GET } from '@/app/api/organizations/[id]/roster/route'

const mockGetSession = authMockFns.mockGetSession

const MEMBER_ROWS = [
  {
    memberId: 'member-admin',
    userId: 'user-admin',
    role: 'admin',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    userName: 'Admin User',
    userEmail: 'admin@example.com',
    userImage: null,
  },
  {
    memberId: 'member-reader',
    userId: 'user-reader',
    role: 'member',
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    userName: 'Reader User',
    userEmail: 'reader@example.com',
    userImage: 'https://example.com/reader.png',
  },
]

afterAll(resetDbChainMock)

describe('GET /api/organizations/[id]/roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockExpireStaleInvitations.mockResolvedValue(undefined)
  })

  it('returns a redacted roster to a target-organization member', async () => {
    mockGetSession.mockResolvedValue(createSession({ userId: 'user-reader' }))
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(member, MEMBER_ROWS)

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost/api/organizations/org-1/roster'),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        members: [
          {
            memberId: 'member-admin',
            userId: 'user-admin',
            role: 'admin',
            createdAt: '2026-01-01T00:00:00.000Z',
            name: 'Admin User',
            email: 'admin@example.com',
            image: null,
            workspaces: [],
          },
          {
            memberId: 'member-reader',
            userId: 'user-reader',
            role: 'member',
            createdAt: '2026-02-01T00:00:00.000Z',
            name: 'Reader User',
            email: 'reader@example.com',
            image: 'https://example.com/reader.png',
            workspaces: [],
          },
        ],
        pendingInvitations: [],
        workspaces: [],
      },
    })
    expect(mockExpireStaleInvitations).not.toHaveBeenCalled()
  })

  it('denies a workspace collaborator who is not a target-organization member', async () => {
    mockGetSession.mockResolvedValue(createSession({ userId: 'external-user' }))

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost/api/organizations/org-1/roster'),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden - Not a member of this organization',
    })
    expect(mockExpireStaleInvitations).not.toHaveBeenCalled()
  })

  it('preserves the full management roster for organization admins', async () => {
    mockGetSession.mockResolvedValue(createSession({ userId: 'user-admin' }))
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(member, MEMBER_ROWS)
    queueTableRows(workspace, [{ id: 'workspace-1', name: 'Workspace One' }])
    queueTableRows(permissions, [
      { userId: 'user-reader', workspaceId: 'workspace-1', permission: 'write' },
    ])
    queueTableRows(permissions, [
      {
        userId: 'external-user',
        userName: 'External User',
        userEmail: 'external@example.com',
        userImage: null,
        workspaceId: 'workspace-1',
        permission: 'read',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    ])
    queueTableRows(invitation, [
      {
        id: 'invitation-1',
        email: 'pending@example.com',
        role: 'member',
        kind: 'workspace',
        membershipIntent: 'external',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        expiresAt: new Date('2026-04-08T00:00:00.000Z'),
        inviteeName: null,
        inviteeImage: null,
      },
    ])
    queueTableRows(invitationWorkspaceGrant, [
      { invitationId: 'invitation-1', workspaceId: 'workspace-1', permission: 'read' },
    ])

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost/api/organizations/org-1/roster'),
      { params: Promise.resolve({ id: 'org-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.workspaces).toEqual([{ id: 'workspace-1', name: 'Workspace One' }])
    expect(body.data.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-admin',
          workspaces: [
            {
              workspaceId: 'workspace-1',
              workspaceName: 'Workspace One',
              permission: 'admin',
            },
          ],
        }),
        expect.objectContaining({
          userId: 'external-user',
          role: 'external',
          email: 'external@example.com',
        }),
      ])
    )
    expect(body.data.pendingInvitations).toEqual([
      expect.objectContaining({
        id: 'invitation-1',
        email: 'pending@example.com',
        workspaces: [
          {
            workspaceId: 'workspace-1',
            workspaceName: 'Workspace One',
            permission: 'read',
          },
        ],
      }),
    ])
    expect(mockExpireStaleInvitations).toHaveBeenCalledWith('org-1')
  })
})
