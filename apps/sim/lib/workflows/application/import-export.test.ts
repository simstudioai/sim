import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { folderQueriesMock, folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
import { realtimeNotifyMock, realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  importTransition: vi.fn(),
  mappedImport: vi.fn(),
  buildExport: vi.fn(),
  folderLock: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/folders/locks', () => ({
  withFolderTreeLock: hoisted.folderLock,
}))
vi.mock('@/lib/folders/queries', () => folderQueriesMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

vi.mock('@/lib/workflows/application/mapped-import', () => ({
  applyMappedWorkflowImport: hoisted.mappedImport,
}))

vi.mock('@/lib/workflows/operations/import-workflow', () => ({
  importWorkflowIntoWorkspaceTransition: hoisted.importTransition,
}))
vi.mock('@/lib/workflows/operations/export-workflow', () => ({
  buildWorkflowExportPayload: hoisted.buildExport,
}))

import { exportWorkflow, importWorkflow } from '@/lib/workflows/application/import-export'
import { WorkflowImportError } from '@/lib/workflows/application/workflow-import-error'

const mocks = {
  ...hoisted,
  loadIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
}

const mockResolveWorkspace = workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext
const mockResolveWorkflow = workflowContextMockFns.mockResolveActiveWorkflowApplicationContext
const mockResolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission
const mockRecordAudit = auditMockFns.mockRecordAudit
const mockNotifyWorkspace = realtimeNotifyMockFns.mockNotifyWorkspaceWorkflowsChanged

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
  blocks: [
    { id: 'block-1', type: 'starter', name: 'Start' },
    { id: 'block-2', type: 'agent', name: 'Classify' },
    { id: 'block-3', type: 'response', name: 'Reply' },
  ],
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
    mockResolveWorkspace.mockResolvedValue(workspaceContext)
    mockResolveWorkflow.mockResolvedValue({
      ...workspaceContext,
      workflowId: 'workflow-1',
      workflow: workflowRecord,
    })
    mockResolvePermission.mockResolvedValue('write')
    mocks.folderLock.mockImplementation(
      async (
        _workspaceId: string,
        _resourceType: string,
        callback: (tx: Record<string, never>) => unknown
      ) => callback({})
    )
    mocks.loadIndex.mockResolvedValue(folderIndex)
    mocks.importTransition.mockResolvedValue({ success: true, workflow: imported, warnings: [] })
    mocks.buildExport.mockResolvedValue(exportPayload)
  })

  it.each([false, true])(
    'preserves mapped import receipts (legacy=%s) without duplicate audit',
    async (legacy) => {
      const { blocks: _blocks, ...metadata } = imported
      const recordedWorkflow = legacy ? metadata : imported
      const operation = { requestId: 'request-1' }
      mocks.mappedImport.mockResolvedValue({
        workflow: recordedWorkflow,
        folderPath: '/Reports',
        operation,
        replayed: true,
      })

      const result = await importWorkflow.execute({
        principal: createPersonalApiKeyPrincipal(),
        input: {
          workspaceId: 'ws-1',
          workflow: { blocks: {}, edges: [] },
          requestId: 'request-1',
          previewFingerprint: 'preview-1',
        },
      })

      expect(result).toEqual({
        workflow: recordedWorkflow,
        folderPath: '/Reports',
        operation,
        replayed: true,
        warnings: [],
      })
      expect(mocks.importTransition).not.toHaveBeenCalled()
      expect(mockRecordAudit).not.toHaveBeenCalled()
      expect(mockNotifyWorkspace).not.toHaveBeenCalled()
    }
  )

  it('preserves classified import details and does not audit a failure', async () => {
    mocks.importTransition.mockResolvedValue({
      success: false,
      status: 400,
      error: 'Invalid workflow state',
      details: [{ path: ['blocks'] }],
    })

    const error = await importWorkflow
      .execute({
        principal: createPersonalApiKeyPrincipal(),
        input: { workspaceId: 'ws-1', workflow: { blocks: null } },
      })
      .catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(WorkflowImportError)
    expect(error).toMatchObject({
      code: 'validation',
      details: [{ path: ['blocks'] }],
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('keeps workspace bindings only when asked, and says so in the audit', async () => {
    await exportWorkflow.execute({
      principal: createPersonalApiKeyPrincipal(),
      input: { workflowId: 'workflow-1', includeWorkspaceBindings: true },
    })

    expect(mocks.buildExport).toHaveBeenCalledWith(workflowRecord, {
      includeReferences: undefined,
      includeWorkspaceBindings: true,
    })
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ includeWorkspaceBindings: true }),
      })
    )
  })
})
