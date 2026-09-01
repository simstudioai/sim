/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRunAlreadyTerminalError } from '@/lib/execution/workflow-run-already-terminal-error'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/workflows/application/cancel-run', () => ({
  cancelWorkflowRun: { operation: { id: 'workflows.runs.cancel' }, execute: mocks.cancel },
}))

import { POST } from '@/app/api/workflows/[id]/executions/[executionId]/cancel/route'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const context = { params: Promise.resolve({ id: 'workflow-1', executionId: 'execution-1' }) }

function request() {
  return new NextRequest(
    'http://localhost/api/workflows/workflow-1/executions/execution-1/cancel',
    { method: 'POST' }
  )
}

describe('POST /api/workflows/[id]/executions/[executionId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: principal.userId },
      session: { id: principal.sessionId },
    })
    mocks.cancel.mockResolvedValue({
      success: true,
      executionId: 'execution-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'recorded',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })
  })

  it('passes the authenticated principal and canonical run input to the application use case', async () => {
    const response = await POST(request(), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'execution-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'recorded',
    })
    expect(mocks.cancel).toHaveBeenCalledWith({
      principal,
      input: {
        runId: 'execution-1',
        abortSignal: expect.any(AbortSignal),
      },
      request: expect.any(NextRequest),
    })
  })

  it('rejects unauthenticated requests before invoking cancellation', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await POST(request(), context)

    expect(response.status).toBe(401)
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('projects application conflicts without reimplementing cancellation errors', async () => {
    mocks.cancel.mockRejectedValue(
      new WorkflowRunAlreadyTerminalError({
        executionId: 'execution-1',
        executionStatus: 'completed',
        redisAvailable: true,
        locallyAborted: false,
      })
    )

    const response = await POST(request(), context)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Execution cannot be cancelled while completed',
    })
  })
})
