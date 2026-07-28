import { dbChainMockFns, drizzleOrmMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureWorkspaceFileFolderPath: vi.fn(),
  listWorkspaceFileFolders: vi.fn(),
  getWorkspaceFileByName: vi.fn(),
  uploadWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-folder-manager', () => ({
  ensureWorkspaceFileFolderPath: mocks.ensureWorkspaceFileFolderPath,
  listWorkspaceFileFolders: mocks.listWorkspaceFileFolders,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFileByName: mocks.getWorkspaceFileByName,
  uploadWorkspaceFile: mocks.uploadWorkspaceFile,
}))

import { cleanupWorkflowAliasBacking, ensureWorkflowAliasBacking } from './workflow-alias-backing'

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

  describe('cleanupWorkflowAliasBacking', () => {
    /**
     * Folder paths resolve independently of `deletedAt`, so a live file parented
     * to an archived folder still resolves to a backing path. The archived
     * `.changelogs` folder below therefore has to participate in file ownership
     * while staying out of the set of folders that get archived.
     */
    const folders = [
      { id: 'changelog-live', path: '.changelogs', deletedAt: null },
      { id: 'changelog-archived', path: '.changelogs', deletedAt: new Date() },
      { id: 'plans-wf1', path: '.plans/wf_1', deletedAt: null },
      { id: 'plans-wf1-nested', path: '.plans/wf_1/nested', deletedAt: null },
      { id: 'plans-wf1-archived', path: '.plans/wf_1/old', deletedAt: new Date() },
      { id: 'plans-wf2', path: '.plans/wf_2', deletedAt: null },
      { id: 'unrelated', path: 'documents', deletedAt: null },
    ]

    beforeEach(() => {
      mocks.listWorkspaceFileFolders.mockResolvedValue(folders)
    })

    it('scopes file ownership by folder id, including archived folders', async () => {
      await cleanupWorkflowAliasBacking({ workspaceId: 'workspace-1', workflowId: 'wf_1' })

      const inArrayValues = drizzleOrmMock.inArray.mock.calls.map(([, values]) => values)

      expect(inArrayValues).toContainEqual(['plans-wf1', 'plans-wf1-nested', 'plans-wf1-archived'])
      expect(inArrayValues).toContainEqual(['changelog-live', 'changelog-archived'])
    })

    it('archives only live folders owned by the workflow', async () => {
      await cleanupWorkflowAliasBacking({ workspaceId: 'workspace-1', workflowId: 'wf_1' })

      const inArrayValues = drizzleOrmMock.inArray.mock.calls.map(([, values]) => values)

      expect(inArrayValues).toContainEqual(['plans-wf1', 'plans-wf1-nested'])
      expect(inArrayValues.flat()).not.toContain('plans-wf2')
      expect(inArrayValues.flat()).not.toContain('unrelated')
    })

    it('matches the changelog by the workflow-scoped filename', async () => {
      await cleanupWorkflowAliasBacking({ workspaceId: 'workspace-1', workflowId: 'wf_1' })

      expect(drizzleOrmMock.eq).toHaveBeenCalledWith(expect.anything(), 'wf_1.md')
    })

    it('restricts the update to workspace-context files', async () => {
      await cleanupWorkflowAliasBacking({ workspaceId: 'workspace-1', workflowId: 'wf_1' })

      expect(drizzleOrmMock.eq).toHaveBeenCalledWith(expect.anything(), 'workspace')
    })

    it('still archives the changelog when the workflow has no plans folder', async () => {
      mocks.listWorkspaceFileFolders.mockResolvedValue([
        { id: 'changelog-live', path: '.changelogs', deletedAt: null },
        { id: 'plans-wf2', path: '.plans/wf_2', deletedAt: null },
      ])

      await cleanupWorkflowAliasBacking({ workspaceId: 'workspace-1', workflowId: 'wf_1' })

      const inArrayValues = drizzleOrmMock.inArray.mock.calls.map(([, values]) => values)
      expect(inArrayValues).toContainEqual(['changelog-live'])
      expect(inArrayValues.flat()).not.toContain('plans-wf2')
      expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    })

    /**
     * The decisive guard: `and()` drops `undefined`, so an ownership clause that
     * resolved to nothing would leave a WHERE matching every file in the
     * workspace. No ownership must mean no UPDATE is issued at all.
     */
    it('issues no update at all when the workflow owns no backing folders', async () => {
      mocks.listWorkspaceFileFolders.mockResolvedValue([
        { id: 'unrelated', path: 'documents', deletedAt: null },
      ])

      const result = await cleanupWorkflowAliasBacking({
        workspaceId: 'workspace-1',
        workflowId: 'wf_missing',
      })

      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(drizzleOrmMock.inArray).not.toHaveBeenCalled()
      expect(result).toEqual({ files: 0, folders: 0 })
    })

    it('never archives files belonging to another workflow', async () => {
      await cleanupWorkflowAliasBacking({ workspaceId: 'workspace-1', workflowId: 'wf_1' })

      const inArrayValues = drizzleOrmMock.inArray.mock.calls.flatMap(([, values]) => values)
      expect(inArrayValues).not.toContain('plans-wf2')
    })
  })
})
