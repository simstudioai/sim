/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ cancel: vi.fn() }))
vi.mock('@/lib/mothership/tools/handlers/workflow/mutations', () => ({
  executeCancelWorkflowRun: mocks.cancel,
  executeGenerateApiKey: vi.fn(),
  executeRunBlock: vi.fn(),
  executeRunFromBlock: vi.fn(),
  executeRunWorkflow: vi.fn(),
  executeRunWorkflowUntilBlock: vi.fn(),
}))

import { executeTool, hasHandler } from '@/lib/mothership/tool-executor/executor'
import { ensureHandlersRegistered } from '@/lib/mothership/tool-executor/register-handlers'
import {
  getToolEntry,
  isSimExecuted,
  toolRequiresApproval,
} from '@/lib/mothership/tool-executor/router'

describe('workflow-run cancellation tool routing', () => {
  beforeEach(() => vi.clearAllMocks())
  it('routes cancellation through Sim with write permission and explicit approval', () => {
    expect(getToolEntry('cancel_workflow_run')).toMatchObject({
      requiredPermission: 'write',
      route: 'sim',
    })
    expect(isSimExecuted('cancel_workflow_run')).toBe(true)
    expect(toolRequiresApproval('cancel_workflow_run')).toBe(true)
  })

  it('dispatches cancellation to the registered Sim handler with trusted context', async () => {
    await ensureHandlersRegistered()

    expect(hasHandler('cancel_workflow_run')).toBe(true)
    const context = {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
      toolCallId: 'cancel-1',
      copilotToolExecution: true,
      userPermission: 'write',
    }
    const params = { workflowId: 'workflow-1', executionId: 'run-1' }
    const result = { success: true, output: { status: 'cancelled' } }
    mocks.cancel.mockResolvedValue(result)
    await expect(
      executeTool(
        'cancel_workflow_run',
        {
          ...params,
          activity: { title: 'Stopping workflow' },
        },
        context
      )
    ).resolves.toEqual(result)
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(params, context)
  })
})
