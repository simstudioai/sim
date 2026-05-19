/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeAppTool } = vi.hoisted(() => ({
  executeAppTool: vi.fn(),
}))

vi.mock('@/tools', () => ({
  executeTool: executeAppTool,
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: vi.fn(),
  queryRows: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: vi.fn(),
  findWorkspaceFileRecord: vi.fn(),
  getSandboxWorkspaceFilePath: vi.fn(),
  listWorkspaceFiles: vi.fn(),
}))

import { executeFunctionExecute } from './function-execute'

describe('executeFunctionExecute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeAppTool.mockResolvedValue({ success: true, output: { result: 'ok' } })
  })

  it('passes the Mothership sandbox flag for Mothership function execution', async () => {
    await executeFunctionExecute(
      { code: 'return 1' },
      {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        copilotToolExecution: true,
        mothershipToolExecution: true,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        _context: expect.objectContaining({
          copilotToolExecution: true,
          useMothershipSandbox: true,
        }),
      })
    )
  })

  it('does not mark workflow function execution for the Mothership sandbox', async () => {
    await executeFunctionExecute(
      { code: 'return 1' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        workspaceId: 'ws-1',
        copilotToolExecution: true,
      }
    )

    expect(executeAppTool).toHaveBeenCalledWith(
      'function_execute',
      expect.objectContaining({
        _context: expect.objectContaining({
          useMothershipSandbox: undefined,
        }),
      })
    )
  })
})
