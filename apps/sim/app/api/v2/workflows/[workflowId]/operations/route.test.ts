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

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { WorkflowOperationsNotAppliedError } from '@/lib/workflows/application/workflow-operations-error'
import { POST } from '@/app/api/v2/workflows/[workflowId]/operations/route'

const WORKFLOW_ID = 'workflow-1'
const SKIPPED = {
  type: 'duplicate_block_name',
  operationType: 'add',
  blockId: 'block-2',
  reason: 'Name taken',
}

const DROPPED_INPUT = {
  blockId: 'block-2',
  blockType: 'agent',
  field: 'credential',
  value: 'cred-9',
  error: 'Invalid credential ID',
}

/** An empty report, with every field the contract publishes. */
const LINT = {
  sources: [],
  sinks: [],
  orphanBlocks: [],
  emptyOutgoingPorts: [],
  invalidBranchPorts: [],
  invalidConnectionTargets: [],
  fieldIssues: [],
  unresolvedReferences: [],
  notes: [],
}

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key-1' },
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const routeContext = { params: Promise.resolve({ workflowId: WORKFLOW_ID }) }

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

describe('/api/v2/workflows/[workflowId]/operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
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
      mintedBlockIds: { 'agent-1': 'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77' },
      lint: LINT,
      warnings: [],
      needsRedeployment: true,
      dryRun: false,
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
        mintedBlockIds: { 'agent-1': 'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77' },
        lint: LINT,
        warnings: [],
        needsRedeployment: true,
        dryRun: false,
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
          '1 operation(s) could not be applied and 0 input(s) would have been dropped; atomic was requested, so nothing was written',
        details: { code: 'OPERATIONS_NOT_APPLIED', skipped: [SKIPPED], droppedInputs: [] },
      },
    })
  })

  /**
   * A stripped credential refuses the batch too, and the caller needs to see
   * which field went — a `skipped` list alone would say only "0 operations
   * declined" while the credential silently vanished.
   */
  it('carries the dropped inputs of a refused atomic batch', async () => {
    mocks.applyWorkflowOperations.mockRejectedValue(
      new WorkflowOperationsNotAppliedError([], [DROPPED_INPUT] as never)
    )

    const response = await POST(request({ operations: [ADD], atomic: true }), routeContext)

    expect(response.status).toBe(409)
    expect((await response.json()).error.details).toEqual({
      code: 'OPERATIONS_NOT_APPLIED',
      skipped: [],
      droppedInputs: [DROPPED_INPUT],
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

  /**
   * `fieldIssues` is the most actionable half of the report for a headless
   * graph builder — a block missing a required field fails at run time — and
   * the `kind` discriminator is what lets a client branch on an unresolved
   * reference instead of string-matching `reason`. Both were dropped.
   */
  it('publishes the full lint report, not just unresolved reference prose', async () => {
    const FIELD_ISSUE = {
      blockId: 'block-2',
      blockName: 'Triage',
      blockType: 'agent',
      missingRequiredFields: ['systemPrompt'],
      inactiveModeValues: [
        {
          canonicalId: 'model',
          activeMemberId: 'model',
          inactiveMemberId: 'modelAdvanced',
          kind: 'other',
        },
      ],
    }
    const SINK = { blockId: 'block-2', blockName: 'Triage', blockType: 'agent' }
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
      mintedBlockIds: { 'agent-1': 'a3f1c0b2-7a44-4c1d-9d3a-2b8e5f0a1c77' },
      lint: {
        ...LINT,
        sinks: [SINK],
        fieldIssues: [FIELD_ISSUE],
        unresolvedReferences: [
          {
            blockId: 'block-2',
            blockName: 'Triage',
            blockType: 'agent',
            field: 'credential',
            value: 'cred-9',
            kind: 'credential',
            reason: 'Not accessible',
          },
        ],
      },
      warnings: [],
      needsRedeployment: true,
      dryRun: false,
    })

    const response = await POST(request({ operations: [ADD] }), routeContext)

    expect(response.status).toBe(200)
    const { lint } = (await response.json()).data
    expect(lint.sinks).toEqual([SINK])
    expect(lint.fieldIssues).toEqual([FIELD_ISSUE])
    expect(lint.unresolvedReferences[0].kind).toBe('credential')
    expect(lint.unresolvedReferences[0].value).toBe('cred-9')
  })

  /**
   * `baseGraph` is Copilot's alone: it substitutes the authoritative graph with
   * one the caller supplies, which the use case honours only for a `delegated`
   * principal. The v2 body is `.strict()`, so it must never reach the use case
   * from an API key at all.
   */
  it('rejects baseGraph in a v2 body', async () => {
    const response = await POST(
      request({ operations: [ADD], baseGraph: { blocks: {}, edges: [] } }),
      routeContext
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
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
