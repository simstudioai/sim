/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeCopilotCustomToolUseCase: vi.fn(),
  useCases: {
    deleteAvailable: { operation: { id: 'custom_tools.delete_available' } },
    deleteWorkspace: { operation: { id: 'custom_tools.delete' } },
    listAvailable: { operation: { id: 'custom_tools.list_available' } },
    listWorkspace: { operation: { id: 'custom_tools.list' } },
    saveWorkspace: { operation: { id: 'custom_tools.save' } },
    updateAvailable: { operation: { id: 'custom_tools.update_available' } },
    updateWorkspace: { operation: { id: 'custom_tools.update' } },
  },
}))

vi.mock('@/lib/copilot/application/execute-custom-tool-use-case', () => ({
  executeCopilotCustomToolUseCase: mocks.executeCopilotCustomToolUseCase,
}))
vi.mock('@/lib/custom-tools/application/use-cases', () => ({
  deleteAvailableCustomToolUseCase: mocks.useCases.deleteAvailable,
  deleteWorkspaceCustomToolUseCase: mocks.useCases.deleteWorkspace,
  listAvailableCustomToolsUseCase: mocks.useCases.listAvailable,
  listWorkspaceCustomToolsUseCase: mocks.useCases.listWorkspace,
  saveWorkspaceCustomToolUseCase: mocks.useCases.saveWorkspace,
  updateAvailableCustomToolUseCase: mocks.useCases.updateAvailable,
  updateWorkspaceCustomToolUseCase: mocks.useCases.updateWorkspace,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { executeManageCustomTool } from './manage-custom-tool'

const CREDENTIALLESS_CONTEXT = {
  userId: 'key-owner',
  workflowId: '',
  workspaceId: 'ws-1',
  userPermission: 'admin',
  secretActorUserId: null,
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
}

describe('manage_custom_tool credentialless workspace scope', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists only workspace tools through the authorized application use case', async () => {
    const tools = [{ id: 'tool-1', title: 'Shared tool' }]
    mocks.executeCopilotCustomToolUseCase.mockResolvedValue({ tools })

    const result = await executeManageCustomTool({ operation: 'list' }, CREDENTIALLESS_CONTEXT)

    expect(result).toMatchObject({
      success: true,
      output: { tools, count: 1 },
    })
    expect(mocks.executeCopilotCustomToolUseCase).toHaveBeenCalledWith(
      CREDENTIALLESS_CONTEXT,
      mocks.useCases.listWorkspace,
      { workspaceId: 'ws-1', limit: 100 }
    )
    expect(mocks.executeCopilotCustomToolUseCase).not.toHaveBeenCalledWith(
      expect.anything(),
      mocks.useCases.listAvailable,
      expect.anything()
    )
  })

  it('edits and deletes through workspace-scoped application use cases', async () => {
    const tool = {
      id: 'tool-1',
      title: 'Shared tool',
      schema: { type: 'function', function: { name: 'shared_tool', parameters: {} } },
      code: 'return 1',
    }
    mocks.executeCopilotCustomToolUseCase.mockResolvedValue({ tool })

    const edit = await executeManageCustomTool(
      { operation: 'edit', toolId: 'tool-1', code: 'return 2' },
      CREDENTIALLESS_CONTEXT
    )
    const remove = await executeManageCustomTool(
      { operation: 'delete', toolId: 'tool-1' },
      CREDENTIALLESS_CONTEXT
    )

    expect(edit.success).toBe(true)
    expect(remove.success).toBe(true)
    expect(mocks.executeCopilotCustomToolUseCase).toHaveBeenNthCalledWith(
      1,
      CREDENTIALLESS_CONTEXT,
      mocks.useCases.updateWorkspace,
      expect.objectContaining({ toolId: 'tool-1', workspaceId: 'ws-1', code: 'return 2' })
    )
    expect(mocks.executeCopilotCustomToolUseCase).toHaveBeenNthCalledWith(
      2,
      CREDENTIALLESS_CONTEXT,
      mocks.useCases.deleteWorkspace,
      { toolId: 'tool-1', workspaceId: 'ws-1', source: 'tool_input' }
    )
    expect(mocks.executeCopilotCustomToolUseCase).not.toHaveBeenCalledWith(
      expect.anything(),
      mocks.useCases.updateAvailable,
      expect.anything()
    )
    expect(mocks.executeCopilotCustomToolUseCase).not.toHaveBeenCalledWith(
      expect.anything(),
      mocks.useCases.deleteAvailable,
      expect.anything()
    )
  })
})
