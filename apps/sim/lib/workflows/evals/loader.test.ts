/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@sim/db/schema', () => ({
  workflowEvalSuite: {
    id: 'suite.id',
    workflowId: 'suite.workflowId',
    name: 'suite.name',
    definitionVersion: 'suite.definitionVersion',
    definitionRevision: 'suite.definitionRevision',
    tests: 'suite.tests',
    archivedAt: 'suite.archivedAt',
    createdAt: 'suite.createdAt',
  },
  workflowEvalRun: {
    id: 'run.id',
    suiteId: 'run.suiteId',
    workspaceId: 'run.workspaceId',
    status: 'run.status',
    scope: 'run.scope',
    selectedTestId: 'run.selectedTestId',
    suiteDefinitionRevision: 'run.suiteDefinitionRevision',
    definitionSnapshot: 'run.definitionSnapshot',
    revision: 'run.revision',
    totalCount: 'run.totalCount',
    completedCount: 'run.completedCount',
    passedCount: 'run.passedCount',
    warningCount: 'run.warningCount',
    failedCount: 'run.failedCount',
    errorCount: 'run.errorCount',
    errorKind: 'run.errorKind',
    errorCode: 'run.errorCode',
    errorMessage: 'run.errorMessage',
    startedAt: 'run.startedAt',
    completedAt: 'run.completedAt',
    createdAt: 'run.createdAt',
    updatedAt: 'run.updatedAt',
  },
  workflowEvalTestRun: {
    id: 'testRun.id',
    runId: 'testRun.runId',
    testId: 'testRun.testId',
    ordinal: 'testRun.ordinal',
    name: 'testRun.name',
    evaluatorType: 'testRun.evaluatorType',
    phase: 'testRun.phase',
    outcome: 'testRun.outcome',
    score: 'testRun.score',
    errorKind: 'testRun.errorKind',
    errorCode: 'testRun.errorCode',
    errorMessage: 'testRun.errorMessage',
    subjectExecutionId: 'testRun.subjectExecutionId',
    judgeExecutionId: 'testRun.judgeExecutionId',
  },
  workflowEvalCriterionRun: {
    id: 'criterionRun.id',
    testRunId: 'criterionRun.testRunId',
    criterionId: 'criterionRun.criterionId',
    ordinal: 'criterionRun.ordinal',
    name: 'criterionRun.name',
    phase: 'criterionRun.phase',
    verdict: 'criterionRun.verdict',
    confidence: 'criterionRun.confidence',
    errorKind: 'criterionRun.errorKind',
    errorCode: 'criterionRun.errorCode',
    errorMessage: 'criterionRun.errorMessage',
  },
}))

import {
  loadWorkflowEvalSuites,
  MAX_WORKFLOW_EVAL_CRITERION_RUN_ROWS,
  MAX_WORKFLOW_EVAL_LOAD_BYTES,
} from '@/lib/workflows/evals/loader'

const TESTS = [
  {
    id: 'test-1',
    name: 'Returns a useful answer',
    input: { message: 'Help me' },
    evaluator: {
      type: 'agent' as const,
      model: 'gpt-test',
      criteria: [{ id: 'criterion-1', name: 'Useful', description: 'The answer should be useful' }],
      outputSelectors: [{ blockId: 'agent-1', path: '' }],
    },
  },
  {
    id: 'test-2',
    name: 'Escalates refunds',
    input: { message: 'I need a refund' },
    evaluator: { type: 'code' as const, code: 'return output.escalated === true' },
  },
]

const TEST_SUMMARIES = [
  {
    id: 'test-1',
    name: 'Returns a useful answer',
    evaluatorType: 'agent',
    criteria: [{ id: 'criterion-1', name: 'Useful' }],
  },
  { id: 'test-2', name: 'Escalates refunds', evaluatorType: 'code' },
]

const SUITE_METADATA_ROW = {
  id: 'suite-1',
  name: 'Regression',
  definitionVersion: 1,
  definitionRevision: 1,
  archivedAt: null,
  testsBytes: 1_000,
  createdAt: new Date('2026-07-15T12:00:00.000Z'),
}

const SUITE_PAYLOAD_ROW = { id: 'suite-1', tests: TESTS }

const RUN_METADATA_ROW = {
  id: 'run-1',
  suiteId: 'suite-1',
  workspaceId: 'workspace-1',
  status: 'completed',
  scope: 'suite',
  selectedTestId: null,
  suiteDefinitionRevision: 1,
  definitionSnapshotBytes: 1_000,
  revision: 7,
  totalCount: 2,
  completedCount: 2,
  passedCount: 1,
  warningCount: 0,
  failedCount: 1,
  errorCount: 0,
  errorKind: null,
  errorCode: null,
  errorMessage: null,
  startedAt: new Date('2026-07-15T12:00:00.000Z'),
  completedAt: new Date('2026-07-15T12:01:00.000Z'),
  createdAt: new Date('2026-07-15T12:00:00.000Z'),
  updatedAt: new Date('2026-07-15T12:01:00.000Z'),
}

const RUN_PAYLOAD_ROW = {
  id: 'run-1',
  definitionSnapshot: { version: 1, suiteId: 'suite-1', name: 'Regression', tests: TESTS },
}

const TEST_RUN_ROWS = [
  {
    id: 'test-run-1',
    runId: 'run-1',
    testId: 'test-1',
    ordinal: 0,
    name: 'Returns a useful answer',
    evaluatorType: 'agent',
    phase: 'completed',
    outcome: 'pass',
    score: 10,
    errorKind: null,
    errorCode: null,
    errorMessage: null,
    subjectExecutionId: 'execution-1',
    judgeExecutionId: null,
  },
  {
    id: 'test-run-2',
    runId: 'run-1',
    testId: 'test-2',
    ordinal: 1,
    name: 'Escalates refunds',
    evaluatorType: 'code',
    phase: 'completed',
    outcome: 'fail',
    score: 0,
    errorKind: null,
    errorCode: null,
    errorMessage: null,
    subjectExecutionId: 'execution-2',
    judgeExecutionId: null,
  },
]

const CRITERION_RUN_ROWS = [
  {
    id: 'criterion-run-1',
    testRunId: 'test-run-1',
    criterionId: 'criterion-1',
    ordinal: 0,
    name: 'Useful',
    phase: 'completed',
    verdict: 'pass',
    confidence: 0.9,
    errorKind: null,
    errorCode: null,
    errorMessage: null,
  },
]

interface MockRowsOptions {
  suites?: unknown[]
  runs?: unknown[]
  testAggregate?: unknown[]
  criterionAggregate?: unknown[]
  suitePayloads?: unknown[]
  runPayloads?: unknown[]
  testRuns?: unknown[]
  criterionRuns?: unknown[]
}

function mockRows({
  suites = [SUITE_METADATA_ROW],
  runs = [RUN_METADATA_ROW],
  testAggregate = [{ count: 2, bytes: 2_000 }],
  criterionAggregate = [{ count: 1, bytes: 500 }],
  suitePayloads = [SUITE_PAYLOAD_ROW],
  runPayloads = [RUN_PAYLOAD_ROW],
  testRuns = TEST_RUN_ROWS,
  criterionRuns = CRITERION_RUN_ROWS,
}: MockRowsOptions = {}): void {
  dbChainMockFns.limit.mockResolvedValueOnce(suites)
  dbChainMockFns.orderBy.mockResolvedValueOnce(runs)

  if (runs.length > 0) {
    dbChainMockFns.limit
      .mockResolvedValueOnce(testAggregate)
      .mockResolvedValueOnce(criterionAggregate)
  }

  dbChainMockFns.orderBy.mockResolvedValueOnce(suitePayloads)
  if (runs.length > 0) {
    dbChainMockFns.orderBy
      .mockResolvedValueOnce(runPayloads)
      .mockResolvedValueOnce(testRuns)
      .mockResolvedValueOnce(criterionRuns)
  }
}

describe('loadWorkflowEvalSuites', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetDbChainMock()
    dbChainMockFns.orderBy.mockReturnValueOnce({ limit: dbChainMockFns.limit })
  })

  it('returns normalized latest test and criterion rows', async () => {
    mockRows()

    const suites = await loadWorkflowEvalSuites('workflow-1', 'workspace-1')

    expect(suites).toEqual([
      {
        id: 'suite-1',
        name: 'Regression',
        definitionRevision: 1,
        archivedAt: null,
        tests: TEST_SUMMARIES,
        testCount: 2,
        latestRun: {
          id: 'run-1',
          scope: 'suite',
          selectedTestId: null,
          suiteDefinitionRevision: 1,
          status: 'completed',
          revision: 7,
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
          tests: TEST_SUMMARIES,
          testRuns: [
            {
              id: 'test-run-1',
              testId: 'test-1',
              ordinal: 0,
              name: 'Returns a useful answer',
              evaluatorType: 'agent',
              phase: 'completed',
              outcome: 'pass',
              score: 10,
              reason: null,
              errorBlockIds: [],
              subjectExecutionId: 'execution-1',
              judgeExecutionId: null,
              error: null,
              criteria: [
                {
                  id: 'criterion-run-1',
                  criterionId: 'criterion-1',
                  ordinal: 0,
                  name: 'Useful',
                  phase: 'completed',
                  verdict: 'pass',
                  confidence: 0.9,
                  reason: null,
                  error: null,
                },
              ],
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
          ],
        },
        latestSuiteRun: expect.objectContaining({ id: 'run-1' }),
      },
    ])
    expect(dbChainMockFns.selectDistinctOn).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
  })

  it('keeps latest-run summaries pinned when the current suite changes', async () => {
    mockRows({
      suitePayloads: [
        {
          id: 'suite-1',
          tests: TESTS.map((test) => ({
            ...test,
            evaluator: { type: 'code' as const, code: 'return false' },
          })),
        },
      ],
    })

    const [suite] = await loadWorkflowEvalSuites('workflow-1', 'workspace-1')

    expect(suite.tests.every((test) => test.evaluatorType === 'code')).toBe(true)
    expect(suite.latestRun?.tests).toEqual(TEST_SUMMARIES)
    expect(suite.latestRun?.testRuns[0].evaluatorType).toBe('agent')
  })

  it('rejects a test-row preflight mismatch before materializing payloads', async () => {
    mockRows({ testAggregate: [{ count: 1, bytes: 1_000 }] })

    await expect(loadWorkflowEvalSuites('workflow-1', 'workspace-1')).rejects.toThrow(
      'expect 2 test rows, but preflight found 1'
    )
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
  })

  it('rejects too many criterion rows before materializing payloads', async () => {
    mockRows({
      criterionAggregate: [{ count: MAX_WORKFLOW_EVAL_CRITERION_RUN_ROWS + 1, bytes: 1_000 }],
    })

    await expect(loadWorkflowEvalSuites('workflow-1', 'workspace-1')).rejects.toThrow(
      `exceeding the ${MAX_WORKFLOW_EVAL_CRITERION_RUN_ROWS}-row limit`
    )
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(3)
  })

  it('rejects aggregate bytes before materializing JSON or result rows', async () => {
    const mebibyte = 1024 * 1024
    mockRows({
      suites: [{ ...SUITE_METADATA_ROW, testsBytes: 32 * mebibyte }],
      runs: [{ ...RUN_METADATA_ROW, definitionSnapshotBytes: 20 * mebibyte }],
      testAggregate: [{ count: 2, bytes: 13 * mebibyte }],
    })

    await expect(loadWorkflowEvalSuites('workflow-1', 'workspace-1')).rejects.toThrow(
      `exceeding the ${MAX_WORKFLOW_EVAL_LOAD_BYTES}-byte load limit`
    )
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(3)
    expect(dbChainMockFns.orderBy).toHaveBeenCalledTimes(2)
  })

  it('rejects persisted aggregate counters that disagree with test rows', async () => {
    mockRows({ runs: [{ ...RUN_METADATA_ROW, passedCount: 2, failedCount: 0 }] })

    await expect(loadWorkflowEvalSuites('workflow-1', 'workspace-1')).rejects.toThrow(
      'has passedCount 2, but its test rows require 1'
    )
  })

  it('rejects criterion rows that do not match the pinned definition', async () => {
    mockRows({
      criterionRuns: [{ ...CRITERION_RUN_ROWS[0], criterionId: 'unknown-criterion' }],
    })

    await expect(loadWorkflowEvalSuites('workflow-1', 'workspace-1')).rejects.toThrow(
      'criteria do not match its definition snapshot'
    )
  })

  it('rejects partially populated typed errors', async () => {
    mockRows({
      testRuns: [
        {
          ...TEST_RUN_ROWS[0],
          phase: 'error',
          outcome: null,
          score: null,
          errorKind: 'evaluator',
          errorCode: null,
          errorMessage: 'Judge failed',
        },
        TEST_RUN_ROWS[1],
      ],
      runs: [
        {
          ...RUN_METADATA_ROW,
          passedCount: 0,
          failedCount: 1,
          errorCount: 1,
        },
      ],
    })

    await expect(loadWorkflowEvalSuites('workflow-1', 'workspace-1')).rejects.toThrow(
      'has partially populated typed error columns'
    )
  })

  it('rejects more than the suite maximum before querying runs or payloads', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce(
      Array.from({ length: 1_001 }, (_, index) => ({
        ...SUITE_METADATA_ROW,
        id: `suite-${index}`,
      }))
    )

    await expect(loadWorkflowEvalSuites('workflow-1', 'workspace-1')).rejects.toThrow(
      'has more than 1000 eval suites'
    )
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1_001)
    expect(dbChainMockFns.selectDistinctOn).not.toHaveBeenCalled()
  })
})
