import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import { workflowAuthzMockFns } from '@sim/testing/mocks/workflow-authz.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

import { moveWorkflowsBulk } from '@/lib/workflows/application/move-workflows-bulk'

const mocks = {
  updateWorkflow: workflowsOrchestrationMockFns.mockUpdateWorkflowRecord,
}

const { mockAssertFolderMutable, mockAssertWorkflowMutable } = workflowAuthzMockFns

const mockAudit = auditMockFns.mockRecordAudit
const mockPermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveContext = workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext
const mockNotify = realtimeNotifyMockFns.mockNotifyWorkflowUpdated
const mockNotifyWorkspace = realtimeNotifyMockFns.mockNotifyWorkspaceWorkflowsChanged

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
    resetDbChainMock()
    mockResolveContext.mockResolvedValue(context)
    mockPermission.mockResolvedValue('write')
    mockAssertFolderMutable.mockResolvedValue(undefined)
    mockAssertWorkflowMutable.mockResolvedValue(undefined)
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
    expect(mockAudit).toHaveBeenCalledOnce()
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.updated',
        resourceId: 'workflow-1',
        metadata: expect.objectContaining({ operation: 'workflows.bulk.move' }),
      })
    )
    expect(mockNotify).toHaveBeenCalledWith('workflow-1')
    expect(mockNotify).not.toHaveBeenCalledWith('workflow-2')
    expect(mockNotifyWorkspace).toHaveBeenCalledWith('workspace-1')
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
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('rejects a delegated service the operation does not accept, before canonical loading', async () => {
    await expect(
      moveWorkflowsBulk.execute({
        principal: {
          kind: 'delegated',
          serviceId: 'executor',
          subjectUserId: 'user-1',
          workspaceId: 'workspace-1',
          delegationId: 'delegation-1',
          audience: 'sim:workflows',
          issuedAt: new Date('2026-01-01T00:00:00Z'),
          expiresAt: new Date('2026-01-01T01:00:00Z'),
        },
        input: { workspaceId: 'workspace-1', workflowIds: ['workflow-1'], folderId: null },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mockResolveContext).not.toHaveBeenCalled()
  })
})
