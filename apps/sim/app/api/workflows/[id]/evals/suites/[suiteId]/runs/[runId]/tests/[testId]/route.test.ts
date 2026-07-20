/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorize, mockGetSession, mockLoadDefinition } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockGetSession: vi.fn(),
  mockLoadDefinition: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/workflows/evals/access', () => ({
  authorizeWorkflowEvalAccess: mockAuthorize,
  WorkflowEvalAccessError: class WorkflowEvalAccessError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  },
}))
vi.mock('@/lib/workflows/evals/run-detail-loader', () => ({
  loadWorkflowEvalRunTestDefinition: mockLoadDefinition,
  WorkflowEvalRunTestDefinitionNotFoundError: class WorkflowEvalRunTestDefinitionNotFoundError extends Error {},
}))

import { GET } from '@/app/api/workflows/[id]/evals/suites/[suiteId]/runs/[runId]/tests/[testId]/route'

const CONTEXT = {
  params: Promise.resolve({
    id: 'workflow-1',
    suiteId: 'suite-1',
    runId: 'run-1',
    testId: 'test-1',
  }),
}

describe('GET workflow Eval run test definition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorize.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })
    mockLoadDefinition.mockResolvedValue({
      runId: 'run-1',
      suiteId: 'suite-1',
      suiteDefinitionRevision: 3,
      test: {
        id: 'test-1',
        name: 'Routes billing requests',
        input: { message: 'I was charged twice' },
        errorBlockIds: ['router'],
        evaluator: { type: 'code', code: "return output.route === 'billing'" },
      },
    })
  })

  it('rejects unauthenticated reads before authorization', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest('GET'), CONTEXT)

    expect(response.status).toBe(401)
    expect(mockAuthorize).not.toHaveBeenCalled()
  })

  it('returns the immutable test definition captured by the run', async () => {
    const response = await GET(createMockRequest('GET'), CONTEXT)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(await response.json()).toEqual({
      runId: 'run-1',
      suiteId: 'suite-1',
      suiteDefinitionRevision: 3,
      test: {
        id: 'test-1',
        name: 'Routes billing requests',
        input: { message: 'I was charged twice' },
        errorBlockIds: ['router'],
        evaluator: { type: 'code', code: "return output.route === 'billing'" },
      },
    })
    expect(mockAuthorize).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'user-1',
      action: 'read',
    })
    expect(mockLoadDefinition).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      suiteId: 'suite-1',
      runId: 'run-1',
      testId: 'test-1',
    })
  })
})
