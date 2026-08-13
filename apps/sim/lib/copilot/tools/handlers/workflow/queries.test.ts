import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const { executeWorkflowUseCaseMock, listUserWorkspacesMock } = vi.hoisted(() => ({
  executeWorkflowUseCaseMock: vi.fn(),
  listUserWorkspacesMock: vi.fn(),
}))

vi.mock('@/lib/copilot/application/execute-workflow-use-case', () => ({
  executeCopilotWorkflowUseCase: executeWorkflowUseCaseMock,
  messageForCopilotWorkflowError: (error: unknown) =>
    getErrorMessage(error, 'Workflow operation failed'),
}))

vi.mock('@/lib/workspaces/utils', () => ({
  listUserWorkspaces: listUserWorkspacesMock,
}))

import {
  executeGetBlockOutputs,
  executeListUserWorkspaces,
} from '@/lib/copilot/tools/handlers/workflow/queries'

describe('executeListUserWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks the current workspace in the accessible workspace list', async () => {
    listUserWorkspacesMock.mockResolvedValue([
      { workspaceId: 'workspace-1', workspaceName: 'One', role: 'owner' },
      { workspaceId: 'workspace-2', workspaceName: 'Two', role: 'read' },
    ])

    const result = await executeListUserWorkspaces({
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-2',
    })

    expect(listUserWorkspacesMock).toHaveBeenCalledWith('user-1')
    expect(result).toEqual({
      success: true,
      output: {
        workspaces: [
          {
            workspaceId: 'workspace-1',
            workspaceName: 'One',
            role: 'owner',
            isCurrent: false,
          },
          {
            workspaceId: 'workspace-2',
            workspaceName: 'Two',
            role: 'read',
            isCurrent: true,
          },
        ],
      },
    })
  })
})

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
})
