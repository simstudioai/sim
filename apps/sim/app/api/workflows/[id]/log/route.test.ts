/**
 * @vitest-environment node
 */
import { authMockFns, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Override global db mock with the configurable chain mock
vi.mock('@sim/db', () => dbChainMock)

const { mockValidateWorkflowAccess, mockGetWorkspaceBilledAccountUserId } = vi.hoisted(() => ({
  mockValidateWorkflowAccess: vi.fn(),
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
}))

vi.mock('@/app/api/workflows/middleware', () => ({
  validateWorkflowAccess: mockValidateWorkflowAccess,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  getWorkspaceBilledAccountUserId: mockGetWorkspaceBilledAccountUserId,
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    markAsFailed: vi.fn().mockResolvedValue(undefined),
    safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
    safeComplete: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn().mockReturnValue([]),
}))

import { POST } from './route'

const makeRequest = (workflowId: string, body: unknown) =>
  new NextRequest(`http://localhost/api/workflows/${workflowId}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const validResult = { success: true, output: { value: 42 } }

describe('POST /api/workflows/[id]/log cross-tenant guard', () => {
  const OWNER_WORKFLOW_ID = 'wf-owner'
  const ATTACKER_WORKFLOW_ID = 'wf-attacker'
  const VICTIM_EXECUTION_ID = 'exec-victim-uuid'

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockValidateWorkflowAccess.mockResolvedValue({ error: null })
    mockGetWorkspaceBilledAccountUserId.mockResolvedValue('user-1')
    // Default: no existing log (fresh execution)
    dbChainMockFns.limit.mockResolvedValue([])
  })

  it('returns 404 when executionId belongs to a different workflow', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workflowId: OWNER_WORKFLOW_ID }])

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

  it('proceeds when executionId belongs to the same workflow', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ workflowId: OWNER_WORKFLOW_ID }])

    const res = await POST(
      makeRequest(OWNER_WORKFLOW_ID, {
        executionId: VICTIM_EXECUTION_ID,
        result: validResult,
      }),
      { params: Promise.resolve({ id: OWNER_WORKFLOW_ID }) }
    )

    expect(res.status).not.toBe(404)
    expect(res.status).not.toBe(403)
  })

  it('proceeds when executionId has no existing log row (fresh execution)', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    const res = await POST(
      makeRequest(OWNER_WORKFLOW_ID, {
        executionId: 'brand-new-execution-id',
        result: validResult,
      }),
      { params: Promise.resolve({ id: OWNER_WORKFLOW_ID }) }
    )

    expect(res.status).not.toBe(404)
    expect(res.status).not.toBe(403)
  })
})
