/**
 * @vitest-environment node
 */

import {
  createMockRequest,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  hybridAuthMockFns,
  loggingSessionMock,
  requestUtilsMockFns,
  workflowAuthzMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueue } = vi.hoisted(() => ({
  mockEnqueue: vi.fn().mockResolvedValue('job-123'),
}))

const mockCheckHybridAuth = hybridAuthMockFns.mockCheckHybridAuth
const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution

const mockAuthorizeWorkflowByWorkspacePermission =
  workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: vi.fn().mockResolvedValue({
    enqueue: mockEnqueue,
    startJob: vi.fn(),
    completeJob: vi.fn(),
    markJobFailed: vi.fn(),
  }),
  shouldExecuteInline: vi.fn().mockReturnValue(false),
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

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/background/workflow-execution', () => ({
  executeWorkflowJob: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
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

    requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('req-12345678')
    workflowsUtilsMockFns.mockWorkflowHasResponseBlock.mockReturnValue(false)
    hybridAuthMockFns.mockHasExternalApiCredentials.mockReturnValue(true)

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
