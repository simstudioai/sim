/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockWorkflowExecutionAdmissionError,
  MockWorkflowEvalJudgeTraceError,
  MockWorkflowEvalWorkflowJudgeValidationError,
  mockAssertBillingAttribution,
  mockCaptureWorkflowEvalSnapshotTargets,
  mockCancelJob,
  mockEnqueue,
  mockEvaluateAgentCriteria,
  mockExecuteInIsolatedVM,
  mockExecuteWorkflowJob,
  mockGetBoundedSnapshotForWorkflow,
  mockGetJobQueue,
  mockMarkExecutionCancelled,
  mockLoadProjectedJudgeInput,
  mockLoadProjectedJudgeScore,
  mockLoadProjectedJudgeTrace,
  mockLoadProjectedCodeBlockOutputs,
  mockPublishEvalEvent,
  mockResolveBillingAttribution,
  mockValidatePinnedWorkflowJudgeDefinition,
} = vi.hoisted(() => ({
  MockWorkflowExecutionAdmissionError: class WorkflowExecutionAdmissionError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
      this.name = 'WorkflowExecutionAdmissionError'
    }
  },
  MockWorkflowEvalJudgeTraceError: class WorkflowEvalJudgeTraceError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
      this.name = 'WorkflowEvalJudgeTraceError'
    }
  },
  MockWorkflowEvalWorkflowJudgeValidationError: class WorkflowEvalWorkflowJudgeValidationError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
      this.name = 'WorkflowEvalWorkflowJudgeValidationError'
    }
  },
  mockAssertBillingAttribution: vi.fn(),
  mockCaptureWorkflowEvalSnapshotTargets: vi.fn(),
  mockCancelJob: vi.fn(),
  mockEnqueue: vi.fn(),
  mockEvaluateAgentCriteria: vi.fn(),
  mockExecuteInIsolatedVM: vi.fn(),
  mockExecuteWorkflowJob: vi.fn(),
  mockGetBoundedSnapshotForWorkflow: vi.fn(),
  mockGetJobQueue: vi.fn(),
  mockMarkExecutionCancelled: vi.fn(),
  mockLoadProjectedJudgeInput: vi.fn(),
  mockLoadProjectedJudgeScore: vi.fn(),
  mockLoadProjectedJudgeTrace: vi.fn(),
  mockLoadProjectedCodeBlockOutputs: vi.fn(),
  mockPublishEvalEvent: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockValidatePinnedWorkflowJudgeDefinition: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/audit', () => ({
  AuditAction: {
    WORKFLOW_EVAL_RUN_QUEUED: 'workflow.eval_run_queued',
    WORKFLOW_EVAL_RUN_STOPPED: 'workflow.eval_run_stopped',
  },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: vi.fn(),
}))
vi.mock('@/background/workflow-execution', () => ({
  executeWorkflowJob: mockExecuteWorkflowJob,
  WorkflowExecutionAdmissionError: MockWorkflowExecutionAdmissionError,
}))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: mockAssertBillingAttribution,
  resolveBillingAttribution: mockResolveBillingAttribution,
}))
vi.mock('@/lib/core/async-jobs/config', () => ({
  getAsyncBackendType: () => 'database',
  getJobQueue: mockGetJobQueue,
}))
vi.mock('@/lib/execution/cancellation', () => ({
  markExecutionCancelled: mockMarkExecutionCancelled,
}))
vi.mock('@/lib/execution/isolated-vm', () => ({ executeInIsolatedVM: mockExecuteInIsolatedVM }))
vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: { getBoundedSnapshotForWorkflow: mockGetBoundedSnapshotForWorkflow },
}))
vi.mock('@/lib/workflows/evals/agent-evaluator.server', () => ({
  evaluateWorkflowEvalAgentCriteria: mockEvaluateAgentCriteria,
  WORKFLOW_EVAL_CRITERION_PROMPT_VERSION: 'workflow_eval_criterion_v1',
}))
vi.mock('@/lib/workflows/evals/judge-trace.server', () => ({
  loadProjectedWorkflowEvalCodeBlockOutputs: mockLoadProjectedCodeBlockOutputs,
  loadProjectedWorkflowEvalJudgeInput: mockLoadProjectedJudgeInput,
  loadProjectedWorkflowEvalJudgeScore: mockLoadProjectedJudgeScore,
  loadProjectedWorkflowEvalJudgeTrace: mockLoadProjectedJudgeTrace,
  WorkflowEvalJudgeTraceError: MockWorkflowEvalJudgeTraceError,
}))
vi.mock('@/lib/workflows/evals/snapshot-targets', () => ({
  captureWorkflowEvalSnapshotTargets: mockCaptureWorkflowEvalSnapshotTargets,
  MAX_WORKFLOW_EVAL_SNAPSHOT_TARGETS: 1_001,
}))
vi.mock('@/lib/workflows/evals/pubsub', () => ({
  workflowEvalPubSub: { publish: mockPublishEvalEvent },
}))
vi.mock('@/lib/workflows/evals/workflow-judge-validation', () => ({
  validatePinnedWorkflowJudgeDefinition: mockValidatePinnedWorkflowJudgeDefinition,
  WorkflowEvalWorkflowJudgeValidationError: MockWorkflowEvalWorkflowJudgeValidationError,
}))

import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { AsyncJobEnqueueError } from '@/lib/core/async-jobs/types'
import type {
  WorkflowEvalAgentCriterionEvaluation,
  WorkflowEvalAgentCriterionWorkItem,
} from '@/lib/workflows/evals/agent-evaluator.server'
import {
  runWorkflowEvalSuiteJob,
  startWorkflowEvalSuiteRun,
  startWorkflowEvalTestRun,
  stopWorkflowEvalRun,
  WorkflowEvalEnqueueError,
  WorkflowEvalRunAlreadyActiveError,
  WorkflowEvalRunNotActiveError,
  WorkflowEvalSuiteNotFoundError,
  WorkflowEvalSuiteNotRunnableError,
} from '@/lib/workflows/evals/run-service'
import { WorkflowExecutionAdmissionError } from '@/background/workflow-execution'

const CREATED_AT = new Date('2026-07-16T12:00:00.000Z')
const STARTED_AT = new Date('2026-07-16T12:00:01.000Z')
const COMPLETED_AT = new Date('2026-07-16T12:00:02.000Z')
const MAX_SNAPSHOT_TARGETS = 1_001

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'user-1',
  billingEntity: { type: 'user', id: 'user-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
} satisfies BillingAttributionSnapshot

const SUBJECT_MOCKS = [{ blockId: 'ticket-lookup', output: { status: 'open' } }]

const CODE_TEST = {
  id: 'test-1',
  name: 'First test',
  input: { message: 'First' },
  mocks: SUBJECT_MOCKS,
  errorBlockIds: ['router'],
  evaluator: {
    type: 'code' as const,
    code: 'return output.ok === true',
    outputSelectors: [{ blockId: 'router', path: 'route' }],
  },
}

const AGENT_TEST = {
  id: 'agent-test-1',
  name: 'Agent quality',
  input: { message: 'Help the customer' },
  mocks: SUBJECT_MOCKS,
  errorBlockIds: ['agent'],
  evaluator: {
    type: 'agent' as const,
    model: 'judge-model',
    criteria: [
      { id: 'quality', name: 'Quality', description: 'The answer solves the request' },
      { id: 'safety', name: 'Safety', description: 'The answer avoids unsafe advice' },
    ],
    outputSelectors: [{ blockId: 'agent', path: 'content' }],
  },
}

const WORKFLOW_TEST = {
  id: 'workflow-test-1',
  name: 'Workflow quality',
  input: { message: 'Help the customer', expectedTone: 'concise' },
  mocks: SUBJECT_MOCKS,
  errorBlockIds: ['agent'],
  evaluator: {
    type: 'workflow' as const,
    workflowId: 'judge-workflow',
    inputMappings: [
      {
        inputName: 'answer',
        source: { type: 'subjectOutput' as const, blockId: 'agent', path: 'content' },
      },
      {
        inputName: 'expectedTone',
        source: { type: 'testInput' as const, path: 'expectedTone' },
      },
    ],
    scoreOutput: { blockId: 'score', path: 'value' },
  },
}

const SELF_JUDGE_WORKFLOW_TEST = {
  ...WORKFLOW_TEST,
  id: 'self-judge-workflow-test',
  name: 'Workflow judges itself',
  evaluator: { ...WORKFLOW_TEST.evaluator, workflowId: 'workflow-1' },
}

const SUITE_ROW = {
  id: 'suite-1',
  name: 'Regression',
  definitionVersion: 1,
  definitionRevision: 1,
  archivedAt: null,
  tests: [CODE_TEST],
  testsBytes: 256,
  workflowWorkspaceId: 'workspace-1',
}

function runProjection({
  status,
  revision,
  completedCount = 0,
  passedCount = 0,
  failedCount = 0,
  warningCount = 0,
  errorCount = 0,
}: {
  status: 'queued' | 'running' | 'completed' | 'error' | 'cancelled'
  revision: number
  completedCount?: number
  passedCount?: number
  failedCount?: number
  warningCount?: number
  errorCount?: number
}) {
  const terminal = status === 'completed' || status === 'error' || status === 'cancelled'
  const errored = status === 'error'
  return {
    id: 'run-1',
    scope: 'suite',
    selectedTestId: null,
    suiteDefinitionRevision: 1,
    status,
    revision,
    completedCount,
    passedCount,
    warningCount,
    failedCount,
    errorCount,
    totalCount: 1,
    createdAt: CREATED_AT,
    updatedAt: terminal ? COMPLETED_AT : STARTED_AT,
    startedAt: status === 'queued' || (errored && revision === 1) ? null : STARTED_AT,
    completedAt: terminal ? COMPLETED_AT : null,
    errorKind: errored ? 'infrastructure' : null,
    errorCode: errored ? 'enqueue_failed' : null,
    errorMessage: errored ? 'Failed to enqueue eval run: queue rejected' : null,
  }
}

function testProjection({
  phase,
  outcome = null,
  score = null,
  errorKind = null,
  errorCode = null,
  errorMessage = null,
}: {
  phase: 'queued' | 'running_subject' | 'running_evaluator' | 'completed' | 'error'
  outcome?: 'pass' | 'warning' | 'fail' | null
  score?: number | null
  errorKind?: 'subject' | 'evaluator' | null
  errorCode?: string | null
  errorMessage?: string | null
}) {
  return {
    id: 'test-run-1',
    testId: CODE_TEST.id,
    ordinal: 0,
    name: CODE_TEST.name,
    evaluatorType: 'code',
    phase,
    outcome,
    score,
    errorKind,
    errorCode,
    errorMessage,
    subjectExecutionId: 'execution-1',
    judgeExecutionId: null,
  }
}

function agentTestProjection({
  phase,
  outcome = null,
  score = null,
  errorKind = null,
  errorCode = null,
  errorMessage = null,
}: {
  phase: 'queued' | 'running_subject' | 'running_evaluator' | 'completed' | 'error'
  outcome?: 'pass' | 'warning' | 'fail' | null
  score?: number | null
  errorKind?: 'subject' | 'evaluator' | 'infrastructure' | null
  errorCode?: string | null
  errorMessage?: string | null
}) {
  return {
    id: 'agent-test-run-1',
    testId: AGENT_TEST.id,
    ordinal: 0,
    name: AGENT_TEST.name,
    evaluatorType: 'agent',
    phase,
    outcome,
    score,
    errorKind,
    errorCode,
    errorMessage,
    subjectExecutionId: 'agent-subject-execution-1',
    judgeExecutionId: null,
  }
}

function workflowTestProjection({
  phase,
  outcome = null,
  score = null,
  errorKind = null,
  errorCode = null,
  errorMessage = null,
}: {
  phase: 'queued' | 'running_subject' | 'running_evaluator' | 'completed' | 'error'
  outcome?: 'pass' | 'warning' | 'fail' | null
  score?: number | null
  errorKind?: 'subject' | 'evaluator' | 'infrastructure' | null
  errorCode?: string | null
  errorMessage?: string | null
}) {
  return {
    id: 'workflow-test-run-1',
    testId: WORKFLOW_TEST.id,
    ordinal: 0,
    name: WORKFLOW_TEST.name,
    evaluatorType: 'workflow',
    phase,
    outcome,
    score,
    errorKind,
    errorCode,
    errorMessage,
    subjectExecutionId: 'workflow-subject-execution-1',
    judgeExecutionId: 'workflow-judge-execution-1',
  }
}

function criterionRow({
  ordinal,
  phase,
  verdict = null,
  confidence = null,
  errorKind = null,
  errorCode = null,
  errorMessage = null,
}: {
  ordinal: 0 | 1
  phase: 'queued' | 'running' | 'completed' | 'error'
  verdict?: 'pass' | 'warning' | 'fail' | null
  confidence?: number | null
  errorKind?: 'evaluator' | 'infrastructure' | null
  errorCode?: string | null
  errorMessage?: string | null
}) {
  const criterion = AGENT_TEST.evaluator.criteria[ordinal]
  if (!criterion) throw new Error(`Missing agent criterion ${ordinal}`)
  return {
    id: `criterion-run-${ordinal + 1}`,
    testRunId: 'agent-test-run-1',
    criterionId: criterion.id,
    ordinal,
    name: criterion.name,
    phase,
    verdict,
    confidence,
    reason: phase === 'completed' ? `${criterion.name} evidence` : null,
    requestedModel: AGENT_TEST.evaluator.model,
    providerId: phase === 'completed' ? 'openai' : null,
    responseModel: phase === 'completed' ? AGENT_TEST.evaluator.model : null,
    promptVersion: 'workflow_eval_criterion_v1',
    inputTokens: phase === 'completed' ? 20 : null,
    outputTokens: phase === 'completed' ? 10 : null,
    totalTokens: phase === 'completed' ? 30 : null,
    cost: phase === 'completed' ? '0.001' : null,
    durationMs: phase === 'completed' ? 100 : null,
    errorKind,
    errorCode,
    errorMessage,
    subjectExecutionId: 'agent-subject-execution-1',
  }
}

interface AgentEvaluatorMockInput {
  trace: unknown
  criteria: readonly WorkflowEvalAgentCriterionWorkItem[]
  onCriterionStarted: (item: WorkflowEvalAgentCriterionWorkItem, ordinal: number) => Promise<void>
  onCriterionFinished: (
    item: WorkflowEvalAgentCriterionWorkItem,
    ordinal: number,
    evaluation: WorkflowEvalAgentCriterionEvaluation
  ) => Promise<void>
}

function completedCriterionEvaluation(
  verdict: 'pass' | 'warning' | 'fail',
  confidence: number,
  reason: string
): WorkflowEvalAgentCriterionEvaluation {
  return {
    phase: 'completed',
    verdict,
    confidence,
    reason,
    error: null,
    providerId: 'openai',
    responseModel: 'judge-model',
    inputTokens: 20,
    outputTokens: 10,
    totalTokens: 30,
    cost: 0.001,
    durationMs: 100,
  }
}

function erroredCriterionEvaluation(message: string): WorkflowEvalAgentCriterionEvaluation {
  return {
    phase: 'error',
    verdict: null,
    confidence: null,
    reason: null,
    error: { kind: 'evaluator', code: 'agent_judge_failed', message },
    providerId: 'openai',
    responseModel: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cost: null,
    durationMs: 100,
  }
}

function workerRunRow() {
  return {
    id: 'run-1',
    suiteId: 'suite-1',
    workspaceId: 'workspace-1',
    status: 'queued',
    scope: 'suite',
    selectedTestId: null,
    suiteDefinitionRevision: 1,
    definitionSnapshot: {
      version: 1,
      suiteId: 'suite-1',
      name: 'Regression',
      tests: [CODE_TEST],
    },
    billingAttribution: BILLING_ATTRIBUTION,
    totalCount: 1,
    triggeredByUserId: 'user-1',
    workflowId: 'workflow-1',
  }
}

function agentWorkerRunRow() {
  return {
    ...workerRunRow(),
    definitionSnapshot: {
      version: 1,
      suiteId: 'suite-1',
      name: 'Regression',
      tests: [AGENT_TEST],
    },
  }
}

function workflowWorkerRunRow(test = WORKFLOW_TEST) {
  return {
    ...workerRunRow(),
    definitionSnapshot: {
      version: 1,
      suiteId: 'suite-1',
      name: 'Regression',
      tests: [test],
    },
  }
}

function subjectTargetRow() {
  return {
    workflowId: 'workflow-1',
    snapshotId: 'snapshot-1',
    stateHash: 'a'.repeat(64),
    isSubject: true,
    snapshotWorkflowId: 'workflow-1',
    snapshotStateHash: 'a'.repeat(64),
  }
}

function judgeTargetRow() {
  return {
    workflowId: 'judge-workflow',
    snapshotId: 'judge-snapshot-1',
    stateHash: 'b'.repeat(64),
    isSubject: false,
    snapshotWorkflowId: 'judge-workflow',
    snapshotStateHash: 'b'.repeat(64),
  }
}

function prepareWorkflowWorkerDb(finalTestProjection: ReturnType<typeof workflowTestProjection>) {
  const outcomeCounts = {
    completedCount: 1,
    ...(finalTestProjection.outcome === 'pass' ? { passedCount: 1 } : {}),
    ...(finalTestProjection.outcome === 'warning' ? { warningCount: 1 } : {}),
    ...(finalTestProjection.outcome === 'fail' ? { failedCount: 1 } : {}),
    ...(finalTestProjection.phase === 'error' ? { errorCount: 1 } : {}),
  }
  dbChainMockFns.limit
    .mockResolvedValueOnce([workflowWorkerRunRow()])
    .mockResolvedValueOnce([subjectTargetRow(), judgeTargetRow()])
  dbChainMockFns.orderBy.mockResolvedValueOnce([workflowTestProjection({ phase: 'queued' })])
  dbChainMockFns.returning
    .mockResolvedValueOnce([runProjection({ status: 'running', revision: 1 })])
    .mockResolvedValueOnce([workflowTestProjection({ phase: 'running_subject' })])
    .mockResolvedValueOnce([runProjection({ status: 'running', revision: 2 })])
    .mockResolvedValueOnce([workflowTestProjection({ phase: 'running_evaluator' })])
    .mockResolvedValueOnce([runProjection({ status: 'running', revision: 3 })])
    .mockResolvedValueOnce([finalTestProjection])
    .mockResolvedValueOnce([runProjection({ status: 'running', revision: 4, ...outcomeCounts })])
    .mockResolvedValueOnce([runProjection({ status: 'completed', revision: 5, ...outcomeCounts })])
}

describe('startWorkflowEvalSuiteRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetJobQueue.mockResolvedValue({ enqueue: mockEnqueue })
    mockEnqueue.mockResolvedValue('job-1')
    mockResolveBillingAttribution.mockResolvedValue(BILLING_ATTRIBUTION)
    mockAssertBillingAttribution.mockReturnValue(BILLING_ATTRIBUTION)
    mockCaptureWorkflowEvalSnapshotTargets.mockResolvedValue([
      {
        workflowId: 'workflow-1',
        snapshotId: 'snapshot-1',
        stateHash: 'a'.repeat(64),
        isSubject: true,
      },
    ])
  })

  it('persists a normalized queued run and stable test row before enqueueing only runId', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([SUITE_ROW]).mockResolvedValueOnce([])

    const result = await startWorkflowEvalSuiteRun({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })

    expect(result).toMatchObject({
      runId: expect.any(String),
      suiteId: 'suite-1',
      status: 'queued',
      revision: 0,
      totalCount: 1,
    })
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: result.runId,
        status: 'queued',
        definitionSnapshot: {
          version: 1,
          suiteId: 'suite-1',
          name: 'Regression',
          tests: [CODE_TEST],
        },
        billingAttribution: BILLING_ATTRIBUTION,
        revision: 0,
        completedCount: 0,
        passedCount: 0,
        warningCount: 0,
        failedCount: 0,
        errorCount: 0,
      })
    )
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        expect.objectContaining({
          runId: result.runId,
          testId: CODE_TEST.id,
          ordinal: 0,
          phase: 'queued',
          subjectExecutionId: expect.any(String),
        }),
      ])
    )
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({
        runId: result.runId,
        workflowId: 'workflow-1',
        snapshotId: 'snapshot-1',
        stateHash: 'a'.repeat(64),
        isSubject: true,
      }),
    ])
    expect(mockEnqueue).toHaveBeenCalledWith(
      'workflow-eval-suite',
      { runId: result.runId },
      expect.objectContaining({
        jobId: `eval-suite:${result.runId}`,
        maxAttempts: 1,
        concurrencyKey: 'workflow-eval-suite',
        concurrencyLimit: 10,
      })
    )
    expect(mockPublishEvalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        type: 'eval.run.upsert',
        run: expect.objectContaining({ revision: 0, completedCount: 0 }),
      })
    )
  })

  it('admits agent tests and preallocates stable criterion call identities', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ ...SUITE_ROW, tests: [AGENT_TEST] }])
      .mockResolvedValueOnce([])

    const result = await startWorkflowEvalSuiteRun({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })

    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        expect.objectContaining({
          runId: result.runId,
          testId: AGENT_TEST.id,
          evaluatorType: 'agent',
          judgeExecutionId: null,
          subjectExecutionId: expect.any(String),
        }),
      ])
    )
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(4, [
      expect.objectContaining({
        criterionId: 'quality',
        ordinal: 0,
        requestedModel: 'judge-model',
        promptVersion: 'workflow_eval_criterion_v1',
      }),
      expect.objectContaining({
        criterionId: 'safety',
        ordinal: 1,
        requestedModel: 'judge-model',
        promptVersion: 'workflow_eval_criterion_v1',
      }),
    ])
  })

  it('admits one selected test as a durable test-scoped run', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ ...SUITE_ROW, tests: [CODE_TEST, AGENT_TEST] }])
      .mockResolvedValueOnce([])

    const result = await startWorkflowEvalTestRun({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      testId: AGENT_TEST.id,
      workspaceId: 'workspace-1',
      userId: 'user-1',
      expectedDefinitionRevision: 1,
    })

    expect(result).toMatchObject({
      scope: 'test',
      selectedTestId: AGENT_TEST.id,
      suiteDefinitionRevision: 1,
      totalCount: 1,
    })
    expect(mockCaptureWorkflowEvalSnapshotTargets).toHaveBeenCalledWith(
      expect.objectContaining({ tests: [AGENT_TEST] })
    )
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        scope: 'test',
        selectedTestId: AGENT_TEST.id,
        suiteDefinitionRevision: 1,
        totalCount: 1,
        definitionSnapshot: expect.objectContaining({ tests: [AGENT_TEST] }),
      })
    )
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([expect.objectContaining({ testId: AGENT_TEST.id, ordinal: 0 })])
    )
  })

  it('admits workflow tests with pinned targets and a preallocated judge execution identity', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ ...SUITE_ROW, tests: [WORKFLOW_TEST] }])
      .mockResolvedValueOnce([])
    mockCaptureWorkflowEvalSnapshotTargets.mockResolvedValueOnce([
      {
        workflowId: 'workflow-1',
        snapshotId: 'snapshot-1',
        stateHash: 'a'.repeat(64),
        isSubject: true,
      },
      {
        workflowId: 'judge-workflow',
        snapshotId: 'judge-snapshot-1',
        stateHash: 'b'.repeat(64),
        isSubject: false,
      },
    ])

    const result = await startWorkflowEvalSuiteRun({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })

    expect(mockCaptureWorkflowEvalSnapshotTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        subjectWorkflowId: 'workflow-1',
        tests: [WORKFLOW_TEST],
      })
    )
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({
          runId: result.runId,
          workflowId: 'workflow-1',
          snapshotId: 'snapshot-1',
          isSubject: true,
        }),
        expect.objectContaining({
          runId: result.runId,
          workflowId: 'judge-workflow',
          snapshotId: 'judge-snapshot-1',
          isSubject: false,
        }),
      ])
    )
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        expect.objectContaining({
          runId: result.runId,
          testId: WORKFLOW_TEST.id,
          evaluatorType: 'workflow',
          subjectExecutionId: expect.any(String),
          judgeExecutionId: expect.any(String),
        }),
      ])
    )
  })

  it('persists one deduplicated target when a workflow judges itself', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ ...SUITE_ROW, tests: [SELF_JUDGE_WORKFLOW_TEST] }])
      .mockResolvedValueOnce([])

    const result = await startWorkflowEvalSuiteRun({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })

    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({
        runId: result.runId,
        workflowId: 'workflow-1',
        snapshotId: 'snapshot-1',
        isSubject: true,
      }),
    ])
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        expect.objectContaining({
          testId: SELF_JUDGE_WORKFLOW_TEST.id,
          evaluatorType: 'workflow',
          judgeExecutionId: expect.any(String),
        }),
      ])
    )
  })

  it('rejects missing, active, and invalid suites before persistence', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(
      startWorkflowEvalSuiteRun({
        workflowId: 'workflow-1',
        suiteId: 'missing',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      })
    ).rejects.toBeInstanceOf(WorkflowEvalSuiteNotFoundError)

    resetDbChainMock()
    dbChainMockFns.limit
      .mockResolvedValueOnce([SUITE_ROW])
      .mockResolvedValueOnce([{ id: 'active-run' }])
    await expect(
      startWorkflowEvalSuiteRun({
        workflowId: 'workflow-1',
        suiteId: 'suite-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      })
    ).rejects.toBeInstanceOf(WorkflowEvalRunAlreadyActiveError)

    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValueOnce([{ ...SUITE_ROW, tests: [] }])
    const invalid = await startWorkflowEvalSuiteRun({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    }).catch((error: unknown) => error)
    expect(invalid).toBeInstanceOf(WorkflowEvalSuiteNotRunnableError)
    expect(invalid).toMatchObject({ reason: 'empty' })
  })

  it('persists a typed run error when enqueue is definitely rejected', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([SUITE_ROW]).mockResolvedValueOnce([])
    mockEnqueue.mockRejectedValueOnce(
      new AsyncJobEnqueueError('queue rejected', {
        acceptance: 'rejected',
        retryable: true,
      })
    )
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        suiteId: 'suite-1',
        workspaceId: 'workspace-1',
        ...runProjection({ status: 'error', revision: 1 }),
      },
    ])

    const error = await startWorkflowEvalSuiteRun({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkflowEvalEnqueueError)
    expect(error).toMatchObject({ acceptance: 'rejected' })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorKind: 'infrastructure',
        errorCode: 'enqueue_failed',
      })
    )
  })

  it('preserves the canonical queued run when enqueue acceptance is ambiguous', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([SUITE_ROW]).mockResolvedValueOnce([])
    mockEnqueue.mockRejectedValueOnce(
      new AsyncJobEnqueueError('queue response was lost', {
        acceptance: 'unknown',
        retryable: true,
      })
    )

    const error = await startWorkflowEvalSuiteRun({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkflowEvalEnqueueError)
    expect(error).toMatchObject({ acceptance: 'unknown' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'queued' })
    )
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({
          workflowId: 'workflow-1',
          snapshotId: 'snapshot-1',
        }),
      ])
    )
  })
})

describe('stopWorkflowEvalRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetJobQueue.mockResolvedValue({ cancelJob: mockCancelJob })
    mockCancelJob.mockResolvedValue(true)
    mockMarkExecutionCancelled.mockResolvedValue({
      durablyRecorded: true,
      reason: 'recorded',
    })
  })

  it('marks the run cancelled before requesting job and execution cancellation', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 3 })])
      .mockResolvedValueOnce([
        { subjectExecutionId: 'subject-execution-1', judgeExecutionId: 'judge-execution-1' },
        { subjectExecutionId: 'subject-execution-2', judgeExecutionId: null },
      ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      runProjection({ status: 'cancelled', revision: 4 }),
    ])

    const result = await stopWorkflowEvalRun({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      runId: 'run-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    })

    expect(result).toMatchObject({
      runId: 'run-1',
      suiteId: 'suite-1',
      status: 'cancelled',
      revision: 4,
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled', completedAt: expect.any(Date) })
    )
    expect(mockCancelJob).toHaveBeenCalledWith('eval-suite:run-1')
    expect(mockMarkExecutionCancelled).toHaveBeenCalledTimes(3)
    expect(mockMarkExecutionCancelled).toHaveBeenCalledWith('subject-execution-1')
    expect(mockMarkExecutionCancelled).toHaveBeenCalledWith('judge-execution-1')
    expect(mockPublishEvalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'eval.run.upsert',
        run: expect.objectContaining({ status: 'cancelled', revision: 4 }),
      })
    )
  })

  it('rejects a terminal run that is not already cancelled', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      runProjection({ status: 'completed', revision: 5, completedCount: 1, passedCount: 1 }),
    ])

    await expect(
      stopWorkflowEvalRun({
        workflowId: 'workflow-1',
        suiteId: 'suite-1',
        runId: 'run-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      })
    ).rejects.toBeInstanceOf(WorkflowEvalRunNotActiveError)

    expect(mockCancelJob).not.toHaveBeenCalled()
    expect(mockMarkExecutionCancelled).not.toHaveBeenCalled()
  })
})

describe('runWorkflowEvalSuiteJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAssertBillingAttribution.mockReturnValue(BILLING_ATTRIBUTION)
    mockExecuteWorkflowJob.mockResolvedValue({
      success: true,
      output: { ok: true },
      durationMs: 1_250,
    })
    mockExecuteInIsolatedVM.mockResolvedValue({ result: true, stdout: '' })
    mockGetBoundedSnapshotForWorkflow.mockResolvedValue({ stateData: { blocks: {} } })
    mockValidatePinnedWorkflowJudgeDefinition.mockReturnValue({
      startBlockId: 'judge-start',
      inputFormat: [],
    })
    mockLoadProjectedJudgeInput.mockResolvedValue({
      answer: 'A concise answer',
      expectedTone: 'concise',
    })
    mockLoadProjectedJudgeScore.mockResolvedValue(7)
    mockLoadProjectedCodeBlockOutputs.mockResolvedValue([
      {
        blockId: 'router',
        path: 'route',
        occurrences: [
          {
            occurrence: 1,
            executionOrder: 2,
            coordinates: [],
            value: 'billing',
          },
        ],
      },
    ])
  })

  it.each(['running', 'completed', 'error', 'cancelled'] as const)(
    'treats duplicate delivery of a %s run as a no-op',
    async (status) => {
      dbChainMockFns.limit.mockResolvedValueOnce([{ ...workerRunRow(), status }])

      await expect(runWorkflowEvalSuiteJob({ runId: 'run-1' })).resolves.toBeUndefined()

      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(mockExecuteWorkflowJob).not.toHaveBeenCalled()
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
      expect(mockPublishEvalEvent).not.toHaveBeenCalled()
    }
  )

  it('treats a lost queued-run claim as a duplicate instead of corrupting the run', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([workerRunRow()])
      .mockResolvedValueOnce([{ status: 'running' }])
    dbChainMockFns.returning.mockResolvedValueOnce([])

    await expect(runWorkflowEvalSuiteJob({ runId: 'run-1' })).resolves.toBeUndefined()

    expect(mockExecuteWorkflowJob).not.toHaveBeenCalled()
    expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
    expect(mockPublishEvalEvent).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }))
  })

  it('marks the run fatal before materializing more than the snapshot target cap', async () => {
    const oversizedTargets = Array.from({ length: MAX_SNAPSHOT_TARGETS + 1 }, (_, index) => ({
      ...subjectTargetRow(),
      workflowId: `workflow-${index}`,
      snapshotWorkflowId: `workflow-${index}`,
      isSubject: index === 0,
    }))
    dbChainMockFns.limit
      .mockResolvedValueOnce([workerRunRow()])
      .mockResolvedValueOnce(oversizedTargets)
    dbChainMockFns.returning
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 1 })])
      .mockResolvedValueOnce([
        {
          suiteId: 'suite-1',
          workspaceId: 'workspace-1',
          ...runProjection({ status: 'error', revision: 2 }),
          errorCode: 'coordinator_failed',
          errorMessage: `Workflow eval run run-1 exceeds the ${MAX_SNAPSHOT_TARGETS} target limit`,
        },
      ])

    await expect(runWorkflowEvalSuiteJob({ runId: 'run-1' })).rejects.toThrow(
      `exceeds the ${MAX_SNAPSHOT_TARGETS} target limit`
    )

    expect(dbChainMockFns.limit).toHaveBeenNthCalledWith(2, MAX_SNAPSHOT_TARGETS + 1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorKind: 'infrastructure',
        errorCode: 'coordinator_failed',
      })
    )
    expect(mockExecuteWorkflowJob).not.toHaveBeenCalled()
    expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
  })

  it('persists explicit phases, normalizes true to pass/10, and publishes committed revisions', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([workerRunRow()])
      .mockResolvedValueOnce([subjectTargetRow()])
    dbChainMockFns.orderBy.mockResolvedValueOnce([testProjection({ phase: 'queued' })])
    dbChainMockFns.returning
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 1 })])
      .mockResolvedValueOnce([testProjection({ phase: 'running_subject' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 2 })])
      .mockResolvedValueOnce([testProjection({ phase: 'running_evaluator' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 3 })])
      .mockResolvedValueOnce([testProjection({ phase: 'completed', outcome: 'pass', score: 10 })])
      .mockResolvedValueOnce([
        runProjection({ status: 'running', revision: 4, completedCount: 1, passedCount: 1 }),
      ])
      .mockResolvedValueOnce([
        runProjection({ status: 'completed', revision: 5, completedCount: 1, passedCount: 1 }),
      ])

    await runWorkflowEvalSuiteJob({ runId: 'run-1' })

    expect(mockExecuteWorkflowJob).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution-1',
        billingAttribution: BILLING_ATTRIBUTION,
        useDraftState: true,
        workflowStateSnapshotId: 'snapshot-1',
        blockMocks: SUBJECT_MOCKS,
        correlation: {
          executionId: 'execution-1',
          requestId: 'run-1:test-run-1',
          source: 'eval',
          workflowId: 'workflow-1',
          triggerType: 'workflow',
          evalRunId: 'run-1',
          evalSuiteId: 'suite-1',
          evalTestId: 'test-1',
          evalTestRunId: 'test-run-1',
        },
      }),
      undefined
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'completed', outcome: 'pass', score: 10 })
    )
    expect(
      mockPublishEvalEvent.mock.calls.map(([event]) => ({
        type: event.type,
        revision: event.run.revision,
        phase: event.type === 'eval.test.upsert' ? event.test.phase : null,
      }))
    ).toEqual([
      { type: 'eval.run.upsert', revision: 1, phase: null },
      { type: 'eval.test.upsert', revision: 2, phase: 'running_subject' },
      { type: 'eval.test.upsert', revision: 3, phase: 'running_evaluator' },
      { type: 'eval.test.upsert', revision: 4, phase: 'completed' },
      { type: 'eval.run.upsert', revision: 5, phase: null },
    ])
  })

  it('maps workflow judge input, executes the pinned judge, and normalizes score 7 to warning', async () => {
    prepareWorkflowWorkerDb(
      workflowTestProjection({ phase: 'completed', outcome: 'warning', score: 7 })
    )

    await runWorkflowEvalSuiteJob({ runId: 'run-1' })

    expect(mockGetBoundedSnapshotForWorkflow).toHaveBeenCalledWith(
      'judge-snapshot-1',
      'judge-workflow'
    )
    expect(mockValidatePinnedWorkflowJudgeDefinition).toHaveBeenCalledWith({
      state: { blocks: {} },
      inputMappings: WORKFLOW_TEST.evaluator.inputMappings,
      scoreOutput: WORKFLOW_TEST.evaluator.scoreOutput,
    })
    expect(mockExecuteWorkflowJob).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ blockMocks: SUBJECT_MOCKS }),
      undefined
    )
    expect(mockLoadProjectedJudgeInput).toHaveBeenCalledWith({
      executionId: 'workflow-subject-execution-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      runId: 'run-1',
      suiteId: 'suite-1',
      testId: WORKFLOW_TEST.id,
      testRunId: 'workflow-test-run-1',
      mappings: WORKFLOW_TEST.evaluator.inputMappings,
    })
    expect(mockExecuteWorkflowJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        workflowId: 'judge-workflow',
        userId: 'user-1',
        billingAttribution: BILLING_ATTRIBUTION,
        workspaceId: 'workspace-1',
        input: { answer: 'A concise answer', expectedTone: 'concise' },
        triggerType: 'workflow',
        triggerBlockId: 'judge-start',
        executionId: 'workflow-judge-execution-1',
        correlation: {
          executionId: 'workflow-judge-execution-1',
          requestId: 'run-1:workflow-test-run-1:judge',
          source: 'eval',
          workflowId: 'judge-workflow',
          triggerType: 'workflow',
          evalRunId: 'run-1',
          evalSuiteId: 'suite-1',
          evalTestId: WORKFLOW_TEST.id,
          evalTestRunId: 'workflow-test-run-1',
        },
        callChain: ['judge-workflow'],
        executionMode: 'async',
        useDraftState: true,
        workflowStateSnapshotId: 'judge-snapshot-1',
      }),
      undefined
    )
    expect(mockExecuteWorkflowJob.mock.calls[1]?.[0].blockMocks).toBeUndefined()
    expect(mockLoadProjectedJudgeScore).toHaveBeenCalledWith({
      executionId: 'workflow-judge-execution-1',
      workflowId: 'judge-workflow',
      workspaceId: 'workspace-1',
      runId: 'run-1',
      suiteId: 'suite-1',
      testId: WORKFLOW_TEST.id,
      testRunId: 'workflow-test-run-1',
      selector: WORKFLOW_TEST.evaluator.scoreOutput,
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'completed', outcome: 'warning', score: 7 })
    )
  })

  it('keeps workflow judge input projection failures local to the test', async () => {
    const projectionError = new MockWorkflowEvalJudgeTraceError(
      'selected_output_missing',
      'Selected output agent.content is missing'
    )
    mockLoadProjectedJudgeInput.mockRejectedValueOnce(projectionError)
    prepareWorkflowWorkerDb(
      workflowTestProjection({
        phase: 'error',
        errorKind: 'evaluator',
        errorCode: projectionError.code,
        errorMessage: projectionError.message,
      })
    )

    await runWorkflowEvalSuiteJob({ runId: 'run-1' })

    expect(mockExecuteWorkflowJob).toHaveBeenCalledOnce()
    expect(mockLoadProjectedJudgeScore).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'error',
        errorKind: 'evaluator',
        errorCode: 'selected_output_missing',
        errorMessage: projectionError.message,
      })
    )
    expect(mockPublishEvalEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'eval.run.upsert',
        run: expect.objectContaining({ status: 'completed', errorCount: 1 }),
      })
    )
  })

  it('keeps an ordinary workflow judge execution failure local to the test', async () => {
    mockExecuteWorkflowJob
      .mockResolvedValueOnce({ success: true, output: { ok: true }, durationMs: 1_250 })
      .mockResolvedValueOnce({ success: false })
    prepareWorkflowWorkerDb(
      workflowTestProjection({
        phase: 'error',
        errorKind: 'evaluator',
        errorCode: 'workflow_judge_execution_failed',
        errorMessage: 'Workflow judge execution did not complete successfully',
      })
    )

    await runWorkflowEvalSuiteJob({ runId: 'run-1' })

    expect(mockExecuteWorkflowJob).toHaveBeenCalledTimes(2)
    expect(mockLoadProjectedJudgeScore).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'error',
        errorKind: 'evaluator',
        errorCode: 'workflow_judge_execution_failed',
      })
    )
    expect(mockPublishEvalEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'eval.run.upsert',
        run: expect.objectContaining({ status: 'completed', errorCount: 1 }),
      })
    )
  })

  it('rejects a string workflow judge score without failing the suite coordinator', async () => {
    mockLoadProjectedJudgeScore.mockResolvedValueOnce('7')
    prepareWorkflowWorkerDb(
      workflowTestProjection({
        phase: 'error',
        errorKind: 'evaluator',
        errorCode: 'invalid_workflow_judge_score',
        errorMessage: 'Workflow judge score must be a raw finite number between 0 and 10',
      })
    )

    await runWorkflowEvalSuiteJob({ runId: 'run-1' })

    expect(mockLoadProjectedJudgeScore).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'error',
        outcome: null,
        score: null,
        errorKind: 'evaluator',
        errorCode: 'invalid_workflow_judge_score',
      })
    )
    expect(mockPublishEvalEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'eval.run.upsert',
        run: expect.objectContaining({ status: 'completed', errorCount: 1 }),
      })
    )
  })

  it.each([
    {
      name: 'fails a mixed aggregate when the judges are confident',
      verdicts: ['pass', 'fail'],
      confidences: [1, 1],
      expectedOutcome: 'fail',
      expectedScore: 5,
      expectedCounts: { failedCount: 1 },
    },
    {
      name: 'warns only when average judge confidence is below 50 percent',
      verdicts: ['pass', 'pass'],
      confidences: [0.49, 0.49],
      expectedOutcome: 'warning',
      expectedScore: 10,
      expectedCounts: { warningCount: 1 },
    },
    {
      name: 'treats exactly 50 percent confidence as decisive',
      verdicts: ['pass', 'pass'],
      confidences: [0.5, 0.5],
      expectedOutcome: 'pass',
      expectedScore: 10,
      expectedCounts: { passedCount: 1 },
    },
    {
      name: 'normalizes floating-point drift in a passing confidence-weighted aggregate',
      verdicts: ['pass', 'pass'],
      confidences: [0.98, 0.98],
      expectedOutcome: 'pass',
      expectedScore: 10,
      expectedCounts: { passedCount: 1 },
    },
  ] as const)(
    '$name',
    async ({ verdicts, confidences, expectedOutcome, expectedScore, expectedCounts }) => {
      const queuedCriteria = [
        criterionRow({ ordinal: 0, phase: 'queued' }),
        criterionRow({ ordinal: 1, phase: 'queued' }),
      ]
      const completedCriteria = [
        criterionRow({
          ordinal: 0,
          phase: 'completed',
          verdict: verdicts[0],
          confidence: confidences[0],
        }),
        criterionRow({
          ordinal: 1,
          phase: 'completed',
          verdict: verdicts[1],
          confidence: confidences[1],
        }),
      ]
      const judgeTrace = {
        spanCount: 1,
        blocks: [],
        selectedOutputs: [],
        agentToolCalls: [],
      }
      const evaluations = [
        completedCriterionEvaluation(verdicts[0], confidences[0], 'Quality evidence'),
        completedCriterionEvaluation(verdicts[1], confidences[1], 'Safety evidence'),
      ]
      mockLoadProjectedJudgeTrace.mockResolvedValueOnce(judgeTrace)
      mockEvaluateAgentCriteria.mockImplementationOnce(async (input: AgentEvaluatorMockInput) => {
        for (const [ordinal, item] of input.criteria.entries()) {
          const evaluation = evaluations[ordinal]
          if (!evaluation) throw new Error(`Missing mock evaluation ${ordinal}`)
          await input.onCriterionStarted(item, ordinal)
          await input.onCriterionFinished(item, ordinal, evaluation)
        }
        return evaluations
      })

      dbChainMockFns.limit
        .mockResolvedValueOnce([agentWorkerRunRow()])
        .mockResolvedValueOnce([subjectTargetRow()])
        .mockResolvedValueOnce(queuedCriteria)
        .mockResolvedValueOnce(queuedCriteria)
        .mockResolvedValueOnce(queuedCriteria)
        .mockResolvedValueOnce(completedCriteria)
        .mockResolvedValueOnce(completedCriteria)
      dbChainMockFns.orderBy.mockResolvedValueOnce([agentTestProjection({ phase: 'queued' })])
      dbChainMockFns.returning
        .mockResolvedValueOnce([runProjection({ status: 'running', revision: 1 })])
        .mockResolvedValueOnce([agentTestProjection({ phase: 'running_subject' })])
        .mockResolvedValueOnce([runProjection({ status: 'running', revision: 2 })])
        .mockResolvedValueOnce([agentTestProjection({ phase: 'running_evaluator' })])
        .mockResolvedValueOnce([runProjection({ status: 'running', revision: 3 })])
        .mockResolvedValueOnce([criterionRow({ ordinal: 0, phase: 'running' })])
        .mockResolvedValueOnce([runProjection({ status: 'running', revision: 4 })])
        .mockResolvedValueOnce([
          criterionRow({
            ordinal: 0,
            phase: 'completed',
            verdict: verdicts[0],
            confidence: confidences[0],
          }),
        ])
        .mockResolvedValueOnce([runProjection({ status: 'running', revision: 5 })])
        .mockResolvedValueOnce([criterionRow({ ordinal: 1, phase: 'running' })])
        .mockResolvedValueOnce([runProjection({ status: 'running', revision: 6 })])
        .mockResolvedValueOnce([
          criterionRow({
            ordinal: 1,
            phase: 'completed',
            verdict: verdicts[1],
            confidence: confidences[1],
          }),
        ])
        .mockResolvedValueOnce([runProjection({ status: 'running', revision: 7 })])
        .mockResolvedValueOnce([
          agentTestProjection({
            phase: 'completed',
            outcome: expectedOutcome,
            score: expectedScore,
          }),
        ])
        .mockResolvedValueOnce([
          runProjection({
            status: 'running',
            revision: 8,
            completedCount: 1,
            ...expectedCounts,
          }),
        ])
        .mockResolvedValueOnce([
          runProjection({
            status: 'completed',
            revision: 9,
            completedCount: 1,
            ...expectedCounts,
          }),
        ])

      await runWorkflowEvalSuiteJob({ runId: 'run-1' })

      expect(mockExecuteWorkflowJob).toHaveBeenCalledWith(
        expect.objectContaining({ blockMocks: SUBJECT_MOCKS }),
        undefined
      )
      expect(mockLoadProjectedJudgeTrace).toHaveBeenCalledWith({
        executionId: 'agent-subject-execution-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        suiteId: 'suite-1',
        testId: AGENT_TEST.id,
        testRunId: 'agent-test-run-1',
        selectors: AGENT_TEST.evaluator.outputSelectors,
      })
      expect(mockEvaluateAgentCriteria).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'judge-model',
          trace: judgeTrace,
          criteria: [
            expect.objectContaining({ criterionRunId: 'criterion-run-1' }),
            expect.objectContaining({ criterionRunId: 'criterion-run-2' }),
          ],
        })
      )
      expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'completed',
          outcome: expectedOutcome,
          score: expectedScore,
        })
      )

      const criterionEvents = mockPublishEvalEvent.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === 'eval.criterion.upsert')
        .map((event) => ({
          revision: event.run.revision,
          criterionId: event.criterion.criterionId,
          phase: event.criterion.phase,
        }))
      expect(criterionEvents).toEqual([
        { revision: 4, criterionId: 'quality', phase: 'running' },
        { revision: 5, criterionId: 'quality', phase: 'completed' },
        { revision: 6, criterionId: 'safety', phase: 'running' },
        { revision: 7, criterionId: 'safety', phase: 'completed' },
      ])
      expect(mockPublishEvalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'eval.test.upsert',
          run: expect.objectContaining({ revision: 8, ...expectedCounts }),
          test: expect.objectContaining({
            phase: 'completed',
            outcome: expectedOutcome,
            score: expectedScore,
            criteria: [
              expect.objectContaining({
                criterionId: 'quality',
                verdict: verdicts[0],
                confidence: confidences[0],
              }),
              expect.objectContaining({
                criterionId: 'safety',
                verdict: verdicts[1],
                confidence: confidences[1],
              }),
            ],
          }),
        })
      )
    }
  )

  it('preserves completed criteria and refuses to reweight around a failed criterion', async () => {
    const queuedCriteria = [
      criterionRow({ ordinal: 0, phase: 'queued' }),
      criterionRow({ ordinal: 1, phase: 'queued' }),
    ]
    const failedMessage = 'Agent judge failed: provider unavailable'
    const terminalCriteria = [
      criterionRow({ ordinal: 0, phase: 'completed', verdict: 'pass', confidence: 1 }),
      criterionRow({
        ordinal: 1,
        phase: 'error',
        errorKind: 'evaluator',
        errorCode: 'agent_judge_failed',
        errorMessage: failedMessage,
      }),
    ]
    const evaluations = [
      completedCriterionEvaluation('pass', 1, 'Quality evidence'),
      erroredCriterionEvaluation(failedMessage),
    ]
    mockLoadProjectedJudgeTrace.mockResolvedValueOnce({
      spanCount: 1,
      blocks: [],
      selectedOutputs: [],
      agentToolCalls: [],
    })
    mockEvaluateAgentCriteria.mockImplementationOnce(async (input: AgentEvaluatorMockInput) => {
      for (const [ordinal, item] of input.criteria.entries()) {
        const evaluation = evaluations[ordinal]
        if (!evaluation) throw new Error(`Missing mock evaluation ${ordinal}`)
        await input.onCriterionStarted(item, ordinal)
        await input.onCriterionFinished(item, ordinal, evaluation)
      }
      return evaluations
    })

    dbChainMockFns.limit
      .mockResolvedValueOnce([agentWorkerRunRow()])
      .mockResolvedValueOnce([subjectTargetRow()])
      .mockResolvedValueOnce(queuedCriteria)
      .mockResolvedValueOnce(queuedCriteria)
      .mockResolvedValueOnce(queuedCriteria)
      .mockResolvedValueOnce(terminalCriteria)
      .mockResolvedValueOnce(terminalCriteria)
    dbChainMockFns.orderBy.mockResolvedValueOnce([agentTestProjection({ phase: 'queued' })])
    dbChainMockFns.returning
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 1 })])
      .mockResolvedValueOnce([agentTestProjection({ phase: 'running_subject' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 2 })])
      .mockResolvedValueOnce([agentTestProjection({ phase: 'running_evaluator' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 3 })])
      .mockResolvedValueOnce([criterionRow({ ordinal: 0, phase: 'running' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 4 })])
      .mockResolvedValueOnce([
        criterionRow({ ordinal: 0, phase: 'completed', verdict: 'pass', confidence: 1 }),
      ])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 5 })])
      .mockResolvedValueOnce([criterionRow({ ordinal: 1, phase: 'running' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 6 })])
      .mockResolvedValueOnce([
        criterionRow({
          ordinal: 1,
          phase: 'error',
          errorKind: 'evaluator',
          errorCode: 'agent_judge_failed',
          errorMessage: failedMessage,
        }),
      ])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 7 })])
      .mockResolvedValueOnce([
        agentTestProjection({
          phase: 'error',
          errorKind: 'infrastructure',
          errorCode: 'agent_criterion_failed',
          errorMessage: `Agent criterion "Safety" failed: ${failedMessage}`,
        }),
      ])
      .mockResolvedValueOnce([
        runProjection({ status: 'running', revision: 8, completedCount: 1, errorCount: 1 }),
      ])
      .mockResolvedValueOnce([
        runProjection({ status: 'completed', revision: 9, completedCount: 1, errorCount: 1 }),
      ])

    await runWorkflowEvalSuiteJob({ runId: 'run-1' })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'error',
        outcome: null,
        score: null,
        errorKind: 'infrastructure',
        errorCode: 'agent_criterion_failed',
      })
    )
    expect(mockPublishEvalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'eval.test.upsert',
        test: expect.objectContaining({
          phase: 'error',
          outcome: null,
          score: null,
          criteria: [
            expect.objectContaining({ criterionId: 'quality', phase: 'completed' }),
            expect.objectContaining({ criterionId: 'safety', phase: 'error' }),
          ],
        }),
      })
    )
  })

  it('fails an agent test before any paid judge call when trace projection fails', async () => {
    const queuedCriteria = [
      criterionRow({ ordinal: 0, phase: 'queued' }),
      criterionRow({ ordinal: 1, phase: 'queued' }),
    ]
    const traceError = new MockWorkflowEvalJudgeTraceError(
      'selected_output_missing',
      'Selected output agent.content is missing'
    )
    mockLoadProjectedJudgeTrace.mockRejectedValueOnce(traceError)
    dbChainMockFns.limit
      .mockResolvedValueOnce([agentWorkerRunRow()])
      .mockResolvedValueOnce([subjectTargetRow()])
      .mockResolvedValueOnce(queuedCriteria)
      .mockResolvedValueOnce(queuedCriteria)
      .mockResolvedValueOnce(queuedCriteria)
      .mockResolvedValueOnce(queuedCriteria)
    dbChainMockFns.orderBy.mockResolvedValueOnce([agentTestProjection({ phase: 'queued' })])
    dbChainMockFns.returning
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 1 })])
      .mockResolvedValueOnce([agentTestProjection({ phase: 'running_subject' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 2 })])
      .mockResolvedValueOnce([agentTestProjection({ phase: 'running_evaluator' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 3 })])
      .mockResolvedValueOnce([
        agentTestProjection({
          phase: 'error',
          errorKind: 'evaluator',
          errorCode: 'selected_output_missing',
          errorMessage: traceError.message,
        }),
      ])
      .mockResolvedValueOnce([
        runProjection({ status: 'running', revision: 4, completedCount: 1, errorCount: 1 }),
      ])
      .mockResolvedValueOnce([
        runProjection({ status: 'completed', revision: 5, completedCount: 1, errorCount: 1 }),
      ])

    await runWorkflowEvalSuiteJob({ runId: 'run-1' })

    expect(mockLoadProjectedJudgeTrace).toHaveBeenCalledOnce()
    expect(mockEvaluateAgentCriteria).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'error',
        errorKind: 'evaluator',
        errorCode: 'selected_output_missing',
      })
    )
  })

  it('marks workflow admission failures as run-fatal instead of repeating them per test', async () => {
    const admissionError = new WorkflowExecutionAdmissionError(
      'snapshot_load_failed',
      'Pinned workflow snapshot failed validation'
    )
    mockExecuteWorkflowJob.mockRejectedValueOnce(admissionError)
    dbChainMockFns.limit
      .mockResolvedValueOnce([workerRunRow()])
      .mockResolvedValueOnce([subjectTargetRow()])
    dbChainMockFns.orderBy.mockResolvedValueOnce([testProjection({ phase: 'queued' })])
    dbChainMockFns.returning
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 1 })])
      .mockResolvedValueOnce([testProjection({ phase: 'running_subject' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 2 })])
      .mockResolvedValueOnce([
        {
          suiteId: 'suite-1',
          workspaceId: 'workspace-1',
          ...runProjection({ status: 'error', revision: 3 }),
          errorCode: 'coordinator_failed',
          errorMessage: admissionError.message,
        },
      ])

    await expect(runWorkflowEvalSuiteJob({ runId: 'run-1' })).rejects.toBe(admissionError)

    expect(mockExecuteWorkflowJob).toHaveBeenCalledOnce()
    expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorKind: 'infrastructure',
        errorCode: 'coordinator_failed',
        errorMessage: admissionError.message,
      })
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'error',
        errorKind: 'infrastructure',
        errorCode: 'coordinator_failed',
        errorMessage: admissionError.message,
      })
    )
  })

  it('records a subject error as a terminal test and still completes the suite', async () => {
    mockExecuteWorkflowJob.mockResolvedValueOnce({ success: false })
    dbChainMockFns.limit
      .mockResolvedValueOnce([workerRunRow()])
      .mockResolvedValueOnce([subjectTargetRow()])
    dbChainMockFns.orderBy.mockResolvedValueOnce([testProjection({ phase: 'queued' })])
    dbChainMockFns.returning
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 1 })])
      .mockResolvedValueOnce([testProjection({ phase: 'running_subject' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 2 })])
      .mockResolvedValueOnce([
        testProjection({
          phase: 'error',
          errorKind: 'subject',
          errorCode: 'subject_execution_failed',
          errorMessage: 'Workflow execution did not complete successfully',
        }),
      ])
      .mockResolvedValueOnce([
        runProjection({ status: 'running', revision: 3, completedCount: 1, errorCount: 1 }),
      ])
      .mockResolvedValueOnce([
        runProjection({ status: 'completed', revision: 4, completedCount: 1, errorCount: 1 }),
      ])

    await runWorkflowEvalSuiteJob({ runId: 'run-1' })

    expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'error',
        errorKind: 'subject',
        errorCode: 'subject_execution_failed',
      })
    )
    expect(mockPublishEvalEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'eval.run.upsert',
        run: expect.objectContaining({ status: 'completed', errorCount: 1 }),
      })
    )
  })

  it('normalizes false to an ordinary fail/0 assertion rather than infrastructure error', async () => {
    mockExecuteInIsolatedVM.mockResolvedValueOnce({
      result: { passed: false, reason: 'Expected escalation' },
      stdout: '',
    })
    dbChainMockFns.limit
      .mockResolvedValueOnce([workerRunRow()])
      .mockResolvedValueOnce([subjectTargetRow()])
    dbChainMockFns.orderBy.mockResolvedValueOnce([testProjection({ phase: 'queued' })])
    dbChainMockFns.returning
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 1 })])
      .mockResolvedValueOnce([testProjection({ phase: 'running_subject' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 2 })])
      .mockResolvedValueOnce([testProjection({ phase: 'running_evaluator' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 3 })])
      .mockResolvedValueOnce([testProjection({ phase: 'completed', outcome: 'fail', score: 0 })])
      .mockResolvedValueOnce([
        runProjection({ status: 'running', revision: 4, completedCount: 1, failedCount: 1 }),
      ])
      .mockResolvedValueOnce([
        runProjection({ status: 'completed', revision: 5, completedCount: 1, failedCount: 1 }),
      ])

    await runWorkflowEvalSuiteJob({ runId: 'run-1' })

    expect(mockExecuteInIsolatedVM).toHaveBeenCalledWith(
      expect.objectContaining({
        contextVariables: {
          input: CODE_TEST.input,
          output: { ok: true },
          blockOutputs: [
            {
              blockId: 'router',
              path: 'route',
              occurrences: [
                {
                  occurrence: 1,
                  executionOrder: 2,
                  coordinates: [],
                  value: 'billing',
                },
              ],
            },
          ],
          metadata: { durationMs: 1_250 },
        },
      }),
      { signal: undefined }
    )

    expect(mockLoadProjectedCodeBlockOutputs).toHaveBeenCalledWith({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      runId: 'run-1',
      suiteId: 'suite-1',
      testId: CODE_TEST.id,
      testRunId: 'test-run-1',
      selectors: CODE_TEST.evaluator.outputSelectors,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'completed',
        outcome: 'fail',
        score: 0,
        reason: 'Expected escalation',
        errorKind: null,
      })
    )
  })

  it('rejects an oversized evaluator context before isolated execution', async () => {
    const oversizedOutput = { content: 'x'.repeat(10 * 1024 * 1024) }
    mockExecuteWorkflowJob.mockResolvedValueOnce({
      success: true,
      output: oversizedOutput,
      durationMs: 1_250,
    })
    dbChainMockFns.limit
      .mockResolvedValueOnce([workerRunRow()])
      .mockResolvedValueOnce([subjectTargetRow()])
    dbChainMockFns.orderBy.mockResolvedValueOnce([testProjection({ phase: 'queued' })])
    dbChainMockFns.returning
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 1 })])
      .mockResolvedValueOnce([testProjection({ phase: 'running_subject' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 2 })])
      .mockResolvedValueOnce([testProjection({ phase: 'running_evaluator' })])
      .mockResolvedValueOnce([runProjection({ status: 'running', revision: 3 })])
      .mockResolvedValueOnce([
        testProjection({
          phase: 'error',
          errorKind: 'evaluator',
          errorCode: 'evaluator_context_too_large',
          errorMessage: 'Code evaluator context exceeds 10485760 serialized bytes',
        }),
      ])
      .mockResolvedValueOnce([
        runProjection({ status: 'running', revision: 4, completedCount: 1, errorCount: 1 }),
      ])
      .mockResolvedValueOnce([
        runProjection({ status: 'completed', revision: 5, completedCount: 1, errorCount: 1 }),
      ])

    await runWorkflowEvalSuiteJob({ runId: 'run-1' })

    expect(mockExecuteInIsolatedVM).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'error',
        errorKind: 'evaluator',
        errorCode: 'evaluator_context_too_large',
      })
    )
  })
})
