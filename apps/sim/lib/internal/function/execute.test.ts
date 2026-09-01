/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/function-execution/application/execute-function', () => ({
  executeFunction: { execute: mocks.execute },
}))

import { executeFunctionTool } from '@/lib/internal/function/execute'

describe('executeFunctionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue(Response.json({ success: true }))
  })

  it('binds executor calls from the canonical origin instead of the compatibility user ID', async () => {
    const principal = createTestRuntimePrincipal({
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
      executionId: 'execution-1',
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment' as const,
        deploymentVersionId: 'deployment-1',
      },
      compatibilityActorUserId: 'workspace-owner',
    })
    mocks.createPrincipal.mockResolvedValue(principal)
    const context = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      userId: 'workspace-owner',
      principal,
    }
    const headers = new Headers()

    await executeFunctionTool({
      body: {
        code: 'return 1',
        timeout: 60_000,
        userId: 'forged-user',
        workspaceId: 'forged-workspace',
      },
      headers,
      context,
      requestId: 'request-1',
    })

    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context,
    })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({
        workspaceId: 'workspace-1',
        body: expect.objectContaining({
          workspaceId: 'workspace-1',
          userId: undefined,
        }),
        headers,
      }),
    })
  })
})
