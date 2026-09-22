import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  execute: vi.fn(),
}))
vi.mock('@/lib/copilot/application/execute-file-use-case', () => ({
  resolveCopilotWorkspaceFileReference: mocks.resolve,
  executeCopilotFileUseCase: mocks.execute,
}))
vi.mock('@/lib/workspace-files/application/file-workflows', () => ({
  runFileWorkflow: { operation: { id: 'files.workflows.run' } },
  readFileWorkflow: { operation: { id: 'files.workflows.read' } },
  runSharedFileWorkflowAsMember: { operation: { id: 'files.workflows.run' } },
  readSharedFileWorkflowAsMember: { operation: { id: 'files.workflows.read' } },
}))
vi.mock('@/lib/workspace-files/application/update-workspace-file-metadata', () => ({
  updateWorkspaceFileMetadata: { operation: { id: 'files.update_metadata' } },
}))

import { fileWorkflowServerTool } from '@/lib/copilot/tools/server/files/file-workflow'
import {
  readFileWorkflow,
  runFileWorkflow,
  runSharedFileWorkflowAsMember,
} from '@/lib/workspace-files/application/file-workflows'

const context = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  toolCallId: 'tool-1',
  copilotToolExecution: true,
}

describe('Mothership file workflow tool', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.resolve.mockResolvedValue({ id: 'file-1' })
    mocks.execute.mockResolvedValue({ status: 'completed', output: { count: 7 } })
  })

  it('configures workflow metadata through the file-scoped application operation', async () => {
    const result = await fileWorkflowServerTool.execute(
      { path: 'files/Dashboard.html', action: 'configure', workflowIds: ['workflow-1'] },
      context
    )
    expect(result.success).toBe(true)
    expect(mocks.resolve).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ id: 'files.update_metadata' }),
      {
        workspaceId: 'workspace-1',
        reference: 'files/Dashboard.html',
      }
    )
    expect(mocks.execute).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'files.update_metadata' }),
      }),
      { fileId: 'file-1', assertedWorkspaceId: 'workspace-1', workflowIds: ['workflow-1'] },
      { fileId: 'file-1' }
    )
  })

  it('uses the public-share cache operation only when explicitly requested', async () => {
    const result = await fileWorkflowServerTool.execute(
      { path: 'files/Dashboard.html', action: 'run', workflowId: 'workflow-1', audience: 'share' },
      context
    )
    expect(result.data).toEqual({ status: 'completed', output: { count: 7 } })
    expect(mocks.execute.mock.calls[0][1]).toBe(runSharedFileWorkflowAsMember)
    expect(mocks.execute).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'files.workflows.run' }),
      }),
      {
        fileId: 'file-1',
        assertedWorkspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        input: undefined,
      },
      { fileId: 'file-1' }
    )
  })

  it('defaults to the caller audience and reads without a run operation', async () => {
    await fileWorkflowServerTool.execute(
      { path: 'files/Dashboard.html', action: 'run', workflowId: 'workflow-1' },
      context
    )
    expect(mocks.execute.mock.calls[0][1]).toBe(runFileWorkflow)
    await fileWorkflowServerTool.execute(
      { path: 'files/Dashboard.html', action: 'read', workflowId: 'workflow-1' },
      context
    )
    expect(mocks.execute.mock.calls[1][1]).toBe(readFileWorkflow)
  })

  it('passes the selected input to the shared workflow operation', async () => {
    await fileWorkflowServerTool.execute(
      {
        path: 'files/Dashboard.html',
        action: 'run',
        workflowId: 'workflow-1',
        input: { incidentId: '123' },
      },
      context
    )
    expect(mocks.execute.mock.calls[0][2]).toMatchObject({ input: { incidentId: '123' } })
  })

  it('rejects malformed configure calls before resolving any file', async () => {
    const result = await fileWorkflowServerTool.execute(
      { path: 'files/Dashboard.html', action: 'configure', workflowIds: ['same', 'same'] },
      context
    )
    expect(result.success).toBe(false)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
})
