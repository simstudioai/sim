/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
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
      createFolder: vi.fn(),
      deleteFolder: vi.fn(),
      deleteWorkflow: vi.fn(),
      duplicateWorkflow: vi.fn(),
      loadFolderIndex: vi.fn(),
      logError: vi.fn(),
      notifyFolder: vi.fn(),
      notifyWorkflow: vi.fn(),
      notifyWorkflowDeleted: vi.fn(),
      notifyWorkspace: vi.fn(),
      permission: vi.fn(),
      relocateFolder: vi.fn(),
      resolveContext: vi.fn(),
      updateWorkflow: vi.fn(),
    },
  }
})

vi.mock('@sim/audit', () => ({
  AuditAction: {
    FOLDER_CREATED: 'folder.created',
    FOLDER_DELETED: 'folder.deleted',
    FOLDER_MOVED: 'folder.moved',
    WORKFLOW_DELETED: 'workflow.deleted',
    WORKFLOW_DUPLICATED: 'workflow.duplicated',
    WORKFLOW_UPDATED: 'workflow.updated',
  },
  AuditResourceType: { FOLDER: 'folder', WORKFLOW: 'workflow' },
  recordAudit: mocks.audit,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    error: mocks.logError,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  assertFolderMutable: mocks.assertFolderMutable,
  assertWorkflowMutable: mocks.assertWorkflowMutable,
  FolderLockedError,
  WorkflowLockedError,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.permission,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadFolderIndex,
}))

vi.mock('@/lib/folders/orchestration', () => ({
  createFolderAtPath: mocks.createFolder,
  deleteFolderByPath: mocks.deleteFolder,
  relocateFolderByPath: mocks.relocateFolder,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  deleteWorkflowRecord: mocks.deleteWorkflow,
  updateWorkflowRecord: mocks.updateWorkflow,
}))

vi.mock('@/lib/workflows/persistence/duplicate', () => ({
  duplicateWorkflow: mocks.duplicateWorkflow,
}))

vi.mock('@/lib/realtime/notify', () => ({
  notifyFolderResourceChanged: mocks.notifyFolder,
  notifyWorkflowDeleted: mocks.notifyWorkflowDeleted,
  notifyWorkflowUpdated: mocks.notifyWorkflow,
  notifyWorkspaceWorkflowsChanged: mocks.notifyWorkspace,
}))

import {
  createWorkflowVfsFolders,
  moveWorkflowVfsItems,
} from '@/lib/workflows/application/workflow-vfs'

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
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveContext.mockResolvedValue(workspaceContext)
    mocks.permission.mockResolvedValue('write')
    mocks.assertFolderMutable.mockResolvedValue(undefined)
    mocks.assertWorkflowMutable.mockResolvedValue(undefined)
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
    mocks.permission.mockResolvedValueOnce(null)

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
      { id: 'workflow-3', name: 'Three', folderId: null },
    ])
    queueTableRows(schemaMock.workflow, [{ id: 'workflow-1', name: 'One', folderId: null }])
    queueTableRows(schemaMock.workflow, [{ id: 'workflow-2', name: 'Two', folderId: null }])
    queueTableRows(schemaMock.workflow, [{ id: 'workflow-3', name: 'Three', folderId: null }])
    mocks.updateWorkflow
      .mockResolvedValueOnce({
        success: true,
        workflow: { id: 'workflow-1', name: 'One', folderId: null },
      })
      .mockResolvedValueOnce({ success: false, error: 'Workflow is locked', errorCode: 'locked' })
      .mockResolvedValueOnce({
        success: true,
        workflow: { id: 'workflow-3', name: 'Three', folderId: null },
      })

    const result = await moveWorkflowVfsItems.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        sources: [
          { source: 'workflows/One', segments: ['One'] },
          { source: 'workflows/Two', segments: ['Two'] },
          { source: 'workflows/Three', segments: ['Three'] },
        ],
        destination: { segments: [], trailingSlash: true },
      },
    })

    expect(mocks.logError).not.toHaveBeenCalled()
    expect(result.outcomes).toEqual([
      expect.objectContaining({ source: 'workflows/One', resourceId: 'workflow-1' }),
      expect.objectContaining({ source: 'workflows/Two', error: 'Workflow is locked' }),
      expect.objectContaining({ source: 'workflows/Three', resourceId: 'workflow-3' }),
    ])
    expect(mocks.audit).toHaveBeenCalledTimes(2)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.updated',
        resourceId: 'workflow-1',
        metadata: expect.objectContaining({ operation: 'workflows.vfs.move' }),
      })
    )
    expect(mocks.notifyWorkflow).toHaveBeenCalledWith('workflow-1')
    expect(mocks.notifyWorkflow).not.toHaveBeenCalledWith('workflow-2')
    expect(mocks.notifyWorkflow).toHaveBeenCalledWith('workflow-3')
    expect(mocks.notifyWorkspace).toHaveBeenCalledOnce()
    expect(mocks.notifyWorkspace).toHaveBeenCalledWith('workspace-1')
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

    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.notifyWorkflow).not.toHaveBeenCalled()
    expect(mocks.notifyFolder).not.toHaveBeenCalled()
    expect(mocks.notifyWorkspace).not.toHaveBeenCalled()
  })

  it('owns mkdir path planning and audits only the folder it creates', async () => {
    const created = {
      id: 'folder-1',
      name: 'Project Plans',
      parentId: null,
    }
    const createdIndex = {
      rowById: new Map([[created.id, created]]),
      pathById: new Map([[created.id, '/Project%20Plans']]),
      idByPath: new Map([['/Project%20Plans', created.id]]),
    }
    mocks.loadFolderIndex.mockResolvedValueOnce(emptyIndex).mockResolvedValueOnce(createdIndex)
    mocks.createFolder.mockResolvedValue({
      success: true,
      folder: created,
      path: '/Project%20Plans',
    })

    const result = await createWorkflowVfsFolders.execute({
      principal,
      input: {
        workspaceId: 'workspace-1',
        paths: [{ source: 'workflows/Project Plans', segments: ['Project Plans'] }],
      },
    })

    expect(result.outcomes).toEqual([
      expect.objectContaining({ resourceId: 'folder-1', targetSegments: ['Project Plans'] }),
    ])
    expect(mocks.createFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/Project%20Plans',
        effects: false,
        throwInfrastructure: true,
      })
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'folder.created',
        resourceId: 'folder-1',
        metadata: expect.objectContaining({ operation: 'workflows.vfs.folders.create' }),
      })
    )
    expect(mocks.notifyWorkspace).toHaveBeenCalledWith('workspace-1')
  })
})
