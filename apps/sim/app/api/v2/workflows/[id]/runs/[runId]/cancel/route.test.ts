/**
 * @vitest-environment node
 */

import {
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
  cancel: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mocks.capture }))
vi.mock('@/lib/workflows/application/cancel-run', () => ({
  cancelWorkflowRun: { operation: { id: 'workflows.runs.cancel' }, execute: mocks.cancel },
}))

import { POST } from '@/app/api/v2/workflows/[id]/runs/[runId]/cancel/route'

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
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:key-1'],
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const context = { params: Promise.resolve({ id: WORKFLOW_ID, runId: RUN_ID }) }

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
    workflowId: WORKFLOW_ID,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  }
}

describe('POST /api/v2/workflows/[id]/runs/[runId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.gate.mockResolvedValue(null)
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
   * The published outcome of a cancel against a run that had already finished.
   * `durablyRecorded: true` here is the defect this suite pins: nothing was
   * written, so a caller reconciling on that flag would trust a write that never
   * happened.
   */
  it.each([
    ['cancelled', 'already_cancelled'],
    ['completed', 'already_completed'],
    ['failed', 'already_failed'],
  ])('reports a terminal %s run as a no-op the caller can tell apart', async (_status, reason) => {
    mocks.cancel.mockResolvedValue(serviceResult({ success: true, durablyRecorded: false, reason }))

    const response = await POST(request(), context)

    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      success: true,
      runId: RUN_ID,
      durablyRecorded: false,
      reason,
    })
  })
})
