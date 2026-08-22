import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/lib/copilot/request/types'

const { executeWorkflowUseCaseMock } = vi.hoisted(() => ({
  executeWorkflowUseCaseMock: vi.fn(),
}))

vi.mock('@/lib/copilot/application/execute-workflow-use-case', () => ({
  executeCopilotWorkflowUseCase: executeWorkflowUseCaseMock,
  messageForCopilotWorkflowError: (error: unknown) =>
    getErrorMessage(error, 'Workflow operation failed'),
}))

import { executeGetBlockOutputs } from '@/lib/copilot/tools/handlers/workflow/queries'

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
