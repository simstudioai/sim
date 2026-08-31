/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mocks.getSession,
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
    call: () => GET(request(), { params: Promise.resolve(params) }),
  },
  {
    name: 'workflow paused-detail route',
    call: () =>
      GET_PAUSED_EXECUTION(pausedExecutionRequest(), {
        params: Promise.resolve({ id: params.workflowId, executionId: params.executionId }),
      }),
  },
]

describe('GET /api/resume/[workflowId]/[executionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.execute.mockResolvedValue(detail)
  })

  it('rejects an unauthenticated request before the application use case', async () => {
    mocks.getSession.mockResolvedValueOnce(null)

    const response = await GET(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'Unauthorized' })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('loads detail through the authorized application use case', async () => {
    const response = await GET(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(detail)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: params,
      })
    )
  })

  it('maps the sibling route parameter to the same semantic input', async () => {
    const response = await GET_PAUSED_EXECUTION(pausedExecutionRequest(), {
      params: Promise.resolve({ id: params.workflowId, executionId: params.executionId }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(detail)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: params,
      })
    )
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

  it.each(routeCases)('$name sanitizes unexpected failures', async ({ call }) => {
    mocks.execute.mockRejectedValueOnce(new Error('database password=secret'))

    const response = await call()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ error: 'Internal server error' })
    expect(JSON.stringify(body)).not.toContain('password=secret')
  })
})
