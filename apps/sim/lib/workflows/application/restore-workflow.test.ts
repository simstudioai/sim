/**
 * @vitest-environment node
 */
import { FolderLockedError } from '@sim/platform-authz/workflow'
import { workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  notify: vi.fn(),
  restoreRecord: vi.fn(),
  folderIndex: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_RESTORED: 'workflow.restored' },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveArchivedWorkflowApplicationContext: mocks.resolveContext,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkflowUpdated: mocks.notify }))
vi.mock('@/lib/workflows/lifecycle', () => ({ restoreWorkflow: mocks.restoreRecord }))
vi.mock('@/lib/folders/queries', () => ({ loadActiveFolderPathIndex: mocks.folderIndex }))

import { restoreWorkflow } from '@/lib/workflows/application/restore-workflow'

const archivedWorkflow = {
  id: 'workflow-1',
  name: 'Daily digest',
  workspaceId: 'workspace-1',
  folderId: null,
  locked: false,
}

const context = {
  workflowId: 'workflow-1',
  workflow: archivedWorkflow,
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const input = { workflowId: 'workflow-1' }

describe('restoreWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    workflowAuthzMockFns.mockAssertFolderMutable.mockResolvedValue(undefined)
    mocks.folderIndex.mockResolvedValue({ pathById: new Map() })
    mocks.restoreRecord.mockResolvedValue({
      restored: true,
      workflow: { ...archivedWorkflow, archivedAt: null },
    })
  })

  it('restores through the lifecycle primitive and projects its own audit row', async () => {
    await expect(restoreWorkflow.execute({ principal, input })).resolves.toMatchObject({
      workspaceId: 'workspace-1',
      folderPath: '/',
    })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.restored',
        resourceId: 'workflow-1',
        resourceName: 'Daily digest',
        metadata: expect.objectContaining({ operation: 'workflows.restore' }),
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledBefore(mocks.notify)
  })

  it('refuses a workflow that is not archived as a conflict', async () => {
    mocks.restoreRecord.mockResolvedValue({ restored: false, workflow: archivedWorkflow })

    await expect(restoreWorkflow.execute({ principal, input })).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('is not found when the workflow row is gone', async () => {
    mocks.restoreRecord.mockResolvedValue({ restored: false, workflow: null })

    await expect(restoreWorkflow.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('refuses a locked workflow before restoring', async () => {
    mocks.resolveContext.mockResolvedValue({
      ...context,
      workflow: { ...archivedWorkflow, locked: true },
    })

    await expect(restoreWorkflow.execute({ principal, input })).rejects.toMatchObject({
      code: 'locked',
    })
    expect(mocks.restoreRecord).not.toHaveBeenCalled()
  })

  it('refuses a locked destination folder before restoring', async () => {
    workflowAuthzMockFns.mockAssertFolderMutable.mockRejectedValue(
      new FolderLockedError('Folder is locked')
    )

    await expect(restoreWorkflow.execute({ principal, input })).rejects.toMatchObject({
      code: 'locked',
    })
    expect(mocks.restoreRecord).not.toHaveBeenCalled()
  })

  it('refuses a role below the operation floor', async () => {
    mocks.resolvePermission.mockResolvedValue('read')

    await expect(restoreWorkflow.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.restoreRecord).not.toHaveBeenCalled()
  })
})
