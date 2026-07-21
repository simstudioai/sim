/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/db/schema', () => ({
  workflowEvalRun: {
    id: 'run.id',
    suiteId: 'run.suiteId',
    workspaceId: 'run.workspaceId',
    definitionSnapshot: 'run.definitionSnapshot',
    suiteDefinitionRevision: 'run.suiteDefinitionRevision',
  },
  workflowEvalSuite: {
    id: 'suite.id',
    workflowId: 'suite.workflowId',
  },
  workflowEvalTestRun: {},
  workflowEvalCriterionRun: {},
}))

import {
  loadWorkflowEvalRunTestDefinition,
  WorkflowEvalRunTestDefinitionNotFoundError,
} from '@/lib/workflows/evals/run-detail-loader'

const TEST = {
  id: 'test-1',
  name: 'Routes billing requests',
  input: { message: 'I was charged twice' },
  errorBlockIds: ['router'],
  evaluator: {
    type: 'code' as const,
    code: "return blockOutputs[0].value === 'billing'",
    outputSelectors: [{ blockId: 'router', path: 'route' }],
  },
}

describe('loadWorkflowEvalRunTestDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns the selected definition from the immutable run snapshot', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        suiteDefinitionRevision: 4,
        definitionSnapshot: {
          version: 1,
          suiteId: 'suite-1',
          name: 'Regression',
          tests: [TEST],
        },
      },
    ])

    await expect(
      loadWorkflowEvalRunTestDefinition({
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        suiteId: 'suite-1',
        runId: 'run-1',
        testId: 'test-1',
      })
    ).resolves.toEqual({
      runId: 'run-1',
      suiteId: 'suite-1',
      suiteDefinitionRevision: 4,
      test: TEST,
    })
  })

  it('fails when the requested test is absent from the run snapshot', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        suiteDefinitionRevision: 4,
        definitionSnapshot: {
          version: 1,
          suiteId: 'suite-1',
          name: 'Regression',
          tests: [TEST],
        },
      },
    ])

    await expect(
      loadWorkflowEvalRunTestDefinition({
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        suiteId: 'suite-1',
        runId: 'run-1',
        testId: 'missing-test',
      })
    ).rejects.toBeInstanceOf(WorkflowEvalRunTestDefinitionNotFoundError)
  })
})
