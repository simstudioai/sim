/**
 * @vitest-environment node
 */
import { dbChainMock, resetDbChainMock, schemaMock, workflowAuthzMockFns } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureWorkspaceAccess: vi.fn(),
  ensureWorkflowAccess: vi.fn(),
  getDefaultWorkspaceId: vi.fn(),
  getWorkspaceFileByName: vi.fn(),
  resolveWorkspaceFileReference: vi.fn(),
  findWorkspaceFileFolderIdByPath: vi.fn(),
  ensureWorkspaceFileFolderPath: vi.fn(),
  ensureCopilotFileFolderPath: vi.fn(),
  moveWorkspaceFileItems: vi.fn(),
  updateWorkspaceFileFolder: vi.fn(),
  deleteWorkspaceFile: vi.fn(),
  renameWorkspaceFile: vi.fn(),
  performMoveRenameWorkspaceFile: vi.fn(),
  performUpdateWorkspaceFileFolder: vi.fn(),
  performCreateFolder: vi.fn(),
  performUpdateFolder: vi.fn(),
  performUpdateWorkflow: vi.fn(),
  duplicateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  resolveWorkflowIndex: vi.fn(),
  createWorkflowFolder: vi.fn(),
  relocateWorkflowFolder: vi.fn(),
  deleteWorkflowFolder: vi.fn(),
  listFolders: vi.fn(),
  verifyFolderWorkspace: vi.fn(),
  listTables: vi.fn(),
  renameTable: vi.fn(),
  listKnowledgeBases: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
  knowledgeBaseDeleted: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkspaceAccess: mocks.ensureWorkspaceAccess,
  ensureWorkflowAccess: mocks.ensureWorkflowAccess,
  getDefaultWorkspaceId: mocks.getDefaultWorkspaceId,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFileByName: mocks.getWorkspaceFileByName,
}))

vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference: mocks.resolveWorkspaceFileReference,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  findWorkspaceFileFolderIdByPath: mocks.findWorkspaceFileFolderIdByPath,
  normalizeWorkspaceFileItemName: vi.fn((name: string) => name.trim()),
}))

vi.mock('@/lib/copilot/tools/server/files/file-folder-application', () => ({
  resolveCopilotFilePrincipal: vi.fn((context, workspaceId, fileId) => ({
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: context.userId,
    workspaceId,
    delegationId: `copilot-tool:${context.toolCallId}`,
    audience: 'sim:workspace-files',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 300_000),
    ...(fileId ? { resourceScope: { fileId } } : {}),
  })),
  ensureCopilotFileFolderPath: mocks.ensureCopilotFileFolderPath,
  requireCopilotWorkspace: vi.fn((context) => context.workspaceId),
}))

vi.mock('@/lib/workspace-files/application/move-workspace-file-items', () => ({
  moveWorkspaceFileItemsOperation: {
    operation: { id: 'files.move', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.moveWorkspaceFileItems,
  },
}))

vi.mock('@/lib/workspace-files/application/operations', () => ({
  fileOperations: {
    move: { id: 'files.move', minimumRole: 'write', workspaceApiKey: 'allow' },
    rename: { id: 'files.rename', minimumRole: 'write', workspaceApiKey: 'allow' },
    delete: { id: 'files.delete', minimumRole: 'write', workspaceApiKey: 'allow' },
    updateFolder: {
      id: 'files.folders.update',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
    },
  },
}))

vi.mock('@/lib/workspace-files/application/workspace-file-folders', () => ({
  updateWorkspaceFileFolderOperation: {
    operation: { id: 'files.folders.update', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.updateWorkspaceFileFolder,
  },
}))

vi.mock('@/lib/workspace-files/application/delete-workspace-file', () => ({
  deleteWorkspaceFileOperation: {
    operation: { id: 'files.delete', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.deleteWorkspaceFile,
  },
}))

vi.mock('@/lib/workspace-files/application/archive-workspace-file-items', () => ({
  archiveWorkspaceFileItemsOperation: {
    operation: { id: 'files.delete', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.deleteWorkspaceFile,
  },
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({}))

vi.mock('@/lib/workspace-files/application/rename-workspace-file', () => ({
  renameWorkspaceFile: {
    operation: { id: 'files.rename', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.renameWorkspaceFile,
  },
}))

vi.mock('@/lib/workflows/application/update-workflow', () => ({
  updateWorkflow: { operation: { id: 'workflows.update' }, execute: mocks.performUpdateWorkflow },
}))

vi.mock('@/lib/workflows/application/duplicate-workflow', () => ({
  duplicateWorkflow: { operation: { id: 'workflows.duplicate' }, execute: mocks.duplicateWorkflow },
}))

vi.mock('@/lib/workflows/application/delete-workflow', () => ({
  deleteWorkflow: { operation: { id: 'workflows.delete' }, execute: mocks.deleteWorkflow },
}))

vi.mock('@/lib/workflows/application/resolve-workflow-vfs-index', () => ({
  resolveWorkflowVfsCreateFolderIndex: {
    operation: { id: 'workflows.folders.create' },
    execute: mocks.resolveWorkflowIndex,
  },
  resolveWorkflowVfsUpdateIndex: {
    operation: { id: 'workflows.update' },
    execute: mocks.resolveWorkflowIndex,
  },
  resolveWorkflowVfsDuplicateIndex: {
    operation: { id: 'workflows.duplicate' },
    execute: mocks.resolveWorkflowIndex,
  },
  resolveWorkflowVfsDeleteIndex: {
    operation: { id: 'workflows.delete' },
    execute: mocks.resolveWorkflowIndex,
  },
}))

vi.mock('@/lib/workflows/application/workflow-folders', () => ({
  createWorkflowFolder: {
    operation: { id: 'workflows.folders.create' },
    execute: mocks.createWorkflowFolder,
  },
  relocateWorkflowFolder: {
    operation: { id: 'workflows.folders.relocate' },
    execute: mocks.relocateWorkflowFolder,
  },
  deleteWorkflowFolder: {
    operation: { id: 'workflows.folders.delete' },
    execute: mocks.deleteWorkflowFolder,
  },
}))

vi.mock('@/lib/table/service', () => ({
  listTables: mocks.listTables,
  renameTable: mocks.renameTable,
}))

vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  listKnowledgeBases: {
    operation: { id: 'knowledge.list' },
    execute: mocks.listKnowledgeBases,
  },
  updateKnowledgeBaseOperation: {
    operation: { id: 'knowledge.update' },
    execute: mocks.updateKnowledgeBase,
  },
  deleteKnowledgeBaseOperation: {
    operation: { id: 'knowledge.delete' },
    execute: mocks.deleteKnowledgeBase,
  },
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDeleted: mocks.knowledgeBaseDeleted },
}))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { executeVfsCp, executeVfsMkdir, executeVfsMv, executeVfsRm } from './vfs-mutate'

const context = {
  userId: 'user-1',
  workspaceId: 'ws-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
} as ExecutionContext

function workflowIndex(
  workflows: Array<{ id: string; name: string; folderId: string | null }> = [],
  folders: Array<{ id: string; name: string; parentId: string | null; path: string }> = []
) {
  return {
    workflows,
    folders: folders.map(({ path: _path, ...folder }) => folder),
    folderIndex: {
      pathById: new Map(folders.map((folder) => [folder.id, folder.path])),
    },
  }
}

describe('vfs mv/cp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.ensureWorkspaceAccess.mockResolvedValue(undefined)
    mocks.ensureWorkflowAccess.mockResolvedValue({ workspaceId: 'ws-1', workflow: {} })
    workflowAuthzMockFns.mockAssertFolderMutable.mockResolvedValue(undefined)
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    mocks.verifyFolderWorkspace.mockResolvedValue(true)
    mocks.listFolders.mockResolvedValue([])
    mocks.resolveWorkflowIndex.mockResolvedValue(workflowIndex())
    mocks.performUpdateWorkflow.mockResolvedValue({ workflow: { id: 'wf-1' } })
    mocks.duplicateWorkflow.mockResolvedValue({ id: 'wf-2', name: 'My Copy' })
    mocks.deleteWorkflow.mockResolvedValue({ archived: true })
    mocks.createWorkflowFolder.mockImplementation(async ({ input }) => ({
      folder: {
        id: 'fold-new',
        name: input.path.split('/').at(-1),
        parentId: null,
      },
      index: {},
    }))
    mocks.relocateWorkflowFolder.mockResolvedValue({ folder: { id: 'fold-1' }, index: {} })
    mocks.deleteWorkflowFolder.mockResolvedValue({ deletedItems: { folders: 1, workflows: 0 } })
    mocks.getWorkspaceFileByName.mockResolvedValue(null)
    mocks.resolveWorkspaceFileReference.mockImplementation(async ({ reference }) => {
      const segments = reference.split('/').slice(1)
      const folderSegments = segments.slice(0, -1)
      if (folderSegments.length > 0) {
        const folderId = await mocks.findWorkspaceFileFolderIdByPath('ws-1', folderSegments)
        if (!folderId) return null
        return mocks.getWorkspaceFileByName('ws-1', segments.at(-1), { folderId })
      }
      return mocks.getWorkspaceFileByName('ws-1', segments.at(-1), { folderId: null })
    })
    mocks.findWorkspaceFileFolderIdByPath.mockResolvedValue(null)
    mocks.ensureWorkspaceFileFolderPath.mockResolvedValue('ensured-folder')
    mocks.ensureCopilotFileFolderPath.mockResolvedValue('ensured-folder')
    mocks.moveWorkspaceFileItems.mockResolvedValue({ movedItems: { files: 1, folders: 0 } })
    mocks.updateWorkspaceFileFolder.mockResolvedValue({ folder: { name: 'Reports 2025' } })
    mocks.deleteWorkspaceFile.mockResolvedValue({
      id: 'file-1',
      workspaceId: 'ws-1',
      deleted: true,
    })
    mocks.renameWorkspaceFile.mockResolvedValue({
      file: { id: 'file-1', name: 'renamed.md' },
    })
  })

  afterAll(() => {
    resetDbChainMock()
    workflowAuthzMockFns.mockAssertFolderMutable.mockReset().mockResolvedValue(undefined)
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockReset().mockResolvedValue(undefined)
  })

  describe('category rules', () => {
    it('rejects cross-category moves', async () => {
      const result = await executeVfsMv(
        { sources: ['files/report.pdf'], destination: 'workflows/report' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('across categories')
    })

    it('rejects uploads with a materialize_file pointer', async () => {
      const result = await executeVfsMv(
        { sources: ['uploads/data.csv'], destination: 'files/data.csv' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('materialize_file')
    })

    it('rejects read-only categories', async () => {
      const result = await executeVfsMv(
        { sources: ['components/blocks/gmail.json'], destination: 'components/blocks/g.json' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('not a movable resource')
    })

    it('aborts before mutating when the request was cancelled', async () => {
      const abortedContext = {
        userId: 'user-1',
        workspaceId: 'ws-1',
        abortSignal: { aborted: true },
      } as unknown as ExecutionContext
      const result = await executeVfsMv(
        { sources: ['files/a.md'], destination: 'files/b.md' },
        abortedContext
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('aborted')
      expect(mocks.moveWorkspaceFileItems).not.toHaveBeenCalled()
    })
  })

  describe('files', () => {
    it('routes a same-folder rename through the delegated file use case', async () => {
      mocks.getWorkspaceFileByName.mockResolvedValue({
        id: 'file-1',
        name: 'draft.md',
        folderId: null,
      })
      mocks.renameWorkspaceFile.mockResolvedValue({
        file: { id: 'file-1', name: 'final.md' },
      })

      const result = await executeVfsMv(
        { sources: ['files/draft.md'], destination: 'files/final.md' },
        context
      )

      expect(mocks.renameWorkspaceFile).toHaveBeenCalledWith({
        principal: expect.objectContaining({
          kind: 'delegated',
          subjectUserId: 'user-1',
          workspaceId: 'ws-1',
          delegationId: 'copilot-tool:tool-call-1',
          resourceScope: expect.objectContaining({ fileId: 'file-1' }),
        }),
        input: {
          fileId: 'file-1',
          assertedWorkspaceId: 'ws-1',
          name: 'final.md',
        },
      })
      expect(mocks.moveWorkspaceFileItems).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        success: true,
        output: { results: [{ to: 'files/final.md', id: 'file-1' }] },
      })
    })

    it('moves and renames a file in one call, auto-creating destination folders', async () => {
      mocks.getWorkspaceFileByName.mockResolvedValue({ id: 'file-1', name: 'draft.md' })
      mocks.renameWorkspaceFile.mockResolvedValue({
        file: { id: 'file-1', name: 'final.md' },
      })

      const result = await executeVfsMv(
        { sources: ['files/draft.md'], destination: 'files/Reports/2026/final.md' },
        context
      )

      expect(mocks.getWorkspaceFileByName).toHaveBeenCalledWith('ws-1', 'draft.md', {
        folderId: null,
      })
      expect(mocks.ensureCopilotFileFolderPath).toHaveBeenCalledWith(context, 'ws-1', [
        'Reports',
        '2026',
      ])
      expect(mocks.moveWorkspaceFileItems).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ targetFolderId: 'ensured-folder' }),
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ from: 'files/draft.md', to: 'files/Reports/2026/final.md', kind: 'file' }],
      })
    })

    it('moves into an existing folder keeping the name without creating anything', async () => {
      mocks.findWorkspaceFileFolderIdByPath.mockResolvedValue('folder-images')
      mocks.getWorkspaceFileByName.mockResolvedValue({ id: 'file-1', name: 'a.png' })

      const result = await executeVfsMv(
        { sources: ['files/a.png'], destination: 'files/Images' },
        context
      )

      expect(mocks.moveWorkspaceFileItems).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ targetFolderId: 'folder-images' }),
        })
      )
      expect(mocks.ensureCopilotFileFolderPath).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ results: [{ to: 'files/Images/a.png' }] })
    })

    it('requires a folder destination for multiple sources', async () => {
      const result = await executeVfsMv(
        { sources: ['files/a.png', 'files/b.png'], destination: 'files/Images/c.png' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('must be a folder')
    })

    it('resolves sources at their exact path only — no cross-folder name fallback', async () => {
      mocks.getWorkspaceFileByName.mockResolvedValue(null)
      mocks.findWorkspaceFileFolderIdByPath.mockResolvedValue(null)

      const result = await executeVfsMv(
        { sources: ['files/report.pdf'], destination: 'files/Archive/' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Not found')
      expect(mocks.moveWorkspaceFileItems).not.toHaveBeenCalled()
      expect(mocks.ensureCopilotFileFolderPath).not.toHaveBeenCalled()
    })

    it('rejects copying workspace files — cp is workflows-only', async () => {
      mocks.getWorkspaceFileByName.mockResolvedValue({ id: 'file-1', name: 'template.md' })

      const result = await executeVfsCp(
        { sources: ['files/template.md'], destination: 'files/Reports/january.md' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('cp only duplicates workflows')
      expect(mocks.ensureCopilotFileFolderPath).not.toHaveBeenCalled()
    })

    it('moves and renames a file folder via the shared folder operation', async () => {
      mocks.findWorkspaceFileFolderIdByPath
        .mockResolvedValueOnce(null) // destination is not an existing folder
        .mockResolvedValueOnce('folder-src') // source resolves as folder

      const result = await executeVfsMv(
        { sources: ['files/Reports'], destination: 'files/Archive/Reports 2025' },
        context
      )

      expect(mocks.updateWorkspaceFileFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            folderId: 'folder-src',
            name: 'Reports 2025',
            parentId: 'ensured-folder',
          }),
        })
      )
      expect(result.success).toBe(true)
    })
  })

  describe('workflows', () => {
    it('renames a workflow at root', async () => {
      mocks.resolveWorkflowIndex.mockResolvedValue(
        workflowIndex([{ id: 'wf-1', name: 'Old Name', folderId: null }])
      )

      const result = await executeVfsMv(
        { sources: ['workflows/Old%20Name'], destination: 'workflows/New Name' },
        context
      )

      expect(mocks.performUpdateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: expect.objectContaining({
            serviceId: 'copilot',
            workspaceId: 'ws-1',
          }),
          input: expect.objectContaining({ workflowId: 'wf-1', name: 'New Name', folderId: null }),
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ results: [{ to: 'workflows/New%20Name' }] })
    })

    it('moves a workflow into an existing folder keeping its name', async () => {
      mocks.resolveWorkflowIndex.mockResolvedValue(
        workflowIndex(
          [{ id: 'wf-1', name: 'My Workflow', folderId: null }],
          [{ id: 'fold-1', name: 'Archive', parentId: null, path: '/Archive' }]
        )
      )

      const result = await executeVfsMv(
        { sources: ['workflows/My%20Workflow'], destination: 'workflows/Archive' },
        context
      )

      expect(mocks.performUpdateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            workflowId: 'wf-1',
            name: undefined,
            folderId: 'fold-1',
          }),
        })
      )
      expect(result.success).toBe(true)
    })

    it('surfaces locked-workflow rejections per item', async () => {
      mocks.resolveWorkflowIndex.mockResolvedValue(
        workflowIndex([{ id: 'wf-1', name: 'Locked One', folderId: null }])
      )
      mocks.performUpdateWorkflow.mockRejectedValue(
        new OrchestrationError('locked', 'Workflow is locked')
      )

      const result = await executeVfsMv(
        { sources: ['workflows/Locked%20One'], destination: 'workflows/Renamed' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('locked')
    })

    it('duplicates a workflow with cp (locked source allowed)', async () => {
      mocks.resolveWorkflowIndex.mockResolvedValue(
        workflowIndex([{ id: 'wf-1', name: 'Template', folderId: null }])
      )

      const result = await executeVfsCp(
        { sources: ['workflows/Template'], destination: 'workflows/My Copy' },
        context
      )

      expect(workflowAuthzMockFns.mockAssertWorkflowMutable).not.toHaveBeenCalled()
      expect(mocks.duplicateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            sourceWorkflowId: 'wf-1',
            assertedWorkspaceId: 'ws-1',
            folderId: null,
            name: 'My Copy',
          }),
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ results: [{ to: 'workflows/My%20Copy', id: 'wf-2' }] })
    })

    it('rejects copying workflow folders', async () => {
      mocks.resolveWorkflowIndex.mockResolvedValue(
        workflowIndex([], [{ id: 'fold-1', name: 'Projects', parentId: null, path: '/Projects' }])
      )
      const result = await executeVfsCp(
        { sources: ['workflows/Projects'], destination: 'workflows/Projects Copy' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('cannot be copied')
    })

    it('moves and renames a workflow folder', async () => {
      mocks.resolveWorkflowIndex.mockResolvedValue(
        workflowIndex(
          [],
          [
            { id: 'fold-1', name: 'Q1', parentId: null, path: '/Q1' },
            { id: 'fold-2', name: 'Archive', parentId: null, path: '/Archive' },
          ]
        )
      )

      const result = await executeVfsMv(
        { sources: ['workflows/Q1'], destination: 'workflows/Archive/Q1 2026' },
        context
      )

      expect(mocks.relocateWorkflowFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            workspaceId: 'ws-1',
            path: '/Q1',
            destinationPath: '/Archive/Q1 2026',
          },
        })
      )
      expect(result.success).toBe(true)
    })

    it('does not expose workflow application infrastructure errors', async () => {
      mocks.resolveWorkflowIndex.mockResolvedValue(
        workflowIndex([{ id: 'wf-1', name: 'Old Name', folderId: null }])
      )
      mocks.performUpdateWorkflow.mockRejectedValue(new Error('postgres host and password'))

      const result = await executeVfsMv(
        { sources: ['workflows/Old%20Name'], destination: 'workflows/New Name' },
        context
      )

      expect(result).toMatchObject({
        success: false,
        error: 'Workflow mutation failed',
        output: { results: [expect.objectContaining({ error: 'Workflow mutation failed' })] },
      })
    })

    it('deletes an encoded workflow alias through the workflow application operation', async () => {
      mocks.resolveWorkflowIndex.mockResolvedValue(
        workflowIndex([{ id: 'wf-1', name: 'Old Name', folderId: null }])
      )

      const result = await executeVfsRm({ paths: ['workflows/Old%20Name'] }, context)

      expect(result.success).toBe(true)
      expect(mocks.deleteWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: expect.objectContaining({
            serviceId: 'copilot',
            workspaceId: 'ws-1',
          }),
          input: { workflowId: 'wf-1', assertedWorkspaceId: 'ws-1' },
        })
      )
    })
  })

  describe('mkdir', () => {
    it('creates a nested file folder chain', async () => {
      const result = await executeVfsMkdir({ paths: ['files/Reports/2026'] }, context)

      expect(mocks.ensureCopilotFileFolderPath).toHaveBeenCalledWith(context, 'ws-1', [
        'Reports',
        '2026',
      ])
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ from: 'files/Reports/2026', to: 'files/Reports/2026', kind: 'file_folder' }],
      })
    })

    it('creates a workflow folder through the workflow application operation', async () => {
      const result = await executeVfsMkdir({ paths: ['workflows/Archive'] }, context)

      expect(mocks.createWorkflowFolder).toHaveBeenCalledWith(
        expect.objectContaining({ input: { workspaceId: 'ws-1', path: '/Archive' } })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ to: 'workflows/Archive', kind: 'workflow_folder', id: 'fold-new' }],
      })
    })

    it('rejects flat namespaces', async () => {
      const result = await executeVfsMkdir({ paths: ['tables/CRM'] }, context)
      expect(result.success).toBe(false)
      expect(result.output).toMatchObject({
        results: [{ from: 'tables/CRM', error: expect.stringContaining('flat namespace') }],
      })
      expect(mocks.ensureCopilotFileFolderPath).not.toHaveBeenCalled()
    })

    it('rejects creation inside a locked workflow folder', async () => {
      mocks.createWorkflowFolder.mockRejectedValue(
        new OrchestrationError('locked', 'Folder is locked')
      )

      const result = await executeVfsMkdir({ paths: ['workflows/Locked/Sub'] }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('locked')
      expect(mocks.createWorkflowFolder).toHaveBeenCalledOnce()
    })
  })

  describe('tables and knowledge bases (flat namespaces)', () => {
    it('renames a table', async () => {
      mocks.listTables.mockResolvedValue([{ id: 'tbl-1', name: 'Leads' }])
      mocks.renameTable.mockResolvedValue({ id: 'tbl-1', name: 'Customers' })

      const result = await executeVfsMv(
        { sources: ['tables/Leads'], destination: 'tables/Customers' },
        context
      )

      expect(mocks.renameTable).toHaveBeenCalledWith('tbl-1', 'Customers', expect.any(String))
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ results: [{ to: 'tables/Customers', kind: 'table' }] })
    })

    it('rejects nested table destinations as flat-namespace violations', async () => {
      const result = await executeVfsMv(
        { sources: ['tables/Leads'], destination: 'tables/CRM/Leads' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('flat namespace')
      expect(mocks.renameTable).not.toHaveBeenCalled()
    })

    it('rejects copying tables', async () => {
      const result = await executeVfsCp(
        { sources: ['tables/Leads'], destination: 'tables/Leads Copy' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('cannot be copied')
    })

    it('renames a knowledge base through trusted application operations', async () => {
      mocks.listKnowledgeBases.mockResolvedValue({
        knowledgeBases: [{ knowledgeBase: { id: 'kb-1', name: 'Docs' }, folderPath: '/' }],
      })
      mocks.updateKnowledgeBase.mockResolvedValue({
        knowledgeBase: { id: 'kb-1', name: 'Product Docs' },
        folderPath: '/',
      })

      const result = await executeVfsMv(
        { sources: ['knowledgebases/Docs'], destination: 'knowledgebases/Product Docs' },
        context
      )

      expect(mocks.updateKnowledgeBase).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: expect.objectContaining({
            kind: 'delegated',
            subjectUserId: 'user-1',
            workspaceId: 'ws-1',
            delegationId: 'tool-call-1',
          }),
          input: {
            knowledgeBaseId: 'kb-1',
            assertedWorkspaceId: 'ws-1',
            name: 'Product Docs',
            source: 'agent',
          },
        })
      )
      expect(result.success).toBe(true)
    })

    it('propagates knowledge application infrastructure failures', async () => {
      mocks.listKnowledgeBases.mockRejectedValueOnce(new Error('knowledge database unavailable'))

      await expect(
        executeVfsMv(
          { sources: ['knowledgebases/Docs'], destination: 'knowledgebases/Product Docs' },
          context
        )
      ).rejects.toThrow('knowledge database unavailable')
    })

    it('preserves an actionable knowledge rename conflict', async () => {
      mocks.listKnowledgeBases.mockResolvedValue({
        knowledgeBases: [{ knowledgeBase: { id: 'kb-1', name: 'Docs' }, folderPath: '/' }],
      })
      mocks.updateKnowledgeBase.mockRejectedValue(
        new OrchestrationError('conflict', 'A knowledge base named Product Docs already exists')
      )

      const result = await executeVfsMv(
        { sources: ['knowledgebases/Docs'], destination: 'knowledgebases/Product Docs' },
        context
      )

      expect(result).toMatchObject({
        success: false,
        error: 'A knowledge base named Product Docs already exists',
      })
    })

    it('rejects the reserved knowledgebases/connectors name', async () => {
      const result = await executeVfsMv(
        { sources: ['knowledgebases/Docs'], destination: 'knowledgebases/connectors' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('reserved')
    })

    it('deletes a knowledge base through the trusted application operation', async () => {
      mocks.listKnowledgeBases.mockResolvedValue({
        knowledgeBases: [{ knowledgeBase: { id: 'kb-1', name: 'Docs' }, folderPath: '/' }],
      })
      mocks.deleteKnowledgeBase.mockResolvedValue({ id: 'kb-1', name: 'Docs' })

      const result = await executeVfsRm({ paths: ['knowledgebases/Docs'] }, context)

      expect(result).toMatchObject({
        success: true,
        output: { results: [{ from: 'knowledgebases/Docs', id: 'kb-1' }] },
      })
      expect(mocks.deleteKnowledgeBase).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: expect.objectContaining({ delegationId: 'tool-call-1' }),
          input: {
            knowledgeBaseId: 'kb-1',
            assertedWorkspaceId: 'ws-1',
            source: 'agent',
          },
        })
      )
      expect(mocks.knowledgeBaseDeleted).toHaveBeenCalledWith({ knowledgeBaseId: 'kb-1' })
    })

    it('preserves an actionable knowledge delete failure', async () => {
      mocks.listKnowledgeBases.mockResolvedValue({
        knowledgeBases: [{ knowledgeBase: { id: 'kb-1', name: 'Docs' }, folderPath: '/' }],
      })
      mocks.deleteKnowledgeBase.mockRejectedValue(
        new OrchestrationError('not_found', 'Knowledge base no longer exists')
      )

      const result = await executeVfsRm({ paths: ['knowledgebases/Docs'] }, context)

      expect(result).toMatchObject({
        success: false,
        error: 'Knowledge base no longer exists',
        output: {
          results: [
            expect.objectContaining({
              from: 'knowledgebases/Docs',
              error: 'Knowledge base no longer exists',
            }),
          ],
        },
      })
    })
  })
})
