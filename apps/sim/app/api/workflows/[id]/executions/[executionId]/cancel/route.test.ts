/**
 * @vitest-environment node
 */

import { databaseMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckHybridAuth,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockMarkExecutionCancelled,
  mockAbortManualExecution,
  mockCancelPausedExecution,
  mockSetExecutionMeta,
  mockWriteEvent,
  mockCloseWriter,
} = vi.hoisted(() => ({
  mockCheckHybridAuth: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockMarkExecutionCancelled: vi.fn(),
  mockAbortManualExecution: vi.fn(),
  mockCancelPausedExecution: vi.fn(),
  mockSetExecutionMeta: vi.fn(),
  mockWriteEvent: vi.fn(),
  mockCloseWriter: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: (...args: unknown[]) => mockCheckHybridAuth(...args),
}))

vi.mock('@/lib/execution/cancellation', () => ({
  markExecutionCancelled: (...args: unknown[]) => mockMarkExecutionCancelled(...args),
}))

vi.mock('@/lib/execution/manual-cancellation', () => ({
  abortManualExecution: (...args: unknown[]) => mockAbortManualExecution(...args),
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    cancelPausedExecution: (...args: unknown[]) => mockCancelPausedExecution(...args),
  },
}))

vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: (params: unknown) =>
    mockAuthorizeWorkflowByWorkspacePermission(params),
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/execution/event-buffer', () => ({
  setExecutionMeta: (...args: unknown[]) => mockSetExecutionMeta(...args),
  createExecutionEventWriter: () => ({
    write: (...args: unknown[]) => mockWriteEvent(...args),
    close: () => mockCloseWriter(),
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
    mockCheckHybridAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({ allowed: true })
    mockAbortManualExecution.mockReturnValue(false)
    mockCancelPausedExecution.mockResolvedValue(false)
    mockSetExecutionMeta.mockResolvedValue(undefined)
    mockWriteEvent.mockResolvedValue({ eventId: 1 })
    mockCloseWriter.mockResolvedValue(undefined)
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
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockCancelPausedExecution.mockResolvedValue(true)

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'ex-1',
      redisAvailable: false,
      durablyRecorded: false,
      locallyAborted: false,
      pausedCancelled: true,
      reason: 'redis_unavailable',
    })
  })

  it('returns 401 when auth fails', async () => {
    mockCheckHybridAuth.mockResolvedValue({ success: false, error: 'Unauthorized' })

    const response = await POST(makeRequest(), makeParams())

    expect(response.status).toBe(401)
  })

  it('returns 403 when workflow access is denied', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({ durablyRecorded: true, reason: 'recorded' })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
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
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockCancelPausedExecution.mockResolvedValue(true)

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
