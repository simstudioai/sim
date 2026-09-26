import { authMockFns, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { loggingSessionMock, loggingSessionMockFns } from '@sim/testing/mocks/logging-session.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  workspacesUtilsMock,
  workspacesUtilsMockFns,
} from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockValidateWorkflowAccess } = vi.hoisted(() => ({
  mockValidateWorkflowAccess: vi.fn(),
}))

vi.mock('@/app/api/workflows/middleware', () => ({
  validateWorkflowAccess: mockValidateWorkflowAccess,
}))

vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn().mockReturnValue({ traceSpans: [], totalDuration: 0 }),
}))

import { POST } from '@/app/api/workflows/[id]/log/route'

const { mockGetWorkspaceBilledAccountUserId } = workspacesUtilsMockFns
const { mockResolveBillingAttribution } = billingAttributionMockFns
const {
  mockStart,
  mockSetResolvedSecretTraceRegistry,
  mockSafeComplete,
  mockSafeCompleteWithError,
} = loggingSessionMockFns

const makeRequest = (workflowId: string, body: unknown) =>
  createMockRequest({
    method: 'POST',
    url: `http://localhost/api/workflows/${workflowId}/log`,
    body,
  })

const validResult = { success: true, output: { value: 42 } }

const storedBillingAttribution = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-original',
  billedAccountUserId: 'owner-original',
  billingEntity: { type: 'organization', id: 'org-original' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

describe('POST /api/workflows/[id]/log completion attribution', () => {
  const OWNER_WORKFLOW_ID = 'wf-owner'
  const ATTACKER_WORKFLOW_ID = 'wf-attacker'
  const VICTIM_EXECUTION_ID = 'exec-victim-uuid'

  beforeEach(() => {
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockValidateWorkflowAccess.mockResolvedValue({
      workflow: {
        id: OWNER_WORKFLOW_ID,
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
      auth: {
        success: true,
        userId: 'user-1',
        authType: 'session',
      },
    })
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('owner-1')
    mockResolveBillingAttribution.mockResolvedValue({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
      billedAccountUserId: 'owner-1',
      billingEntity: { type: 'organization', id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    })
    dbChainMockFns.limit.mockResolvedValue([])
  })

  it('returns 404 when executionId belongs to a different workflow', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        workflowId: OWNER_WORKFLOW_ID,
        workspaceId: 'workspace-1',
        executionData: { billingAttribution: storedBillingAttribution },
      },
    ])

    const res = await POST(
      makeRequest(ATTACKER_WORKFLOW_ID, {
        executionId: VICTIM_EXECUTION_ID,
        result: validResult,
      }),
      createRouteContext({ id: ATTACKER_WORKFLOW_ID })
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Execution not found')
  })

  it('fails closed when a completion has no persisted execution row', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const res = await POST(
      makeRequest(OWNER_WORKFLOW_ID, {
        executionId: 'missing-execution-id',
        result: validResult,
      }),
      createRouteContext({ id: OWNER_WORKFLOW_ID })
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Execution not found' })
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockSafeComplete).not.toHaveBeenCalled()
  })

  it('rejects a completion from an actor other than the persisted execution actor', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        workflowId: OWNER_WORKFLOW_ID,
        workspaceId: 'workspace-1',
        executionData: {
          billingAttribution: {
            ...storedBillingAttribution,
            actorUserId: 'different-user',
          },
        },
      },
    ])

    const res = await POST(
      makeRequest(OWNER_WORKFLOW_ID, {
        executionId: 'actor-mismatch-execution-id',
        result: validResult,
      }),
      createRouteContext({ id: OWNER_WORKFLOW_ID })
    )

    expect(res.status).toBe(403)
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('rejects a persisted attribution snapshot bound to another workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        workflowId: OWNER_WORKFLOW_ID,
        workspaceId: 'workspace-1',
        executionData: {
          billingAttribution: {
            ...storedBillingAttribution,
            workspaceId: 'workspace-other',
          },
        },
      },
    ])

    const res = await POST(
      makeRequest(OWNER_WORKFLOW_ID, {
        executionId: 'workspace-mismatch-execution-id',
        result: validResult,
      }),
      createRouteContext({ id: OWNER_WORKFLOW_ID })
    )

    expect(res.status).toBe(500)
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('uses the persisted attribution after a workflow transfer and payer change', async () => {
    mockValidateWorkflowAccess.mockResolvedValueOnce({
      workflow: {
        id: OWNER_WORKFLOW_ID,
        userId: 'owner-current',
        workspaceId: 'workspace-current',
      },
      auth: {
        success: true,
        userId: 'user-1',
        authType: 'session',
      },
    })
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        workflowId: OWNER_WORKFLOW_ID,
        workspaceId: 'workspace-1',
        executionData: { billingAttribution: storedBillingAttribution },
      },
    ])

    const res = await POST(
      makeRequest(OWNER_WORKFLOW_ID, {
        executionId: 'existing-execution-id',
        result: validResult,
      }),
      createRouteContext({ id: OWNER_WORKFLOW_ID })
    )

    expect(res.status).toBe(200)
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockStart).toHaveBeenCalledWith({
      userId: 'user-1',
      actorUserId: 'user-1',
      billingAttribution: storedBillingAttribution,
      workspaceId: 'workspace-1',
      variables: {},
      skipLogCreation: true,
    })
  })

  it('restores trusted Secrets provenance before projecting legacy completion traces', async () => {
    const trustedExecutionState = {
      blockStates: { 'function-1': { output: { result: 'raw-secret-value' } } },
      executedBlocks: ['function-1'],
      blockLogs: [],
      decisions: { router: {}, condition: {} },
      completedLoops: [],
      activeExecutionPath: ['function-1'],
      resolvedSecretTraceProvenance: { version: 1, complete: true, entries: [] },
    }
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        workflowId: OWNER_WORKFLOW_ID,
        workspaceId: 'workspace-1',
        executionData: {
          billingAttribution: storedBillingAttribution,
          executionState: trustedExecutionState,
        },
      },
    ])

    const res = await POST(
      makeRequest(OWNER_WORKFLOW_ID, {
        executionId: 'trusted-provenance-execution-id',
        result: validResult,
      }),
      createRouteContext({ id: OWNER_WORKFLOW_ID })
    )

    expect(res.status).toBe(200)
    const registry = mockSetResolvedSecretTraceRegistry.mock.calls[0]?.[0]
    expect(registry?.isComplete()).toBe(true)
    expect(registry?.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(mockSafeComplete).toHaveBeenCalledWith(
      expect.objectContaining({ executionState: trustedExecutionState })
    )
  })

  it('forces structural-only traces when trusted stored provenance is unavailable', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        workflowId: OWNER_WORKFLOW_ID,
        workspaceId: 'workspace-1',
        executionData: { billingAttribution: storedBillingAttribution },
      },
    ])

    const res = await POST(
      makeRequest(OWNER_WORKFLOW_ID, {
        executionId: 'legacy-no-provenance-execution-id',
        result: validResult,
      }),
      createRouteContext({ id: OWNER_WORKFLOW_ID })
    )

    expect(res.status).toBe(200)
    const registry = mockSetResolvedSecretTraceRegistry.mock.calls[0]?.[0]
    expect(registry?.isComplete()).toBe(false)
  })
})
