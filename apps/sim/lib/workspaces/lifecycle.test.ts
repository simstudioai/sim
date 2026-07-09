/**
 * @vitest-environment node
 */
import { auditMock, auditMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockTransaction,
  mockArchiveWorkflowsForWorkspace,
  mockListAccessibleWorkspaceRowsForUser,
  mockCreateWorkspaceRecord,
  mockGetActivelyBannedUserIds,
  mockWorkspaceCreatedEvent,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockTransaction: vi.fn(),
  mockArchiveWorkflowsForWorkspace: vi.fn(),
  mockListAccessibleWorkspaceRowsForUser: vi.fn(),
  mockCreateWorkspaceRecord: vi.fn(),
  mockGetActivelyBannedUserIds: vi.fn(),
  mockWorkspaceCreatedEvent: vi.fn(),
}))

const mockGetWorkspaceWithOwner = permissionsMockFns.mockGetWorkspaceWithOwner

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    transaction: mockTransaction,
  },
}))

vi.mock('@/lib/workflows/lifecycle', () => ({
  archiveWorkflowsForWorkspace: (...args: unknown[]) => mockArchiveWorkflowsForWorkspace(...args),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/workspaces/utils', () => ({
  listAccessibleWorkspaceRowsForUser: mockListAccessibleWorkspaceRowsForUser,
}))

vi.mock('@/lib/workspaces/create', () => ({
  createWorkspaceRecord: mockCreateWorkspaceRecord,
}))

vi.mock('@/lib/auth/ban', () => ({
  getActivelyBannedUserIds: mockGetActivelyBannedUserIds,
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { workspaceCreated: mockWorkspaceCreatedEvent },
}))

vi.mock('@sim/audit', () => auditMock)

import { archiveWorkspace } from './lifecycle'

function createUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  }
}

function createMembersChain(members: Array<{ userId: string }>) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(members),
    }),
  }
}

function accessibleWorkspaceRow(workspaceId: string) {
  return { workspace: { id: workspaceId }, permissionType: 'admin' as const }
}

function createTx(
  members: Array<{ userId: string }>,
  orgAdminMembers: Array<{ userId: string }> = []
) {
  const selectDistinct = vi.fn()
  // First call is always the explicit-permissions query; the second (only reached when the
  // workspace has an organizationId) is the org-admin query.
  selectDistinct.mockReturnValueOnce(createMembersChain(members))
  selectDistinct.mockReturnValueOnce(createMembersChain(orgAdminMembers))

  return {
    selectDistinct,
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockImplementation(() => createUpdateChain()),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
  }
}

describe('workspace lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })
    mockCreateWorkspaceRecord.mockResolvedValue({ id: 'fallback-workspace', name: 'My Workspace' })
    mockGetActivelyBannedUserIds.mockResolvedValue([])
  })

  it('archives workspace and dependent resources under serializable isolation', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(2)

    const tx = createTx([])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const result = await archiveWorkspace('workspace-1', {
      requestId: 'req-1',
      provisionFallbackForStrandedMembers: true,
    })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
    })
    expect(mockArchiveWorkflowsForWorkspace).toHaveBeenCalledWith('workspace-1', {
      requestId: 'req-1',
      provisionFallbackForStrandedMembers: true,
    })
    expect(tx.update).toHaveBeenCalledTimes(8)
    expect(tx.delete).toHaveBeenCalledTimes(1)
    expect(mockCreateWorkspaceRecord).not.toHaveBeenCalled()
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'serializable',
    })
  })

  it('auto-provisions a replacement workspace for a member who would be stranded, and still archives', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(0)
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
      accessibleWorkspaceRow('workspace-1'),
    ])

    const tx = createTx([{ userId: 'user-victim' }])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const result = await archiveWorkspace('workspace-1', {
      requestId: 'req-1',
      provisionFallbackForStrandedMembers: true,
      actorId: 'admin-1',
      actorName: 'Admin',
      actorEmail: 'admin@example.com',
    })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
      provisionedWorkspaceUserIds: ['user-victim'],
    })
    expect(mockListAccessibleWorkspaceRowsForUser).toHaveBeenCalledWith('user-victim', 'active', tx)
    expect(mockCreateWorkspaceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-victim',
        workspaceMode: 'personal',
        organizationId: null,
        billedAccountUserId: 'user-victim',
        executor: tx,
      })
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        resourceId: 'fallback-workspace',
        metadata: expect.objectContaining({
          deletedWorkspaceId: 'workspace-1',
          recipientUserId: 'user-victim',
        }),
      })
    )
    expect(mockWorkspaceCreatedEvent).toHaveBeenCalledWith({
      workspaceId: 'fallback-workspace',
      userId: 'user-victim',
      name: 'My Workspace',
    })
    expect(tx.update).toHaveBeenCalledTimes(8)
    expect(tx.delete).toHaveBeenCalledTimes(1)
  })

  it('does not record an audit entry for the fallback workspace when no actor is provided', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(0)
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
      accessibleWorkspaceRow('workspace-1'),
    ])

    const tx = createTx([{ userId: 'user-victim' }])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    await archiveWorkspace('workspace-1', {
      requestId: 'req-1',
      provisionFallbackForStrandedMembers: true,
    })

    expect(mockCreateWorkspaceRecord).toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('does not record an audit entry for a fallback workspace whose transaction subsequently fails', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
      accessibleWorkspaceRow('workspace-1'),
    ])

    const tx = createTx([{ userId: 'user-victim' }])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) => {
      await callback(tx)
      throw new Error('serialization_failure')
    })

    await expect(
      archiveWorkspace('workspace-1', {
        requestId: 'req-1',
        provisionFallbackForStrandedMembers: true,
        actorId: 'admin-1',
      })
    ).rejects.toThrow('serialization_failure')

    // recordAudit and the workspaceCreated telemetry event must only ever fire after the
    // transaction has committed — otherwise a failed transaction (e.g. a serialization abort)
    // would leave a phantom audit entry / event pointing at a fallback workspace that was
    // rolled back.
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mockWorkspaceCreatedEvent).not.toHaveBeenCalled()
  })

  it('only provisions a fallback for the one member who would actually be stranded', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(0)
    mockListAccessibleWorkspaceRowsForUser.mockImplementation(async (userId: string) =>
      userId === 'user-victim'
        ? [accessibleWorkspaceRow('workspace-1')]
        : [accessibleWorkspaceRow('workspace-1'), accessibleWorkspaceRow('workspace-2')]
    )

    const tx = createTx([{ userId: 'user-victim' }, { userId: 'user-safe' }])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const result = await archiveWorkspace('workspace-1', {
      requestId: 'req-1',
      provisionFallbackForStrandedMembers: true,
    })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
      provisionedWorkspaceUserIds: ['user-victim'],
    })
    expect(mockCreateWorkspaceRecord).toHaveBeenCalledTimes(1)
    expect(mockCreateWorkspaceRecord).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-victim' })
    )
  })

  it('does not strand an org admin who has no explicit permission row on another workspace', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(0)
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
      accessibleWorkspaceRow('workspace-1'),
      accessibleWorkspaceRow('workspace-2'),
    ])

    const tx = createTx([{ userId: 'user-org-admin' }])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const result = await archiveWorkspace('workspace-1', {
      requestId: 'req-1',
      provisionFallbackForStrandedMembers: true,
    })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
    })
    expect(mockCreateWorkspaceRecord).not.toHaveBeenCalled()
    expect(tx.update).toHaveBeenCalledTimes(8)
  })

  it('provisions a fallback for an org admin who is stranded but has no explicit permission row', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      organizationId: 'org-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(0)
    // The org admin has no row in `permissions` for this workspace at all — they only appear as
    // an org-admin candidate. Their only accessible workspace is this one, so they're stranded.
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
      accessibleWorkspaceRow('workspace-1'),
    ])

    const tx = createTx([], [{ userId: 'user-org-admin-no-row' }])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const result = await archiveWorkspace('workspace-1', {
      requestId: 'req-1',
      provisionFallbackForStrandedMembers: true,
    })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
      provisionedWorkspaceUserIds: ['user-org-admin-no-row'],
    })
    expect(tx.selectDistinct).toHaveBeenCalledTimes(2)
    expect(mockCreateWorkspaceRecord).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-org-admin-no-row' })
    )
  })

  it('does not provision a fallback for an actively banned stranded member', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(0)
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
      accessibleWorkspaceRow('workspace-1'),
    ])
    mockGetActivelyBannedUserIds.mockResolvedValue(['user-banned'])

    const tx = createTx([{ userId: 'user-banned' }])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const result = await archiveWorkspace('workspace-1', {
      requestId: 'req-1',
      provisionFallbackForStrandedMembers: true,
      actorId: 'admin-1',
    })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
    })
    expect(mockCreateWorkspaceRecord).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })

  it('proceeds without provisioning when every member has another active workspace', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(0)
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
      accessibleWorkspaceRow('workspace-1'),
      accessibleWorkspaceRow('workspace-2'),
    ])

    const tx = createTx([{ userId: 'user-safe-1' }, { userId: 'user-safe-2' }])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const result = await archiveWorkspace('workspace-1', {
      requestId: 'req-1',
      provisionFallbackForStrandedMembers: true,
    })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
    })
    expect(mockCreateWorkspaceRecord).not.toHaveBeenCalled()
    expect(tx.update).toHaveBeenCalledTimes(8)
  })

  it('never checks or provisions when provisionFallbackForStrandedMembers is not set (ban flow default)', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(0)

    const tx = createTx([{ userId: 'user-banned' }])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const result = await archiveWorkspace('workspace-1', { requestId: 'req-1' })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
    })
    expect(tx.selectDistinct).not.toHaveBeenCalled()
    expect(mockListAccessibleWorkspaceRowsForUser).not.toHaveBeenCalled()
    expect(mockCreateWorkspaceRecord).not.toHaveBeenCalled()
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), undefined)
    // The archival writes must still run even when fallback provisioning is skipped entirely —
    // this is the exact regression a prior version of this fix introduced (an early return that
    // skipped all archival writes whenever the flag was off).
    expect(tx.update).toHaveBeenCalledTimes(8)
    expect(tx.delete).toHaveBeenCalledTimes(1)
  })

  it('is idempotent for already archived workspaces', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: new Date(),
    })

    const result = await archiveWorkspace('workspace-1', { requestId: 'req-1' })

    expect(result).toEqual({
      archived: false,
      workspaceName: 'Workspace 1',
    })
    expect(mockArchiveWorkflowsForWorkspace).toHaveBeenCalledWith('workspace-1', {
      requestId: 'req-1',
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
