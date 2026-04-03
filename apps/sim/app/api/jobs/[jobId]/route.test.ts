/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckHybridAuth, mockGetJobQueue, mockVerifyWorkflowAccess, mockGetWorkflowById } =
  vi.hoisted(() => ({
    mockCheckHybridAuth: vi.fn(),
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
  getJobQueue: mockGetJobQueue,
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

  it('returns pending status for a queued job', async () => {
    mockGetJobQueue.mockResolvedValue({
      getJob: vi.fn().mockResolvedValue({
        id: 'job-1',
        type: 'workflow-execution',
        payload: {},
        status: 'pending',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        attempts: 0,
        maxAttempts: 1,
        metadata: {
          workflowId: 'workflow-1',
        },
      }),
    })

    const response = await GET(createMockRequest(), {
      params: Promise.resolve({ jobId: 'job-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('pending')
  })

  it('returns completed output from job', async () => {
    mockGetJobQueue.mockResolvedValue({
      getJob: vi.fn().mockResolvedValue({
        id: 'job-2',
        type: 'workflow-execution',
        payload: {},
        status: 'completed',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        startedAt: new Date('2025-01-01T00:00:01Z'),
        completedAt: new Date('2025-01-01T00:00:06Z'),
        attempts: 1,
        maxAttempts: 1,
        output: { success: true },
        metadata: {
          workflowId: 'workflow-1',
        },
      }),
    })

    const response = await GET(createMockRequest(), {
      params: Promise.resolve({ jobId: 'job-2' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('completed')
    expect(body.output).toEqual({ success: true })
  })

  it('returns 404 when job does not exist', async () => {
    const response = await GET(createMockRequest(), {
      params: Promise.resolve({ jobId: 'missing-job' }),
    })

    expect(response.status).toBe(404)
  })

  it('returns 401 for unauthenticated requests', async () => {
    mockCheckHybridAuth.mockResolvedValue({
      success: false,
      error: 'Not authenticated',
    })

    const response = await GET(createMockRequest(), {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    expect(response.status).toBe(401)
  })
})
