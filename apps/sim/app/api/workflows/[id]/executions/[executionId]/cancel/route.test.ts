/**
 * @vitest-environment node
 */

import {
  databaseMock,
  hybridAuthMockFns,
  posthogServerMock,
  workflowAuthzMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockMarkExecutionCancelled,
  mockAbortManualExecution,
  mockBeginPausedCancellation,
  mockBlockQueuedResumesForCancellation,
  mockClearPausedCancellationIntent,
  mockCompletePausedCancellation,
  mockGetPausedCancellationStatus,
  mockFinalizeExecutionStream,
  mockReadExecutionMetaState,
  mockWriteEvent,
  mockWriteTerminalEvent,
} = vi.hoisted(() => ({
  mockMarkExecutionCancelled: vi.fn(),
  mockAbortManualExecution: vi.fn(),
  mockBeginPausedCancellation: vi.fn(),
  mockBlockQueuedResumesForCancellation: vi.fn(),
  mockClearPausedCancellationIntent: vi.fn(),
  mockCompletePausedCancellation: vi.fn(),
  mockGetPausedCancellationStatus: vi.fn(),
  mockFinalizeExecutionStream: vi.fn(),
  mockReadExecutionMetaState: vi.fn(),
  mockWriteEvent: vi.fn(),
  mockWriteTerminalEvent: vi.fn(),
}))

vi.mock('@/lib/execution/cancellation', () => ({
  markExecutionCancelled: (...args: unknown[]) => mockMarkExecutionCancelled(...args),
}))

vi.mock('@/lib/execution/manual-cancellation', () => ({
  abortManualExecution: (...args: unknown[]) => mockAbortManualExecution(...args),
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    beginPausedCancellation: (...args: unknown[]) => mockBeginPausedCancellation(...args),
    blockQueuedResumesForCancellation: (...args: unknown[]) =>
      mockBlockQueuedResumesForCancellation(...args),
    clearPausedCancellationIntent: (...args: unknown[]) =>
      mockClearPausedCancellationIntent(...args),
    completePausedCancellation: (...args: unknown[]) => mockCompletePausedCancellation(...args),
    getPausedCancellationStatus: (...args: unknown[]) => mockGetPausedCancellationStatus(...args),
  },
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/execution/event-buffer', () => ({
  finalizeExecutionStream: (...args: unknown[]) => mockFinalizeExecutionStream(...args),
  readExecutionMetaState: (...args: unknown[]) => mockReadExecutionMetaState(...args),
  createExecutionEventWriter: () => ({
    write: (...args: unknown[]) => mockWriteEvent(...args),
    writeTerminal: (...args: unknown[]) => mockWriteTerminalEvent(...args),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}))

import { POST } from './route'

const makeRequest = () =>
  new NextRequest('http://localhost/api/workflows/wf-1/executions/ex-1/cancel', {
    method: 'POST',
  })

const makeParams = () => ({ params: Promise.resolve({ id: 'wf-1', executionId: 'ex-1' }) })

describe('POST /api/workflows/[id]/executions/[executionId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
    })
    mockAbortManualExecution.mockReturnValue(false)
    mockBeginPausedCancellation.mockResolvedValue(false)
    mockBlockQueuedResumesForCancellation.mockResolvedValue(false)
    mockClearPausedCancellationIntent.mockResolvedValue(undefined)
    mockCompletePausedCancellation.mockResolvedValue(false)
    mockGetPausedCancellationStatus.mockResolvedValue(null)
    mockFinalizeExecutionStream.mockResolvedValue(true)
    mockReadExecutionMetaState.mockResolvedValue({ status: 'missing' })
    mockWriteEvent.mockResolvedValue({ eventId: 1 })
    mockWriteTerminalEvent.mockResolvedValue({ eventId: 1 })
  })

  it('returns success when cancellation was durably recorded', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: true,
      reason: 'recorded',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'ex-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'recorded',
    })
  })

  it('returns unsuccessful response when Redis is unavailable', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      executionId: 'ex-1',
      redisAvailable: false,
      durablyRecorded: false,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'redis_unavailable',
    })
  })

  it('returns unsuccessful response when Redis persistence fails', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_write_failed',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      executionId: 'ex-1',
      redisAvailable: true,
      durablyRecorded: false,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'redis_write_failed',
    })
  })

  it('returns success when local fallback aborts execution without Redis durability', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockAbortManualExecution.mockReturnValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'ex-1',
      redisAvailable: false,
      durablyRecorded: false,
      locallyAborted: true,
      pausedCancelled: false,
      reason: 'redis_unavailable',
    })
  })

  it('returns success when a paused HITL execution is cancelled directly in the database', async () => {
    mockBeginPausedCancellation.mockResolvedValue(true)
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'ex-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: true,
      reason: 'recorded',
    })
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockWriteTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'execution:cancelled',
        executionId: 'ex-1',
        workflowId: 'wf-1',
      }),
      'cancelled'
    )
    expect(mockFinalizeExecutionStream).not.toHaveBeenCalled()
  })

  it('publishes paused cancellation event even when Redis cancellation is recorded', async () => {
    mockBeginPausedCancellation.mockResolvedValue(true)
    mockCompletePausedCancellation.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      executionId: 'ex-1',
      durablyRecorded: true,
      pausedCancelled: true,
    })
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockWriteTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'execution:cancelled',
        executionId: 'ex-1',
        workflowId: 'wf-1',
      }),
      'cancelled'
    )
    expect(mockFinalizeExecutionStream).not.toHaveBeenCalled()
  })

  it('does not confirm paused cancellation when terminal event publication fails', async () => {
    mockBeginPausedCancellation.mockResolvedValue(true)
    mockCompletePausedCancellation.mockResolvedValue(true)
    mockWriteTerminalEvent.mockRejectedValue(new Error('Redis unavailable'))

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      executionId: 'ex-1',
      redisAvailable: false,
      durablyRecorded: false,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'paused_event_publish_failed',
    })
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
    expect(mockCompletePausedCancellation).not.toHaveBeenCalled()
    expect(mockWriteTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'execution:cancelled',
        executionId: 'ex-1',
        workflowId: 'wf-1',
      }),
      'cancelled'
    )
    expect(mockFinalizeExecutionStream).not.toHaveBeenCalled()
  })

  it('returns 401 when auth fails', async () => {
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(401)
  })

  it('returns 403 when workflow access is denied', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: false,
      message: 'Access denied',
      status: 403,
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(403)
  })

  it('updates execution log status in DB when durably recorded', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined)
    const mockSet = vi.fn(() => ({ where: mockWhere }))
    databaseMock.db.update.mockReturnValueOnce({ set: mockSet })
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: true,
      reason: 'recorded',
    })

    await POST(makeRequest(), makeParams())

    expect(databaseMock.db.update).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith({
      status: 'cancelled',
      endedAt: expect.any(Date),
    })
  })

  it('updates execution log status in DB when locally aborted', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined)
    const mockSet = vi.fn(() => ({ where: mockWhere }))
    databaseMock.db.update.mockReturnValueOnce({ set: mockSet })
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockAbortManualExecution.mockReturnValue(true)

    await POST(makeRequest(), makeParams())

    expect(databaseMock.db.update).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith({
      status: 'cancelled',
      endedAt: expect.any(Date),
    })
  })

  it('does not update execution log status in DB when only paused execution was cancelled', async () => {
    mockBeginPausedCancellation.mockResolvedValue(true)

    await POST(makeRequest(), makeParams())

    expect(databaseMock.db.update).not.toHaveBeenCalled()
  })

  it('returns success even if direct DB update fails', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: true,
      reason: 'recorded',
    })
    databaseMock.db.update.mockReturnValueOnce({
      set: vi.fn(() => ({
        where: vi.fn(() => {
          throw new Error('DB connection failed')
        }),
      })),
    })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
  })
})
