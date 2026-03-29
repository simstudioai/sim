/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckHybridAuth,
  mockGetDispatchJobRecord,
  mockGetJobQueue,
  mockVerifyWorkflowAccess,
  mockGetWorkflowById,
} = vi.hoisted(() => ({
  mockCheckHybridAuth: vi.fn(),
  mockGetDispatchJobRecord: vi.fn(),
  mockGetJobQueue: vi.fn(),
  mockVerifyWorkflowAccess: vi.fn(),
  mockGetWorkflowById: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: mockCheckHybridAuth,
}))

vi.mock('@/lib/core/async-jobs', () => ({
  JOB_STATUS: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
  },
  getJobQueue: mockGetJobQueue,
}))

vi.mock('@/lib/core/workspace-dispatch/store', () => ({
  getDispatchJobRecord: mockGetDispatchJobRecord,
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('request-1'),
}))

vi.mock('@/socket/middleware/permissions', () => ({
  verifyWorkflowAccess: mockVerifyWorkflowAccess,
}))

vi.mock('@/lib/workflows/utils', () => ({
  getWorkflowById: mockGetWorkflowById,
}))

import { GET } from './route'

function createMockRequest(): NextRequest {
  return {
    headers: {
      get: () => null,
    },
  } as NextRequest
}

describe('GET /api/jobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      apiKeyType: undefined,
      workspaceId: undefined,
    })

    mockVerifyWorkflowAccess.mockResolvedValue({ hasAccess: true })
    mockGetWorkflowById.mockResolvedValue({
      id: 'workflow-1',
      workspaceId: 'workspace-1',
    })

    mockGetJobQueue.mockResolvedValue({
      getJob: vi.fn().mockResolvedValue(null),
    })
  })

  it('returns dispatcher-aware waiting status with metadata', async () => {
    mockGetDispatchJobRecord.mockResolvedValue({
      id: 'dispatch-1',
      workspaceId: 'workspace-1',
      lane: 'runtime',
      queueName: 'workflow-execution',
      bullmqJobName: 'workflow-execution',
      bullmqPayload: {},
      metadata: {
        workflowId: 'workflow-1',
      },
      priority: 10,
      status: 'waiting',
      createdAt: 1000,
      admittedAt: 2000,
    })

    const response = await GET(createMockRequest(), {
      params: Promise.resolve({ jobId: 'dispatch-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('waiting')
    expect(body.metadata.queueName).toBe('workflow-execution')
    expect(body.metadata.lane).toBe('runtime')
    expect(body.metadata.workspaceId).toBe('workspace-1')
  })

  it('returns completed output from dispatch state', async () => {
    mockGetDispatchJobRecord.mockResolvedValue({
      id: 'dispatch-2',
      workspaceId: 'workspace-1',
      lane: 'interactive',
      queueName: 'workflow-execution',
      bullmqJobName: 'direct-workflow-execution',
      bullmqPayload: {},
      metadata: {
        workflowId: 'workflow-1',
      },
      priority: 1,
      status: 'completed',
      createdAt: 1000,
      startedAt: 2000,
      completedAt: 7000,
      output: { success: true },
    })

    const response = await GET(createMockRequest(), {
      params: Promise.resolve({ jobId: 'dispatch-2' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('completed')
    expect(body.output).toEqual({ success: true })
    expect(body.metadata.duration).toBe(5000)
  })

  it('returns 404 when neither dispatch nor BullMQ job exists', async () => {
    mockGetDispatchJobRecord.mockResolvedValue(null)

    const response = await GET(createMockRequest(), {
      params: Promise.resolve({ jobId: 'missing-job' }),
    })

    expect(response.status).toBe(404)
  })
})
