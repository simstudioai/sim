/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckHybridAuth = vi.fn()
const mockAuthorizeWorkflowByWorkspacePermission = vi.fn()
const mockMarkExecutionCancelled = vi.fn()
const mockAbortManualExecution = vi.fn()

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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

vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: (params: unknown) =>
    mockAuthorizeWorkflowByWorkspacePermission(params),
}))

import { POST } from './route'

describe('POST /api/workflows/[id]/executions/[executionId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckHybridAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({ allowed: true })
    mockAbortManualExecution.mockReturnValue(false)
  })

  it('returns success when cancellation was durably recorded', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: true,
      reason: 'recorded',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/workflows/wf-1/executions/ex-1/cancel', {
        method: 'POST',
      }),
      {
        params: Promise.resolve({ id: 'wf-1', executionId: 'ex-1' }),
      }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'ex-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      reason: 'recorded',
    })
  })

  it('returns unsuccessful response when Redis is unavailable', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/workflows/wf-1/executions/ex-1/cancel', {
        method: 'POST',
      }),
      {
        params: Promise.resolve({ id: 'wf-1', executionId: 'ex-1' }),
      }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      executionId: 'ex-1',
      redisAvailable: false,
      durablyRecorded: false,
      locallyAborted: false,
      reason: 'redis_unavailable',
    })
  })

  it('returns unsuccessful response when Redis persistence fails', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_write_failed',
    })

    const response = await POST(
      new NextRequest('http://localhost/api/workflows/wf-1/executions/ex-1/cancel', {
        method: 'POST',
      }),
      {
        params: Promise.resolve({ id: 'wf-1', executionId: 'ex-1' }),
      }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      executionId: 'ex-1',
      redisAvailable: true,
      durablyRecorded: false,
      locallyAborted: false,
      reason: 'redis_write_failed',
    })
  })

  it('returns success when local fallback aborts execution without Redis durability', async () => {
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    mockAbortManualExecution.mockReturnValue(true)

    const response = await POST(
      new NextRequest('http://localhost/api/workflows/wf-1/executions/ex-1/cancel', {
        method: 'POST',
      }),
      {
        params: Promise.resolve({ id: 'wf-1', executionId: 'ex-1' }),
      }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      executionId: 'ex-1',
      redisAvailable: false,
      durablyRecorded: false,
      locallyAborted: true,
      reason: 'redis_unavailable',
    })
  })
})
