/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

const { routeExecutionMock } = vi.hoisted(() => ({ routeExecutionMock: vi.fn() }))

vi.mock('@/lib/copilot/tools/server/router', () => ({ routeExecution: routeExecutionMock }))

import { createServerToolHandler } from './server-tool-adapter'

describe('createServerToolHandler', () => {
  it('propagates the secretless actor policy to server tools', async () => {
    routeExecutionMock.mockResolvedValue({ success: true })
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

    expect(routeExecutionMock).toHaveBeenCalledWith(
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
