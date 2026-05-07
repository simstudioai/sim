/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionEventEntry } from '@/lib/execution/event-buffer'

const {
  mockAuthorizeWorkflowByWorkspacePermission,
  mockGetSession,
  mockReadExecutionEventsState,
  mockReadExecutionMetaState,
} = vi.hoisted(() => ({
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockGetSession: vi.fn(),
  mockReadExecutionEventsState: vi.fn(),
  mockReadExecutionMetaState: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/lib/execution/event-buffer', () => ({
  readExecutionEventsState: mockReadExecutionEventsState,
  readExecutionMetaState: mockReadExecutionMetaState,
}))

import { GET } from './route'

function completedEntry(eventId: number): ExecutionEventEntry {
  return {
    eventId,
    executionId: 'exec-1',
    event: {
      type: 'execution:completed',
      timestamp: new Date().toISOString(),
      executionId: 'exec-1',
      workflowId: 'wf-1',
      data: {
        success: true,
        output: {},
        duration: 10,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        finalBlockLogs: [],
      },
    },
  }
}

describe('execution stream reconnect route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({ allowed: true })
    mockReadExecutionMetaState.mockResolvedValue({
      status: 'found',
      meta: { status: 'active', workflowId: 'wf-1' },
    })
    mockReadExecutionEventsState.mockResolvedValue({ status: 'ok', events: [] })
  })

  it('drains final events after terminal meta before sending DONE', async () => {
    mockReadExecutionMetaState
      .mockResolvedValueOnce({
        status: 'found',
        meta: { status: 'active', workflowId: 'wf-1' },
      })
      .mockResolvedValueOnce({
        status: 'found',
        meta: { status: 'complete', workflowId: 'wf-1' },
      })
    mockReadExecutionEventsState
      .mockResolvedValueOnce({ status: 'ok', events: [] })
      .mockResolvedValueOnce({ status: 'ok', events: [completedEntry(4)] })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=3'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    expect(response.status).toBe(200)
    const body = await response.text()
    const completedIndex = body.indexOf('"type":"execution:completed"')
    const doneIndex = body.indexOf('data: [DONE]')

    expect(completedIndex).toBeGreaterThanOrEqual(0)
    expect(doneIndex).toBeGreaterThan(completedIndex)
    expect(mockReadExecutionEventsState).toHaveBeenNthCalledWith(1, 'exec-1', 3)
    expect(mockReadExecutionEventsState).toHaveBeenNthCalledWith(2, 'exec-1', 3)
  })

  it('errors when terminal metadata has no terminal event to replay', async () => {
    mockReadExecutionMetaState
      .mockResolvedValueOnce({
        status: 'found',
        meta: { status: 'active', workflowId: 'wf-1' },
      })
      .mockResolvedValueOnce({
        status: 'found',
        meta: { status: 'complete', workflowId: 'wf-1' },
      })
    mockReadExecutionEventsState
      .mockResolvedValueOnce({ status: 'ok', events: [] })
      .mockResolvedValueOnce({ status: 'ok', events: [] })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=3'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toThrow(
      'Execution reached terminal metadata without a terminal event'
    )
  })

  it('allows replay event id gaps from reserved but unused writer ids', async () => {
    mockReadExecutionEventsState.mockResolvedValueOnce({
      status: 'ok',
      events: [completedEntry(101)],
    })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=3'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    expect(response.status).toBe(200)
    const body = await response.text()

    expect(body).toContain('"eventId":101')
    expect(body).toContain('data: [DONE]')
  })

  it('errors when replay events are not strictly increasing', async () => {
    mockReadExecutionEventsState.mockResolvedValueOnce({
      status: 'ok',
      events: [completedEntry(3)],
    })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=3'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toThrow(
      'Execution event replay order violation: previous 3, received 3'
    )
  })

  it('returns unavailable when metadata cannot be read', async () => {
    mockReadExecutionMetaState.mockResolvedValueOnce({
      status: 'unavailable',
      error: 'redis unavailable',
    })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=3'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Run buffer temporarily unavailable',
    })
  })

  it('stops after replaying a terminal event even when metadata is still active', async () => {
    mockReadExecutionEventsState.mockResolvedValueOnce({
      status: 'ok',
      events: [completedEntry(4)],
    })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=3'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    expect(response.status).toBe(200)
    const body = await response.text()

    expect(body).toContain('"type":"execution:completed"')
    expect(body).toContain('data: [DONE]')
    expect(mockReadExecutionEventsState).toHaveBeenCalledTimes(1)
    expect(mockReadExecutionMetaState).toHaveBeenCalledTimes(1)
  })

  it('errors the stream when replay events cannot be read', async () => {
    mockReadExecutionEventsState.mockResolvedValueOnce({
      status: 'unavailable',
      error: 'redis read failed',
    })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=3'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toThrow('Execution events unavailable: redis read failed')
  })

  it('errors the stream when requested events were pruned', async () => {
    mockReadExecutionEventsState.mockResolvedValueOnce({
      status: 'pruned',
      earliestEventId: 10,
    })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=3'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toThrow(
      'Execution events pruned before requested event id'
    )
  })
})
