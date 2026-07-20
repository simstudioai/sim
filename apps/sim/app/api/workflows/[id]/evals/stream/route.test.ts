/**
 * @vitest-environment node
 */
import { createMockRequest, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowEvalStreamEvent } from '@/lib/api/contracts/workflow-evals'

vi.mock('@sim/db', () => dbChainMock)

const {
  mockAuthorizeWorkflow,
  mockCreateSSEStream,
  mockGetSession,
  mockIsFeatureEnabled,
  mockSubscribe,
  mockUnsubscribe,
} = vi.hoisted(() => ({
  mockAuthorizeWorkflow: vi.fn(),
  mockCreateSSEStream: vi.fn(),
  mockGetSession: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockSubscribe: vi.fn(),
  mockUnsubscribe: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@sim/platform-authz/workflow', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))
vi.mock('@/lib/events/sse-endpoint', () => ({
  createSSEStream: mockCreateSSEStream,
}))
vi.mock('@/lib/workflows/evals/pubsub', () => ({
  workflowEvalPubSub: { subscribe: mockSubscribe },
}))

import { GET } from '@/app/api/workflows/[id]/evals/stream/route'

interface StreamConfig {
  subscribe: (send: (eventName: string, data: Record<string, unknown>) => void) => () => void
}

function callRoute(id = 'workflow-1') {
  return GET(createMockRequest('GET'), { params: Promise.resolve({ id }) })
}

function streamEvent(workflowId = 'workflow-1'): WorkflowEvalStreamEvent {
  return {
    version: 2,
    type: 'eval.run.upsert',
    workspaceId: 'workspace-1',
    workflowId,
    suiteId: 'suite-1',
    run: {
      id: 'run-1',
      status: 'running',
      revision: 1,
      completedCount: 0,
      passedCount: 0,
      warningCount: 0,
      failedCount: 0,
      errorCount: 0,
      totalCount: 2,
      createdAt: new Date('2026-07-16T12:00:00.000Z'),
      updatedAt: new Date('2026-07-16T12:00:01.000Z'),
      startedAt: new Date('2026-07-16T12:00:01.000Z'),
      completedAt: null,
      error: null,
    },
  }
}

describe('GET /api/workflows/[id]/evals/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorizeWorkflow.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })
    dbChainMockFns.limit.mockResolvedValue([{ organizationId: 'organization-1' }])
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockSubscribe.mockReturnValue(mockUnsubscribe)
    mockCreateSSEStream.mockReturnValue(
      new Response(null, { headers: { 'Content-Type': 'text/event-stream' } })
    )
  })

  it('authenticates before opening a stream', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callRoute()

    expect(response.status).toBe(401)
    expect(mockAuthorizeWorkflow).not.toHaveBeenCalled()
    expect(mockCreateSSEStream).not.toHaveBeenCalled()
  })

  it('enforces workflow read authorization and the eval feature flag', async () => {
    mockAuthorizeWorkflow.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      message: 'Access denied',
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })

    expect((await callRoute()).status).toBe(403)
    expect(mockCreateSSEStream).not.toHaveBeenCalled()

    mockAuthorizeWorkflow.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })
    mockIsFeatureEnabled.mockResolvedValueOnce(false)

    expect((await callRoute()).status).toBe(403)
    expect(mockCreateSSEStream).not.toHaveBeenCalled()
  })

  it('streams only events for the authorized workflow and workspace', async () => {
    const response = await callRoute()

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(mockCreateSSEStream).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'workflow-evals',
        metadata: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
      })
    )

    const config = mockCreateSSEStream.mock.calls[0][0] as StreamConfig
    const send = vi.fn()
    const unsubscribe = config.subscribe(send)
    const handler = mockSubscribe.mock.calls[0][0] as (event: WorkflowEvalStreamEvent) => void

    expect(send).toHaveBeenCalledWith('workflow_eval_ready', { workflowId: 'workflow-1' })
    send.mockClear()

    handler(streamEvent('workflow-2'))
    handler({ ...streamEvent(), workspaceId: 'workspace-2' })
    expect(send).not.toHaveBeenCalled()

    const matchingEvent = streamEvent()
    handler(matchingEvent)
    expect(send).toHaveBeenCalledWith('workflow_eval_update', matchingEvent)

    unsubscribe()
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
  })
})
