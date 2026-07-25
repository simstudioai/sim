import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class FileConflictError extends Error {
    readonly code = 'FILE_EXISTS' as const
  }

  return {
    FileConflictError,
    ensureWorkflowAliasBacking: vi.fn(),
    ensureWorkspacePlanBacking: vi.fn(),
    resolveWorkflowAliasForWorkspace: vi.fn(),
    ensureWorkspaceFileFolderPath: vi.fn(),
    findWorkspaceFileFolderIdByPath: vi.fn(),
    normalizeWorkspaceFileItemName: vi.fn((name: string) => name.trim()),
    getWorkspaceFileByName: vi.fn(),
    resolveWorkspaceFileReference: vi.fn(),
    updateWorkspaceFileContent: vi.fn(),
    uploadWorkspaceFile: vi.fn(),
  }
})

vi.mock('@/lib/copilot/vfs/workflow-alias-backing', () => ({
  ensureWorkflowAliasBacking: mocks.ensureWorkflowAliasBacking,
  ensureWorkspacePlanBacking: mocks.ensureWorkspacePlanBacking,
}))

vi.mock('@/lib/copilot/vfs/workflow-alias-resolver', () => ({
  resolveWorkflowAliasForWorkspace: mocks.resolveWorkflowAliasForWorkspace,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  ensureWorkspaceFileFolderPath: mocks.ensureWorkspaceFileFolderPath,
  findWorkspaceFileFolderIdByPath: mocks.findWorkspaceFileFolderIdByPath,
  normalizeWorkspaceFileItemName: mocks.normalizeWorkspaceFileItemName,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  FileConflictError: mocks.FileConflictError,
  getWorkspaceFileByName: mocks.getWorkspaceFileByName,
  resolveWorkspaceFileReference: mocks.resolveWorkspaceFileReference,
  updateWorkspaceFileContent: mocks.updateWorkspaceFileContent,
  uploadWorkspaceFile: mocks.uploadWorkspaceFile,
}))

import { validateWorkspaceFileWriteTarget, writeWorkspaceFileByPath } from './resource-writer'

describe('resource writer workflow aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureWorkflowAliasBacking.mockResolvedValue({})
    mocks.ensureWorkspacePlanBacking.mockResolvedValue({})
    mocks.ensureWorkspaceFileFolderPath.mockResolvedValue('folder-id')
  })

  it('creates workflow plan aliases through backing workspace files', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue({
      kind: 'plan_file',
      scope: 'workflow',
      workflowId: 'wf_1',
      workflowName: 'My Workflow',
      workflowPath: 'workflows/My%20Workflow',
      aliasPath: 'workflows/My%20Workflow/.plans/launch.md',
      backingPath: 'files/.plans/wf_1/launch.md',
      backingFolderPath: 'files/.plans/wf_1',
      planRelativePath: 'launch.md',
    })
    mocks.getWorkspaceFileByName.mockResolvedValue(null)
    mocks.uploadWorkspaceFile.mockResolvedValue({
      id: 'file-plan',
      name: 'launch.md',
      size: 7,
      type: 'text/markdown',
      url: '/download',
    })

    const result = await writeWorkspaceFileByPath({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'workflows/My%20Workflow/.plans/launch.md',
        mode: 'create',
      },
      buffer: Buffer.from('content'),
      inferredMimeType: 'text/markdown',
    })

    expect(mocks.uploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('content'),
      'launch.md',
      'text/markdown',
      { folderId: 'folder-id', exactName: true }
    )
    expect(result).toMatchObject({
      id: 'file-plan',
      vfsPath: 'workflows/My%20Workflow/.plans/launch.md',
      backingVfsPath: 'files/.plans/wf_1/launch.md',
      mode: 'create',
    })
  })

  it('overwrites workflow changelog aliases through backing workspace files', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue({
      kind: 'changelog',
      scope: 'workflow',
      workflowId: 'wf_1',
      workflowName: 'My Workflow',
      workflowPath: 'workflows/My%20Workflow',
      aliasPath: 'workflows/My%20Workflow/changelog.md',
      backingPath: 'files/.changelogs/wf_1.md',
      backingFolderPath: 'files/.changelogs',
    })
    mocks.getWorkspaceFileByName.mockResolvedValue({
      id: 'file-changelog',
      name: 'wf_1.md',
      type: 'text/markdown',
      folderPath: '.changelogs',
    })
    mocks.updateWorkspaceFileContent.mockResolvedValue({
      id: 'file-changelog',
      name: 'wf_1.md',
      size: 7,
      type: 'text/markdown',
      url: '/download',
      folderPath: '.changelogs',
    })

    const result = await writeWorkspaceFileByPath({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'workflows/My%20Workflow/changelog.md',
        mode: 'overwrite',
      },
      buffer: Buffer.from('updated'),
      inferredMimeType: 'text/markdown',
    })

    expect(mocks.updateWorkspaceFileContent).toHaveBeenCalledWith(
      'workspace-1',
      'file-changelog',
      'user-1',
      Buffer.from('updated'),
      'text/markdown'
    )
    expect(result).toMatchObject({
      id: 'file-changelog',
      vfsPath: 'workflows/My%20Workflow/changelog.md',
      backingVfsPath: 'files/.changelogs/wf_1.md',
      mode: 'overwrite',
    })
  })

  it('creates root workspace plan aliases through workspace backing files', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue({
      kind: 'plan_file',
      scope: 'workspace',
      aliasPath: '.plans/root.md',
      backingPath: 'files/.plans/workspace/root.md',
      backingFolderPath: 'files/.plans/workspace',
      planRelativePath: 'root.md',
    })
    mocks.getWorkspaceFileByName.mockResolvedValue(null)
    mocks.uploadWorkspaceFile.mockResolvedValue({
      id: 'file-root-plan',
      name: 'root.md',
      size: 7,
      type: 'text/markdown',
      url: '/download',
    })

    const result = await writeWorkspaceFileByPath({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: '.plans/root.md',
        mode: 'create',
      },
      buffer: Buffer.from('content'),
      inferredMimeType: 'text/markdown',
    })

    expect(mocks.ensureWorkspacePlanBacking).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
    expect(mocks.ensureWorkspaceFileFolderPath).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      pathSegments: ['.plans', 'workspace'],
    })
    expect(result).toMatchObject({
      id: 'file-root-plan',
      vfsPath: '.plans/root.md',
      backingVfsPath: 'files/.plans/workspace/root.md',
      mode: 'create',
    })
  })

  it('rejects direct writes to reserved workflow alias backing paths', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue(null)

    await expect(
      writeWorkspaceFileByPath({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        target: {
          path: 'files/.plans/wf_1/launch.md',
          mode: 'create',
        },
        buffer: Buffer.from('content'),
        inferredMimeType: 'text/markdown',
      })
    ).rejects.toThrow(
      'Reserved workflow alias backing paths must be accessed through their alias path'
    )

    expect(mocks.uploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('rejects validation of reserved workflow alias backing paths', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue(null)

    await expect(
      validateWorkspaceFileWriteTarget({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        target: {
          path: 'files/.changelogs/wf_1.md',
          mode: 'overwrite',
        },
      })
    ).rejects.toThrow(
      'Reserved workflow alias backing paths must be accessed through their alias path'
    )

    expect(mocks.resolveWorkspaceFileReference).not.toHaveBeenCalled()
  })

  it('uses exact-name creates for alias backing files', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue({
      kind: 'plan_file',
      scope: 'workflow',
      workflowId: 'wf_1',
      workflowName: 'My Workflow',
      workflowPath: 'workflows/My%20Workflow',
      aliasPath: 'workflows/My%20Workflow/.plans/launch.md',
      backingPath: 'files/.plans/wf_1/launch.md',
      backingFolderPath: 'files/.plans/wf_1',
      planRelativePath: 'launch.md',
    })
    mocks.getWorkspaceFileByName.mockResolvedValue(null)
    mocks.uploadWorkspaceFile.mockResolvedValue({
      id: 'file-plan',
      name: 'launch.md',
      size: 7,
      type: 'text/markdown',
      url: '/download',
    })

    await writeWorkspaceFileByPath({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'workflows/My%20Workflow/.plans/launch.md',
        mode: 'create',
      },
      buffer: Buffer.from('content'),
      inferredMimeType: 'text/markdown',
    })

    expect(mocks.uploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('content'),
      'launch.md',
      'text/markdown',
      { folderId: 'folder-id', exactName: true }
    )
  })

  it('auto-creates missing parent folders for plain workspace file creates', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue(null)
    mocks.ensureWorkspaceFileFolderPath.mockResolvedValue('folder-nested')
    mocks.getWorkspaceFileByName.mockResolvedValue(null)
    mocks.uploadWorkspaceFile.mockResolvedValue({
      id: 'file-report',
      name: 'summary.csv',
      size: 7,
      type: 'text/csv',
      url: '/download',
    })

    const result = await writeWorkspaceFileByPath({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'files/Reports/2026/summary.csv',
        mode: 'create',
      },
      buffer: Buffer.from('content'),
      inferredMimeType: 'text/csv',
    })

    expect(mocks.ensureWorkspaceFileFolderPath).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      pathSegments: ['Reports', '2026'],
    })
    expect(mocks.findWorkspaceFileFolderIdByPath).not.toHaveBeenCalled()
    expect(mocks.uploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('content'),
      'summary.csv',
      'text/csv',
      { folderId: 'folder-nested' }
    )
    expect(result).toMatchObject({
      id: 'file-report',
      vfsPath: 'files/Reports/2026/summary.csv',
      mode: 'create',
    })
  })

  it('validates create targets read-only, resolving existing parent folders without creating', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue(null)
    mocks.findWorkspaceFileFolderIdByPath.mockResolvedValue('folder-nested')
    mocks.getWorkspaceFileByName.mockResolvedValue(null)

    const validation = await validateWorkspaceFileWriteTarget({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'files/Reports/2026/summary.csv',
        mode: 'create',
      },
    })

    expect(mocks.ensureWorkspaceFileFolderPath).not.toHaveBeenCalled()
    expect(validation).toMatchObject({
      mode: 'create',
      vfsPath: 'files/Reports/2026/summary.csv',
      fileName: 'summary.csv',
      folderId: 'folder-nested',
    })
  })

  it('accepts create targets with missing parent folders during validation without creating them', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue(null)
    mocks.findWorkspaceFileFolderIdByPath.mockResolvedValue(null)

    const validation = await validateWorkspaceFileWriteTarget({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'files/Reports/2026/summary.csv',
        mode: 'create',
      },
    })

    expect(mocks.ensureWorkspaceFileFolderPath).not.toHaveBeenCalled()
    expect(mocks.getWorkspaceFileByName).not.toHaveBeenCalled()
    expect(validation).toMatchObject({
      mode: 'create',
      vfsPath: 'files/Reports/2026/summary.csv',
      fileName: 'summary.csv',
      folderId: null,
    })
  })

  it('reports alias path when exact-name alias backing creation conflicts', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue({
      kind: 'plan_file',
      scope: 'workflow',
      workflowId: 'wf_1',
      workflowName: 'My Workflow',
      workflowPath: 'workflows/My%20Workflow',
      aliasPath: 'workflows/My%20Workflow/.plans/launch.md',
      backingPath: 'files/.plans/wf_1/launch.md',
      backingFolderPath: 'files/.plans/wf_1',
      planRelativePath: 'launch.md',
    })
    mocks.getWorkspaceFileByName.mockResolvedValue(null)
    mocks.uploadWorkspaceFile.mockRejectedValue(new mocks.FileConflictError('launch.md'))

    await expect(
      writeWorkspaceFileByPath({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        target: {
          path: 'workflows/My%20Workflow/.plans/launch.md',
          mode: 'create',
        },
        buffer: Buffer.from('content'),
        inferredMimeType: 'text/markdown',
      })
    ).rejects.toThrow(
      'File already exists at workflows/My%20Workflow/.plans/launch.md. Use mode "overwrite" to update it.'
    )
  })
})
