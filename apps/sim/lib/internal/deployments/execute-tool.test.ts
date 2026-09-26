import { createExecutionContext } from '@sim/testing'
import {
  executorPrincipalMock,
  executorPrincipalMockFns,
} from '@sim/testing/mocks/executor-principal.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deploy: vi.fn(),
  getVersion: vi.fn(),
  listVersions: vi.fn(),
  promote: vi.fn(),
  undeploy: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => executorPrincipalMock)

vi.mock('@/lib/internal/deployments/operations', () => ({
  executeDeploymentsDeploy: mocks.deploy,
  executeDeploymentsGetVersion: mocks.getVersion,
  executeDeploymentsListVersions: mocks.listVersions,
  executeDeploymentsPromote: mocks.promote,
  executeDeploymentsUndeploy: mocks.undeploy,
}))

import { DelegatedWorkspaceAuthorizationError } from '@/lib/core/application'
import { executeDeploymentsTool } from '@/lib/internal/deployments/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const { mockCreateExecutorPrincipalFromExecutionContext } = executorPrincipalMockFns

const INPUTS = {
  deployments_deploy: { workflowId: 'workflow-1', name: 'Release 4' },
  deployments_undeploy: { workflowId: 'workflow-1' },
  deployments_promote: { workflowId: 'workflow-1', version: 4 },
  deployments_list_versions: { workflowId: 'workflow-1' },
  deployments_get_version: { workflowId: 'workflow-1', version: 4 },
} as const

const DISPATCH = {
  deployments_deploy: mocks.deploy,
  deployments_undeploy: mocks.undeploy,
  deployments_promote: mocks.promote,
  deployments_list_versions: mocks.listVersions,
  deployments_get_version: mocks.getVersion,
} as const

function request(
  toolId: keyof typeof INPUTS,
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId,
    input: INPUTS[toolId],
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'origin-workflow' }),
      executionId: 'execution-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeDeploymentsTool', () => {
  beforeEach(() => {
    mockCreateExecutorPrincipalFromExecutionContext.mockResolvedValue({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    for (const operation of Object.values(DISPATCH)) {
      operation.mockResolvedValue({ success: true, output: { ok: true } })
    }
  })

  it('rejects missing trusted workspace scope before principal construction', async () => {
    const response = await executeDeploymentsTool(
      request('deployments_deploy', {
        context: {
          ...createExecutionContext({ workflowId: 'origin-workflow' }),
          userId: 'user-1',
        },
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Authentication required',
    })
    expect(mockCreateExecutorPrincipalFromExecutionContext).not.toHaveBeenCalled()
    expect(mocks.deploy).not.toHaveBeenCalled()
  })

  it('conceals cross-workspace deployment targets as not found', async () => {
    mocks.deploy.mockRejectedValueOnce(new DelegatedWorkspaceAuthorizationError())

    const response = await executeDeploymentsTool(request('deployments_deploy'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Workflow not found in this workspace',
    })
  })
})
