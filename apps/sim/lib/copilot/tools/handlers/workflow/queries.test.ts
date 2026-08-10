import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const { executeCustomToolUseCaseMock, executeMcpServerUseCaseMock, executeWorkflowUseCaseMock } =
  vi.hoisted(() => ({
    executeCustomToolUseCaseMock: vi.fn(),
    executeMcpServerUseCaseMock: vi.fn(),
    executeWorkflowUseCaseMock: vi.fn(),
  }))

vi.mock('@/lib/copilot/application/execute-custom-tool-use-case', () => ({
  executeCopilotCustomToolUseCase: executeCustomToolUseCaseMock,
}))

vi.mock('@/lib/copilot/application/execute-mcp-server-use-case', () => ({
  executeCopilotMcpServerUseCase: executeMcpServerUseCaseMock,
}))

vi.mock('@/lib/copilot/application/execute-workflow-use-case', () => ({
  executeCopilotWorkflowUseCase: executeWorkflowUseCaseMock,
  messageForCopilotWorkflowError: (error: unknown) =>
    getErrorMessage(error, 'Workflow operation failed'),
}))

import { executeGetBlockOutputs, executeGetWorkflowData } from './queries'

describe('executeGetBlockOutputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns display outputs and block-relative outputs for chat deployment', async () => {
    const applicationResult = {
      blocks: [
        {
          blockId: 'agent-1',
          blockName: 'Support Agent',
          blockType: 'agent',
          outputs: ['supportagent.content'],
          relativeOutputs: ['content'],
          triggerMode: undefined,
        },
        {
          blockId: 'loop-1',
          blockName: 'Items Loop',
          blockType: 'loop',
          outputs: [],
          relativeOutputs: [],
          insideSubflowOutputs: ['itemsloop.index', 'itemsloop.currentItem', 'itemsloop.items'],
          outsideSubflowOutputs: ['itemsloop.results'],
          relativeInsideSubflowOutputs: ['index', 'currentItem', 'items'],
          relativeOutsideSubflowOutputs: ['results'],
          triggerMode: undefined,
        },
      ],
      variables: [],
    }
    executeWorkflowUseCaseMock.mockResolvedValue(applicationResult)

    const result = await executeGetBlockOutputs({ blockIds: ['agent-1', 'loop-1'] }, {
      workflowId: 'wf-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      toolCallId: 'tool-1',
      copilotToolExecution: true,
    } as ExecutionContext)

    expect(result.success).toBe(true)
    expect(result.output).toEqual(applicationResult)
    expect(executeWorkflowUseCaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'wf-1', workspaceId: 'ws-1' }),
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'workflows.copilot.block_outputs.read' }),
      }),
      {
        workflowId: 'wf-1',
        assertedWorkspaceId: 'ws-1',
        blockIds: ['agent-1', 'loop-1'],
      }
    )
  })

  it('lists only workspace custom tools for a credentialless context', async () => {
    executeCustomToolUseCaseMock.mockResolvedValue({
      tools: [
        {
          id: 'tool-workspace',
          title: 'Workspace tool',
          schema: { function: { name: 'workspace_tool', description: 'Shared', parameters: {} } },
        },
      ],
    })

    const result = await executeGetWorkflowData({ workflowId: 'wf-1', data_type: 'custom_tools' }, {
      workflowId: 'wf-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
      secretActorUserId: null,
    } as ExecutionContext)

    expect(result.success).toBe(true)
    expect(executeCustomToolUseCaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ secretActorUserId: null, workspaceId: 'ws-1' }),
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'custom_tools.list' }),
      }),
      { workspaceId: 'ws-1' }
    )
    expect(result.output).toEqual({
      customTools: [
        {
          id: 'tool-workspace',
          title: 'Workspace tool',
          functionName: 'workspace_tool',
          description: 'Shared',
          parameters: {},
        },
      ],
    })
  })

  it('does not discover MCP tools for a credentialless context', async () => {
    const result = await executeGetWorkflowData({ workflowId: 'wf-1', data_type: 'mcp_tools' }, {
      workflowId: 'wf-1',
      userId: 'key-creator',
      workspaceId: 'ws-1',
      secretActorUserId: null,
    } as ExecutionContext)

    expect(result).toEqual({
      success: false,
      error: 'MCP tools are not available without credential access.',
    })
    expect(executeMcpServerUseCaseMock).not.toHaveBeenCalled()
  })
})
