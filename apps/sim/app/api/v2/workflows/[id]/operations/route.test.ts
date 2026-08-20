/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyWorkflowOperations: vi.fn(),
}))

vi.mock('@/lib/workflows/application/apply-workflow-operations', () => ({
  applyWorkflowOperations: {
    operation: { id: 'workflows.operations.apply' },
    execute: mocks.applyWorkflowOperations,
  },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { WorkflowOperationsNotAppliedError } from '@/lib/workflows/application/workflow-operations-error'
import { POST } from '@/app/api/v2/workflows/[id]/operations/route'

const WORKFLOW_ID = 'workflow-1'
const SKIPPED = {
  type: 'duplicate_block_name',
  operationType: 'add',
  blockId: 'block-2',
  reason: 'Name taken',
}

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key-1' },
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const routeContext = { params: Promise.resolve({ id: WORKFLOW_ID }) }

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/operations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ADD = {
  operation_type: 'add',
  block_id: 'block-2',
  params: { type: 'agent', name: 'Triage' },
}

describe('/api/v2/workflows/[id]/operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.applyWorkflowOperations.mockResolvedValue({
      workflowId: WORKFLOW_ID,
      workflowName: 'Daily digest',
      workspaceId: 'workspace-1',
      graph: { blocks: {}, edges: [], loops: {}, parallels: {} },
      operationCount: 1,
      applied: 1,
      skipped: [],
      deferred: [],
      inputValidationErrors: [],
      lint: { unresolvedReferences: [], notes: [] },
      warnings: [],
      needsRedeployment: true,
    })
  })

  it('authenticates before parsing the body', async () => {
    v2RouteMocks.authenticate.mockRejectedValue(new MockV2ApiKeyUnauthenticatedError('No API key'))

    const response = await POST(request({ nonsense: true }), routeContext)

    expect(response.status).toBe(401)
    expect(mocks.applyWorkflowOperations).not.toHaveBeenCalled()
  })

  it('applies a batch and returns the exact result contract', async () => {
    const response = await POST(request({ operations: [ADD] }), routeContext)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: WORKFLOW_ID,
        applied: 1,
        skipped: [],
        deferred: [],
        inputValidationErrors: [],
        lint: { unresolvedReferences: [], notes: [] },
        warnings: [],
        needsRedeployment: true,
      },
    })
    expect(mocks.applyWorkflowOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          workflowId: WORKFLOW_ID,
          operations: [ADD],
          atomic: false,
          layout: 'targeted',
        }),
      })
    )
  })

  it('maps the setBlockEnabled flag onto the use case input', async () => {
    await POST(
      request({
        operations: [ADD],
        setBlockEnabled: [{ block_id: 'block-1', enabled: false }],
      }),
      routeContext
    )

    expect(mocks.applyWorkflowOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          blockEnabledChanges: [{ blockId: 'block-1', enabled: false }],
        }),
      })
    )
  })

  it('answers a refused atomic batch with 409 and the declined operations', async () => {
    mocks.applyWorkflowOperations.mockRejectedValue(
      new WorkflowOperationsNotAppliedError([SKIPPED] as never)
    )

    const response = await POST(request({ operations: [ADD], atomic: true }), routeContext)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'CONFLICT',
        message:
          '1 operation(s) could not be applied and atomic was requested; nothing was written',
        details: { code: 'OPERATIONS_NOT_APPLIED', skipped: [SKIPPED] },
      },
    })
  })

  it('conceals a cross-tenant write as not found', async () => {
    mocks.applyWorkflowOperations.mockRejectedValue(new NoWorkspaceAccessError('workspace-2'))

    const response = await POST(request({ operations: [ADD] }), routeContext)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('rejects an empty batch', async () => {
    const response = await POST(request({ operations: [] }), routeContext)

    expect(response.status).toBe(400)
    expect(mocks.applyWorkflowOperations).not.toHaveBeenCalled()
  })

  it('rejects an add operation with no block type or name', async () => {
    const response = await POST(
      request({ operations: [{ operation_type: 'add', block_id: 'block-2', params: {} }] }),
      routeContext
    )

    expect(response.status).toBe(400)
    expect(mocks.applyWorkflowOperations).not.toHaveBeenCalled()
  })

  it('rejects params on a delete operation', async () => {
    const response = await POST(
      request({
        operations: [{ operation_type: 'delete', block_id: 'block-2', params: { type: 'agent' } }],
      }),
      routeContext
    )

    expect(response.status).toBe(400)
    expect(mocks.applyWorkflowOperations).not.toHaveBeenCalled()
  })
})
