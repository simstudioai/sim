/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { FolderLockedError, WorkflowLockedError, mocks } = vi.hoisted(() => {
  class WorkflowLockedError extends Error {}
  class FolderLockedError extends Error {}
  return {
    WorkflowLockedError,
    FolderLockedError,
    mocks: {
      assertFolderMutable: vi.fn(),
      assertWorkflowMutable: vi.fn(),
      audit: vi.fn(),
      notify: vi.fn(),
      permission: vi.fn(),
      resolveContext: vi.fn(),
      updateWorkflow: vi.fn(),
    },
  }
})

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_UPDATED: 'workflow.updated' },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.audit,
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  assertFolderMutable: mocks.assertFolderMutable,
  assertWorkflowMutable: mocks.assertWorkflowMutable,
  FolderLockedError,
  WorkflowLockedError,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => actual === required,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  updateWorkflowRecord: mocks.updateWorkflow,
}))

vi.mock('@/lib/realtime/notify', () => ({ notifyWorkflowUpdated: mocks.notify }))

import { moveWorkflowsBulk } from '@/lib/workflows/application/move-workflows-bulk'

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'tool-call-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2099-01-01T00:00:00Z'),
}

describe('moveWorkflowsBulk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.permission.mockResolvedValue('write')
    mocks.assertFolderMutable.mockResolvedValue(undefined)
    mocks.assertWorkflowMutable.mockResolvedValue(undefined)
  })

  it('returns bounded best-effort outcomes and audits only authoritative moves', async () => {
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'One', folderId: null },
      { id: 'workflow-2', name: 'Two', folderId: null },
    ])
    dbChainMockFns.for
      .mockResolvedValueOnce([{ id: 'workflow-1', name: 'One', folderId: null }])
      .mockResolvedValueOnce([{ id: 'workflow-2', name: 'Two', folderId: null }])
    mocks.updateWorkflow
      .mockResolvedValueOnce({
        success: true,
        workflow: { id: 'workflow-1', name: 'One', folderId: 'folder-1' },
      })
      .mockResolvedValueOnce({ success: false, error: 'Workflow is locked', errorCode: 'locked' })

    const result = await moveWorkflowsBulk.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        workflowIds: ['workflow-1', 'workflow-2', 'workflow-1'],
        folderId: 'folder-1',
      },
    })

    expect(result).toMatchObject({
      moved: ['workflow-1'],
      failed: ['workflow-2'],
      folderId: 'folder-1',
    })
    expect(mocks.audit).toHaveBeenCalledOnce()
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.updated',
        resourceId: 'workflow-1',
        metadata: expect.objectContaining({ operation: 'workflows.bulk.move' }),
      })
    )
    expect(mocks.notify).toHaveBeenCalledWith('workflow-1')
    expect(mocks.notify).not.toHaveBeenCalledWith('workflow-2')
  })

  it('conceals cross-workspace workflow IDs as failed items', async () => {
    queueTableRows(schemaMock.workflow, [])

    await expect(
      moveWorkflowsBulk.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          workflowIds: ['workflow-from-workspace-2'],
          folderId: null,
        },
      })
    ).resolves.toMatchObject({
      moved: [],
      failed: ['workflow-from-workspace-2'],
    })

    expect(mocks.updateWorkflow).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects a non-Copilot principal before canonical workspace loading', async () => {
    await expect(
      moveWorkflowsBulk.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workspaceId: 'workspace-1', workflowIds: ['workflow-1'], folderId: null },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.resolveContext).not.toHaveBeenCalled()
  })
})
