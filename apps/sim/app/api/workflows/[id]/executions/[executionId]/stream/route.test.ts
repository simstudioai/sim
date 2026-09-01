/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionEventEntry } from '@/lib/execution/event-buffer'

const { mockReadExecutionEventsState, mockReadExecutionMetaState, mockSubscribe } = vi.hoisted(
  () => ({
    mockReadExecutionEventsState: vi.fn(),
    mockReadExecutionMetaState: vi.fn(),
    mockSubscribe: vi.fn(),
  })
)

const mockAuthorizeWorkflowByWorkspacePermission =
  workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

vi.mock('@/lib/execution/event-buffer', () => ({
  EXECUTION_STREAM_PROTOCOL_VERSION: 1,
  readExecutionEventsState: mockReadExecutionEventsState,
  readExecutionMetaState: mockReadExecutionMetaState,
}))

vi.mock('@/lib/execution/execution-signal', () => ({
  getExecutionSignalHub: () => ({ subscribe: mockSubscribe }),
}))

import { GET } from './route'

const mockGetSession = authMockFns.mockGetSession

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

function blockCompletedEntry(eventId: number): ExecutionEventEntry {
  return {
    eventId,
    executionId: 'exec-1',
    event: {
      type: 'block:completed',
      timestamp: new Date().toISOString(),
      executionId: 'exec-1',
      workflowId: 'wf-1',
      data: {
        blockId: 'function-1',
        blockName: 'Qualify',
        blockType: 'function',
        output: { ok: true },
        durationMs: 10,
        startedAt: new Date().toISOString(),
        executionOrder: 2,
        endedAt: new Date().toISOString(),
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
      meta: { status: 'active', workflowId: 'wf-1', protocolVersion: 1 },
    })
    mockReadExecutionEventsState.mockResolvedValue({ status: 'ok', events: [] })
    mockSubscribe.mockResolvedValue(vi.fn())
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

  it('fails closed when terminal metadata has no terminal event to replay', async () => {
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
    const body = await response.text()

    expect(body).toContain('"type":"execution:error"')
    expect(body).toContain('its final event could not be recovered')
    expect(body).toContain('data: [DONE]')
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

  it('hydrates active block starts that were already acknowledged before refresh', async () => {
    const activeBlockStarts = [
      {
        eventId: 4,
        data: {
          blockId: 'function-1',
          blockName: 'Qualify',
          blockType: 'function',
          executionOrder: 2,
        },
      },
    ]
    mockReadExecutionMetaState.mockResolvedValue({
      status: 'found',
      meta: { status: 'active', workflowId: 'wf-1', activeBlockStarts },
    })
    mockReadExecutionEventsState.mockResolvedValueOnce({
      status: 'ok',
      events: [completedEntry(6)],
    })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=5'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body.indexOf('"type":"block:started"')).toBeLessThan(
      body.indexOf('"type":"execution:completed"')
    )
    expect(body).toContain('"blockId":"function-1"')
  })

  it('hydrates an active block snapshot committed after the reconnect subscription starts', async () => {
    let signalHandler: ((reason: 'event') => void) | undefined
    mockSubscribe.mockImplementationOnce(async (_executionId, handler) => {
      signalHandler = handler
      return vi.fn()
    })
    mockReadExecutionMetaState
      .mockResolvedValueOnce({
        status: 'found',
        meta: { status: 'active', workflowId: 'wf-1', protocolVersion: 1 },
      })
      .mockResolvedValueOnce({
        status: 'found',
        meta: { status: 'active', workflowId: 'wf-1', protocolVersion: 1 },
      })
      .mockResolvedValueOnce({
        status: 'found',
        meta: {
          status: 'active',
          workflowId: 'wf-1',
          protocolVersion: 1,
          activeBlockStarts: [
            {
              eventId: 4,
              data: {
                blockId: 'function-1',
                blockName: 'Qualify',
                blockType: 'function',
                executionOrder: 2,
              },
            },
          ],
        },
      })
    mockReadExecutionEventsState
      .mockResolvedValueOnce({ status: 'ok', events: [] })
      .mockResolvedValueOnce({ status: 'ok', events: [] })
      .mockResolvedValueOnce({ status: 'ok', events: [completedEntry(6)] })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=5'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })
    const body = response.text()
    await vi.waitFor(() => expect(mockReadExecutionEventsState).toHaveBeenCalledTimes(1))

    signalHandler?.('event')
    await vi.waitFor(() => expect(mockReadExecutionMetaState).toHaveBeenCalledTimes(3))
    signalHandler?.('event')

    const text = await body
    expect(text.indexOf('"type":"block:started"')).toBeLessThan(
      text.indexOf('"type":"execution:completed"')
    )
    expect(text.match(/"type":"block:started"/g)).toHaveLength(1)
  })

  it('does not rehydrate a stale active snapshot after its completion event was replayed', async () => {
    let signalHandler: ((reason: 'event') => void) | undefined
    mockSubscribe.mockImplementationOnce(async (_executionId, handler) => {
      signalHandler = handler
      return vi.fn()
    })
    const staleActiveMeta = {
      status: 'found' as const,
      meta: {
        status: 'active' as const,
        workflowId: 'wf-1',
        protocolVersion: 1,
        activeBlockStarts: [
          {
            eventId: 4,
            data: {
              blockId: 'function-1',
              blockName: 'Qualify',
              blockType: 'function',
              executionOrder: 2,
            },
          },
        ],
      },
    }
    mockReadExecutionMetaState
      .mockResolvedValueOnce({
        status: 'found',
        meta: { status: 'active', workflowId: 'wf-1', protocolVersion: 1 },
      })
      .mockResolvedValueOnce({
        status: 'found',
        meta: { status: 'active', workflowId: 'wf-1', protocolVersion: 1 },
      })
      .mockResolvedValueOnce(staleActiveMeta)
    mockReadExecutionEventsState
      .mockResolvedValueOnce({ status: 'ok', events: [] })
      .mockResolvedValueOnce({ status: 'ok', events: [blockCompletedEntry(6)] })
      .mockResolvedValueOnce({ status: 'ok', events: [completedEntry(7)] })

    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=5'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })
    const body = response.text()
    await vi.waitFor(() => expect(mockReadExecutionEventsState).toHaveBeenCalledTimes(1))

    signalHandler?.('event')
    await vi.waitFor(() => expect(mockReadExecutionMetaState).toHaveBeenCalledTimes(3))
    signalHandler?.('event')

    const text = await body
    expect(text).toContain('"type":"block:completed"')
    expect(text).not.toContain('"type":"block:started"')
  })

  it('fails the observer closed when its Redis signal subscription becomes unavailable', async () => {
    mockSubscribe.mockImplementationOnce(async (_executionId, handler) => {
      queueMicrotask(() => handler('unavailable'))
      return vi.fn()
    })
    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=0'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })

    await expect(response.text()).rejects.toThrow(
      'Execution signal subscription became unavailable'
    )
  })

  it('unsubscribes immediately when the client closes before subscription acknowledgement', async () => {
    let acknowledge!: (unsubscribe: () => void) => void
    const cleanup = vi.fn()
    mockSubscribe.mockReturnValueOnce(
      new Promise<() => void>((resolve) => {
        acknowledge = resolve
      })
    )
    const req = createMockRequest(
      'GET',
      undefined,
      undefined,
      'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=0'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
    })
    const reader = response.body!.getReader()
    const cancelled = reader.cancel()

    acknowledge(cleanup)
    await cancelled

    expect(cleanup).toHaveBeenCalledOnce()
    expect(mockReadExecutionEventsState).not.toHaveBeenCalled()
  })

  it('keeps reading events from a legacy producer that cannot publish wake signals', async () => {
    vi.useFakeTimers()
    try {
      mockReadExecutionMetaState
        .mockResolvedValueOnce({
          status: 'found',
          meta: { status: 'active', workflowId: 'wf-1' },
        })
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
        .mockResolvedValueOnce({ status: 'ok', events: [completedEntry(1)] })

      const req = createMockRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost/api/workflows/wf-1/executions/exec-1/stream?from=0'
      )
      const response = await GET(req, {
        params: Promise.resolve({ id: 'wf-1', executionId: 'exec-1' }),
      })
      const body = response.text()
      await vi.advanceTimersByTimeAsync(500)

      await expect(body).resolves.toContain('"type":"execution:completed"')
    } finally {
      vi.useRealTimers()
    }
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
    expect(mockReadExecutionMetaState).toHaveBeenCalledTimes(2)
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
