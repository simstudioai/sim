/**
 * @vitest-environment node
 */
import { createMockRequest, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

const {
  MockWorkflowEvalRunNotActiveError,
  MockWorkflowEvalRunNotFoundError,
  mockAuthorizeWorkflow,
  mockGetSession,
  mockIsFeatureEnabled,
  mockStopWorkflowEvalRun,
} = vi.hoisted(() => ({
  MockWorkflowEvalRunNotActiveError: class WorkflowEvalRunNotActiveError extends Error {},
  MockWorkflowEvalRunNotFoundError: class WorkflowEvalRunNotFoundError extends Error {},
  mockAuthorizeWorkflow: vi.fn(),
  mockGetSession: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockStopWorkflowEvalRun: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@sim/platform-authz/workflow', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))
vi.mock('@/lib/workflows/evals/run-service', () => ({
  WorkflowEvalRunNotActiveError: MockWorkflowEvalRunNotActiveError,
  WorkflowEvalRunNotFoundError: MockWorkflowEvalRunNotFoundError,
  stopWorkflowEvalRun: mockStopWorkflowEvalRun,
}))

import { POST } from './route'

function callRoute(
  params: { id?: string; suiteId?: string; runId?: string } = {},
  headers?: Record<string, string>
) {
  return POST(createMockRequest('POST', undefined, headers), {
    params: Promise.resolve({
      id: params.id ?? 'workflow-1',
      suiteId: params.suiteId ?? 'suite-1',
      runId: params.runId ?? 'run-1',
    }),
  })
}

describe('POST /api/workflows/[id]/evals/suites/[suiteId]/runs/[runId]/stop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorizeWorkflow.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })
    dbChainMockFns.limit.mockResolvedValue([{ organizationId: 'organization-1' }])
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockStopWorkflowEvalRun.mockResolvedValue({
      runId: 'run-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      status: 'cancelled',
      revision: 4,
      completedAt: new Date('2026-07-18T12:00:00.000Z'),
    })
  })

  it('authenticates before parsing route parameters', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callRoute({ id: '', suiteId: '', runId: '' })

    expect(response.status).toBe(401)
    expect(mockAuthorizeWorkflow).not.toHaveBeenCalled()
    expect(mockStopWorkflowEvalRun).not.toHaveBeenCalled()
  })

  it('rejects cross-site session requests', async () => {
    const response = await callRoute({}, { 'sec-fetch-site': 'cross-site' })

    expect(response.status).toBe(403)
    expect(mockStopWorkflowEvalRun).not.toHaveBeenCalled()
  })

  it('requires workflow write access', async () => {
    mockAuthorizeWorkflow.mockResolvedValue({
      allowed: false,
      status: 403,
      message: 'Access denied',
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })

    const response = await callRoute()

    expect(response.status).toBe(403)
    expect(mockStopWorkflowEvalRun).not.toHaveBeenCalled()
  })

  it('durably stops the requested Eval run', async () => {
    const response = await callRoute()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      runId: 'run-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      status: 'cancelled',
      revision: 4,
      completedAt: '2026-07-18T12:00:00.000Z',
    })
    expect(mockStopWorkflowEvalRun).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
  })

  it.each([
    { error: new MockWorkflowEvalRunNotFoundError('Run not found'), status: 404 },
    { error: new MockWorkflowEvalRunNotActiveError('Run is complete'), status: 409 },
  ])('maps $status stop failures', async ({ error, status }) => {
    mockStopWorkflowEvalRun.mockRejectedValue(error)

    const response = await callRoute()

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: error.message })
  })
})
