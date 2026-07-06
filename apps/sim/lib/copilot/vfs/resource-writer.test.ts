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
    uploadChatOutput: vi.fn(),
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
  uploadChatOutput: mocks.uploadChatOutput,
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

describe('resource writer outputs/ namespace', () => {
  const baseArgs = {
    workspaceId: 'workspace-1',
    userId: 'user-1',
    buffer: Buffer.from('bytes'),
    inferredMimeType: 'image/png',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue(null)
    mocks.getWorkspaceFileByName.mockResolvedValue(null)
    mocks.findWorkspaceFileFolderIdByPath.mockResolvedValue(null)
  })

  it('rejects outputs/ + overwrite on interactive turns (write-once)', async () => {
    await expect(
      writeWorkspaceFileByPath({
        ...baseArgs,
        chatId: 'chat-1',
        interactive: true,
        target: { path: 'outputs/report.png', mode: 'overwrite' },
      })
    ).rejects.toThrow('outputs/ files are write-once')
    expect(mocks.uploadChatOutput).not.toHaveBeenCalled()
    expect(mocks.updateWorkspaceFileContent).not.toHaveBeenCalled()
  })

  it('rejects outputs/ + overwrite on headless runs too — never clobbers files/<name> via the redirect', async () => {
    // Pre-fix, the headless redirect kept mode:'overwrite' and silently
    // replaced an existing files/report.png. The write-once rejection now
    // runs BEFORE the redirect, regardless of interactivity.
    mocks.resolveWorkspaceFileReference.mockResolvedValue({
      id: 'wf_existing',
      name: 'report.png',
      type: 'image/png',
    })

    await expect(
      writeWorkspaceFileByPath({
        ...baseArgs,
        interactive: false,
        target: { path: 'outputs/report.png', mode: 'overwrite' },
      })
    ).rejects.toThrow('outputs/ files are write-once')
    expect(mocks.updateWorkspaceFileContent).not.toHaveBeenCalled()
    expect(mocks.uploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('writes an interactive outputs/ create as a chat output, threading messageId', async () => {
    mocks.uploadChatOutput.mockResolvedValue({
      id: 'wf_out',
      name: 'report.png',
      size: 5,
      type: 'image/png',
      url: '/serve/report.png',
      key: 'workspace/ws-1/1-report.png',
      context: 'output',
    })

    const result = await writeWorkspaceFileByPath({
      ...baseArgs,
      chatId: 'chat-1',
      interactive: true,
      messageId: 'msg-1',
      target: { path: 'outputs/report.png', mode: 'create' },
    })

    expect(mocks.uploadChatOutput).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1', messageId: 'msg-1', fileName: 'report.png' })
    )
    expect(result).toMatchObject({ id: 'wf_out', vfsPath: 'outputs/report.png', mode: 'create' })
  })

  it('redirects a headless outputs/ create to a files/ create', async () => {
    mocks.uploadWorkspaceFile.mockResolvedValue({
      id: 'wf_redirected',
      name: 'report.png',
      size: 5,
      type: 'image/png',
      url: '/download',
    })

    const result = await writeWorkspaceFileByPath({
      ...baseArgs,
      interactive: false,
      target: { path: 'outputs/report.png', mode: 'create' },
    })

    expect(mocks.uploadChatOutput).not.toHaveBeenCalled()
    expect(mocks.uploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      baseArgs.buffer,
      'report.png',
      'image/png',
      { folderId: null }
    )
    expect(result).toMatchObject({ id: 'wf_redirected', mode: 'create' })
  })
})
