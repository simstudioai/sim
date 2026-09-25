import { member } from '@sim/db/schema'
import {
  authMockFns,
  createMockRequest,
  createSession,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockExpireStaleInvitations,
  mockGetOrgPermissionConfig,
  mockGetUserPermissionConfig,
  mockResolveVerifiedContext,
} = vi.hoisted(() => ({
  mockExpireStaleInvitations: vi.fn(),
  mockGetOrgPermissionConfig: vi.fn(),
  mockGetUserPermissionConfig: vi.fn(),
  mockResolveVerifiedContext: vi.fn(),
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
  getUserPermissionConfigForOrganization: mockGetOrgPermissionConfig,
  resolveVerifiedUserAccessControlContext: mockResolveVerifiedContext,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  isOrgAdminRole: (role: string | null | undefined) => role === 'owner' || role === 'admin',
}))

vi.mock('@/lib/invitations/core', () => ({
  expireStalePendingInvitationsForOrganization: mockExpireStaleInvitations,
}))

import { readOrganizationRoster } from '@/lib/organizations/application/member-roster'
import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
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
    userSuspendedAt: null,
  },
  {
    memberId: 'member-reader',
    userId: 'user-reader',
    role: 'member',
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    userName: 'Reader User',
    userEmail: 'reader@example.com',
    userImage: 'https://example.com/reader.png',
    userSuspendedAt: null,
  },
]

afterAll(resetDbChainMock)

describe('GET /api/organizations/[id]/roster', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockExpireStaleInvitations.mockResolvedValue(undefined)
    mockGetOrgPermissionConfig.mockResolvedValue(null)
  })

  it('refuses a member whose permission group hides the member directory', async () => {
    mockGetSession.mockResolvedValue({
      ...createSession({ userId: 'user-reader' }),
      session: { id: 'session' },
    })
    mockGetOrgPermissionConfig.mockResolvedValue({ hideOrgMemberDirectory: true })
    queueTableRows(member, [{ role: 'member' }])

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://localhost/api/organizations/org-1/roster'),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: capabilityRefusal('organization.member_directory'),
    })
  })

  it('returns a redacted roster to a target-organization member', async () => {
    mockGetSession.mockResolvedValue({
      ...createSession({ userId: 'user-reader' }),
      session: { id: 'session' },
    })
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
            suspendedAt: null,
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
            suspendedAt: null,
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
    mockGetSession.mockResolvedValue({
      ...createSession({ userId: 'external-user' }),
      session: { id: 'session' },
    })

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
})

describe('delegated organization roster application boundary', () => {
  const principal = {
    kind: 'organization_delegated',
    serviceId: 'copilot',
    subjectUserId: 'actor',
    organizationId: 'org-1',
    delegationId: 'roster',
    audience: 'sim:settings',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resourceScope: { chatId: 'chat' },
  } as const
  beforeEach(() => {
    resetDbChainMock()
    mockGetOrgPermissionConfig.mockResolvedValue(null)
  })
  it('rechecks current membership and withholds organization directory after revocation', async () => {
    queueTableRows(member, [])
    await expect(
      readOrganizationRoster.execute({ principal, input: { organizationId: 'org-1' } })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mockExpireStaleInvitations).not.toHaveBeenCalled()
  })
  it.each([{ organizationId: 'other' }, { audience: 'sim:knowledge' }, { expiresAt: new Date(0) }])(
    'rejects invalid organization delegation before roster work',
    async (change) => {
      await expect(
        readOrganizationRoster.execute({
          principal: { ...principal, ...change },
          input: { organizationId: 'org-1' },
        })
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(mockExpireStaleInvitations).not.toHaveBeenCalled()
    }
  )
})
