/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSelect,
  mockTransaction,
  mockArchiveWorkflowsForWorkspace,
  mockListAccessibleWorkspaceRowsForUser,
  mockCreateWorkspaceRecord,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockTransaction: vi.fn(),
  mockArchiveWorkflowsForWorkspace: vi.fn(),
  mockListAccessibleWorkspaceRowsForUser: vi.fn(),
  mockCreateWorkspaceRecord: vi.fn(),
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

function createTx(members: Array<{ userId: string }>) {
  return {
    selectDistinct: vi.fn().mockReturnValue(createMembersChain(members)),
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
    mockCreateWorkspaceRecord.mockResolvedValue({ id: 'fallback-workspace' })
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

    const result = await archiveWorkspace('workspace-1', { requestId: 'req-1' })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
    })
    expect(mockArchiveWorkflowsForWorkspace).toHaveBeenCalledWith('workspace-1', {
      requestId: 'req-1',
    })
    expect(tx.update).toHaveBeenCalledTimes(8)
    expect(tx.delete).toHaveBeenCalledTimes(1)
    expect(mockListAccessibleWorkspaceRowsForUser).not.toHaveBeenCalled()
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

    const result = await archiveWorkspace('workspace-1', { requestId: 'req-1' })

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
    // Deletion is never blocked — the workspace is still archived alongside the fallback creation.
    expect(tx.update).toHaveBeenCalledTimes(8)
    expect(tx.delete).toHaveBeenCalledTimes(1)
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

    const result = await archiveWorkspace('workspace-1', { requestId: 'req-1' })

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
    // The org admin's only *explicit* permission row is on workspace-1, but they still have
    // access to workspace-2 purely through their organization admin role.
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
      accessibleWorkspaceRow('workspace-1'),
      accessibleWorkspaceRow('workspace-2'),
    ])

    const tx = createTx([{ userId: 'user-org-admin' }])
    mockTransaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) =>
      callback(tx)
    )

    const result = await archiveWorkspace('workspace-1', { requestId: 'req-1' })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
    })
    expect(mockCreateWorkspaceRecord).not.toHaveBeenCalled()
    expect(tx.update).toHaveBeenCalledTimes(8)
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

    const result = await archiveWorkspace('workspace-1', { requestId: 'req-1' })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
    })
    expect(mockCreateWorkspaceRecord).not.toHaveBeenCalled()
    // No knowledge bases found, so the two KB-dependent updates (document, knowledgeConnector) are skipped.
    expect(tx.update).toHaveBeenCalledTimes(8)
  })

  it('skips the stranded-member check and provisioning entirely when force is set (ban flow)', async () => {
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

    const result = await archiveWorkspace('workspace-1', { requestId: 'req-1', force: true })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
    })
    expect(tx.selectDistinct).not.toHaveBeenCalled()
    expect(mockListAccessibleWorkspaceRowsForUser).not.toHaveBeenCalled()
    expect(mockCreateWorkspaceRecord).not.toHaveBeenCalled()
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), undefined)
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
