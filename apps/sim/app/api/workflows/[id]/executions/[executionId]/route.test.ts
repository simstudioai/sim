/**
 * @vitest-environment node
 *
 * The internal run-detail door. `logs.cost` and `logs.trace_spans` withhold
 * fields inside a run, and the shared read applies them — but only for the
 * subject this route names. `auth.userId` is populated for every credential the
 * route accepts, so naming it unconditionally would apply a workspace key
 * creator's group to every caller of a shared credential, and the executor's
 * actor's group to a delegation that carries no capabilities at all.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockValidateWorkflowAccess, mockGetStatus } = vi.hoisted(() => ({
  mockValidateWorkflowAccess: vi.fn(),
  mockGetStatus: vi.fn(),
}))

vi.mock('@/app/api/workflows/middleware', () => ({
  validateWorkflowAccess: mockValidateWorkflowAccess,
}))

vi.mock('@/lib/workflows/executor/execution-status', () => ({
  getWorkflowExecutionStatus: mockGetStatus,
}))

import { GET } from './route'

const WORKFLOW_ID = 'b1f0c7e2-0000-4000-8000-00000000000a'
const EXECUTION_ID = 'b1f0c7e2-0000-4000-8000-00000000000b'

function request() {
  return new NextRequest(`https://sim.test/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}`)
}

function context() {
  return { params: Promise.resolve({ id: WORKFLOW_ID, executionId: EXECUTION_ID }) }
}

function grantAccess(auth: Record<string, unknown>) {
  mockValidateWorkflowAccess.mockResolvedValue({
    workflow: { id: WORKFLOW_ID, workspaceId: 'workspace-1' },
    auth,
  })
}

describe('internal execution status route projection subject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockResolvedValue({
      executionId: EXECUTION_ID,
      workflowId: WORKFLOW_ID,
      status: 'completed',
      trigger: 'api',
      level: 'info',
      startedAt: '2026-08-05T12:00:00.000Z',
      endedAt: null,
      totalDurationMs: null,
      paused: null,
      cost: null,
      error: null,
      finalOutput: null,
      blockOutputs: null,
    })
  })

  it('names the session user as the projection subject', async () => {
    grantAccess({ success: true, userId: 'user-1', authType: 'session' })

    const response = await GET(request(), context())

    expect(response.status).toBe(200)
    expect(mockGetStatus).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', viewerUserId: 'user-1' })
    )
  })

  it('names the personal API key owner as the projection subject', async () => {
    grantAccess({ success: true, userId: 'user-1', authType: 'api_key', apiKeyType: 'personal' })

    await GET(request(), context())

    expect(mockGetStatus).toHaveBeenCalledWith(expect.objectContaining({ viewerUserId: 'user-1' }))
  })

  it('names no subject for a workspace API key', async () => {
    grantAccess({
      success: true,
      userId: 'key-creator-1',
      authType: 'api_key',
      apiKeyType: 'workspace',
    })

    await GET(request(), context())

    expect(mockGetStatus).toHaveBeenCalledWith(expect.objectContaining({ viewerUserId: null }))
  })

  it('names no subject for an executor delegation', async () => {
    grantAccess({ success: true, userId: 'run-actor-1', authType: 'internal_jwt' })

    await GET(request(), context())

    expect(mockGetStatus).toHaveBeenCalledWith(expect.objectContaining({ viewerUserId: null }))
  })
})
