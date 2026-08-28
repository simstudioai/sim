/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/function-execution/application/authorization'
import { executeFunctionTool } from '@/lib/internal/function/execute'

describe('executeFunctionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue(Response.json({ success: true }))
  })

  it('binds executor calls from the canonical origin instead of the compatibility user ID', async () => {
    const startedAt = Date.now()
    const origin = {
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment' as const,
        deploymentVersionId: 'deployment-1',
      },
    }
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'executor' as const,
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      delegationContext: { kind: 'workflow_execution' as const, ...origin },
    }
    mocks.createPrincipal.mockResolvedValue(principal)
    const context = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      userId: 'workspace-owner',
      executorDelegationOrigin: origin,
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
      audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
      expiresAt: expect.any(Date),
      resourceScope: { executionId: 'execution-1' },
    })
    const delegatedExpiry = mocks.createPrincipal.mock.calls[0]?.[0].expiresAt as Date
    expect(delegatedExpiry.getTime()).toBeGreaterThanOrEqual(startedAt + 60_000)
    expect(delegatedExpiry.getTime()).toBeLessThanOrEqual(Date.now() + 60_000)
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
