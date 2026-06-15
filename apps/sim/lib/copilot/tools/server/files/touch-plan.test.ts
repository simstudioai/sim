import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureWorkspaceAccess: vi.fn(),
  resolveWorkflowAliasForWorkspace: vi.fn(),
  writeWorkspaceFileByPath: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/handlers/access', () => ({
  ensureWorkspaceAccess: mocks.ensureWorkspaceAccess,
}))

vi.mock('@/lib/copilot/vfs/workflow-alias-resolver', () => ({
  resolveWorkflowAliasForWorkspace: mocks.resolveWorkflowAliasForWorkspace,
}))

vi.mock('@/lib/copilot/vfs/resource-writer', () => ({
  writeWorkspaceFileByPath: mocks.writeWorkspaceFileByPath,
}))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isMothershipBetaFeaturesEnabled: true,
}))

import { touchPlanServerTool } from './touch-plan'

describe('touch_plan server tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureWorkspaceAccess.mockResolvedValue(undefined)
  })

  it('creates a workflow-local plan alias and returns backing metadata', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue({
      kind: 'plan_file',
      scope: 'workflow',
      workflowId: 'wf_1',
      workflowName: 'My Workflow',
      workflowPath: 'workflows/My%20Workflow',
      aliasPath: 'workflows/My%20Workflow/.plans/implementation.md',
      backingPath: 'files/.plans/wf_1/implementation.md',
      backingFolderPath: 'files/.plans/wf_1',
      planRelativePath: 'implementation.md',
    })
    mocks.writeWorkspaceFileByPath.mockResolvedValue({
      id: 'file-plan',
      name: 'implementation.md',
      vfsPath: 'workflows/My%20Workflow/.plans/implementation.md',
      backingVfsPath: 'files/.plans/wf_1/implementation.md',
    })

    const result = await touchPlanServerTool.execute(
      { workflowPath: 'workflows/My Workflow', name: 'implementation' },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(mocks.resolveWorkflowAliasForWorkspace).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      path: 'workflows/My%20Workflow/.plans/implementation.md',
    })
    expect(mocks.writeWorkspaceFileByPath).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: 'workflows/My%20Workflow/.plans/implementation.md',
        mode: 'create',
        mimeType: 'text/markdown',
      },
      buffer: Buffer.from('', 'utf-8'),
      inferredMimeType: 'text/markdown',
    })
    expect(result).toMatchObject({
      success: true,
      data: {
        id: 'file-plan',
        scope: 'workflow',
        vfsPath: 'workflows/My%20Workflow/.plans/implementation.md',
        backingVfsPath: 'files/.plans/wf_1/implementation.md',
        workflowId: 'wf_1',
      },
    })
  })

  it('creates a workspace root plan alias and returns backing metadata', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue({
      kind: 'plan_file',
      scope: 'workspace',
      aliasPath: '.plans/migration.md',
      backingPath: 'files/.plans/workspace/migration.md',
      backingFolderPath: 'files/.plans/workspace',
      planRelativePath: 'migration.md',
    })
    mocks.writeWorkspaceFileByPath.mockResolvedValue({
      id: 'file-root-plan',
      name: 'migration.md',
      vfsPath: '.plans/migration.md',
      backingVfsPath: 'files/.plans/workspace/migration.md',
    })

    const result = await touchPlanServerTool.execute(
      { scope: 'workspace', name: 'migration' },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(mocks.resolveWorkflowAliasForWorkspace).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      path: '.plans/migration.md',
    })
    expect(mocks.writeWorkspaceFileByPath).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      target: {
        path: '.plans/migration.md',
        mode: 'create',
        mimeType: 'text/markdown',
      },
      buffer: Buffer.from('', 'utf-8'),
      inferredMimeType: 'text/markdown',
    })
    expect(result).toMatchObject({
      success: true,
      data: {
        id: 'file-root-plan',
        scope: 'workspace',
        vfsPath: '.plans/migration.md',
        backingVfsPath: 'files/.plans/workspace/migration.md',
      },
    })
  })

  it('rejects missing workflows before writing', async () => {
    mocks.resolveWorkflowAliasForWorkspace.mockResolvedValue(null)

    const result = await touchPlanServerTool.execute(
      { workflowPath: 'workflows/Missing', name: 'implementation.md' },
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )

    expect(result.success).toBe(false)
    expect(result.message).toContain('Workflow not found')
    expect(mocks.writeWorkspaceFileByPath).not.toHaveBeenCalled()
  })
})
