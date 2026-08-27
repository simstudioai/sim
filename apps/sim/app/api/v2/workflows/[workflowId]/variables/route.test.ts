/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ applyWorkflowVariableOperations: vi.fn() }))

vi.mock('@/lib/workflows/application/update-workflow-content', () => ({
  applyWorkflowVariableOperations: {
    operation: { id: 'workflows.variables.apply_operations' },
    execute: mocks.applyWorkflowVariableOperations,
  },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { PATCH } from '@/app/api/v2/workflows/[workflowId]/variables/route'

const WORKFLOW_ID = 'workflow-1'
const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: 'workspace-1', keyId: 'ws-key-1' },
  rateLimitSubjectIds: ['api-key:ws-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const routeContext = { params: Promise.resolve({ workflowId: WORKFLOW_ID }) }

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/variables`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/v2/workflows/[workflowId]/variables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.applyWorkflowVariableOperations.mockResolvedValue({ updated: 3, changed: true })
  })

  it('authenticates before parsing the body', async () => {
    v2RouteMocks.authenticate.mockRejectedValue(new MockV2ApiKeyUnauthenticatedError('No API key'))

    const response = await PATCH(request({ nonsense: true }), routeContext)

    expect(response.status).toBe(401)
    expect(mocks.applyWorkflowVariableOperations).not.toHaveBeenCalled()
  })

  it('applies a batch under a workspace API key, which the widened policy allows', async () => {
    const response = await PATCH(
      request({ operations: [{ operation: 'add', name: 'region', type: 'string', value: 'eu' }] }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { id: WORKFLOW_ID, variableCount: 3, changed: true },
    })
    expect(mocks.applyWorkflowVariableOperations).toHaveBeenCalledWith({
      principal: auth.principal,
      input: {
        workflowId: WORKFLOW_ID,
        operations: [{ operation: 'add', name: 'region', type: 'string', value: 'eu' }],
      },
      request: expect.anything(),
    })
  })

  it('does not forward a value or type on a delete operation', async () => {
    await PATCH(request({ operations: [{ operation: 'delete', name: 'region' }] }), routeContext)

    expect(mocks.applyWorkflowVariableOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          operations: [{ operation: 'delete', name: 'region' }],
        }),
      })
    )
  })

  it('reports an authoritative no-op without pretending anything changed', async () => {
    mocks.applyWorkflowVariableOperations.mockResolvedValue({ updated: 3, changed: false })

    const response = await PATCH(
      request({ operations: [{ operation: 'delete', name: 'missing' }] }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data.changed).toBe(false)
  })

  it('rejects a value on a delete operation', async () => {
    const response = await PATCH(
      request({ operations: [{ operation: 'delete', name: 'region', value: 'eu' }] }),
      routeContext
    )

    expect(response.status).toBe(400)
    expect(mocks.applyWorkflowVariableOperations).not.toHaveBeenCalled()
  })

  it('rejects an empty batch', async () => {
    const response = await PATCH(request({ operations: [] }), routeContext)

    expect(response.status).toBe(400)
  })
})
