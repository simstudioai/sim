/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureWorkspaceAccess: vi.fn(),
  ensureWorkflowAccess: vi.fn(),
  getDefaultWorkspaceId: vi.fn(),
  assertFolderMutable: vi.fn(),
  assertWorkflowMutable: vi.fn(),
  getWorkspaceFileByName: vi.fn(),
  findWorkspaceFileFolderIdByPath: vi.fn(),
  ensureWorkspaceFileFolderPath: vi.fn(),
  performMoveRenameWorkspaceFile: vi.fn(),
  performUpdateWorkspaceFileFolder: vi.fn(),
  performCreateFolder: vi.fn(),
  performUpdateFolder: vi.fn(),
  performUpdateWorkflow: vi.fn(),
  duplicateWorkflow: vi.fn(),
  listFolders: vi.fn(),
  verifyFolderWorkspace: vi.fn(),
  listTables: vi.fn(),
  renameTable: vi.fn(),
  getKnowledgeBases: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  checkKnowledgeBaseWriteAccess: vi.fn(),
  workflowRows: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mocks.workflowRows()),
      }),
    }),
  },
  workflow: { id: 'id', name: 'name', folderId: 'folderId', workspaceId: 'workspaceId' },
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  assertFolderMutable: mocks.assertFolderMutable,
  assertWorkflowMutable: mocks.assertWorkflowMutable,
}))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkspaceAccess: mocks.ensureWorkspaceAccess,
  ensureWorkflowAccess: mocks.ensureWorkflowAccess,
  getDefaultWorkspaceId: mocks.getDefaultWorkspaceId,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFileByName: mocks.getWorkspaceFileByName,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  findWorkspaceFileFolderIdByPath: mocks.findWorkspaceFileFolderIdByPath,
  ensureWorkspaceFileFolderPath: mocks.ensureWorkspaceFileFolderPath,
  normalizeWorkspaceFileItemName: vi.fn((name: string) => name.trim()),
}))

vi.mock('@/lib/workspace-files/orchestration', () => ({
  performMoveRenameWorkspaceFile: mocks.performMoveRenameWorkspaceFile,
  performUpdateWorkspaceFileFolder: mocks.performUpdateWorkspaceFileFolder,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  performCreateFolder: mocks.performCreateFolder,
  performUpdateFolder: mocks.performUpdateFolder,
  performUpdateWorkflow: mocks.performUpdateWorkflow,
}))

vi.mock('@/lib/workflows/persistence/duplicate', () => ({
  duplicateWorkflow: mocks.duplicateWorkflow,
}))

vi.mock('@/lib/workflows/utils', () => ({
  listFolders: mocks.listFolders,
  verifyFolderWorkspace: mocks.verifyFolderWorkspace,
}))

vi.mock('@/lib/table/service', () => ({
  listTables: mocks.listTables,
  renameTable: mocks.renameTable,
}))

vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBases: mocks.getKnowledgeBases,
  updateKnowledgeBase: mocks.updateKnowledgeBase,
}))

vi.mock('@/app/api/knowledge/utils', () => ({
  checkKnowledgeBaseWriteAccess: mocks.checkKnowledgeBaseWriteAccess,
}))

import type { ExecutionContext } from '@/lib/copilot/request/types'
import { executeVfsCp, executeVfsMkdir, executeVfsMv } from './vfs-mutate'

const context = { userId: 'user-1', workspaceId: 'ws-1' } as ExecutionContext

describe('vfs mv/cp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureWorkspaceAccess.mockResolvedValue(undefined)
    mocks.ensureWorkflowAccess.mockResolvedValue({ workspaceId: 'ws-1', workflow: {} })
    mocks.assertFolderMutable.mockResolvedValue(undefined)
    mocks.assertWorkflowMutable.mockResolvedValue(undefined)
    mocks.verifyFolderWorkspace.mockResolvedValue(true)
    mocks.listFolders.mockResolvedValue([])
    mocks.workflowRows.mockReturnValue([])
    mocks.getWorkspaceFileByName.mockResolvedValue(null)
    mocks.findWorkspaceFileFolderIdByPath.mockResolvedValue(null)
    mocks.ensureWorkspaceFileFolderPath.mockResolvedValue('ensured-folder')
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
      expect(mocks.performMoveRenameWorkspaceFile).not.toHaveBeenCalled()
    })
  })

  describe('files', () => {
    it('moves and renames a file in one call, auto-creating destination folders', async () => {
      mocks.getWorkspaceFileByName.mockResolvedValue({ id: 'file-1', name: 'draft.md' })
      mocks.performMoveRenameWorkspaceFile.mockResolvedValue({
        success: true,
        file: { id: 'file-1', name: 'final.md' },
      })

      const result = await executeVfsMv(
        { sources: ['files/draft.md'], destination: 'files/Reports/2026/final.md' },
        context
      )

      expect(mocks.getWorkspaceFileByName).toHaveBeenCalledWith('ws-1', 'draft.md', {
        folderId: null,
      })
      expect(mocks.ensureWorkspaceFileFolderPath).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        userId: 'user-1',
        pathSegments: ['Reports', '2026'],
      })
      expect(mocks.performMoveRenameWorkspaceFile).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        userId: 'user-1',
        fileId: 'file-1',
        targetFolderId: 'ensured-folder',
        newName: 'final.md',
      })
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ from: 'files/draft.md', to: 'files/Reports/2026/final.md', kind: 'file' }],
      })
    })

    it('moves into an existing folder keeping the name without creating anything', async () => {
      mocks.findWorkspaceFileFolderIdByPath.mockResolvedValue('folder-images')
      mocks.getWorkspaceFileByName.mockResolvedValue({ id: 'file-1', name: 'a.png' })
      mocks.performMoveRenameWorkspaceFile.mockResolvedValue({
        success: true,
        file: { id: 'file-1', name: 'a.png' },
      })

      const result = await executeVfsMv(
        { sources: ['files/a.png'], destination: 'files/Images' },
        context
      )

      expect(mocks.performMoveRenameWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({ targetFolderId: 'folder-images', newName: 'a.png' })
      )
      expect(mocks.ensureWorkspaceFileFolderPath).not.toHaveBeenCalled()
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
      expect(mocks.performMoveRenameWorkspaceFile).not.toHaveBeenCalled()
      expect(mocks.ensureWorkspaceFileFolderPath).not.toHaveBeenCalled()
    })

    it('rejects copying workspace files — cp is workflows-only', async () => {
      mocks.getWorkspaceFileByName.mockResolvedValue({ id: 'file-1', name: 'template.md' })

      const result = await executeVfsCp(
        { sources: ['files/template.md'], destination: 'files/Reports/january.md' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('cp only duplicates workflows')
      expect(mocks.ensureWorkspaceFileFolderPath).not.toHaveBeenCalled()
    })

    it('moves and renames a file folder via performUpdateWorkspaceFileFolder', async () => {
      mocks.findWorkspaceFileFolderIdByPath
        .mockResolvedValueOnce(null) // destination is not an existing folder
        .mockResolvedValueOnce('folder-src') // source resolves as folder
      mocks.performUpdateWorkspaceFileFolder.mockResolvedValue({
        success: true,
        folder: { name: 'Reports 2025' },
      })

      const result = await executeVfsMv(
        { sources: ['files/Reports'], destination: 'files/Archive/Reports 2025' },
        context
      )

      expect(mocks.performUpdateWorkspaceFileFolder).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        folderId: 'folder-src',
        userId: 'user-1',
        name: 'Reports 2025',
        parentId: 'ensured-folder',
      })
      expect(result.success).toBe(true)
    })

    it('rejects reserved alias backing paths', async () => {
      const result = await executeVfsMv(
        { sources: ['files/.plans/wf_1/launch.md'], destination: 'files/launch.md' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Reserved system paths')
    })
  })

  describe('workflows', () => {
    it('renames a workflow at root', async () => {
      mocks.workflowRows.mockReturnValue([{ id: 'wf-1', name: 'Old Name', folderId: null }])
      mocks.performUpdateWorkflow.mockResolvedValue({ success: true })

      const result = await executeVfsMv(
        { sources: ['workflows/Old%20Name'], destination: 'workflows/New Name' },
        context
      )

      expect(mocks.assertWorkflowMutable).toHaveBeenCalledWith('wf-1')
      expect(mocks.performUpdateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'wf-1', name: 'New Name', folderId: null })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ results: [{ to: 'workflows/New%20Name' }] })
    })

    it('moves a workflow into an existing folder keeping its name', async () => {
      mocks.listFolders.mockResolvedValue([
        { folderId: 'fold-1', folderName: 'Archive', parentId: null },
      ])
      mocks.workflowRows.mockReturnValue([{ id: 'wf-1', name: 'My Workflow', folderId: null }])
      mocks.performUpdateWorkflow.mockResolvedValue({ success: true })

      const result = await executeVfsMv(
        { sources: ['workflows/My%20Workflow'], destination: 'workflows/Archive' },
        context
      )

      expect(mocks.assertFolderMutable).toHaveBeenCalledWith('fold-1')
      expect(mocks.performUpdateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'wf-1', name: undefined, folderId: 'fold-1' })
      )
      expect(result.success).toBe(true)
    })

    it('surfaces locked-workflow rejections per item', async () => {
      mocks.workflowRows.mockReturnValue([{ id: 'wf-1', name: 'Locked One', folderId: null }])
      mocks.assertWorkflowMutable.mockRejectedValue(new Error('Workflow is locked'))

      const result = await executeVfsMv(
        { sources: ['workflows/Locked%20One'], destination: 'workflows/Renamed' },
        context
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('locked')
    })

    it('duplicates a workflow with cp (locked source allowed)', async () => {
      mocks.workflowRows.mockReturnValue([{ id: 'wf-1', name: 'Template', folderId: null }])
      mocks.duplicateWorkflow.mockResolvedValue({ id: 'wf-2', name: 'My Copy' })

      const result = await executeVfsCp(
        { sources: ['workflows/Template'], destination: 'workflows/My Copy' },
        context
      )

      expect(mocks.assertWorkflowMutable).not.toHaveBeenCalled()
      expect(mocks.duplicateWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceWorkflowId: 'wf-1',
          workspaceId: 'ws-1',
          folderId: null,
          name: 'My Copy',
        })
      )
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ results: [{ to: 'workflows/My%20Copy', id: 'wf-2' }] })
    })

    it('rejects copying workflow folders', async () => {
      mocks.listFolders.mockResolvedValue([
        { folderId: 'fold-1', folderName: 'Projects', parentId: null },
      ])
      const result = await executeVfsCp(
        { sources: ['workflows/Projects'], destination: 'workflows/Projects Copy' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('cannot be copied')
    })

    it('moves and renames a workflow folder', async () => {
      mocks.listFolders.mockResolvedValue([
        { folderId: 'fold-1', folderName: 'Q1', parentId: null },
        { folderId: 'fold-2', folderName: 'Archive', parentId: null },
      ])
      mocks.performUpdateFolder.mockResolvedValue({ success: true })

      const result = await executeVfsMv(
        { sources: ['workflows/Q1'], destination: 'workflows/Archive/Q1 2026' },
        context
      )

      expect(mocks.performUpdateFolder).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: 'fold-1', name: 'Q1 2026', parentId: 'fold-2' })
      )
      expect(result.success).toBe(true)
    })
  })

  describe('mkdir', () => {
    it('creates a nested file folder chain', async () => {
      const result = await executeVfsMkdir({ paths: ['files/Reports/2026'] }, context)

      expect(mocks.ensureWorkspaceFileFolderPath).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        userId: 'user-1',
        pathSegments: ['Reports', '2026'],
      })
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ from: 'files/Reports/2026', to: 'files/Reports/2026', kind: 'file_folder' }],
      })
    })

    it('creates a workflow folder via performCreateFolder', async () => {
      mocks.listFolders.mockResolvedValue([])
      mocks.performCreateFolder.mockResolvedValue({ success: true, folder: { id: 'fold-new' } })

      const result = await executeVfsMkdir({ paths: ['workflows/Archive'] }, context)

      expect(mocks.performCreateFolder).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        userId: 'user-1',
        name: 'Archive',
        parentId: undefined,
      })
      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({
        results: [{ to: 'workflows/Archive', kind: 'workflow_folder', id: 'fold-new' }],
      })
    })

    it('rejects flat namespaces and reserved paths', async () => {
      const result = await executeVfsMkdir({ paths: ['tables/CRM', 'files/.plans/wf_1'] }, context)
      expect(result.success).toBe(false)
      expect(result.output).toMatchObject({
        results: [
          { from: 'tables/CRM', error: expect.stringContaining('flat namespace') },
          { from: 'files/.plans/wf_1', error: expect.stringContaining('Reserved') },
        ],
      })
      expect(mocks.ensureWorkspaceFileFolderPath).not.toHaveBeenCalled()
    })

    it('rejects creation inside a locked workflow folder', async () => {
      mocks.listFolders.mockResolvedValue([])
      mocks.assertFolderMutable.mockRejectedValue(new Error('Folder is locked'))

      const result = await executeVfsMkdir({ paths: ['workflows/Locked/Sub'] }, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('locked')
      expect(mocks.performCreateFolder).not.toHaveBeenCalled()
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

    it('renames a knowledge base after a write-access check', async () => {
      mocks.getKnowledgeBases.mockResolvedValue([{ id: 'kb-1', name: 'Docs' }])
      mocks.checkKnowledgeBaseWriteAccess.mockResolvedValue({ hasAccess: true })
      mocks.updateKnowledgeBase.mockResolvedValue({ id: 'kb-1', name: 'Product Docs' })

      const result = await executeVfsMv(
        { sources: ['knowledgebases/Docs'], destination: 'knowledgebases/Product Docs' },
        context
      )

      expect(mocks.checkKnowledgeBaseWriteAccess).toHaveBeenCalledWith('kb-1', 'user-1')
      expect(mocks.updateKnowledgeBase).toHaveBeenCalledWith(
        'kb-1',
        { name: 'Product Docs' },
        expect.any(String)
      )
      expect(result.success).toBe(true)
    })

    it('rejects the reserved knowledgebases/connectors name', async () => {
      const result = await executeVfsMv(
        { sources: ['knowledgebases/Docs'], destination: 'knowledgebases/connectors' },
        context
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('reserved')
    })
  })
})
