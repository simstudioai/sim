import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: vi.fn(),
  getWorkspaceFileByName: vi.fn(),
  listWorkspaceFiles: vi.fn(),
  uploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  ensureWorkspaceFileFolderPath: mocks.ensureWorkspaceFileFolderPath,
  listWorkspaceFileFolders: mocks.listWorkspaceFileFolders,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFileByName: mocks.getWorkspaceFileByName,
  listWorkspaceFiles: mocks.listWorkspaceFiles,
  uploadWorkspaceFile: mocks.uploadWorkspaceFile,
}))

import { ensureWorkflowAliasBacking } from './workflow-alias-backing'

describe('workflow alias backing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureWorkspaceFileFolderPath.mockImplementation(({ pathSegments }) =>
      Promise.resolve(`folder:${pathSegments.join('/')}`)
    )
  })

  it('provisions reserved folders and creates a headed changelog when missing', async () => {
    mocks.getWorkspaceFileByName
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'file-1', name: 'wf_1.md' })

    const result = await ensureWorkflowAliasBacking({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      workflowId: 'wf_1',
      workflowName: 'My Workflow',
    })

    expect(mocks.ensureWorkspaceFileFolderPath).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      pathSegments: ['.changelogs'],
    })
    expect(mocks.ensureWorkspaceFileFolderPath).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      pathSegments: ['.plans', 'wf_1'],
    })
    expect(mocks.ensureWorkspaceFileFolderPath).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      pathSegments: ['.plans', 'workspace'],
    })
    expect(mocks.uploadWorkspaceFile).toHaveBeenCalledWith(
      'workspace-1',
      'user-1',
      Buffer.from('# My Workflow Changelog\n', 'utf-8'),
      'wf_1.md',
      'text/markdown',
      { folderId: 'folder:.changelogs' }
    )
    expect(result.changelogFile).toMatchObject({ id: 'file-1' })
  })

  it('reuses an existing changelog backing file', async () => {
    mocks.getWorkspaceFileByName.mockResolvedValueOnce({ id: 'file-existing', name: 'wf_2.md' })

    const result = await ensureWorkflowAliasBacking({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      workflowId: 'wf_2',
    })

    expect(mocks.uploadWorkspaceFile).not.toHaveBeenCalled()
    expect(result.changelogFile).toMatchObject({ id: 'file-existing' })
  })
})
