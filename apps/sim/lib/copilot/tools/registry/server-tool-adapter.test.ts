/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_RESULT_UNAVAILABLE_ERROR } from '@/lib/copilot/request/tools/resolved-secret-result'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  routeExecution: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mocks.loggerError }),
}))

vi.mock('@/lib/copilot/tools/server/router', () => ({ routeExecution: mocks.routeExecution }))

import { createServerToolHandler } from '@/lib/copilot/tools/registry/server-tool-adapter'

describe('server tool adapter authority boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.routeExecution.mockResolvedValue({ success: true })
  })

  it('overwrites model-supplied workspace scope and forwards trusted delegation context', async () => {
    const handler = createServerToolHandler('prepare_file_edit')

    await handler(
      { workspaceId: 'attacker-workspace', operation: 'rename' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        toolCallId: 'tool-call-1',
        copilotToolExecution: true,
      }
    )

    expect(mocks.routeExecution).toHaveBeenCalledWith(
      'prepare_file_edit',
      expect.objectContaining({ workspaceId: 'workspace-1', operation: 'rename' }),
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-1',
        toolCallId: 'tool-call-1',
        copilotToolExecution: true,
      })
    )
  })

  it('logs unexpected failures in full and returns only a generic system message', async () => {
    const storageError = new Error('update workspace_files set secret_column = value')
    mocks.routeExecution.mockRejectedValue(storageError)

    const result = await createServerToolHandler('prepare_file_edit')(
      {},
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        toolCallId: 'tool-call-1',
        copilotToolExecution: true,
      }
    )

    expect(result).toEqual({
      success: false,
      error: `[prepare_file_edit] ${TOOL_RESULT_UNAVAILABLE_ERROR}`,
    })
    expect(result.error).not.toContain('workspace_files')
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Server tool execution failed',
      {
        toolId: 'prepare_file_edit',
        abortSignalAborted: false,
      },
      storageError
    )
  })
})
