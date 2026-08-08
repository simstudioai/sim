/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const routeExecution = vi.hoisted(() => vi.fn())

vi.mock('@/lib/copilot/tools/server/router', () => ({ routeExecution }))

import { createServerToolHandler } from '@/lib/copilot/tools/registry/server-tool-adapter'

describe('server tool adapter authority boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeExecution.mockResolvedValue({ success: true })
  })

  it('overwrites model-supplied workspace scope and forwards trusted delegation context', async () => {
    const handler = createServerToolHandler('workspace_file')

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

    expect(routeExecution).toHaveBeenCalledWith(
      'workspace_file',
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

  it('propagates the secretless actor policy to server tools', async () => {
    const userStopController = new AbortController()

    await createServerToolHandler('edit_workflow')(
      { workflowId: 'workflow-1' },
      {
        userId: 'key-creator',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        secretActorUserId: null,
        userStopSignal: userStopController.signal,
      }
    )

    expect(routeExecution).toHaveBeenCalledWith(
      'edit_workflow',
      { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
      expect.objectContaining({
        userId: 'key-creator',
        workspaceId: 'workspace-1',
        secretActorUserId: null,
        userStopSignal: userStopController.signal,
      })
    )
  })
})
