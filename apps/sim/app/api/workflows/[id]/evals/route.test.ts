/**
 * @vitest-environment node
 */
import { createMockRequest, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

const { mockAuthorizeWorkflow, mockGetSession, mockIsFeatureEnabled, mockLoadSuites } = vi.hoisted(
  () => ({
    mockAuthorizeWorkflow: vi.fn(),
    mockGetSession: vi.fn(),
    mockIsFeatureEnabled: vi.fn(),
    mockLoadSuites: vi.fn(),
  })
)

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@sim/platform-authz/workflow', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflow,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))
vi.mock('@/lib/workflows/evals/loader', () => ({
  loadWorkflowEvalSuites: mockLoadSuites,
}))

import { GET } from '@/app/api/workflows/[id]/evals/route'

function callRoute(id = 'workflow-1') {
  return GET(createMockRequest('GET'), { params: Promise.resolve({ id }) })
}

describe('GET /api/workflows/[id]/evals', () => {
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
    mockLoadSuites.mockResolvedValue([])
  })

  it('returns 401 before parsing or listing without a session', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await callRoute()

    expect(response.status).toBe(401)
    expect(mockAuthorizeWorkflow).not.toHaveBeenCalled()
    expect(mockLoadSuites).not.toHaveBeenCalled()
  })

  it('enforces workflow read authorization', async () => {
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
      action: 'read',
    })
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
    expect(mockLoadSuites).not.toHaveBeenCalled()
  })

  it('returns the disabled availability response without listing suites', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)

    const response = await callRoute()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled: false, suites: [] })
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('workflow-evals', {
      userId: 'user-1',
      orgId: 'organization-1',
    })
    expect(mockLoadSuites).not.toHaveBeenCalled()
  })

  it('returns enabled suites from the authorized workflow workspace', async () => {
    mockLoadSuites.mockResolvedValue([
      {
        id: 'suite-1',
        name: 'Regression',
        definitionRevision: 1,
        archivedAt: null,
        tests: [
          {
            id: 'test-1',
            name: 'Answers routine questions',
            evaluatorType: 'code',
          },
          {
            id: 'test-2',
            name: 'Escalates refunds',
            evaluatorType: 'code',
          },
        ],
        testCount: 2,
        latestRun: {
          id: 'run-1',
          scope: 'suite',
          selectedTestId: null,
          suiteDefinitionRevision: 1,
          status: 'completed',
          revision: 8,
          completedCount: 2,
          passedCount: 1,
          warningCount: 0,
          failedCount: 1,
          errorCount: 0,
          totalCount: 2,
          createdAt: new Date('2026-07-15T12:00:00.000Z'),
          updatedAt: new Date('2026-07-15T12:01:00.000Z'),
          startedAt: new Date('2026-07-15T12:00:00.000Z'),
          completedAt: new Date('2026-07-15T12:01:00.000Z'),
          error: null,
          tests: [
            {
              id: 'test-1',
              name: 'Answers routine questions',
              evaluatorType: 'code',
            },
            {
              id: 'test-2',
              name: 'Escalates refunds',
              evaluatorType: 'code',
            },
          ],
          testRuns: [
            {
              id: 'test-run-1',
              testId: 'test-1',
              ordinal: 0,
              name: 'Answers routine questions',
              evaluatorType: 'code',
              phase: 'completed',
              outcome: 'pass',
              score: 10,
              subjectExecutionId: 'execution-1',
              judgeExecutionId: null,
              error: null,
              criteria: [],
            },
            {
              id: 'test-run-2',
              testId: 'test-2',
              ordinal: 1,
              name: 'Escalates refunds',
              evaluatorType: 'code',
              phase: 'completed',
              outcome: 'fail',
              score: 0,
              subjectExecutionId: 'execution-2',
              judgeExecutionId: null,
              error: null,
              criteria: [],
            },
          ],
        },
        latestSuiteRun: null,
      },
    ])

    const response = await callRoute()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.enabled).toBe(true)
    expect(body.suites[0].tests).toEqual([
      {
        id: 'test-1',
        name: 'Answers routine questions',
        evaluatorType: 'code',
      },
      {
        id: 'test-2',
        name: 'Escalates refunds',
        evaluatorType: 'code',
      },
    ])
    expect(body.suites[0].latestRun.tests).toEqual(body.suites[0].tests)
    expect(body.suites[0].latestRun.testRuns).toEqual([
      {
        id: 'test-run-1',
        testId: 'test-1',
        ordinal: 0,
        name: 'Answers routine questions',
        evaluatorType: 'code',
        phase: 'completed',
        outcome: 'pass',
        score: 10,
        reason: null,
        errorBlockIds: [],
        subjectExecutionId: 'execution-1',
        judgeExecutionId: null,
        error: null,
        criteria: [],
      },
      {
        id: 'test-run-2',
        testId: 'test-2',
        ordinal: 1,
        name: 'Escalates refunds',
        evaluatorType: 'code',
        phase: 'completed',
        outcome: 'fail',
        score: 0,
        reason: null,
        errorBlockIds: [],
        subjectExecutionId: 'execution-2',
        judgeExecutionId: null,
        error: null,
        criteria: [],
      },
    ])
    expect(mockLoadSuites).toHaveBeenCalledWith('workflow-1', 'workspace-1')
  })
})
