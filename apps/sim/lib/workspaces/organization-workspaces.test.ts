/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbResults,
  mockUpdateWhere,
  mockUpdateSet,
  mockDbUpdate,
  mockOnConflictDoUpdate,
  mockInsertValues,
  mockDbInsert,
  mockEnsureUserInOrganization,
  mockSyncUsageLimitsFromSubscription,
} = vi.hoisted(() => {
  const mockDbResults: { value: any[] } = { value: [] }
  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined)
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere })
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet })
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const mockInsertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate: mockOnConflictDoUpdate,
  })
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues })
  const mockEnsureUserInOrganization = vi.fn()
  const mockSyncUsageLimitsFromSubscription = vi.fn().mockResolvedValue(undefined)

  return {
    mockDbResults,
    mockUpdateWhere,
    mockUpdateSet,
    mockDbUpdate,
    mockOnConflictDoUpdate,
    mockInsertValues,
    mockDbInsert,
    mockEnsureUserInOrganization,
    mockSyncUsageLimitsFromSubscription,
  }
})

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => {
      const chain: any = {}
      chain.from = vi.fn().mockReturnValue(chain)
      chain.where = vi.fn().mockReturnValue(chain)
      chain.limit = vi
        .fn()
        .mockImplementation(() => Promise.resolve(mockDbResults.value.shift() || []))
      chain.then = vi.fn().mockImplementation((callback: (rows: any[]) => unknown) => {
        const result = mockDbResults.value.shift() || []
        return Promise.resolve(callback ? callback(result) : result)
      })
      return chain
    }),
    update: mockDbUpdate,
    insert: mockDbInsert,
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: {
    userId: 'user_id',
    organizationId: 'organization_id',
    role: 'role',
  },
  permissions: {
    userId: 'user_id',
    entityType: 'entity_type',
    entityId: 'entity_id',
    permissionType: 'permission_type',
  },
  workspace: {
    id: 'id',
    ownerId: 'owner_id',
    organizationId: 'organization_id',
    workspaceMode: 'workspace_mode',
  },
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  ensureUserInOrganization: mockEnsureUserInOrganization,
}))

vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: mockSyncUsageLimitsFromSubscription,
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/core/utils/uuid', () => ({
  generateId: vi.fn().mockReturnValue('generated-id'),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ type: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ type: 'inArray', field, values })),
}))

import {
  attachOwnedWorkspacesToOrganization,
  detachOrganizationWorkspaces,
  WorkspaceOrganizationMembershipConflictError,
} from '@/lib/workspaces/organization-workspaces'

describe('organization workspace helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    mockEnsureUserInOrganization.mockReset()
    mockSyncUsageLimitsFromSubscription.mockResolvedValue(undefined)
  })

  it('attaches owned workspaces to an organization and syncs existing members', async () => {
    mockDbResults.value = [
      [{ id: 'ws-1' }, { id: 'ws-2' }],
      [{ userId: 'owner-1' }],
      [{ userId: 'owner-1' }, { userId: 'member-1' }],
      [{ userId: 'owner-1', organizationId: 'org-1' }],
    ]
    mockEnsureUserInOrganization
      .mockResolvedValueOnce({
        success: true,
        alreadyMember: true,
        billingActions: {
          proUsageSnapshotted: false,
          proCancelledAtPeriodEnd: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        alreadyMember: false,
        memberId: 'member-1',
        billingActions: {
          proUsageSnapshotted: false,
          proCancelledAtPeriodEnd: false,
        },
      })

    const result = await attachOwnedWorkspacesToOrganization({
      ownerUserId: 'user-1',
      organizationId: 'org-1',
    })

    expect(result.attachedWorkspaceIds).toEqual(['ws-1', 'ws-2'])
    expect(result.addedMemberIds).toEqual(['member-1'])
    expect(result.skippedMembers).toEqual([])
    expect(mockEnsureUserInOrganization).toHaveBeenCalledWith({
      userId: 'owner-1',
      organizationId: 'org-1',
      role: 'owner',
      skipSeatValidation: true,
    })
    expect(mockEnsureUserInOrganization).toHaveBeenCalledWith({
      userId: 'member-1',
      organizationId: 'org-1',
      role: 'member',
      skipSeatValidation: true,
    })
    expect(mockSyncUsageLimitsFromSubscription).toHaveBeenCalledWith('member-1')
  })

  it('fails before attaching workspaces when an existing member belongs to another organization', async () => {
    mockDbResults.value = [
      [{ id: 'ws-1' }],
      [{ userId: 'owner-1' }],
      [{ userId: 'owner-1' }, { userId: 'member-2' }],
      [{ userId: 'member-2', organizationId: 'org-2' }],
    ]

    await expect(
      attachOwnedWorkspacesToOrganization({
        ownerUserId: 'user-1',
        organizationId: 'org-1',
      })
    ).rejects.toBeInstanceOf(WorkspaceOrganizationMembershipConflictError)

    expect(mockEnsureUserInOrganization).not.toHaveBeenCalled()
    expect(mockDbUpdate).not.toHaveBeenCalled()
  })

  it('detaches organization workspaces into grandfathered shared mode', async () => {
    mockDbResults.value = [[{ userId: 'owner-1' }], [{ id: 'ws-1', ownerId: 'creator-1' }]]

    const result = await detachOrganizationWorkspaces('org-1')

    expect(result.detachedWorkspaceIds).toEqual(['ws-1'])
    expect(result.billedAccountUserId).toBe('owner-1')
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        workspaceMode: 'grandfathered_shared',
        billedAccountUserId: 'owner-1',
      })
    )
    expect(mockOnConflictDoUpdate).toHaveBeenCalled()
  })
})
