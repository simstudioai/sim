/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckHybridAuth,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockPreprocessExecution,
  mockEnqueue,
} = vi.hoisted(() => ({
  mockCheckHybridAuth: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockPreprocessExecution: vi.fn(),
  mockEnqueue: vi.fn().mockResolvedValue('job-123'),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: mockCheckHybridAuth,
  hasExternalApiCredentials: vi.fn().mockReturnValue(true),
  AuthType: {
    SESSION: 'session',
    API_KEY: 'api_key',
    INTERNAL_JWT: 'internal_jwt',
  },
}))

vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
  createHttpResponseFromBlock: vi.fn(),
  workflowHasResponseBlock: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/execution/preprocessing', () => ({
  preprocessExecution: mockPreprocessExecution,
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn().mockResolvedValue({
    enqueue: mockEnqueue,
    startJob: vi.fn(),
    completeJob: vi.fn(),
    markJobFailed: vi.fn(),
  }),
  shouldExecuteInline: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/core/utils/request', () => ({
  generateRequestId: vi.fn().mockReturnValue('req-12345678'),
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: vi.fn().mockReturnValue('http://localhost:3000'),
  getOllamaUrl: vi.fn().mockReturnValue('http://localhost:11434'),
}))

vi.mock('@/lib/execution/call-chain', () => ({
  SIM_VIA_HEADER: 'x-sim-via',
  parseCallChain: vi.fn().mockReturnValue([]),
  validateCallChain: vi.fn().mockReturnValue(null),
  buildNextCallChain: vi.fn().mockReturnValue(['workflow-1']),
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@/background/workflow-execution', () => ({
  executeWorkflowJob: vi.fn(),
}))

vi.mock('@sim/logger', () => {
  const createMockLogger = (): Record<string, any> => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    withMetadata: vi.fn(() => createMockLogger()),
  })
  return { createLogger: vi.fn(() => createMockLogger()) }
})

vi.mock('@/lib/core/utils/uuid', () => ({
  generateId: vi.fn(() => 'execution-123'),
  generateShortId: vi.fn(() => 'mock-short-id'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

import { POST } from './route'

describe('workflow execute async route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockCheckHybridAuth.mockResolvedValue({
      success: true,
      userId: 'session-user-1',
      authType: 'session',
    })

    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      workflow: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    })

    mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    })
  })

  it('queues async execution with matching correlation metadata', async () => {
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Execution-Mode': 'async',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req as any, { params })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.executionId).toBe('execution-123')
    expect(body.jobId).toBe('job-123')
    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-execution',
      expect.objectContaining({
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        executionId: 'execution-123',
        executionMode: 'async',
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          workflowId: 'workflow-1',
          userId: 'actor-1',
          workspaceId: 'workspace-1',
          correlation: expect.objectContaining({
            executionId: 'execution-123',
            requestId: 'req-12345678',
            source: 'workflow',
            workflowId: 'workflow-1',
            triggerType: 'manual',
          }),
        }),
      })
    )
  })
})
