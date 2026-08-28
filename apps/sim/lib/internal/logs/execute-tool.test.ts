/**
 * @vitest-environment node
 */

import {
  PrincipalSubjectUserRequiredError,
  type WorkflowExecutionDelegatedPrincipal,
} from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  getRun: vi.fn(),
  getExecution: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))
vi.mock('@/lib/internal/logs/operations', () => ({
  executeLogsList: mocks.list,
  executeLogsGet: mocks.get,
  executeLogsGetRunDetails: mocks.getRun,
  executeLogsGetExecution: mocks.getExecution,
}))

import { executeLogsTool } from '@/lib/internal/logs/execute-tool'

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-canonical',
  delegationId: 'delegation-1',
  audience: 'sim:logs',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}

const CONTEXT = { userId: 'user-1', workflowId: 'workflow-1' } as ExecutionContext

const SUMMARY = {
  id: 'log-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  deploymentVersionId: null,
  deploymentVersion: null,
  deploymentVersionName: null,
  executionOrigin: null,
  level: 'info',
  status: 'success',
  duration: '10ms',
  trigger: 'manual',
  createdAt: '2026-08-27T00:00:00.000Z',
  workflow: null,
  jobTitle: null,
  cost: null,
  pauseSummary: { status: null, total: 0, resumed: 0 },
  hasPendingPause: false,
}

const DETAIL = {
  ...SUMMARY,
  executionData: {},
  files: null,
}

const SNAPSHOT = {
  executionId: 'execution-1',
  workflowId: 'workflow-1',
  workflowState: {},
  childWorkflowSnapshots: {},
  executionMetadata: {
    trigger: 'manual',
    startedAt: '2026-08-27T00:00:00.000Z',
    cost: null,
  },
}

const CASES = [
  {
    toolId: 'logs_query',
    input: {},
    operation: 'list' as const,
  },
  {
    toolId: 'logs_query_runs',
    input: { limit: 25 },
    operation: 'list' as const,
  },
  {
    toolId: 'logs_get',
    input: { id: 'log-1' },
    operation: 'get' as const,
  },
  {
    toolId: 'logs_get_run_details',
    input: { executionId: 'execution-1' },
    operation: 'getRun' as const,
    executionId: 'execution-1',
  },
  {
    toolId: 'logs_get_execution',
    input: { executionId: 'execution-1' },
    operation: 'getExecution' as const,
    executionId: 'execution-1',
  },
]

describe('executeLogsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPrincipal.mockResolvedValue(PRINCIPAL)
    mocks.list.mockResolvedValue({ data: [SUMMARY], nextCursor: null })
    mocks.get.mockResolvedValue({ data: DETAIL })
    mocks.getRun.mockResolvedValue({ data: DETAIL })
    mocks.getExecution.mockResolvedValue(SNAPSHOT)
  })

  it.each(CASES)('dispatches $toolId through its canonical contract', async (testCase) => {
    const response = await executeLogsTool({
      toolId: testCase.toolId,
      input: testCase.input,
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(200)
    expect(mocks[testCase.operation]).toHaveBeenCalledOnce()
    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context: CONTEXT,
      audience: 'sim:logs',
      ...(testCase.executionId ? { resourceScope: { executionId: testCase.executionId } } : {}),
    })
  })

  it('authenticates before input validation and preserves response validation', async () => {
    mocks.createPrincipal.mockRejectedValueOnce(new Error('Authentication required'))
    const unauthenticated = await executeLogsTool({
      toolId: 'logs_get',
      input: {},
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })
    expect(unauthenticated.status).toBe(401)
    expect(mocks.get).not.toHaveBeenCalled()

    const invalidInput = await executeLogsTool({
      toolId: 'logs_get',
      input: {},
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })
    expect(invalidInput.status).toBe(400)
    expect(await invalidInput.json()).toMatchObject({ error: 'Validation error' })

    mocks.get.mockResolvedValueOnce({ data: {} })
    const invalidResponse = await executeLogsTool({
      toolId: 'logs_get',
      input: { id: 'log-1' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })
    expect(invalidResponse.status).toBe(500)
    expect(await invalidResponse.json()).toEqual({ error: 'Failed to fetch log' })
  })

  it('names the missing identity instead of answering an opaque 500', async () => {
    // The regression this guards: an operation that still demands a person answered
    // every scheduled run with `Failed to fetch log`, which says nothing about why.
    mocks.getRun.mockRejectedValueOnce(new PrincipalSubjectUserRequiredError('delegated'))

    const response = await executeLogsTool({
      toolId: 'logs_get_run_details',
      input: { executionId: 'execution-1' },
      headers: new Headers(),
      context: CONTEXT,
      requestId: 'request-1',
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error:
        'This tool requires a user identity, and this run has none — scheduled and webhook triggers run without a user',
    })
  })
})
