/**
 * @vitest-environment node
 */
import { createMockRequest, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

const {
  MockWorkflowEvalEnqueueError,
  MockWorkflowEvalDefinitionRevisionConflictError,
  MockWorkflowEvalRunAlreadyActiveError,
  MockWorkflowEvalSnapshotTargetError,
  MockWorkflowEvalSuiteNotFoundError,
  MockWorkflowEvalSuiteNotRunnableError,
  MockWorkflowEvalSuiteArchivedError,
  MockWorkflowEvalTestNotFoundError,
  mockAuthorizeWorkflow,
  mockGetSession,
  mockIsFeatureEnabled,
  mockStartWorkflowEvalTestRun,
  mockStartWorkflowEvalSuiteRun,
} = vi.hoisted(() => ({
  MockWorkflowEvalEnqueueError: class WorkflowEvalEnqueueError extends Error {},
  MockWorkflowEvalDefinitionRevisionConflictError: class WorkflowEvalDefinitionRevisionConflictError extends Error {},
  MockWorkflowEvalRunAlreadyActiveError: class WorkflowEvalRunAlreadyActiveError extends Error {},
  MockWorkflowEvalSnapshotTargetError: class WorkflowEvalSnapshotTargetError extends Error {},
  MockWorkflowEvalSuiteNotFoundError: class WorkflowEvalSuiteNotFoundError extends Error {},
  MockWorkflowEvalSuiteNotRunnableError: class WorkflowEvalSuiteNotRunnableError extends Error {},
  MockWorkflowEvalSuiteArchivedError: class WorkflowEvalSuiteArchivedError extends Error {},
  MockWorkflowEvalTestNotFoundError: class WorkflowEvalTestNotFoundError extends Error {},
  mockAuthorizeWorkflow: vi.fn(),
  mockGetSession: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockStartWorkflowEvalTestRun: vi.fn(),
  mockStartWorkflowEvalSuiteRun: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@sim/platform-authz/workflow', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))
vi.mock('@/lib/workflows/evals/run-service', () => ({
  WorkflowEvalEnqueueError: MockWorkflowEvalEnqueueError,
  WorkflowEvalDefinitionRevisionConflictError: MockWorkflowEvalDefinitionRevisionConflictError,
  WorkflowEvalRunAlreadyActiveError: MockWorkflowEvalRunAlreadyActiveError,
  WorkflowEvalSuiteNotFoundError: MockWorkflowEvalSuiteNotFoundError,
  WorkflowEvalSuiteNotRunnableError: MockWorkflowEvalSuiteNotRunnableError,
  WorkflowEvalSuiteArchivedError: MockWorkflowEvalSuiteArchivedError,
  WorkflowEvalTestNotFoundError: MockWorkflowEvalTestNotFoundError,
  startWorkflowEvalTestRun: mockStartWorkflowEvalTestRun,
  startWorkflowEvalSuiteRun: mockStartWorkflowEvalSuiteRun,
}))
vi.mock('@/lib/workflows/evals/snapshot-targets', () => ({
  WorkflowEvalSnapshotTargetError: MockWorkflowEvalSnapshotTargetError,
}))

import { POST } from './route'

interface CallRouteOptions {
  id?: string
  suiteId?: string
  body?: unknown
  headers?: Record<string, string>
}

function callRoute({
  id = 'workflow-1',
  suiteId = 'suite-1',
  body = {},
  headers,
}: CallRouteOptions = {}) {
  return POST(createMockRequest('POST', body, headers), {
    params: Promise.resolve({ id, suiteId }),
  })
}

describe('POST /api/workflows/[id]/evals/suites/[suiteId]/runs', () => {
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
    mockStartWorkflowEvalSuiteRun.mockResolvedValue({
      runId: 'run-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      scope: 'suite',
      selectedTestId: null,
      suiteDefinitionRevision: 1,
      status: 'queued',
      revision: 0,
      totalCount: 2,
      createdAt: new Date('2026-07-16T12:00:00.000Z'),
    })
    mockStartWorkflowEvalTestRun.mockResolvedValue({
      runId: 'run-test-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      scope: 'test',
      selectedTestId: 'test-1',
      suiteDefinitionRevision: 4,
      status: 'queued',
      revision: 0,
      totalCount: 1,
      createdAt: new Date('2026-07-16T12:01:00.000Z'),
    })
  })

  it('authenticates before parsing route parameters', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callRoute({ id: '', suiteId: '' })

    expect(response.status).toBe(401)
    expect(mockAuthorizeWorkflow).not.toHaveBeenCalled()
    expect(mockStartWorkflowEvalSuiteRun).not.toHaveBeenCalled()
  })

  it('rejects invalid route parameters before authorization', async () => {
    const response = await callRoute({ suiteId: '' })

    expect(response.status).toBe(400)
    expect(mockAuthorizeWorkflow).not.toHaveBeenCalled()
    expect(mockStartWorkflowEvalSuiteRun).not.toHaveBeenCalled()
  })

  it('rejects cross-site session requests before parsing or authorization', async () => {
    const response = await callRoute({
      id: '',
      suiteId: '',
      headers: { 'sec-fetch-site': 'cross-site' },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Access denied' })
    expect(mockAuthorizeWorkflow).not.toHaveBeenCalled()
    expect(mockStartWorkflowEvalSuiteRun).not.toHaveBeenCalled()
  })

  it('accepts same-site session requests', async () => {
    const response = await callRoute({ headers: { 'sec-fetch-site': 'same-site' } })

    expect(response.status).toBe(202)
    expect(mockStartWorkflowEvalSuiteRun).toHaveBeenCalledOnce()
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
    expect(mockAuthorizeWorkflow).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'user-1',
      action: 'write',
    })
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
    expect(mockStartWorkflowEvalSuiteRun).not.toHaveBeenCalled()
  })

  it('returns 404 when the workflow does not exist', async () => {
    mockAuthorizeWorkflow.mockResolvedValue({
      allowed: false,
      status: 404,
      workflow: null,
    })

    const response = await callRoute()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Workflow not found' })
    expect(mockStartWorkflowEvalSuiteRun).not.toHaveBeenCalled()
  })

  it('rejects starts when workflow evals are disabled', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    const response = await callRoute()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Workflow evals are not enabled' })
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('workflow-evals', {
      userId: 'user-1',
      orgId: 'organization-1',
    })
    expect(mockStartWorkflowEvalSuiteRun).not.toHaveBeenCalled()
  })

  it('starts the requested suite and returns its queued descriptor', async () => {
    const response = await callRoute()

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      runId: 'run-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      scope: 'suite',
      selectedTestId: null,
      suiteDefinitionRevision: 1,
      status: 'queued',
      revision: 0,
      totalCount: 2,
      createdAt: '2026-07-16T12:00:00.000Z',
    })
    expect(mockStartWorkflowEvalSuiteRun).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      expectedDefinitionRevision: undefined,
    })
  })

  it('starts one requested test against the visible suite definition revision', async () => {
    const response = await callRoute({
      body: { testId: 'test-1', expectedDefinitionRevision: 4 },
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      runId: 'run-test-1',
      scope: 'test',
      selectedTestId: 'test-1',
      suiteDefinitionRevision: 4,
      totalCount: 1,
    })
    expect(mockStartWorkflowEvalTestRun).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      testId: 'test-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      expectedDefinitionRevision: 4,
    })
    expect(mockStartWorkflowEvalSuiteRun).not.toHaveBeenCalled()
  })

  it('rejects a test retry without its expected definition revision', async () => {
    const response = await callRoute({ body: { testId: 'test-1' } })

    expect(response.status).toBe(400)
    expect(mockAuthorizeWorkflow).not.toHaveBeenCalled()
    expect(mockStartWorkflowEvalTestRun).not.toHaveBeenCalled()
  })

  it.each([
    {
      error: new MockWorkflowEvalSuiteNotFoundError('Eval suite was not found'),
      status: 404,
    },
    {
      error: new MockWorkflowEvalRunAlreadyActiveError('Eval suite already has an active run'),
      status: 409,
    },
    {
      error: new MockWorkflowEvalSuiteNotRunnableError('Eval suite cannot be run'),
      status: 422,
    },
    {
      error: new MockWorkflowEvalSnapshotTargetError('Eval workflow snapshot is invalid'),
      status: 422,
    },
    {
      error: new MockWorkflowEvalEnqueueError('Eval runner is unavailable'),
      status: 503,
    },
  ])('maps $error.name to $status', async ({ error, status }) => {
    mockStartWorkflowEvalSuiteRun.mockRejectedValue(error)

    const response = await callRoute()

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: error.message })
  })
})
