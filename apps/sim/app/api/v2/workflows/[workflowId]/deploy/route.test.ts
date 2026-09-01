/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  defineRoute: vi.fn((definition) => definition),
  capture: vi.fn(),
}))

vi.mock('@/lib/api/server/routes', () => ({
  createInternalResourceConcealmentPolicy: vi.fn(() => ({ kind: 'conceal-internal-resource' })),
  internalOrchestrationErrorPolicy: { kind: 'internal-plain' },
  createInternalSessionOrExecutorAuth: vi.fn(() => ({ kind: 'internal-workflow' })),
  createV2ResourceConcealmentPolicy: vi.fn(() => ({ kind: 'conceal-resource' })),
  defineV2JsonRoute: mocks.defineRoute,
  v2ApiKeyAuth: { kind: 'v2-api-key' },
  v2RateLimits: { publicApi: { kind: 'public-api' } },
  v2OrchestrationErrorPolicy: { kind: 'orchestration-errors' },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))

import {
  v2DeployWorkflowContract,
  v2UndeployWorkflowContract,
} from '@/lib/api/contracts/v2/workflows'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { deployWorkflow, undeployWorkflow } from '@/lib/workflows/application/deployments'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { DELETE, POST } from '@/app/api/v2/workflows/[workflowId]/deploy/route'

describe('/api/v2/workflows/[workflowId]/deploy route definitions', () => {
  /**
   * Both the malformed-body 400 and the oversized-body 413 are v2 builder
   * defaults, so neither belongs on the route. The envelope they produce is
   * asserted once against the builder in
   * `lib/api/server/routes/v2-error-envelope.test.ts`.
   */
  it('keeps an omitted deploy body valid and binds the authorized deployment use case', async () => {
    expect(v2DeployWorkflowContract.body?.parse(undefined)).toEqual({})
    expect(POST).toMatchObject({
      operation: workflowOperations.deploy,
      useCase: deployWorkflow,
      errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
      parseOptions: { optionalJsonBody: true },
    })
    expect(
      Reflect.get(POST, 'mapInput')({ params: { workflowId: 'workflow-1' }, body: {} })
    ).toEqual(
      expect.objectContaining({
        workflowId: 'workflow-1',
        name: undefined,
        description: undefined,
      })
    )

    expect(Reflect.get(Reflect.get(POST, 'parseOptions'), 'invalidJsonResponse')).toBeUndefined()
    expect(
      Reflect.get(Reflect.get(POST, 'parseOptions'), 'payloadTooLargeResponse')
    ).toBeUndefined()
  })

  it('presents the full declared deployment lifecycle response', () => {
    const body = Reflect.get(
      POST,
      'present'
    )({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      deployedAt: new Date('2026-01-01T00:00:00.000Z'),
      version: 2,
      warnings: [],
      activeDeployment: null,
      latestDeploymentAttempt: null,
    })
    expect(body.data.isDeployed).toBe(false)
    expect(v2DeployWorkflowContract.response.schema.parse(body)).toEqual(body)
  })

  it('defers deploy analytics to durable activation', () => {
    expect(Reflect.get(POST, 'onSuccess')).toBeUndefined()
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('keeps undeploy on the authorized operation and declared response schema', () => {
    expect(DELETE).toMatchObject({
      operation: workflowOperations.undeploy,
      useCase: undeployWorkflow,
      errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
    })
    const body = Reflect.get(
      DELETE,
      'present'
    )({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      warnings: [],
    })
    expect(v2UndeployWorkflowContract.response.schema.parse(body)).toEqual(body)
  })
})
