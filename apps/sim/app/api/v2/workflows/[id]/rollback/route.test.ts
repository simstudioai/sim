/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  defineRoute: vi.fn((definition) => definition),
  capture: vi.fn(),
}))

vi.mock('@/lib/api/server/routes', () => ({
  defineV2JsonRoute: mocks.defineRoute,
  v2ApiKeyAuth: { kind: 'v2-api-key' },
  v2RateLimits: { publicApi: { kind: 'public-api' } },
  v2OrchestrationErrorPolicy: { kind: 'orchestration-errors' },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import { v2RollbackWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { activateWorkflowVersion } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { POST } from '@/app/api/v2/workflows/[id]/rollback/route'

describe('/api/v2/workflows/[id]/rollback route definition', () => {
  it('keeps an omitted rollback body valid and delegates version selection to the use case', async () => {
    expect(v2RollbackWorkflowContract.body?.parse(undefined)).toEqual({})
    expect(POST).toMatchObject({
      operation: workflowOperations.activateVersion,
      useCase: activateWorkflowVersion,
      errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
      parseOptions: { optionalJsonBody: true },
    })
    expect(Reflect.get(POST, 'mapInput')({ params: { id: 'workflow-1' }, body: {} })).toEqual(
      expect.objectContaining({
        workflowId: 'workflow-1',
        version: undefined,
        transition: 'rollback',
      })
    )

    const invalidJsonResponse = Reflect.get(
      Reflect.get(POST, 'parseOptions'),
      'invalidJsonResponse'
    )()
    expect(invalidJsonResponse.status).toBe(400)
    expect(await invalidJsonResponse.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Request body must be valid JSON' },
    })

    const payloadTooLargeResponse = Reflect.get(
      Reflect.get(POST, 'parseOptions'),
      'payloadTooLargeResponse'
    )()
    expect(payloadTooLargeResponse.status).toBe(413)
    expect(await payloadTooLargeResponse.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    })
  })

  it('presents the full declared rollback lifecycle response', () => {
    const body = Reflect.get(
      POST,
      'present'
    )({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      deployedAt: new Date('2026-01-01T00:00:00.000Z'),
      version: 1,
      warnings: [],
      activeDeployment: null,
      latestDeploymentAttempt: null,
    })
    expect(body.data.isDeployed).toBe(false)
    expect(v2RollbackWorkflowContract.response.schema.parse(body)).toEqual(body)
  })

  it('keeps activation analytics on the v2 adapter', async () => {
    await Reflect.get(
      POST,
      'onSuccess'
    )({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      result: { workflowId: 'workflow-1', workspaceId: 'workspace-1', version: 1 },
    })
    expect(mocks.capture).toHaveBeenCalledWith(
      'user-1',
      'deployment_version_activated',
      { workflow_id: 'workflow-1', workspace_id: 'workspace-1', version: 1 },
      { groups: { workspace: 'workspace-1' } }
    )
  })
})
