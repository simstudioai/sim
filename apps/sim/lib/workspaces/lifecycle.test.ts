/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction, mockArchiveWorkflowsForWorkspace, mockGetWorkspaceWithOwner } = vi.hoisted(
  () => ({
    mockTransaction: vi.fn(),
    mockArchiveWorkflowsForWorkspace: vi.fn(),
    mockGetWorkspaceWithOwner: vi.fn(),
  })
)

vi.mock('@sim/db', () => ({
  db: {
    transaction: mockTransaction,
  },
}))

vi.mock('@sim/db/schema', () => ({
  apiKey: { type: 'api_key_type' },
  knowledgeBase: { deletedAt: 'kb_deleted_at' },
  userTableDefinitions: { archivedAt: 'table_archived_at' },
  workflowSchedule: { archivedAt: 'schedule_archived_at' },
  workspace: { archivedAt: 'workspace_archived_at' },
  workflowMcpServer: { isPublic: 'workflow_mcp_server_is_public' },
  workspaceFiles: { deletedAt: 'workspace_file_deleted_at' },
  workspaceInvitation: { status: 'workspace_invitation_status' },
  workspaceNotificationSubscription: { active: 'workspace_notification_active' },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@/lib/workflows/lifecycle', () => ({
  archiveWorkflowsForWorkspace: (...args: unknown[]) => mockArchiveWorkflowsForWorkspace(...args),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: (...args: unknown[]) => mockGetWorkspaceWithOwner(...args),
}))

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
  })

  it('archives workspace and dependent resources', async () => {
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      name: 'Workspace 1',
      ownerId: 'user-1',
      archivedAt: null,
    })
    mockArchiveWorkflowsForWorkspace.mockResolvedValue(2)

    const tx = {
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
    expect(mockArchiveWorkflowsForWorkspace).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
