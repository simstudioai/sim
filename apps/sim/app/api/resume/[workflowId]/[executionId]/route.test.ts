import { createMockRequest } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}))

vi.mock('@/lib/workflows/application/read-paused-workflow-execution', () => ({
  readPausedWorkflowExecution: {
    operation: { id: 'workflows.paused_executions.read' },
    execute: mocks.execute,
  },
}))

import { GET } from '@/app/api/resume/[workflowId]/[executionId]/route'
import { GET as GET_PAUSED_EXECUTION } from '@/app/api/workflows/[id]/paused/[executionId]/route'

const params = { workflowId: 'workflow-1', executionId: 'execution-1' }
const detail = {
  id: 'paused-1',
  workflowId: params.workflowId,
  executionId: params.executionId,
  status: 'paused',
  totalPauseCount: 1,
  resumedCount: 0,
  pausedAt: '2026-08-31T12:00:00.000Z',
  updatedAt: '2026-08-31T12:00:00.000Z',
  expiresAt: null,
  metadata: { source: 'human-in-the-loop' },
  triggerIds: ['trigger-1'],
  pausePoints: [
    {
      contextId: 'context-1',
      resumeStatus: 'paused',
      registeredAt: '2026-08-31T12:00:00.000Z',
      snapshotReady: true,
      response: { data: { approved: false } },
      queuePosition: 1,
    },
  ],
  executionSnapshot: { snapshot: '{}', triggerIds: [] },
  queue: [
    {
      id: 'queue-1',
      pausedExecutionId: 'paused-1',
      parentExecutionId: params.executionId,
      newExecutionId: 'execution-2',
      contextId: 'context-1',
      resumeInput: { approved: true },
      status: 'queued',
      queuedAt: '2026-08-31T12:01:00.000Z',
      claimedAt: null,
      completedAt: null,
      failureReason: null,
    },
  ],
}

function request() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost/api/resume/workflow-1/execution-1'
  )
}

function pausedExecutionRequest() {
  return createMockRequest(
    'GET',
    undefined,
    {},
    'http://localhost/api/workflows/workflow-1/paused/execution-1'
  )
}

const routeCases = [
  {
    name: 'resume detail route',
    call: () => GET(request(), createRouteContext(params)),
  },
  {
    name: 'workflow paused-detail route',
    call: () =>
      GET_PAUSED_EXECUTION(
        pausedExecutionRequest(),
        createRouteContext({ id: params.workflowId, executionId: params.executionId })
      ),
  },
]

describe('GET /api/resume/[workflowId]/[executionId]', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.execute.mockResolvedValue(detail)
  })

  it.each(routeCases)('$name conceals cross-workspace denial', async ({ call }) => {
    mocks.execute.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await call()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Workflow not found' })
  })

  it.each(routeCases)('$name preserves actionable same-workspace denial', async ({ call }) => {
    mocks.execute.mockRejectedValueOnce(new InsufficientWorkspacePermissionsError())

    const response = await call()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Insufficient workspace permissions' })
  })
})
