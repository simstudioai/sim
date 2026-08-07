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
})
