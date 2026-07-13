/**
 * @vitest-environment node
 */
import { createMockRequest, createSession, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbState, mockExpireStaleInvitations, mockGetSession } = vi.hoisted(() => ({
  mockDbState: {
    selectResults: [] as unknown[][],
  },
  mockExpireStaleInvitations: vi.fn(),
  mockGetSession: vi.fn(),
}))

function createSelectChain() {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  }
  chain.from.mockReturnValue(chain)
  chain.innerJoin.mockReturnValue(chain)
  chain.leftJoin.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.limit.mockImplementation(() => Promise.resolve(mockDbState.selectResults.shift() ?? []))
  chain.then.mockImplementation((resolve: (rows: unknown[]) => unknown) =>
    Promise.resolve(resolve(mockDbState.selectResults.shift() ?? []))
  )
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => createSelectChain()),
  },
}))

vi.mock('@sim/db/schema', () => ({
  invitation: {
    id: 'invitation.id',
    email: 'invitation.email',
    role: 'invitation.role',
    kind: 'invitation.kind',
    membershipIntent: 'invitation.membershipIntent',
    organizationId: 'invitation.organizationId',
    status: 'invitation.status',
    createdAt: 'invitation.createdAt',
    expiresAt: 'invitation.expiresAt',
  },
  invitationWorkspaceGrant: {
    invitationId: 'invitationWorkspaceGrant.invitationId',
    workspaceId: 'invitationWorkspaceGrant.workspaceId',
    permission: 'invitationWorkspaceGrant.permission',
  },
  member: {
    id: 'member.id',
    organizationId: 'member.organizationId',
    userId: 'member.userId',
    role: 'member.role',
    createdAt: 'member.createdAt',
  },
  permissions: {
    userId: 'permissions.userId',
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    permissionType: 'permissions.permissionType',
    createdAt: 'permissions.createdAt',
  },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
    image: 'user.image',
  },
  workspace: {
    id: 'workspace.id',
    name: 'workspace.name',
    organizationId: 'workspace.organizationId',
    archivedAt: 'workspace.archivedAt',
  },
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string | null | undefined) => role === 'owner' || role === 'admin',
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
  isNull: vi.fn((field: unknown) => ({ type: 'isNull', field })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/invitations/core', () => ({
  expireStalePendingInvitationsForOrganization: mockExpireStaleInvitations,
}))

import { GET } from '@/app/api/organizations/[id]/roster/route'

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

describe('GET /api/organizations/[id]/roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.selectResults = []
    mockExpireStaleInvitations.mockResolvedValue(undefined)
  })

  it('returns a redacted roster to a target-organization member', async () => {
    mockGetSession.mockResolvedValue(createSession({ userId: 'user-reader' }))
    mockDbState.selectResults = [[{ role: 'member' }], MEMBER_ROWS]

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
    mockDbState.selectResults = [[]]

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
    mockDbState.selectResults = [
      [{ role: 'admin' }],
      MEMBER_ROWS,
      [{ id: 'workspace-1', name: 'Workspace One' }],
      [{ userId: 'user-reader', workspaceId: 'workspace-1', permission: 'write' }],
      [
        {
          userId: 'external-user',
          userName: 'External User',
          userEmail: 'external@example.com',
          userImage: null,
          workspaceId: 'workspace-1',
          permission: 'read',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
      [
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
      ],
      [{ invitationId: 'invitation-1', workspaceId: 'workspace-1', permission: 'read' }],
    ]

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
