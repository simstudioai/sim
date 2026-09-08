/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  permissionsMock,
  permissionsMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockArchiveWorkflowsForWorkspace } = vi.hoisted(() => ({
  mockArchiveWorkflowsForWorkspace: vi.fn(),
}))

const mockGetWorkspaceWithOwner = permissionsMockFns.mockGetWorkspaceWithOwner

vi.mock('@/lib/workflows/lifecycle', () => ({
  archiveWorkflowsForWorkspace: (...args: unknown[]) => mockArchiveWorkflowsForWorkspace(...args),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { archiveWorkspace } from '@/lib/workspaces/lifecycle'

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
    resetDbChainMock()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('archives workspace and dependent resources', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(2)
    queueTableRows(schemaMock.workflowMcpServer, [{ id: 'server-1' }])

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
    dbChainMockFns.transaction.mockImplementation(
      async (callback: (trx: typeof tx) => Promise<void>) => callback(tx)
    )

    const result = await archiveWorkspace('workspace-1', { requestId: 'req-1' })

    expect(result).toEqual({
      archived: true,
      workspaceName: 'Workspace 1',
    })
    expect(mockArchiveWorkflowsForWorkspace).toHaveBeenCalledWith('workspace-1', {
      requestId: 'req-1',
    })
    expect(tx.update).toHaveBeenCalledTimes(9)
    expect(tx.delete).toHaveBeenCalledTimes(1)
  })

  it('retries child cleanup for already archived workspaces', async () => {
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
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })
})
