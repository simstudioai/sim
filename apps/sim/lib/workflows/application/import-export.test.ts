/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  resolveWorkflow: vi.fn(),
  resolvePermission: vi.fn(),
  importTransition: vi.fn(),
  buildExport: vi.fn(),
  folderLock: vi.fn(),
  loadIndex: vi.fn(),
  recordAudit: vi.fn(),
  notifyWorkspace: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveWorkspace,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflow,
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    WORKFLOW_CREATED: 'workflow.created',
    WORKFLOW_EXPORTED: 'workflow.exported',
  },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.recordAudit,
}))
vi.mock('@/lib/folders/locks', () => ({
  withFolderTreeLock: mocks.folderLock,
}))
vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadIndex,
  resolveFolderPathFromIndex: (index: { idByPath: Map<string, string> }, path: string) =>
    path === '/' ? null : index.idByPath.get(path),
}))
vi.mock('@/lib/realtime/notify', () => ({
  notifyWorkspaceWorkflowsChanged: mocks.notifyWorkspace,
}))

vi.mock('@/lib/workflows/operations/import-workflow', () => ({
  importWorkflowIntoWorkspaceTransition: mocks.importTransition,
}))
vi.mock('@/lib/workflows/operations/export-workflow', () => ({
  buildWorkflowExportPayload: mocks.buildExport,
}))

import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { exportWorkflow, importWorkflow } from '@/lib/workflows/application/import-export'
import { WorkflowImportError } from '@/lib/workflows/application/workflow-import-error'

const workspaceContext = {
  workspaceId: 'ws-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'owner-1',
}
const workflowRecord = {
  id: 'workflow-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
  folderId: 'folder-1',
  sortOrder: 0,
  name: 'Reports',
  description: null,
  variables: {},
}
const folderIndex = {
  rowById: new Map(),
  pathById: new Map([['folder-1', '/Reports']]),
  idByPath: new Map([['/Reports', 'folder-1']]),
}
const imported = {
  id: 'workflow-2',
  name: 'Imported',
  description: null,
  workspaceId: 'ws-1',
  folderId: 'folder-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}
const exportPayload = {
  version: '1.0' as const,
  exportedAt: '2026-01-01T00:00:00.000Z',
  workflow: {
    id: 'workflow-1',
    name: 'Reports',
    description: null,
    workspaceId: 'ws-1',
    folderId: 'folder-1',
  },
  state: {
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
    metadata: { name: 'Reports', exportedAt: '2026-01-01T00:00:00.000Z' },
  },
}

describe('workflow import and export application operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolveWorkflow.mockResolvedValue({
      ...workspaceContext,
      workflowId: 'workflow-1',
      workflow: workflowRecord,
    })
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.folderLock.mockImplementation(
      async (
        _workspaceId: string,
        _resourceType: string,
        callback: (tx: Record<string, never>) => unknown
      ) => callback({})
    )
    mocks.loadIndex.mockResolvedValue(folderIndex)
    mocks.importTransition.mockResolvedValue({ success: true, workflow: imported })
    mocks.buildExport.mockResolvedValue(exportPayload)
  })

  it('imports through the unaudited transition and projects one semantic audit', async () => {
    const result = await importWorkflow.execute({
      principal: { kind: 'workspace_api_key', workspaceId: 'ws-1', keyId: 'key-1' },
      input: {
        workspaceId: 'ws-1',
        folderPath: '/Reports',
        workflow: { blocks: {}, edges: [] },
      },
    })

    expect(result).toEqual({ workflow: imported, folderPath: '/Reports' })
    expect(mocks.importTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        folderId: 'folder-1',
        userId: 'owner-1',
      })
    )
    expect(mocks.recordAudit).toHaveBeenCalledOnce()
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        actorName: 'Workspace API key',
        metadata: expect.objectContaining({
          operation: 'workflows.import',
          actor: { kind: 'workspace_api_key', keyId: 'key-1', workspaceId: 'ws-1' },
        }),
      })
    )
  })

  it('preserves classified import details and does not audit a failure', async () => {
    mocks.importTransition.mockResolvedValue({
      success: false,
      status: 400,
      error: 'Invalid workflow state',
      details: [{ path: ['blocks'] }],
    })

    const error = await importWorkflow
      .execute({
        principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        input: { workspaceId: 'ws-1', workflow: { blocks: null } },
      })
      .catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(WorkflowImportError)
    expect(error).toMatchObject({
      code: 'validation',
      details: [{ path: ['blocks'] }],
    })
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('exports from the canonical workflow context and audits authoritative counts', async () => {
    const result = await exportWorkflow.execute({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: { workflowId: 'workflow-1' },
    })

    expect(mocks.resolveWorkflow).toHaveBeenCalledWith({ workflowId: 'workflow-1' })
    expect(mocks.buildExport).toHaveBeenCalledWith(workflowRecord)
    expect(mocks.loadIndex).toHaveBeenCalledWith('ws-1', 'workflow', undefined, {
      maxRows: MAX_FOLDERS_PER_WORKSPACE,
    })
    expect(mocks.folderLock).not.toHaveBeenCalled()
    expect(result).toEqual({ payload: exportPayload, folderPath: '/Reports' })
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'workflow-1',
        metadata: expect.objectContaining({ blocksCount: 0, edgesCount: 0 }),
      })
    )
  })

  it('propagates export infrastructure failures without audit', async () => {
    const failure = new Error('storage unavailable')
    mocks.buildExport.mockRejectedValueOnce(failure)

    await expect(
      exportWorkflow.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { workflowId: 'workflow-1' },
      })
    ).rejects.toBe(failure)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })
})
