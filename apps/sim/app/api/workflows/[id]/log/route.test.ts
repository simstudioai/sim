/**
 * @vitest-environment node
 */
import { authMockFns, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Override global db mock with the configurable chain mock
vi.mock('@sim/db', () => dbChainMock)

const {
  mockValidateWorkflowAccess,
  mockGetWorkspaceBilledAccountUserId,
  mockResolveBillingAttribution,
  mockAssertBillingAttributionSnapshot,
  mockStart,
  mockSafeComplete,
  mockSafeCompleteWithError,
} = vi.hoisted(() => ({
  mockValidateWorkflowAccess: vi.fn(),
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockAssertBillingAttributionSnapshot: vi.fn((value) => value),
  mockStart: vi.fn().mockResolvedValue(undefined),
  mockSafeComplete: vi.fn().mockResolvedValue(undefined),
  mockSafeCompleteWithError: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/api/workflows/middleware', () => ({
  validateWorkflowAccess: mockValidateWorkflowAccess,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: mockAssertBillingAttributionSnapshot,
  resolveBillingAttribution: mockResolveBillingAttribution,
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn(function LoggingSession() {
    return {
      start: mockStart,
      markAsFailed: vi.fn().mockResolvedValue(undefined),
      safeCompleteWithError: mockSafeCompleteWithError,
      safeComplete: mockSafeComplete,
    }
  }),
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn().mockReturnValue({ traceSpans: [], totalDuration: 0 }),
}))

import { POST } from './route'

const makeRequest = (workflowId: string, body: unknown) =>
  new NextRequest(`http://localhost/api/workflows/${workflowId}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
    vi.clearAllMocks()
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
      { params: Promise.resolve({ id: ATTACKER_WORKFLOW_ID }) }
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
      { params: Promise.resolve({ id: OWNER_WORKFLOW_ID }) }
    )

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Execution not found' })
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockSafeComplete).not.toHaveBeenCalled()
  })

  it('fails closed when the persisted execution has no attribution snapshot', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        workflowId: OWNER_WORKFLOW_ID,
        workspaceId: 'workspace-1',
        executionData: {},
      },
    ])

    const res = await POST(
      makeRequest(OWNER_WORKFLOW_ID, {
        executionId: 'legacy-execution-id',
        result: validResult,
      }),
      { params: Promise.resolve({ id: OWNER_WORKFLOW_ID }) }
    )

    expect(res.status).toBe(500)
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
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
      { params: Promise.resolve({ id: OWNER_WORKFLOW_ID }) }
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
      { params: Promise.resolve({ id: OWNER_WORKFLOW_ID }) }
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
      { params: Promise.resolve({ id: OWNER_WORKFLOW_ID }) }
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

  it('completes with a valid persisted attribution snapshot', async () => {
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
      { params: Promise.resolve({ id: OWNER_WORKFLOW_ID }) }
    )

    expect(res.status).toBe(200)
    expect(mockGetWorkspaceBilledAccountUserId).not.toHaveBeenCalled()
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        actorUserId: 'user-1',
        billingAttribution: storedBillingAttribution,
        workspaceId: 'workspace-1',
        skipLogCreation: true,
      })
    )
    expect(mockSafeComplete).toHaveBeenCalledOnce()
  })
})
