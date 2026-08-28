/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  deploy: vi.fn(),
  getVersion: vi.fn(),
  listVersions: vi.fn(),
  promote: vi.fn(),
  undeploy: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/internal/deployments/operations', () => ({
  executeDeploymentsDeploy: mocks.deploy,
  executeDeploymentsGetVersion: mocks.getVersion,
  executeDeploymentsListVersions: mocks.listVersions,
  executeDeploymentsPromote: mocks.promote,
  executeDeploymentsUndeploy: mocks.undeploy,
}))

import { DelegatedWorkspaceAuthorizationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { executeDeploymentsTool } from '@/lib/internal/deployments/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { WORKFLOW_DELEGATION_AUDIENCE } from '@/lib/workflows/application/authorization'

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
    vi.clearAllMocks()
    mocks.createPrincipal.mockResolvedValue({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    for (const operation of Object.values(DISPATCH)) {
      operation.mockResolvedValue({ success: true, output: { ok: true } })
    }
  })

  it.each(Object.keys(INPUTS) as Array<keyof typeof INPUTS>)(
    'binds trusted workspace scope and dispatches %s',
    async (toolId) => {
      const executionRequest = request(toolId, {
        input: { ...INPUTS[toolId], workspaceId: 'workspace-attacker' },
      })
      const response = await executeDeploymentsTool(executionRequest)

      expect(response.status).toBe(200)
      expect(mocks.createPrincipal).toHaveBeenCalledWith({
        context: executionRequest.context,
        audience: WORKFLOW_DELEGATION_AUDIENCE,
      })
      expect(DISPATCH[toolId]).toHaveBeenCalledWith(
        { ...INPUTS[toolId], workspaceId: 'workspace-1' },
        expect.objectContaining({ requestId: 'request-1' })
      )
    }
  )

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
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
    expect(mocks.deploy).not.toHaveBeenCalled()
  })

  it('preserves canonical validation and classified error status', async () => {
    const invalid = await executeDeploymentsTool(
      request('deployments_promote', { input: { workflowId: 'workflow-1' } })
    )
    expect(invalid.status).toBe(400)
    expect(mocks.promote).not.toHaveBeenCalled()

    mocks.promote.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Deployment version not found')
    )
    const missing = await executeDeploymentsTool(request('deployments_promote'))
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({
      success: false,
      error: 'Deployment version not found',
    })
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

  it('propagates cancellation before principal or application work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeDeploymentsTool(request('deployments_deploy', { signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
    expect(mocks.deploy).not.toHaveBeenCalled()
  })

  it('propagates cancellation that arrives during application work', async () => {
    const controller = new AbortController()
    mocks.deploy.mockImplementationOnce(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return { success: true }
    })

    await expect(
      executeDeploymentsTool(request('deployments_deploy', { signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
