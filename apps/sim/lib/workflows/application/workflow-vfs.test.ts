import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import {
  foldersOrchestrationMock,
  foldersOrchestrationMockFns,
} from '@sim/testing/mocks/folders-orchestration.mock'
import { getAllMockLoggers } from '@sim/testing/mocks/logger.mock'
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

const hoisted = vi.hoisted(() => ({
  duplicateWorkflow: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@/lib/folders/queries', () => folderQueriesMock)

vi.mock('@/lib/folders/orchestration', () => foldersOrchestrationMock)

vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)

vi.mock('@/lib/workflows/persistence/duplicate', () => ({
  duplicateWorkflow: hoisted.duplicateWorkflow,
}))

vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

import { moveWorkflowVfsItems } from '@/lib/workflows/application/workflow-vfs'

const mocks = {
  ...hoisted,
  createFolder: foldersOrchestrationMockFns.mockCreateFolderAtPath,
  deleteFolder: foldersOrchestrationMockFns.mockDeleteFolderByPath,
  relocateFolder: foldersOrchestrationMockFns.mockRelocateFolderByPath,
  deleteWorkflow: workflowsOrchestrationMockFns.mockDeleteWorkflowRecord,
  updateWorkflow: workflowsOrchestrationMockFns.mockUpdateWorkflowRecord,
  loadFolderIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
}

const { mockAssertFolderMutable, mockAssertWorkflowMutable } = workflowAuthzMockFns

const mockAudit = auditMockFns.mockRecordAudit
const mockPermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockResolveContext = workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext
const mockNotifyFolder = realtimeNotifyMockFns.mockNotifyFolderResourceChanged
const mockNotifyWorkflow = realtimeNotifyMockFns.mockNotifyWorkflowUpdated

const workspaceContext = {
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
const emptyIndex = {
  rowById: new Map(),
  pathById: new Map(),
  idByPath: new Map(),
}

describe('workflow VFS application commands', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockResolveContext.mockResolvedValue(workspaceContext)
    mockPermission.mockResolvedValue('write')
    mockAssertFolderMutable.mockResolvedValue(undefined)
    mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mocks.loadFolderIndex.mockResolvedValue(emptyIndex)
  })

  it('rejects a forged cross-workspace delegation before loading the protected VFS index', async () => {
    await expect(
      moveWorkflowVfsItems.execute({
        principal: { ...principal, workspaceId: 'workspace-2' },
        input: {
          workspaceId: 'workspace-1',
          sources: [{ source: 'workflows/One', segments: ['One'] }],
          destination: { segments: ['Archive'], trailingSlash: true },
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadFolderIndex).not.toHaveBeenCalled()
  })

  it('rechecks current permission before canonical index loading', async () => {
    mockPermission.mockResolvedValueOnce(null)

    await expect(
      moveWorkflowVfsItems.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          sources: [{ source: 'workflows/One', segments: ['One'] }],
          destination: { segments: [], trailingSlash: false },
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.loadFolderIndex).not.toHaveBeenCalled()
  })

  it('keeps partial failures bounded while auditing and notifying only durable successes', async () => {
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'One', folderId: null },
      { id: 'workflow-2', name: 'Two', folderId: null },
    ])
    queueTableRows(schemaMock.workflow, [{ id: 'workflow-1', name: 'One', folderId: null }])
    queueTableRows(schemaMock.workflow, [{ id: 'workflow-2', name: 'Two', folderId: null }])
    mocks.updateWorkflow
      .mockResolvedValueOnce({
        success: true,
        workflow: { id: 'workflow-1', name: 'One', folderId: null },
      })
      .mockResolvedValueOnce({ success: false, error: 'Workflow is locked', errorCode: 'locked' })

    const result = await moveWorkflowVfsItems.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        sources: [
          { source: 'workflows/One', segments: ['One'] },
          { source: 'workflows/Two', segments: ['Two'] },
        ],
        destination: { segments: [], trailingSlash: true },
      },
    })

    for (const logger of getAllMockLoggers()) expect(logger.error).not.toHaveBeenCalled()
    expect(result.outcomes).toEqual([
      expect.objectContaining({ source: 'workflows/One', resourceId: 'workflow-1' }),
      expect.objectContaining({ source: 'workflows/Two', error: 'Workflow is locked' }),
    ])
    expect(mockAudit).toHaveBeenCalledOnce()
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.updated',
        resourceId: 'workflow-1',
        metadata: expect.objectContaining({ operation: 'workflows.vfs.move' }),
      })
    )
    expect(mockNotifyWorkflow).toHaveBeenCalledWith('workflow-1')
    expect(mockNotifyWorkflow).not.toHaveBeenCalledWith('workflow-2')
  })

  it('propagates an unexpected mutation failure without projecting a partial outcome', async () => {
    queueTableRows(schemaMock.workflow, [{ id: 'workflow-1', name: 'One', folderId: null }])
    queueTableRows(schemaMock.workflow, [{ id: 'workflow-1', name: 'One', folderId: null }])
    mocks.updateWorkflow.mockRejectedValueOnce(new Error('postgres password=secret'))

    await expect(
      moveWorkflowVfsItems.execute({
        principal,
        input: {
          workspaceId: 'workspace-1',
          sources: [{ source: 'workflows/One', segments: ['One'] }],
          destination: { segments: [], trailingSlash: true },
        },
      })
    ).rejects.toThrow('postgres password=secret')

    expect(mockAudit).not.toHaveBeenCalled()
    expect(mockNotifyWorkflow).not.toHaveBeenCalled()
    expect(mockNotifyFolder).not.toHaveBeenCalled()
  })
})
