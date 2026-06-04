/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect, mockTransaction, mockArchiveWorkflowsForWorkspace } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockTransaction: vi.fn(),
  mockArchiveWorkflowsForWorkspace: vi.fn(),
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

import { archiveWorkspace } from './lifecycle'

function createUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  }
}

describe('workspace lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('archives workspace and dependent resources', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(2)
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'server-1' }]),
      }),
    })

    const tx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: 'kb-1' }]),
        }),
      }),
      update: vi.fn().mockImplementation(() => createUpdateChain()),
      delete: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    }
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
    expect(tx.update).toHaveBeenCalledTimes(11)
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
