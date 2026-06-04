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
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueue, mockExecuteWorkflowCore, mockHandlePostExecutionPauseState } = vi.hoisted(
  () => ({
    mockEnqueue: vi.fn().mockResolvedValue('job-123'),
    mockExecuteWorkflowCore: vi.fn(),
    mockHandlePostExecutionPauseState: vi.fn(),
  })
)

const mockCheckHybridAuth = hybridAuthMockFns.mockCheckHybridAuth
const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution

const mockAuthorizeWorkflowByWorkspacePermission =
  workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
}))

vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: mockHandlePostExecutionPauseState,
}))

vi.mock('@/lib/execution/payloads/store', () => ({
  storeLargeValue: vi.fn(async (_value, _json, size: number) => ({
    __simLargeValueRef: true,
    version: 1,
    id: 'lv_abcdefghijkl',
    kind: 'string',
    size,
  })),
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

import { storeLargeValue } from '@/lib/execution/payloads/store'
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
    workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState.mockResolvedValue(null)
    workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables.mockResolvedValue(null)
    mockExecuteWorkflowCore.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { ok: true },
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    mockHandlePostExecutionPauseState.mockResolvedValue(undefined)
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

    const response = await POST(req, { params })
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

  it('rejects oversized request bodies before authorization work', async () => {
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'Content-Length': String(10 * 1024 * 1024 + 1),
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error).toContain('Workflow execution request body')
    expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
  })

  it('authenticates before rejecting oversized request bodies', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
      authType: 'api_key',
    })
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'Content-Length': String(10 * 1024 * 1024 + 1),
        'X-API-Key': 'invalid',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(mockCheckHybridAuth).toHaveBeenCalled()
  })

  it('returns 499 when a non-SSE execution is cancelled by client disconnect', async () => {
    const abortController = new AbortController()
    mockExecuteWorkflowCore.mockImplementationOnce(
      async ({ abortSignal }: { abortSignal: AbortSignal }) => {
        abortController.abort()
        expect(abortSignal.aborted).toBe(true)
        return {
          success: false,
          status: 'cancelled',
          output: { partial: true },
          metadata: {
            duration: 100,
            startTime: '2026-01-01T00:00:00Z',
            endTime: '2026-01-01T00:00:01Z',
          },
        }
      }
    )
    const req = new NextRequest('http://localhost:3000/api/workflows/workflow-1/execute', {
      method: 'POST',
      body: JSON.stringify({ input: { hello: 'world' } }),
      signal: abortController.signal,
    })
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(499)
    expect(body.error).toBe('Client cancelled request')
  })

  it('rejects large MCP bridge outputs instead of returning large-value refs', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'internal-user-1',
      authType: 'internal_jwt',
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: 'x'.repeat(10 * 1024 * 1024 + 1),
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Sim-MCP-Tool-Call': 'true',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error).toContain('Workflow execution response')
    expect(storeLargeValue).not.toHaveBeenCalled()
  })

  it('does not trust client-spoofed MCP bridge headers on API key executions', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'api-user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
    })
    workflowsUtilsMockFns.mockWorkflowHasResponseBlock.mockReturnValueOnce(true)
    workflowsUtilsMockFns.mockCreateHttpResponseFromBlock.mockResolvedValueOnce(
      Response.json({ response: 'plain text body' })
    )
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: { response: 'plain text body' },
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-API-Key': 'valid',
        'X-Sim-MCP-Tool-Call': 'true',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ response: 'plain text body' })
    expect(workflowsUtilsMockFns.mockCreateHttpResponseFromBlock).toHaveBeenCalled()
  })

  it('keeps trusted internal MCP bridge executions on the JSON envelope path', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'internal-user-1',
      authType: 'internal_jwt',
    })
    workflowsUtilsMockFns.mockWorkflowHasResponseBlock.mockReturnValueOnce(true)
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: { response: 'plain text body' },
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Sim-MCP-Tool-Call': 'true',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      output: { response: 'plain text body' },
    })
    expect(workflowsUtilsMockFns.mockCreateHttpResponseFromBlock).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          input: { hello: 'world' },
        }),
      })
    )
  })

  it('preserves authenticated-user actor semantics for trusted MCP bridge calls', async () => {
    mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'api-user-1',
      authType: 'internal_jwt',
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: { ok: true },
      metadata: {
        duration: 100,
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
      },
    })
    const req = createMockRequest(
      'POST',
      { input: { hello: 'world' } },
      {
        'Content-Type': 'application/json',
        'X-Sim-MCP-Tool-Call': 'true',
        'X-Sim-MCP-Tool-Actor': 'authenticated-user',
      }
    )
    const params = Promise.resolve({ id: 'workflow-1' })

    const response = await POST(req, { params })

    expect(response.status).toBe(200)
    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'api-user-1',
        useAuthenticatedUserAsActor: true,
      })
    )
    const executionCall = mockExecuteWorkflowCore.mock.calls[0][0]
    const snapshot =
      typeof executionCall.snapshot === 'string'
        ? JSON.parse(executionCall.snapshot)
        : executionCall.snapshot
    expect(snapshot.metadata.enforceCredentialAccess).toBe(true)
  })
})
