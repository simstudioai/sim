/**
 * @vitest-environment node
 */

import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRunAlreadyTerminalError } from '@/lib/execution/workflow-run-already-terminal-error'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workflows/application/cancel-run', () => ({
  cancelWorkflowRun: { operation: { id: 'workflows.runs.cancel' }, execute: mocks.cancel },
}))

import { POST } from '@/app/api/v2/workflows/[workflowId]/runs/[runId]/cancel/route'

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW_ID = 'workflow-1'
const RUN_ID = 'run-1'

const principal = {
  kind: 'personal_api_key' as const,
  userId: 'user-1',
  keyId: 'key-1',
}
const auth = {
  principal,
  rateLimitSubjectIds: ['api-key:key-1'],
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const context = { params: Promise.resolve({ workflowId: WORKFLOW_ID, runId: RUN_ID }) }

function request() {
  return new NextRequest(
    `http://localhost:3000/api/v2/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/cancel`,
    { method: 'POST', headers: { 'x-api-key': 'secret' } }
  )
}

/** The service result the use case hands back, minus the outcome under test. */
function serviceResult(overrides: Record<string, unknown>) {
  return {
    executionId: RUN_ID,
    redisAvailable: true,
    locallyAborted: false,
    pausedCancelled: false,
    cancelled: true,
    workflowId: WORKFLOW_ID,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  }
}

describe('POST /api/v2/workflows/[workflowId]/runs/[runId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  })

  it('reports a durable write when an active run is cancelled', async () => {
    mocks.cancel.mockResolvedValue(
      serviceResult({ success: true, durablyRecorded: true, reason: 'recorded' })
    )

    const response = await POST(request(), context)

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({
      success: true,
      runId: RUN_ID,
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'recorded',
    })
  })

  /**
   * `success: true` with every action flag false told a caller its cancel had
   * done something. A run that was already terminal is a `200` no-op — not an
   * error — answered with `success: false` and the `already_*` reason.
   */
  it('answers an already-cancelled run as a no-op that cancelled nothing', async () => {
    mocks.cancel.mockResolvedValue(
      serviceResult({
        success: true,
        cancelled: false,
        durablyRecorded: false,
        reason: 'already_cancelled',
      })
    )

    const response = await POST(request(), context)

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      success: false,
      runId: RUN_ID,
      durablyRecorded: false,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'already_cancelled',
    })
  })

  it.each([
    ['completed', 'already_completed'],
    ['failed', 'already_failed'],
  ] as const)(
    'answers a 200 no-op with success false when a standalone run is already %s',
    async (executionStatus, reason) => {
      mocks.cancel.mockRejectedValue(
        new WorkflowRunAlreadyTerminalError({
          executionId: RUN_ID,
          executionStatus,
          redisAvailable: true,
          locallyAborted: false,
        })
      )

      const response = await POST(request(), context)

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        data: {
          success: false,
          runId: RUN_ID,
          redisAvailable: true,
          durablyRecorded: false,
          locallyAborted: false,
          pausedCancelled: false,
          reason,
        },
      })
    }
  )
})
