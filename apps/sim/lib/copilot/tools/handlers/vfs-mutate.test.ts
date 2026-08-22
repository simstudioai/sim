/**
 * @vitest-environment node
 */
import { dbChainMock, resetDbChainMock, schemaMock, workflowAuthzMockFns } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { tableOperations } from '@/lib/table/application/operations'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { fileOperations } from '@/lib/workspace-files/application/operations'

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
  moveWorkflowVfs: vi.fn(),
  copyWorkflowVfs: vi.fn(),
  createWorkflowVfsFolders: vi.fn(),
  deleteWorkflowVfs: vi.fn(),
  listFolders: vi.fn(),
  verifyFolderWorkspace: vi.fn(),
  listTables: vi.fn(),
  renameTable: vi.fn(),
  listKnowledgeBases: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
  knowledgeBaseDeleted: vi.fn(),
  createFileVfsFolders: vi.fn(),
  relocateFileVfsItems: vi.fn(),
  deleteFileVfsItems: vi.fn(),
  renameTableVfs: vi.fn(),
  deleteTableVfs: vi.fn(),
  transferTableVfs: vi.fn(),
  createTableFolders: vi.fn(),
  deleteTableFolders: vi.fn(),
  renameKnowledgeVfs: vi.fn(),
  deleteKnowledgeVfs: vi.fn(),
  transferKnowledgeVfs: vi.fn(),
  createKnowledgeFolders: vi.fn(),
  deleteKnowledgeFolders: vi.fn(),
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
    operation: fileOperations.move,
    execute: mocks.moveWorkspaceFileItems,
  },
}))

vi.mock('@/lib/workspace-files/application/workspace-file-folders', () => ({
  updateWorkspaceFileFolderOperation: {
    operation: fileOperations.updateFolder,
    execute: mocks.updateWorkspaceFileFolder,
  },
}))

vi.mock('@/lib/workspace-files/application/delete-workspace-file', () => ({
  deleteWorkspaceFileOperation: {
    operation: fileOperations.delete,
    execute: mocks.deleteWorkspaceFile,
  },
}))

vi.mock('@/lib/workspace-files/application/archive-workspace-file-items', () => ({
  archiveWorkspaceFileItemsOperation: {
    operation: fileOperations.delete,
    execute: mocks.deleteWorkspaceFile,
  },
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({}))

vi.mock('@/lib/workspace-files/application/rename-workspace-file', () => ({
  renameWorkspaceFile: {
    operation: fileOperations.rename,
    execute: mocks.renameWorkspaceFile,
  },
}))

vi.mock('@/lib/workflows/application/workflow-vfs', () => ({
  moveWorkflowVfsItems: {
    operation: workflowOperations.moveVfsItems,
    execute: mocks.moveWorkflowVfs,
  },
  copyWorkflowVfsItems: {
    operation: workflowOperations.copyVfsItems,
    execute: mocks.copyWorkflowVfs,
  },
  createWorkflowVfsFolders: {
    operation: workflowOperations.createVfsFolders,
    execute: mocks.createWorkflowVfsFolders,
  },
  deleteWorkflowVfsItems: {
    operation: workflowOperations.deleteVfsItems,
    execute: mocks.deleteWorkflowVfs,
  },
}))

vi.mock('@/lib/workspace-files/application/workspace-file-vfs', () => ({
  createWorkspaceFileVfsFolders: {
    operation: fileOperations.createVfsFolders,
    execute: mocks.createFileVfsFolders,
  },
  relocateWorkspaceFileVfsItems: {
    operation: fileOperations.relocateVfsItems,
    execute: mocks.relocateFileVfsItems,
  },
  deleteWorkspaceFileVfsItems: {
    operation: fileOperations.deleteVfsItems,
    execute: mocks.deleteFileVfsItems,
  },
}))

vi.mock('@/lib/table/application/table-vfs', () => ({
  renameTableByVfsPath: {
    operation: tableOperations.renameByVfsPath,
    execute: mocks.renameTableVfs,
  },
  deleteTableByVfsPath: {
    operation: tableOperations.deleteByVfsPath,
    execute: mocks.deleteTableVfs,
  },
  transferTableVfsItems: {
    operation: tableOperations.moveByVfsPath,
    execute: mocks.transferTableVfs,
  },
  createTableVfsFolders: {
    operation: tableOperations.createFolder,
    execute: mocks.createTableFolders,
  },
  deleteTableVfsFolders: {
    operation: tableOperations.deleteFolder,
    execute: mocks.deleteTableFolders,
  },
}))

vi.mock('@/lib/knowledge/application/knowledge-vfs', () => ({
  renameKnowledgeBaseByVfsPath: {
    operation: knowledgeOperations.renameByVfsPath,
    execute: mocks.renameKnowledgeVfs,
  },
  deleteKnowledgeBaseByVfsPath: {
    operation: knowledgeOperations.deleteByVfsPath,
    execute: mocks.deleteKnowledgeVfs,
  },
  transferKnowledgeVfsItems: {
    operation: knowledgeOperations.moveByVfsPath,
    execute: mocks.transferKnowledgeVfs,
  },
  createKnowledgeVfsFolders: {
    operation: knowledgeOperations.manageVfsFolders,
    execute: mocks.createKnowledgeFolders,
  },
  deleteKnowledgeVfsFolders: {
    operation: knowledgeOperations.manageVfsFolders,
    execute: mocks.deleteKnowledgeFolders,
  },
}))

vi.mock('@/lib/table/service', () => ({
  listTables: mocks.listTables,
  renameTable: mocks.renameTable,
}))

vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  listKnowledgeBases: {
    operation: knowledgeOperations.list,
    execute: mocks.listKnowledgeBases,
  },
  updateKnowledgeBaseOperation: {
    operation: knowledgeOperations.update,
    execute: mocks.updateKnowledgeBase,
  },
  deleteKnowledgeBaseOperation: {
    operation: knowledgeOperations.delete,
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
    mocks.moveWorkflowVfs.mockResolvedValue({ outcomes: [] })
    mocks.copyWorkflowVfs.mockResolvedValue({ outcomes: [] })
    mocks.createWorkflowVfsFolders.mockResolvedValue({ outcomes: [] })
    mocks.deleteWorkflowVfs.mockResolvedValue({ outcomes: [] })
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
    mocks.ensureWorkspaceFileFolderPath.mockResolvedValue({
      folderId: 'ensured-folder',
      createdFolderIds: [],
    })
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
    mocks.createFileVfsFolders.mockResolvedValue({ outcomes: [] })
    mocks.relocateFileVfsItems.mockResolvedValue({ outcomes: [] })
    mocks.deleteFileVfsItems.mockResolvedValue({ outcomes: [] })
    mocks.renameTableVfs.mockResolvedValue({
      id: 'tbl-1',
      name: 'Customers',
      previousName: 'Leads',
      workspaceId: 'ws-1',
    })
    mocks.renameKnowledgeVfs.mockResolvedValue({
      id: 'kb-1',
      name: 'Product Docs',
      previousName: 'Docs',
      workspaceId: 'ws-1',
    })
    mocks.deleteKnowledgeVfs.mockResolvedValue({
      id: 'kb-1',
      name: 'Docs',
      workspaceId: 'ws-1',
      deleted: true,
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

    it('rejects uploads with a save_upload pointer', async () => {
      const result = await executeVfsMv(
        { sources: ['uploads/data.csv'], destination: 'files/data.csv' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('save_upload')
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
      mocks.relocateFileVfsItems.mockResolvedValue({
        outcomes: [
          {
            source: 'files/draft.md',
            targetSegments: ['final.md'],
            resourceType: 'file',
            resourceId: 'file-1',
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['files/draft.md'], destination: 'files/final.md' },
        context
      )

      expect(mocks.relocateFileVfsItems).toHaveBeenCalledWith({
        principal: expect.objectContaining({
          kind: 'delegated',
          subjectUserId: 'user-1',
          workspaceId: 'ws-1',
          delegationId: 'copilot-tool:tool-call-1',
        }),
        input: {
          workspaceId: 'ws-1',
          sources: [{ source: 'files/draft.md', segments: ['draft.md'] }],
          destination: { segments: ['final.md'], trailingSlash: false },
        },
      })
      expect(mocks.moveWorkspaceFileItems).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        success: true,
        output: { results: [{ to: 'files/final.md', id: 'file-1' }] },
      })
    })

    it('moves and renames a file in one call, auto-creating destination folders', async () => {
      mocks.relocateFileVfsItems.mockResolvedValue({
        outcomes: [
          {
            source: 'files/draft.md',
            targetSegments: ['Reports', '2026', 'final.md'],
            resourceType: 'file',
            resourceId: 'file-1',
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['files/draft.md'], destination: 'files/Reports/2026/final.md' },
        context
      )

      expect(mocks.relocateFileVfsItems).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            destination: { segments: ['Reports', '2026', 'final.md'], trailingSlash: false },
          }),
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ from: 'files/draft.md', to: 'files/Reports/2026/final.md', kind: 'file' }],
      })
    })

    it('moves into an existing folder keeping the name without creating anything', async () => {
      mocks.relocateFileVfsItems.mockResolvedValue({
        outcomes: [
          {
            source: 'files/a.png',
            targetSegments: ['Images', 'a.png'],
            resourceType: 'file',
            resourceId: 'file-1',
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['files/a.png'], destination: 'files/Images' },
        context
      )

      expect(mocks.relocateFileVfsItems).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            destination: { segments: ['Images'], trailingSlash: false },
          }),
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ results: [{ to: 'files/Images/a.png' }] })
    })

    it('requires a folder destination for multiple sources', async () => {
      mocks.relocateFileVfsItems.mockResolvedValue({
        outcomes: [
          {
            source: 'files/a.png',
            resourceType: 'file',
            error: 'Destination must be a folder when moving multiple sources',
          },
          {
            source: 'files/b.png',
            resourceType: 'file',
            error: 'Destination must be a folder when moving multiple sources',
          },
        ],
      })
      const result = await executeVfsMv(
        { sources: ['files/a.png', 'files/b.png'], destination: 'files/Images/c.png' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('must be a folder')
    })

    it('resolves sources at their exact path only — no cross-folder name fallback', async () => {
      mocks.relocateFileVfsItems.mockResolvedValue({
        outcomes: [
          {
            source: 'files/report.pdf',
            resourceType: 'file',
            error: 'Not found at files/report.pdf',
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['files/report.pdf'], destination: 'files/Archive/' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Not found')
      expect(mocks.relocateFileVfsItems).toHaveBeenCalledOnce()
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
      mocks.relocateFileVfsItems.mockResolvedValue({
        outcomes: [
          {
            source: 'files/Reports',
            targetSegments: ['Archive', 'Reports 2025'],
            resourceType: 'folder',
            resourceId: 'folder-src',
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['files/Reports'], destination: 'files/Archive/Reports 2025' },
        context
      )

      expect(mocks.relocateFileVfsItems).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            destination: { segments: ['Archive', 'Reports 2025'], trailingSlash: false },
          }),
        })
      )
      expect(result.success).toBe(true)
    })
  })

  describe('workflows', () => {
    it('routes an encoded rename through one bounded workflow VFS command', async () => {
      mocks.moveWorkflowVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'workflows/Old%20Name',
            targetSegments: ['New Name'],
            resourceType: 'workflow',
            resourceId: 'wf-1',
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['workflows/Old%20Name'], destination: 'workflows/New Name' },
        context
      )

      expect(mocks.moveWorkflowVfs).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: expect.objectContaining({
            serviceId: 'copilot',
            workspaceId: 'ws-1',
          }),
          input: {
            workspaceId: 'ws-1',
            sources: [{ source: 'workflows/Old%20Name', segments: ['Old Name'] }],
            destination: { segments: ['New Name'], trailingSlash: false },
          },
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ results: [{ to: 'workflows/New%20Name' }] })
    })

    it('passes a multi-source move to the application once', async () => {
      mocks.moveWorkflowVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'workflows/One',
            targetSegments: ['Archive', 'One'],
            resourceType: 'workflow',
            resourceId: 'wf-1',
          },
          {
            source: 'workflows/Two',
            targetSegments: ['Archive', 'Two'],
            resourceType: 'workflow',
            resourceId: 'wf-2',
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['workflows/One', 'workflows/Two'], destination: 'workflows/Archive/' },
        context
      )

      expect(mocks.moveWorkflowVfs).toHaveBeenCalledOnce()
      expect(result.success).toBe(true)
    })

    it('preserves safe workflow application validation errors', async () => {
      mocks.moveWorkflowVfs.mockRejectedValueOnce(
        new OrchestrationError(
          'validation',
          'With multiple sources the destination must be a folder'
        )
      )

      const result = await executeVfsMv(
        { sources: ['workflows/One', 'workflows/Two'], destination: 'workflows/Renamed' },
        context
      )

      expect(result).toEqual({
        success: false,
        error: 'With multiple sources the destination must be a folder',
      })
    })

    it('surfaces locked-workflow rejections per item', async () => {
      mocks.moveWorkflowVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'workflows/Locked%20One',
            resourceType: 'workflow',
            error: 'Workflow is locked',
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['workflows/Locked%20One'], destination: 'workflows/Renamed' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('locked')
    })

    it('duplicates a workflow with cp (locked source allowed)', async () => {
      mocks.copyWorkflowVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'workflows/Template',
            targetSegments: ['My Copy'],
            resourceType: 'workflow',
            resourceId: 'wf-2',
          },
        ],
      })

      const result = await executeVfsCp(
        { sources: ['workflows/Template'], destination: 'workflows/My Copy' },
        context
      )

      expect(workflowAuthzMockFns.mockAssertWorkflowMutable).not.toHaveBeenCalled()
      expect(mocks.copyWorkflowVfs).toHaveBeenCalledOnce()
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ results: [{ to: 'workflows/My%20Copy', id: 'wf-2' }] })
    })

    it('rejects copying workflow folders', async () => {
      mocks.copyWorkflowVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'workflows/Projects',
            resourceType: 'folder',
            error: 'Workflow folders cannot be copied.',
          },
        ],
      })
      const result = await executeVfsCp(
        { sources: ['workflows/Projects'], destination: 'workflows/Projects Copy' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('cannot be copied')
    })

    it('moves and renames a workflow folder', async () => {
      mocks.moveWorkflowVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'workflows/Q1',
            targetSegments: ['Archive', 'Q1 2026'],
            resourceType: 'folder',
            resourceId: 'fold-1',
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['workflows/Q1'], destination: 'workflows/Archive/Q1 2026' },
        context
      )

      expect(mocks.moveWorkflowVfs).toHaveBeenCalledOnce()
      expect(result.success).toBe(true)
    })

    it('does not expose workflow application infrastructure errors', async () => {
      mocks.moveWorkflowVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'workflows/Old%20Name',
            resourceType: 'workflow',
            error: 'Workflow mutation failed',
          },
        ],
      })

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
      mocks.deleteWorkflowVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'workflows/Old%20Name',
            resourceType: 'workflow',
            resourceId: 'wf-1',
          },
        ],
      })

      const result = await executeVfsRm({ paths: ['workflows/Old%20Name'] }, context)

      expect(result.success).toBe(true)
      expect(mocks.deleteWorkflowVfs).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: expect.objectContaining({
            serviceId: 'copilot',
            workspaceId: 'ws-1',
          }),
          input: {
            workspaceId: 'ws-1',
            paths: [{ source: 'workflows/Old%20Name', segments: ['Old Name'] }],
          },
        })
      )
    })
  })

  describe('mkdir', () => {
    it('creates a nested file folder chain', async () => {
      mocks.createFileVfsFolders.mockResolvedValue({
        outcomes: [
          {
            source: 'files/Reports/2026',
            targetSegments: ['Reports', '2026'],
            resourceType: 'folder',
            resourceId: 'folder-2026',
          },
        ],
      })
      const result = await executeVfsMkdir({ paths: ['files/Reports/2026'] }, context)

      expect(mocks.createFileVfsFolders).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            workspaceId: 'ws-1',
            paths: [{ source: 'files/Reports/2026', segments: ['Reports', '2026'] }],
          },
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ from: 'files/Reports/2026', to: 'files/Reports/2026', kind: 'file_folder' }],
      })
    })

    it('creates a workflow folder through the workflow application operation', async () => {
      mocks.createWorkflowVfsFolders.mockResolvedValue({
        outcomes: [
          {
            source: 'workflows/Project Plans',
            targetSegments: ['Project Plans'],
            resourceType: 'folder',
            resourceId: 'fold-new',
          },
        ],
      })
      const result = await executeVfsMkdir({ paths: ['workflows/Project Plans'] }, context)

      expect(mocks.createWorkflowVfsFolders).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            workspaceId: 'ws-1',
            paths: [{ source: 'workflows/Project Plans', segments: ['Project Plans'] }],
          },
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ to: 'workflows/Project%20Plans', kind: 'workflow_folder', id: 'fold-new' }],
      })
    })

    it('creates table folders through the table application operation', async () => {
      mocks.createTableFolders.mockResolvedValue({
        outcomes: [
          { source: 'tables/CRM', kind: 'folder', resourceId: 'fld-1', targetSegments: ['CRM'] },
        ],
      })

      const result = await executeVfsMkdir({ paths: ['tables/CRM'] }, context)

      expect(mocks.createTableFolders).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            workspaceId: 'ws-1',
            paths: [{ source: 'tables/CRM', segments: ['CRM'] }],
          },
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ from: 'tables/CRM', to: 'tables/CRM', kind: 'table_folder', id: 'fld-1' }],
      })
      expect(mocks.ensureCopilotFileFolderPath).not.toHaveBeenCalled()
    })

    it('rejects the reserved knowledgebases/connectors folder path', async () => {
      const result = await executeVfsMkdir({ paths: ['knowledgebases/connectors/sub'] }, context)
      expect(result.success).toBe(false)
      expect(result.output).toMatchObject({
        results: [
          { from: 'knowledgebases/connectors/sub', error: expect.stringContaining('reserved') },
        ],
      })
      expect(mocks.createKnowledgeFolders).not.toHaveBeenCalled()
    })

    it('rejects creation inside a locked workflow folder', async () => {
      mocks.createWorkflowVfsFolders.mockResolvedValue({
        outcomes: [
          {
            source: 'workflows/Locked/Sub',
            resourceType: 'folder',
            error: 'Folder is locked',
          },
        ],
      })

      const result = await executeVfsMkdir({ paths: ['workflows/Locked/Sub'] }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('locked')
      expect(mocks.createWorkflowVfsFolders).toHaveBeenCalledOnce()
    })
  })

  describe('tables and knowledge bases (foldered)', () => {
    it('renames a table through the transfer application operation', async () => {
      mocks.transferTableVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'tables/Leads',
            kind: 'resource',
            resourceId: 'tbl-1',
            targetSegments: ['Customers'],
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['tables/Leads'], destination: 'tables/Customers' },
        context
      )

      expect(mocks.transferTableVfs).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            workspaceId: 'ws-1',
            sources: [{ source: 'tables/Leads', segments: ['Leads'] }],
            destination: { segments: ['Customers'], trailingSlash: false },
          },
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ results: [{ to: 'tables/Customers', kind: 'table' }] })
    })

    it('moves a table into a folder, folders auto-created server-side', async () => {
      mocks.transferTableVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'tables/Leads',
            kind: 'resource',
            resourceId: 'tbl-1',
            targetSegments: ['CRM', 'Leads'],
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['tables/Leads'], destination: 'tables/CRM/' },
        context
      )

      expect(mocks.transferTableVfs).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            destination: { segments: ['CRM'], trailingSlash: true },
          }),
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ to: 'tables/CRM/Leads', kind: 'table' }],
      })
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
      mocks.transferKnowledgeVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'knowledgebases/Docs',
            kind: 'resource',
            resourceId: 'kb-1',
            targetSegments: ['Product Docs'],
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['knowledgebases/Docs'], destination: 'knowledgebases/Product Docs' },
        context
      )

      expect(mocks.transferKnowledgeVfs).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: expect.objectContaining({
            kind: 'delegated',
            subjectUserId: 'user-1',
            workspaceId: 'ws-1',
            delegationId: 'tool-call-1',
          }),
          input: {
            workspaceId: 'ws-1',
            sources: [{ source: 'knowledgebases/Docs', segments: ['Docs'] }],
            destination: { segments: ['Product Docs'], trailingSlash: false },
          },
        })
      )
      expect(result.success).toBe(true)
    })

    it('propagates knowledge application infrastructure failures', async () => {
      mocks.transferKnowledgeVfs.mockRejectedValueOnce(new Error('knowledge database unavailable'))

      await expect(
        executeVfsMv(
          { sources: ['knowledgebases/Docs'], destination: 'knowledgebases/Product Docs' },
          context
        )
      ).rejects.toThrow('knowledge database unavailable')
    })

    it('preserves an actionable knowledge rename conflict', async () => {
      mocks.transferKnowledgeVfs.mockRejectedValue(
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
      const result = await executeVfsRm({ paths: ['knowledgebases/Docs'] }, context)

      expect(result).toMatchObject({
        success: true,
        output: { results: [{ from: 'knowledgebases/Docs', id: 'kb-1' }] },
      })
      expect(mocks.deleteKnowledgeVfs).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: expect.objectContaining({ delegationId: 'tool-call-1' }),
          input: {
            workspaceId: 'ws-1',
            sourceName: 'Docs',
            sourceSegments: ['Docs'],
          },
        })
      )
    })

    it('moves a whole table folder through the transfer operation', async () => {
      mocks.transferTableVfs.mockResolvedValue({
        outcomes: [
          {
            source: 'tables/CRM',
            kind: 'folder',
            resourceId: 'fld-1',
            targetSegments: ['Archive', 'CRM'],
          },
        ],
      })

      const result = await executeVfsMv(
        { sources: ['tables/CRM'], destination: 'tables/Archive/' },
        context
      )

      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ to: 'tables/Archive/CRM', kind: 'table_folder' }],
      })
    })

    it('rm retargets to the folder cascade when the path is a folder', async () => {
      mocks.deleteTableVfs.mockRejectedValue(
        new OrchestrationError('invalid', 'tables/CRM is a folder; this operation takes a table.')
      )
      mocks.deleteTableFolders.mockResolvedValue({
        outcomes: [{ source: 'tables/CRM', kind: 'folder', resourceId: 'fld-1' }],
      })

      const result = await executeVfsRm({ paths: ['tables/CRM'] }, context)

      expect(mocks.deleteTableFolders).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { workspaceId: 'ws-1', paths: [{ source: 'tables/CRM', segments: ['CRM'] }] },
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ from: 'tables/CRM', kind: 'table_folder', id: 'fld-1' }],
      })
    })

    it('deletes a nested knowledge base by its folder path', async () => {
      const result = await executeVfsRm({ paths: ['knowledgebases/Legal/Contracts'] }, context)

      expect(mocks.deleteKnowledgeVfs).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            workspaceId: 'ws-1',
            sourceName: 'Contracts',
            sourceSegments: ['Legal', 'Contracts'],
          },
        })
      )
      expect(result.success).toBe(true)
    })

    it('preserves an actionable knowledge delete failure', async () => {
      mocks.deleteKnowledgeVfs.mockRejectedValue(
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
