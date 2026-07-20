import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  workflow,
  workflowEvalCriterionRun,
  workflowEvalRun,
  workflowEvalRunTarget,
  workflowEvalSuite,
  workflowEvalTestRun,
  workflowExecutionSnapshots,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { and, asc, eq, exists, inArray, sql } from 'drizzle-orm'
import {
  MAX_WORKFLOW_EVAL_SUITE_BYTES,
  WORKFLOW_EVAL_AGENT_WARNING_CONFIDENCE_THRESHOLD,
  type WorkflowEvalCompactCriterionRun,
  type WorkflowEvalCompactTestRun,
  type WorkflowEvalCriterionRun,
  type WorkflowEvalDefinitionSnapshot,
  type WorkflowEvalError,
  type WorkflowEvalOutcome,
  type WorkflowEvalStreamEvent,
  type WorkflowEvalStreamRun,
  type WorkflowEvalTest,
  type WorkflowEvalTestRun,
  workflowEvalCompactCriterionRunSchema,
  workflowEvalCompactTestRunSchema,
  workflowEvalCriterionRunSchema,
  workflowEvalDefinitionSnapshotSchema,
  workflowEvalScoreSchema,
  workflowEvalStreamEventSchema,
  workflowEvalStreamRunSchema,
  workflowEvalTestRunSchema,
  workflowEvalTestsSchema,
} from '@/lib/api/contracts/workflow-evals'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  resolveBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { getAsyncBackendType, getJobQueue } from '@/lib/core/async-jobs/config'
import {
  type AsyncJobEnqueueAcceptance,
  type EnqueueOptions,
  isAsyncJobEnqueueError,
} from '@/lib/core/async-jobs/types'
import { getBoundedJsonByteLength } from '@/lib/core/utils/json-size'
import type { DbOrTx } from '@/lib/db/types'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import { executeInIsolatedVM } from '@/lib/execution/isolated-vm'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import {
  evaluateWorkflowEvalAgentCriteria,
  WORKFLOW_EVAL_CRITERION_PROMPT_VERSION,
  type WorkflowEvalAgentCriterionEvaluation,
  type WorkflowEvalAgentCriterionWorkItem,
} from '@/lib/workflows/evals/agent-evaluator.server'
import {
  loadProjectedWorkflowEvalCodeBlockOutputs,
  loadProjectedWorkflowEvalJudgeInput,
  loadProjectedWorkflowEvalJudgeScore,
  loadProjectedWorkflowEvalJudgeTrace,
  type WorkflowEvalJudgeSelectedOutput,
  WorkflowEvalJudgeTraceError,
} from '@/lib/workflows/evals/judge-trace.server'
import { workflowEvalPubSub } from '@/lib/workflows/evals/pubsub'
import {
  captureWorkflowEvalSnapshotTargets,
  MAX_WORKFLOW_EVAL_SNAPSHOT_TARGETS,
} from '@/lib/workflows/evals/snapshot-targets'
import {
  validatePinnedWorkflowJudgeDefinition,
  WorkflowEvalWorkflowJudgeValidationError,
} from '@/lib/workflows/evals/workflow-judge-validation'
import { WORKFLOW_EVAL_SUITE_CONCURRENCY_LIMIT } from '@/background/concurrency-limits'
import {
  executeWorkflowJob,
  WorkflowExecutionAdmissionError,
} from '@/background/workflow-execution'

const logger = createLogger('WorkflowEvalRunService')

const ACTIVE_RUN_CONSTRAINT = 'workflow_eval_run_active_suite_unique'
const EVAL_JOB_ID_PREFIX = 'eval-suite:'
const CODE_EVALUATOR_TIMEOUT_MS = 5_000
const MAX_EVALUATOR_CONTEXT_BYTES = MAX_WORKFLOW_EVAL_SUITE_BYTES
const MAX_ERROR_CHARS = 20_000
const CRITERION_INSERT_BATCH_SIZE = 250
const AGENT_SCORE_EPSILON = 1e-12
const AGENT_SCORE_DECIMAL_PLACES = 12

type CodeWorkflowEvalTest = WorkflowEvalTest & {
  evaluator: Extract<WorkflowEvalTest['evaluator'], { type: 'code' }>
}

type AgentWorkflowEvalTest = WorkflowEvalTest & {
  evaluator: Extract<WorkflowEvalTest['evaluator'], { type: 'agent' }>
}

type WorkflowJudgeEvalTest = WorkflowEvalTest & {
  evaluator: Extract<WorkflowEvalTest['evaluator'], { type: 'workflow' }>
}

type WorkflowJudgeEvaluator = WorkflowJudgeEvalTest['evaluator']

type RunnableWorkflowEvalTest = CodeWorkflowEvalTest | AgentWorkflowEvalTest | WorkflowJudgeEvalTest

export interface WorkflowEvalSuiteJobPayload {
  runId: string
}

interface WorkflowEvalJobScope {
  suiteId: string
  workflowId: string
  workspaceId: string
  userId: string
  subjectSnapshotId: string
}

export interface QueuedWorkflowEvalRun {
  runId: string
  suiteId: string
  workspaceId: string
  workflowId: string
  scope: 'suite' | 'test'
  selectedTestId: string | null
  suiteDefinitionRevision: number
  status: 'queued'
  revision: 0
  totalCount: number
  createdAt: Date
}

export interface StoppedWorkflowEvalRun {
  runId: string
  suiteId: string
  workspaceId: string
  workflowId: string
  status: 'cancelled'
  revision: number
  completedAt: Date
}

export class WorkflowEvalSuiteNotFoundError extends Error {
  constructor(readonly suiteId: string) {
    super(`Workflow eval suite ${suiteId} was not found`)
    this.name = 'WorkflowEvalSuiteNotFoundError'
  }
}

export class WorkflowEvalSuiteNotRunnableError extends Error {
  constructor(
    readonly suiteId: string,
    readonly reason: 'empty' | 'oversized' | 'invalid-definition'
  ) {
    super(
      reason === 'empty'
        ? `Workflow eval suite ${suiteId} has no tests`
        : reason === 'oversized'
          ? `Workflow eval suite ${suiteId} exceeds ${MAX_WORKFLOW_EVAL_SUITE_BYTES} serialized bytes`
          : `Workflow eval suite ${suiteId} has an invalid definition`
    )
    this.name = 'WorkflowEvalSuiteNotRunnableError'
  }
}

export class WorkflowEvalRunAlreadyActiveError extends Error {
  constructor(
    readonly suiteId: string,
    readonly activeRunId?: string
  ) {
    super(`Workflow eval suite ${suiteId} already has an active run`)
    this.name = 'WorkflowEvalRunAlreadyActiveError'
  }
}

export class WorkflowEvalRunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`Workflow eval run ${runId} was not found`)
    this.name = 'WorkflowEvalRunNotFoundError'
  }
}

export class WorkflowEvalRunNotActiveError extends Error {
  constructor(
    readonly runId: string,
    readonly status: string
  ) {
    super(`Workflow eval run ${runId} cannot be stopped from status ${status}`)
    this.name = 'WorkflowEvalRunNotActiveError'
  }
}

export class WorkflowEvalSuiteArchivedError extends Error {
  constructor(readonly suiteId: string) {
    super(`Workflow eval suite ${suiteId} is archived`)
    this.name = 'WorkflowEvalSuiteArchivedError'
  }
}

export class WorkflowEvalDefinitionRevisionConflictError extends Error {
  constructor(
    readonly suiteId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(
      `Workflow eval suite ${suiteId} revision conflict: expected ${expectedRevision}, found ${actualRevision}`
    )
    this.name = 'WorkflowEvalDefinitionRevisionConflictError'
  }
}

export class WorkflowEvalTestNotFoundError extends Error {
  constructor(
    readonly suiteId: string,
    readonly testId: string
  ) {
    super(`Workflow eval test ${testId} was not found in suite ${suiteId}`)
    this.name = 'WorkflowEvalTestNotFoundError'
  }
}

export class WorkflowEvalEnqueueError extends Error {
  constructor(
    readonly runId: string,
    readonly acceptance: AsyncJobEnqueueAcceptance,
    cause: unknown
  ) {
    super(`Failed to enqueue workflow eval run ${runId}`, { cause })
    this.name = 'WorkflowEvalEnqueueError'
  }
}

type CodeEvaluatorVerdict =
  | { success: true; passed: boolean; reason: string | null }
  | { success: false; error: WorkflowEvalError }

type WorkflowEvalTestEvaluation =
  | {
      phase: 'completed'
      outcome: WorkflowEvalOutcome
      score: number
      reason: string | null
      error: null
    }
  | {
      phase: 'error'
      outcome: null
      score: null
      reason: null
      error: WorkflowEvalError
    }

interface RunProjectionRow {
  id: string
  scope: string
  selectedTestId: string | null
  suiteDefinitionRevision: number
  status: string
  revision: number
  completedCount: number
  passedCount: number
  warningCount: number
  failedCount: number
  errorCount: number
  totalCount: number
  createdAt: Date
  updatedAt: Date
  startedAt: Date | null
  completedAt: Date | null
  errorKind: string | null
  errorCode: string | null
  errorMessage: string | null
}

interface TestRunProjectionRow {
  id: string
  testId: string
  ordinal: number
  name: string
  evaluatorType: string
  phase: string
  outcome: string | null
  score: number | null
  reason: string | null
  errorBlockIds: string[]
  errorKind: string | null
  errorCode: string | null
  errorMessage: string | null
  subjectExecutionId: string
  judgeExecutionId: string | null
}

interface CriterionRunProjectionRow {
  id: string
  criterionId: string
  ordinal: number
  name: string
  phase: string
  verdict: string | null
  confidence: number | null
  reason: string | null
  errorKind: string | null
  errorCode: string | null
  errorMessage: string | null
}

interface CriterionRunWorkerRow extends CriterionRunProjectionRow {
  testRunId: string
  requestedModel: string
  providerId: string | null
  responseModel: string | null
  promptVersion: string
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cost: string | null
  durationMs: number | null
}

type WorkflowEvalEventTransport = NonNullable<typeof workflowEvalPubSub>

const runProjectionSelection = {
  id: workflowEvalRun.id,
  scope: workflowEvalRun.scope,
  selectedTestId: workflowEvalRun.selectedTestId,
  suiteDefinitionRevision: workflowEvalRun.suiteDefinitionRevision,
  status: workflowEvalRun.status,
  revision: workflowEvalRun.revision,
  completedCount: workflowEvalRun.completedCount,
  passedCount: workflowEvalRun.passedCount,
  warningCount: workflowEvalRun.warningCount,
  failedCount: workflowEvalRun.failedCount,
  errorCount: workflowEvalRun.errorCount,
  totalCount: workflowEvalRun.totalCount,
  createdAt: workflowEvalRun.createdAt,
  updatedAt: workflowEvalRun.updatedAt,
  startedAt: workflowEvalRun.startedAt,
  completedAt: workflowEvalRun.completedAt,
  errorKind: workflowEvalRun.errorKind,
  errorCode: workflowEvalRun.errorCode,
  errorMessage: workflowEvalRun.errorMessage,
} as const

const testRunProjectionSelection = {
  id: workflowEvalTestRun.id,
  testId: workflowEvalTestRun.testId,
  ordinal: workflowEvalTestRun.ordinal,
  name: workflowEvalTestRun.name,
  evaluatorType: workflowEvalTestRun.evaluatorType,
  phase: workflowEvalTestRun.phase,
  outcome: workflowEvalTestRun.outcome,
  score: workflowEvalTestRun.score,
  reason: workflowEvalTestRun.reason,
  errorBlockIds: workflowEvalTestRun.errorBlockIds,
  errorKind: workflowEvalTestRun.errorKind,
  errorCode: workflowEvalTestRun.errorCode,
  errorMessage: workflowEvalTestRun.errorMessage,
  subjectExecutionId: workflowEvalTestRun.subjectExecutionId,
  judgeExecutionId: workflowEvalTestRun.judgeExecutionId,
} as const

const criterionRunProjectionSelection = {
  id: workflowEvalCriterionRun.id,
  criterionId: workflowEvalCriterionRun.criterionId,
  ordinal: workflowEvalCriterionRun.ordinal,
  name: workflowEvalCriterionRun.name,
  phase: workflowEvalCriterionRun.phase,
  verdict: workflowEvalCriterionRun.verdict,
  confidence: workflowEvalCriterionRun.confidence,
  reason: workflowEvalCriterionRun.reason,
  errorKind: workflowEvalCriterionRun.errorKind,
  errorCode: workflowEvalCriterionRun.errorCode,
  errorMessage: workflowEvalCriterionRun.errorMessage,
} as const

const criterionRunWorkerSelection = {
  ...criterionRunProjectionSelection,
  testRunId: workflowEvalCriterionRun.testRunId,
  requestedModel: workflowEvalCriterionRun.requestedModel,
  providerId: workflowEvalCriterionRun.providerId,
  responseModel: workflowEvalCriterionRun.responseModel,
  promptVersion: workflowEvalCriterionRun.promptVersion,
  inputTokens: workflowEvalCriterionRun.inputTokens,
  outputTokens: workflowEvalCriterionRun.outputTokens,
  totalTokens: workflowEvalCriterionRun.totalTokens,
  cost: workflowEvalCriterionRun.cost,
  durationMs: workflowEvalCriterionRun.durationMs,
} as const

function boundedError(message: string): string {
  return truncate(message, MAX_ERROR_CHARS - 3)
}

function typedError(
  kind: WorkflowEvalError['kind'],
  code: string,
  message: string
): WorkflowEvalError {
  return { kind, code, message: boundedError(message) }
}

function restoreTypedError({
  kind,
  code,
  message,
  owner,
}: {
  kind: string | null
  code: string | null
  message: string | null
  owner: string
}): WorkflowEvalError | null {
  const populated = [kind, code, message].filter((value) => value !== null).length
  if (populated === 0) return null
  if (populated !== 3) throw new Error(`${owner} contains a partial typed error`)
  return { kind, code, message } as WorkflowEvalError
}

function toRunProjection(row: RunProjectionRow): WorkflowEvalStreamRun {
  return workflowEvalStreamRunSchema.parse({
    id: row.id,
    scope: row.scope,
    selectedTestId: row.selectedTestId,
    suiteDefinitionRevision: row.suiteDefinitionRevision,
    status: row.status,
    revision: row.revision,
    completedCount: row.completedCount,
    passedCount: row.passedCount,
    warningCount: row.warningCount,
    failedCount: row.failedCount,
    errorCount: row.errorCount,
    totalCount: row.totalCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    error: restoreTypedError({
      kind: row.errorKind,
      code: row.errorCode,
      message: row.errorMessage,
      owner: `Workflow eval run ${row.id}`,
    }),
  })
}

function toCriterionRunProjection(row: CriterionRunProjectionRow): WorkflowEvalCriterionRun {
  return workflowEvalCriterionRunSchema.parse({
    id: row.id,
    criterionId: row.criterionId,
    ordinal: row.ordinal,
    name: row.name,
    phase: row.phase,
    verdict: row.verdict,
    confidence: row.confidence,
    reason: row.reason,
    error: restoreTypedError({
      kind: row.errorKind,
      code: row.errorCode,
      message: row.errorMessage,
      owner: `Workflow eval criterion run ${row.id}`,
    }),
  })
}

async function loadCriterionRunProjections(
  executor: DbOrTx,
  testRunId: string
): Promise<WorkflowEvalCriterionRun[]> {
  const rows = await executor
    .select(criterionRunProjectionSelection)
    .from(workflowEvalCriterionRun)
    .where(eq(workflowEvalCriterionRun.testRunId, testRunId))
    .orderBy(asc(workflowEvalCriterionRun.ordinal), asc(workflowEvalCriterionRun.id))
    .limit(13)
  if (rows.length > 12) {
    throw new Error(`Workflow eval test run ${testRunId} exceeds the 12-criterion limit`)
  }
  return rows.map(toCriterionRunProjection)
}

function toTestRunProjection(
  row: TestRunProjectionRow,
  criteria: WorkflowEvalCriterionRun[] = []
): WorkflowEvalTestRun {
  return workflowEvalTestRunSchema.parse({
    id: row.id,
    testId: row.testId,
    ordinal: row.ordinal,
    name: row.name,
    evaluatorType: row.evaluatorType,
    phase: row.phase,
    outcome: row.outcome,
    score: row.score,
    reason: row.reason,
    errorBlockIds: row.errorBlockIds,
    subjectExecutionId: row.subjectExecutionId,
    judgeExecutionId: row.judgeExecutionId,
    error: restoreTypedError({
      kind: row.errorKind,
      code: row.errorCode,
      message: row.errorMessage,
      owner: `Workflow eval test run ${row.id}`,
    }),
    criteria,
  })
}

function toCompactCriterionRun(
  criterionRun: WorkflowEvalCriterionRun
): WorkflowEvalCompactCriterionRun {
  const { name: _name, ...compact } = criterionRun
  return workflowEvalCompactCriterionRunSchema.parse(compact)
}

function toCompactTestRun(testRun: WorkflowEvalTestRun): WorkflowEvalCompactTestRun {
  const { name: _name, criteria, ...compact } = testRun
  return workflowEvalCompactTestRunSchema.parse({
    ...compact,
    criteria: criteria.map(toCompactCriterionRun),
  })
}

function requireWorkflowEvalEventTransport(): WorkflowEvalEventTransport {
  if (!workflowEvalPubSub) {
    throw new Error('Workflow eval event transport is unavailable')
  }
  return workflowEvalPubSub
}

function publishWorkflowEvalEvent(
  transport: WorkflowEvalEventTransport,
  event: WorkflowEvalStreamEvent
): void {
  try {
    transport.publish(event)
  } catch (error) {
    logger.error('Failed to publish workflow eval event', {
      eventType: event.type,
      runId: event.run.id,
      error: toError(error),
    })
  }
}

function buildRunEvent({
  scope,
  run,
}: {
  scope: Omit<WorkflowEvalJobScope, 'userId' | 'subjectSnapshotId'>
  run: WorkflowEvalStreamRun
}): WorkflowEvalStreamEvent {
  return workflowEvalStreamEventSchema.parse({
    version: 2,
    type: 'eval.run.upsert',
    workspaceId: scope.workspaceId,
    workflowId: scope.workflowId,
    suiteId: scope.suiteId,
    run,
  })
}

function buildTestEvent({
  scope,
  run,
  testRun,
}: {
  scope: Omit<WorkflowEvalJobScope, 'userId' | 'subjectSnapshotId'>
  run: WorkflowEvalStreamRun
  testRun: WorkflowEvalTestRun
}): WorkflowEvalStreamEvent {
  return workflowEvalStreamEventSchema.parse({
    version: 2,
    type: 'eval.test.upsert',
    workspaceId: scope.workspaceId,
    workflowId: scope.workflowId,
    suiteId: scope.suiteId,
    run,
    test: toCompactTestRun(testRun),
  })
}

function buildCriterionEvent({
  scope,
  run,
  testRunId,
  testId,
  criterionRun,
}: {
  scope: Omit<WorkflowEvalJobScope, 'userId' | 'subjectSnapshotId'>
  run: WorkflowEvalStreamRun
  testRunId: string
  testId: string
  criterionRun: WorkflowEvalCriterionRun
}): WorkflowEvalStreamEvent {
  return workflowEvalStreamEventSchema.parse({
    version: 2,
    type: 'eval.criterion.upsert',
    workspaceId: scope.workspaceId,
    workflowId: scope.workflowId,
    suiteId: scope.suiteId,
    run,
    testRunId,
    testId,
    criterion: toCompactCriterionRun(criterionRun),
  })
}

function parseCodeEvaluatorVerdict(value: unknown): CodeEvaluatorVerdict {
  if (typeof value === 'boolean') {
    return { success: true, passed: value, reason: null }
  }
  if (!isRecordLike(value) || Array.isArray(value)) {
    return {
      success: false,
      error: typedError(
        'evaluator',
        'invalid_code_verdict',
        'Code evaluator must return a boolean or { passed: boolean, reason?: string }'
      ),
    }
  }

  const keys = Object.keys(value)
  if (keys.some((key) => key !== 'passed' && key !== 'reason')) {
    return {
      success: false,
      error: typedError(
        'evaluator',
        'invalid_code_verdict',
        'Structured code evaluator verdict may only contain passed and reason'
      ),
    }
  }
  if (typeof value.passed !== 'boolean') {
    return {
      success: false,
      error: typedError(
        'evaluator',
        'invalid_code_verdict',
        'Structured code evaluator verdict passed must be a boolean'
      ),
    }
  }

  let reason: string | null = null
  if (value.reason !== undefined) {
    if (typeof value.reason !== 'string' || value.reason.trim().length === 0) {
      return {
        success: false,
        error: typedError(
          'evaluator',
          'invalid_code_verdict',
          'Structured code evaluator verdict reason must be a non-empty string'
        ),
      }
    }
    reason = value.reason.trim()
    if (reason.length > MAX_ERROR_CHARS) {
      return {
        success: false,
        error: typedError(
          'evaluator',
          'invalid_code_verdict',
          `Structured code evaluator verdict reason must be at most ${MAX_ERROR_CHARS} characters`
        ),
      }
    }
  }

  return { success: true, passed: value.passed, reason }
}

function requireRunnableTests(
  suiteId: string,
  tests: WorkflowEvalTest[]
): RunnableWorkflowEvalTest[] {
  if (tests.length === 0) {
    throw new WorkflowEvalSuiteNotRunnableError(suiteId, 'empty')
  }

  return tests as RunnableWorkflowEvalTest[]
}

async function markRunError(
  runId: string,
  code: string,
  message: string,
  expectedStatus: 'queued' | 'running'
): Promise<{ suiteId: string; workspaceId: string; run: WorkflowEvalStreamRun }> {
  const completedAt = new Date()
  const error = typedError('infrastructure', code, message)
  return db.transaction(async (tx) => {
    const [marked] = await tx
      .update(workflowEvalRun)
      .set({
        status: 'error',
        errorKind: error.kind,
        errorCode: error.code,
        errorMessage: error.message,
        completedAt,
        updatedAt: completedAt,
        revision: sql`${workflowEvalRun.revision} + 1`,
      })
      .where(and(eq(workflowEvalRun.id, runId), eq(workflowEvalRun.status, expectedStatus)))
      .returning({
        suiteId: workflowEvalRun.suiteId,
        workspaceId: workflowEvalRun.workspaceId,
        ...runProjectionSelection,
      })

    if (!marked) {
      throw new Error(`Could not mark workflow eval run ${runId} as error`)
    }

    if (expectedStatus === 'running') {
      await tx
        .update(workflowEvalCriterionRun)
        .set({
          phase: 'error',
          verdict: null,
          confidence: null,
          reason: null,
          errorKind: error.kind,
          errorCode: error.code,
          errorMessage: error.message,
          startedAt: sql`COALESCE(${workflowEvalCriterionRun.startedAt}, ${completedAt})`,
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(
            inArray(workflowEvalCriterionRun.phase, ['queued', 'running']),
            exists(
              tx
                .select({ id: workflowEvalTestRun.id })
                .from(workflowEvalTestRun)
                .where(
                  and(
                    eq(workflowEvalTestRun.id, workflowEvalCriterionRun.testRunId),
                    eq(workflowEvalTestRun.runId, runId),
                    inArray(workflowEvalTestRun.phase, ['running_subject', 'running_evaluator'])
                  )
                )
            )
          )
        )

      await tx
        .update(workflowEvalTestRun)
        .set({
          phase: 'error',
          outcome: null,
          score: null,
          reason: null,
          errorKind: error.kind,
          errorCode: error.code,
          errorMessage: error.message,
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(workflowEvalTestRun.runId, runId),
            inArray(workflowEvalTestRun.phase, ['running_subject', 'running_evaluator'])
          )
        )
    }

    return {
      suiteId: marked.suiteId,
      workspaceId: marked.workspaceId,
      run: toRunProjection(marked),
    }
  })
}

async function runIsCancelled(runId: string): Promise<boolean> {
  const [run] = await db
    .select({ status: workflowEvalRun.status })
    .from(workflowEvalRun)
    .where(eq(workflowEvalRun.id, runId))
    .limit(1)
  if (!run) throw new WorkflowEvalRunNotFoundError(runId)
  return run.status === 'cancelled'
}

function publishErroredRun({
  scope,
  marked,
  transport,
}: {
  scope: Omit<WorkflowEvalJobScope, 'userId' | 'subjectSnapshotId'>
  marked: Awaited<ReturnType<typeof markRunError>>
  transport: WorkflowEvalEventTransport
}): void {
  if (marked.suiteId !== scope.suiteId || marked.workspaceId !== scope.workspaceId) {
    throw new Error(`Errored eval run ${marked.run.id} does not match its job scope`)
  }
  publishWorkflowEvalEvent(transport, buildRunEvent({ scope, run: marked.run }))
}

async function enqueueRun({
  payload,
  scope,
  transport,
}: {
  payload: WorkflowEvalSuiteJobPayload
  scope: WorkflowEvalJobScope
  transport: WorkflowEvalEventTransport
}): Promise<void> {
  let queue: Awaited<ReturnType<typeof getJobQueue>>
  try {
    queue = await getJobQueue()
  } catch (error) {
    const marked = await markRunError(
      payload.runId,
      'queue_initialization_failed',
      `Failed to initialize eval job queue: ${toError(error).message}`,
      'queued'
    )
    publishErroredRun({ scope, marked, transport })
    throw new WorkflowEvalEnqueueError(payload.runId, 'rejected', error)
  }

  try {
    await queue.enqueue('workflow-eval-suite', payload, {
      jobId: `${EVAL_JOB_ID_PREFIX}${payload.runId}`,
      maxAttempts: 1,
      concurrencyKey: 'workflow-eval-suite',
      concurrencyLimit: WORKFLOW_EVAL_SUITE_CONCURRENCY_LIMIT,
      metadata: {
        workflowId: scope.workflowId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
      },
      tags: [`evalRunId:${payload.runId}`, `evalSuiteId:${scope.suiteId}`],
      runner: runWorkflowEvalSuiteJob as EnqueueOptions['runner'],
    })
  } catch (error) {
    const acceptance = isAsyncJobEnqueueError(error) ? error.acceptance : 'unknown'
    if (acceptance === 'rejected') {
      const marked = await markRunError(
        payload.runId,
        'enqueue_failed',
        `Failed to enqueue eval run: ${toError(error).message}`,
        'queued'
      )
      publishErroredRun({ scope, marked, transport })
    }
    throw new WorkflowEvalEnqueueError(payload.runId, acceptance, error)
  }
}

async function cancelTriggerDevEvalJob(runId: string): Promise<void> {
  const { runs } = await import('@trigger.dev/sdk')
  const cancellations: Array<Promise<unknown>> = []
  for await (const run of runs.list({
    tag: `evalRunId:${runId}`,
    taskIdentifier: 'workflow-eval-suite',
    status: ['PENDING_VERSION', 'QUEUED', 'DEQUEUED', 'EXECUTING', 'WAITING', 'DELAYED'],
  })) {
    cancellations.push(runs.cancel(run.id))
  }
  await Promise.all(cancellations)
}

async function cancelEvalJob(runId: string): Promise<void> {
  if (getAsyncBackendType() === 'trigger-dev') {
    await cancelTriggerDevEvalJob(runId)
    return
  }
  const queue = await getJobQueue()
  await queue.cancelJob(`${EVAL_JOB_ID_PREFIX}${runId}`)
}

async function cancelEvalWorkflowExecutions(executionIds: readonly string[]): Promise<void> {
  const results = await Promise.allSettled(
    executionIds.map((executionId) => markExecutionCancelled(executionId))
  )
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `Failed to request cancellation for ${failures.length} Eval workflow execution(s)`
    )
  }
}

/**
 * Creates the canonical queued run and all stable test/criterion identities before dispatch.
 */
async function startWorkflowEvalRun({
  workflowId,
  suiteId,
  workspaceId,
  userId,
  expectedDefinitionRevision,
  selectedTestId,
}: {
  workflowId: string
  suiteId: string
  workspaceId: string
  userId: string
  expectedDefinitionRevision?: number
  selectedTestId: string | null
}): Promise<QueuedWorkflowEvalRun> {
  const eventTransport = requireWorkflowEvalEventTransport()
  const billingAttribution = await resolveBillingAttribution({ actorUserId: userId, workspaceId })
  const runId = generateId()
  const createdAt = new Date()
  let admittedTestCount = 0
  let admittedSuiteRevision = 0
  let subjectSnapshotId = ''

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)

      const [suite] = await tx
        .select({
          id: workflowEvalSuite.id,
          name: workflowEvalSuite.name,
          definitionVersion: workflowEvalSuite.definitionVersion,
          definitionRevision: workflowEvalSuite.definitionRevision,
          archivedAt: workflowEvalSuite.archivedAt,
          testsBytes: sql<number>`octet_length(${workflowEvalSuite.tests}::text)`,
          tests: sql<unknown>`CASE
            WHEN octet_length(${workflowEvalSuite.tests}::text) <= ${MAX_WORKFLOW_EVAL_SUITE_BYTES}
            THEN ${workflowEvalSuite.tests}
            ELSE NULL
          END`,
          workflowWorkspaceId: workflow.workspaceId,
        })
        .from(workflowEvalSuite)
        .innerJoin(workflow, eq(workflow.id, workflowEvalSuite.workflowId))
        .where(and(eq(workflowEvalSuite.id, suiteId), eq(workflowEvalSuite.workflowId, workflowId)))
        .limit(1)

      if (!suite) {
        throw new WorkflowEvalSuiteNotFoundError(suiteId)
      }
      if (suite.workflowWorkspaceId !== workspaceId) {
        throw new Error(
          `Workflow eval suite ${suiteId} belongs to workspace ${suite.workflowWorkspaceId ?? 'none'}, expected ${workspaceId}`
        )
      }
      if (suite.archivedAt !== null) {
        throw new WorkflowEvalSuiteArchivedError(suiteId)
      }
      if (
        expectedDefinitionRevision !== undefined &&
        suite.definitionRevision !== expectedDefinitionRevision
      ) {
        throw new WorkflowEvalDefinitionRevisionConflictError(
          suiteId,
          expectedDefinitionRevision,
          suite.definitionRevision
        )
      }
      if (suite.testsBytes > MAX_WORKFLOW_EVAL_SUITE_BYTES) {
        throw new WorkflowEvalSuiteNotRunnableError(suiteId, 'oversized')
      }
      if (suite.definitionVersion !== 1) {
        throw new WorkflowEvalSuiteNotRunnableError(suiteId, 'invalid-definition')
      }

      const parsedTests = workflowEvalTestsSchema.safeParse(suite.tests)
      if (!parsedTests.success) {
        throw new WorkflowEvalSuiteNotRunnableError(suiteId, 'invalid-definition')
      }
      const allTests = parsedTests.data
      const tests = selectedTestId
        ? allTests.filter((test) => test.id === selectedTestId)
        : allTests
      if (selectedTestId && tests.length !== 1) {
        throw new WorkflowEvalTestNotFoundError(suiteId, selectedTestId)
      }
      requireRunnableTests(suiteId, tests)

      const [activeRun] = await tx
        .select({ id: workflowEvalRun.id })
        .from(workflowEvalRun)
        .where(
          and(
            eq(workflowEvalRun.suiteId, suiteId),
            inArray(workflowEvalRun.status, ['queued', 'running'])
          )
        )
        .limit(1)
      if (activeRun) {
        throw new WorkflowEvalRunAlreadyActiveError(suiteId, activeRun.id)
      }

      const snapshotTargets = await captureWorkflowEvalSnapshotTargets({
        tx,
        workspaceId,
        subjectWorkflowId: workflowId,
        tests,
      })
      const subjectTargets = snapshotTargets.filter((target) => target.isSubject)
      if (subjectTargets.length !== 1 || !subjectTargets[0]) {
        throw new Error(
          `Workflow eval suite ${suiteId} captured ${subjectTargets.length} subject snapshots, expected exactly 1`
        )
      }
      subjectSnapshotId = subjectTargets[0].snapshotId

      const definitionSnapshot: WorkflowEvalDefinitionSnapshot = {
        version: 1,
        suiteId,
        name: suite.name,
        tests,
      }
      workflowEvalDefinitionSnapshotSchema.parse(definitionSnapshot)

      const testRunRows = tests.map((test, ordinal) => ({
        id: generateId(),
        runId,
        testId: test.id,
        ordinal,
        name: test.name,
        evaluatorType: test.evaluator.type,
        phase: 'queued',
        outcome: null,
        score: null,
        reason: null,
        errorBlockIds: test.errorBlockIds,
        errorKind: null,
        errorCode: null,
        errorMessage: null,
        subjectExecutionId: generateId(),
        judgeExecutionId: test.evaluator.type === 'workflow' ? generateId() : null,
        startedAt: null,
        completedAt: null,
        createdAt,
        updatedAt: createdAt,
      }))
      const testRunIds = new Map(testRunRows.map((row) => [row.testId, row.id]))
      const criterionRows = tests.flatMap((test) => {
        const evaluator = test.evaluator
        if (evaluator.type !== 'agent') return []
        const testRunId = testRunIds.get(test.id)
        if (!testRunId) throw new Error(`Missing preallocated test run for ${test.id}`)

        return evaluator.criteria.map((criterion, ordinal) => ({
          id: generateId(),
          testRunId,
          criterionId: criterion.id,
          ordinal,
          name: criterion.name,
          phase: 'queued',
          verdict: null,
          confidence: null,
          reason: null,
          requestedModel: evaluator.model,
          providerId: null,
          responseModel: null,
          promptVersion: WORKFLOW_EVAL_CRITERION_PROMPT_VERSION,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          cost: null,
          durationMs: null,
          errorKind: null,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
          createdAt,
          updatedAt: createdAt,
        }))
      })

      await tx.insert(workflowEvalRun).values({
        id: runId,
        suiteId,
        workspaceId,
        status: 'queued',
        definitionSnapshot,
        suiteDefinitionRevision: suite.definitionRevision,
        scope: selectedTestId ? 'test' : 'suite',
        selectedTestId,
        billingAttribution,
        revision: 0,
        totalCount: tests.length,
        completedCount: 0,
        passedCount: 0,
        warningCount: 0,
        failedCount: 0,
        errorCount: 0,
        errorKind: null,
        errorCode: null,
        errorMessage: null,
        triggeredByUserId: userId,
        startedAt: null,
        completedAt: null,
        createdAt,
        updatedAt: createdAt,
      })
      await tx.insert(workflowEvalRunTarget).values(
        snapshotTargets.map((target) => ({
          runId,
          workflowId: target.workflowId,
          snapshotId: target.snapshotId,
          stateHash: target.stateHash,
          isSubject: target.isSubject,
          createdAt,
        }))
      )
      await tx.insert(workflowEvalTestRun).values(testRunRows)
      for (let start = 0; start < criterionRows.length; start += CRITERION_INSERT_BATCH_SIZE) {
        const batch = criterionRows.slice(start, start + CRITERION_INSERT_BATCH_SIZE)
        await tx.insert(workflowEvalCriterionRun).values(batch)
      }
      admittedTestCount = tests.length
      admittedSuiteRevision = suite.definitionRevision
    })
  } catch (error) {
    if (
      getPostgresErrorCode(error) === '23505' &&
      getPostgresConstraintName(error) === ACTIVE_RUN_CONSTRAINT
    ) {
      throw new WorkflowEvalRunAlreadyActiveError(suiteId)
    }
    throw error
  }

  if (admittedTestCount === 0 || admittedSuiteRevision === 0 || subjectSnapshotId.length === 0) {
    throw new Error(`Workflow eval run ${runId} admission did not produce canonical work`)
  }

  const queuedRun = workflowEvalStreamRunSchema.parse({
    id: runId,
    scope: selectedTestId ? 'test' : 'suite',
    selectedTestId,
    suiteDefinitionRevision: admittedSuiteRevision,
    status: 'queued',
    revision: 0,
    completedCount: 0,
    passedCount: 0,
    warningCount: 0,
    failedCount: 0,
    errorCount: 0,
    totalCount: admittedTestCount,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    completedAt: null,
    error: null,
  })
  const scope = { suiteId, workflowId, workspaceId, userId, subjectSnapshotId }
  publishWorkflowEvalEvent(eventTransport, buildRunEvent({ scope, run: queuedRun }))
  await enqueueRun({ payload: { runId }, scope, transport: eventTransport })

  recordAudit({
    workspaceId,
    actorId: userId,
    action: AuditAction.WORKFLOW_EVAL_RUN_QUEUED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: workflowId,
    description: `Queued ${selectedTestId ? 'test' : 'suite'} Eval run ${runId}`,
    metadata: {
      runId,
      suiteId,
      scope: selectedTestId ? 'test' : 'suite',
      selectedTestId,
      suiteDefinitionRevision: admittedSuiteRevision,
    },
  })

  return {
    runId,
    suiteId,
    workspaceId,
    workflowId,
    scope: selectedTestId ? 'test' : 'suite',
    selectedTestId,
    suiteDefinitionRevision: queuedRun.suiteDefinitionRevision,
    status: 'queued',
    revision: 0,
    totalCount: admittedTestCount,
    createdAt,
  }
}

export function startWorkflowEvalSuiteRun({
  workflowId,
  suiteId,
  workspaceId,
  userId,
  expectedDefinitionRevision,
}: {
  workflowId: string
  suiteId: string
  workspaceId: string
  userId: string
  expectedDefinitionRevision?: number
}): Promise<QueuedWorkflowEvalRun> {
  return startWorkflowEvalRun({
    workflowId,
    suiteId,
    workspaceId,
    userId,
    expectedDefinitionRevision,
    selectedTestId: null,
  })
}

export function startWorkflowEvalTestRun({
  workflowId,
  suiteId,
  testId,
  workspaceId,
  userId,
  expectedDefinitionRevision,
}: {
  workflowId: string
  suiteId: string
  testId: string
  workspaceId: string
  userId: string
  expectedDefinitionRevision: number
}): Promise<QueuedWorkflowEvalRun> {
  return startWorkflowEvalRun({
    workflowId,
    suiteId,
    workspaceId,
    userId,
    expectedDefinitionRevision,
    selectedTestId: testId,
  })
}

/** Stops one active Eval run and requests cancellation of its queued or in-flight work. */
export async function stopWorkflowEvalRun({
  workflowId,
  suiteId,
  runId,
  workspaceId,
  userId,
}: {
  workflowId: string
  suiteId: string
  runId: string
  workspaceId: string
  userId: string
}): Promise<StoppedWorkflowEvalRun> {
  const eventTransport = requireWorkflowEvalEventTransport()
  const stoppedAt = new Date()
  const { stoppedRun, alreadyStopped, executionIds } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select(runProjectionSelection)
      .from(workflowEvalRun)
      .innerJoin(workflowEvalSuite, eq(workflowEvalSuite.id, workflowEvalRun.suiteId))
      .where(
        and(
          eq(workflowEvalRun.id, runId),
          eq(workflowEvalRun.suiteId, suiteId),
          eq(workflowEvalRun.workspaceId, workspaceId),
          eq(workflowEvalSuite.workflowId, workflowId)
        )
      )
      .limit(1)
    if (!existing) throw new WorkflowEvalRunNotFoundError(runId)

    let stoppedRun: WorkflowEvalStreamRun
    let alreadyStopped: boolean
    if (existing.status === 'cancelled') {
      alreadyStopped = true
      stoppedRun = toRunProjection(existing)
    } else {
      if (existing.status !== 'queued' && existing.status !== 'running') {
        throw new WorkflowEvalRunNotActiveError(runId, existing.status)
      }

      const [updated] = await tx
        .update(workflowEvalRun)
        .set({
          status: 'cancelled',
          completedAt: stoppedAt,
          updatedAt: stoppedAt,
          revision: sql`${workflowEvalRun.revision} + 1`,
        })
        .where(
          and(
            eq(workflowEvalRun.id, runId),
            eq(workflowEvalRun.suiteId, suiteId),
            eq(workflowEvalRun.workspaceId, workspaceId),
            inArray(workflowEvalRun.status, ['queued', 'running'])
          )
        )
        .returning(runProjectionSelection)

      if (updated) {
        alreadyStopped = false
        stoppedRun = toRunProjection(updated)
      } else {
        const [raced] = await tx
          .select(runProjectionSelection)
          .from(workflowEvalRun)
          .where(
            and(
              eq(workflowEvalRun.id, runId),
              eq(workflowEvalRun.suiteId, suiteId),
              eq(workflowEvalRun.workspaceId, workspaceId)
            )
          )
          .limit(1)
        if (!raced) throw new WorkflowEvalRunNotFoundError(runId)
        if (raced.status !== 'cancelled') {
          throw new WorkflowEvalRunNotActiveError(runId, raced.status)
        }
        alreadyStopped = true
        stoppedRun = toRunProjection(raced)
      }
    }

    const testRuns = await tx
      .select({
        subjectExecutionId: workflowEvalTestRun.subjectExecutionId,
        judgeExecutionId: workflowEvalTestRun.judgeExecutionId,
      })
      .from(workflowEvalTestRun)
      .where(eq(workflowEvalTestRun.runId, runId))
      .limit(1_001)
    if (testRuns.length > 1_000) {
      throw new Error(`Workflow eval run ${runId} exceeds the 1000-test limit`)
    }
    const executionIds = [
      ...new Set(
        testRuns.flatMap((testRun) =>
          testRun.judgeExecutionId
            ? [testRun.subjectExecutionId, testRun.judgeExecutionId]
            : [testRun.subjectExecutionId]
        )
      ),
    ]
    return { stoppedRun, alreadyStopped, executionIds }
  })

  if (!stoppedRun || stoppedRun.status !== 'cancelled' || !stoppedRun.completedAt) {
    throw new Error(`Workflow eval run ${runId} did not produce a cancelled projection`)
  }

  if (!alreadyStopped) {
    publishWorkflowEvalEvent(
      eventTransport,
      buildRunEvent({ scope: { suiteId, workflowId, workspaceId }, run: stoppedRun })
    )
    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.WORKFLOW_EVAL_RUN_STOPPED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: workflowId,
      description: `Stopped Eval run ${runId}`,
      metadata: { runId, suiteId },
    })
  }

  const cancellationResults = await Promise.allSettled([
    cancelEvalJob(runId),
    cancelEvalWorkflowExecutions(executionIds),
  ])
  for (const result of cancellationResults) {
    if (result.status === 'rejected') {
      logger.warn('Eval run stopped durably but physical cancellation request failed', {
        runId,
        error: toError(result.reason).message,
      })
    }
  }

  return {
    runId,
    suiteId,
    workspaceId,
    workflowId,
    status: 'cancelled',
    revision: stoppedRun.revision,
    completedAt: stoppedRun.completedAt,
  }
}

async function transitionTestPhase({
  runId,
  testRunId,
  expectedPhase,
  nextPhase,
  startedAt,
}: {
  runId: string
  testRunId: string
  expectedPhase: 'queued' | 'running_subject'
  nextPhase: 'running_subject' | 'running_evaluator'
  startedAt?: Date
}): Promise<{ run: WorkflowEvalStreamRun; testRun: WorkflowEvalTestRun }> {
  const updatedAt = new Date()
  return db.transaction(async (tx) => {
    const [testRow] = await tx
      .update(workflowEvalTestRun)
      .set({ phase: nextPhase, ...(startedAt ? { startedAt } : {}), updatedAt })
      .where(
        and(
          eq(workflowEvalTestRun.id, testRunId),
          eq(workflowEvalTestRun.runId, runId),
          eq(workflowEvalTestRun.phase, expectedPhase)
        )
      )
      .returning(testRunProjectionSelection)
    if (!testRow) {
      throw new Error(
        `Workflow eval test run ${testRunId} could not transition from ${expectedPhase} to ${nextPhase}`
      )
    }

    const [runRow] = await tx
      .update(workflowEvalRun)
      .set({ revision: sql`${workflowEvalRun.revision} + 1`, updatedAt })
      .where(and(eq(workflowEvalRun.id, runId), eq(workflowEvalRun.status, 'running')))
      .returning(runProjectionSelection)
    if (!runRow) {
      throw new Error(`Workflow eval run ${runId} stopped while transitioning test ${testRunId}`)
    }

    const criteria = await loadCriterionRunProjections(tx, testRunId)
    return { run: toRunProjection(runRow), testRun: toTestRunProjection(testRow, criteria) }
  })
}

async function transitionCriterionToRunning({
  runId,
  testRunId,
  criterionRunId,
}: {
  runId: string
  testRunId: string
  criterionRunId: string
}): Promise<{ run: WorkflowEvalStreamRun; criterionRun: WorkflowEvalCriterionRun }> {
  const startedAt = new Date()
  return db.transaction(async (tx) => {
    const [criterionRow] = await tx
      .update(workflowEvalCriterionRun)
      .set({ phase: 'running', startedAt, updatedAt: startedAt })
      .where(
        and(
          eq(workflowEvalCriterionRun.id, criterionRunId),
          eq(workflowEvalCriterionRun.testRunId, testRunId),
          eq(workflowEvalCriterionRun.phase, 'queued')
        )
      )
      .returning(criterionRunProjectionSelection)
    if (!criterionRow) {
      throw new Error(`Workflow eval criterion run ${criterionRunId} could not start`)
    }

    const [runRow] = await tx
      .update(workflowEvalRun)
      .set({ revision: sql`${workflowEvalRun.revision} + 1`, updatedAt: startedAt })
      .where(and(eq(workflowEvalRun.id, runId), eq(workflowEvalRun.status, 'running')))
      .returning(runProjectionSelection)
    if (!runRow) {
      throw new Error(
        `Workflow eval run ${runId} stopped while starting criterion ${criterionRunId}`
      )
    }

    return {
      run: toRunProjection(runRow),
      criterionRun: toCriterionRunProjection(criterionRow),
    }
  })
}

async function finalizeCriterionRun({
  runId,
  testRunId,
  criterionRunId,
  evaluation,
}: {
  runId: string
  testRunId: string
  criterionRunId: string
  evaluation: WorkflowEvalAgentCriterionEvaluation
}): Promise<{ run: WorkflowEvalStreamRun; criterionRun: WorkflowEvalCriterionRun }> {
  const completedAt = new Date()
  return db.transaction(async (tx) => {
    const [criterionRow] = await tx
      .update(workflowEvalCriterionRun)
      .set({
        phase: evaluation.phase,
        verdict: evaluation.verdict,
        confidence: evaluation.confidence,
        reason: evaluation.reason,
        providerId: evaluation.providerId,
        responseModel: evaluation.responseModel,
        inputTokens: evaluation.inputTokens,
        outputTokens: evaluation.outputTokens,
        totalTokens: evaluation.totalTokens,
        cost: evaluation.cost === null ? null : evaluation.cost.toString(),
        durationMs: evaluation.durationMs,
        errorKind: evaluation.error?.kind ?? null,
        errorCode: evaluation.error?.code ?? null,
        errorMessage: evaluation.error?.message ?? null,
        completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(workflowEvalCriterionRun.id, criterionRunId),
          eq(workflowEvalCriterionRun.testRunId, testRunId),
          eq(workflowEvalCriterionRun.phase, 'running')
        )
      )
      .returning(criterionRunProjectionSelection)
    if (!criterionRow) {
      throw new Error(`Workflow eval criterion run ${criterionRunId} could not be finalized`)
    }

    const [runRow] = await tx
      .update(workflowEvalRun)
      .set({ revision: sql`${workflowEvalRun.revision} + 1`, updatedAt: completedAt })
      .where(and(eq(workflowEvalRun.id, runId), eq(workflowEvalRun.status, 'running')))
      .returning(runProjectionSelection)
    if (!runRow) {
      throw new Error(
        `Workflow eval run ${runId} stopped while finalizing criterion ${criterionRunId}`
      )
    }

    return {
      run: toRunProjection(runRow),
      criterionRun: toCriterionRunProjection(criterionRow),
    }
  })
}

function criterionVerdictScore(verdict: WorkflowEvalOutcome): 10 | 5 | 0 {
  if (verdict === 'pass') return 10
  if (verdict === 'warning') return 5
  return 0
}

async function aggregatePersistedAgentCriteria({
  tx,
  testRunId,
  model,
  items,
}: {
  tx: DbOrTx
  testRunId: string
  model: string
  items: readonly WorkflowEvalAgentCriterionWorkItem[]
}): Promise<WorkflowEvalTestEvaluation> {
  const rows = await tx
    .select(criterionRunWorkerSelection)
    .from(workflowEvalCriterionRun)
    .where(eq(workflowEvalCriterionRun.testRunId, testRunId))
    .orderBy(asc(workflowEvalCriterionRun.ordinal), asc(workflowEvalCriterionRun.id))
    .limit(13)
  if (rows.length !== items.length) {
    throw new Error(
      `Workflow eval test run ${testRunId} has ${rows.length} criteria, expected ${items.length}`
    )
  }

  let confidenceTotal = 0
  let weightedScoreTotal = 0
  const nonPassingReasons: string[] = []
  for (const [ordinal, item] of items.entries()) {
    const row = rows[ordinal]
    if (
      !row ||
      row.id !== item.criterionRunId ||
      row.criterionId !== item.criterion.id ||
      row.ordinal !== ordinal ||
      row.name !== item.criterion.name ||
      row.requestedModel !== model ||
      row.promptVersion !== WORKFLOW_EVAL_CRITERION_PROMPT_VERSION
    ) {
      throw new Error(`Workflow eval criterion row ${ordinal} does not match its definition`)
    }
    const projection = toCriterionRunProjection(row)
    if (projection.phase === 'error') {
      return {
        phase: 'error',
        outcome: null,
        score: null,
        reason: null,
        error: typedError(
          'infrastructure',
          'agent_criterion_failed',
          `Agent criterion "${row.name}" failed: ${projection.error?.message ?? 'unknown evaluator error'}`
        ),
      }
    }
    if (
      projection.phase !== 'completed' ||
      projection.verdict === null ||
      projection.confidence === null
    ) {
      throw new Error(`Workflow eval criterion run ${row.id} is not terminal`)
    }
    confidenceTotal += projection.confidence
    weightedScoreTotal += criterionVerdictScore(projection.verdict) * projection.confidence
    if (projection.verdict !== 'pass') {
      nonPassingReasons.push(
        `${row.name}: ${projection.reason ?? 'The judge did not provide a reason.'}`
      )
    }
  }

  if (confidenceTotal === 0) {
    return {
      phase: 'error',
      outcome: null,
      score: null,
      reason: null,
      error: typedError(
        'evaluator',
        'agent_judge_zero_confidence',
        'Agent judge criteria returned zero total confidence'
      ),
    }
  }
  const rawScore = weightedScoreTotal / confidenceTotal
  if (
    !Number.isFinite(rawScore) ||
    rawScore < -AGENT_SCORE_EPSILON ||
    rawScore > 10 + AGENT_SCORE_EPSILON
  ) {
    throw new Error(`Workflow eval test run ${testRunId} produced invalid score ${rawScore}`)
  }
  const roundedScore = Number(rawScore.toFixed(AGENT_SCORE_DECIMAL_PLACES))
  const score = Math.min(10, Math.max(0, roundedScore))
  const averageConfidence = confidenceTotal / items.length
  const outcome: WorkflowEvalOutcome =
    averageConfidence < WORKFLOW_EVAL_AGENT_WARNING_CONFIDENCE_THRESHOLD
      ? 'warning'
      : score >= 8
        ? 'pass'
        : 'fail'
  return {
    phase: 'completed',
    outcome,
    score,
    reason:
      nonPassingReasons.length > 0
        ? truncate(nonPassingReasons.join(' '), MAX_ERROR_CHARS - 3)
        : null,
    error: null,
  }
}

async function finalizeTestRun({
  runId,
  testRunId,
  expectedPhase,
  evaluation,
  agentFinalization,
}: {
  runId: string
  testRunId: string
  expectedPhase: 'running_subject' | 'running_evaluator'
  evaluation?: WorkflowEvalTestEvaluation
  agentFinalization?: {
    model: string
    items: readonly WorkflowEvalAgentCriterionWorkItem[]
  }
}): Promise<{ run: WorkflowEvalStreamRun; testRun: WorkflowEvalTestRun }> {
  const completedAt = new Date()
  if ((evaluation === undefined) === (agentFinalization === undefined)) {
    throw new Error('Test finalization requires exactly one evaluation source')
  }
  return db.transaction(async (tx) => {
    const resolvedEvaluation =
      evaluation ??
      (await aggregatePersistedAgentCriteria({
        tx,
        testRunId,
        model: agentFinalization!.model,
        items: agentFinalization!.items,
      }))
    const outcomeCountUpdate =
      resolvedEvaluation.outcome === 'pass'
        ? { passedCount: sql`${workflowEvalRun.passedCount} + 1` }
        : resolvedEvaluation.outcome === 'warning'
          ? { warningCount: sql`${workflowEvalRun.warningCount} + 1` }
          : resolvedEvaluation.outcome === 'fail'
            ? { failedCount: sql`${workflowEvalRun.failedCount} + 1` }
            : { errorCount: sql`${workflowEvalRun.errorCount} + 1` }
    const [testRow] = await tx
      .update(workflowEvalTestRun)
      .set({
        phase: resolvedEvaluation.phase,
        outcome: resolvedEvaluation.outcome,
        score: resolvedEvaluation.score,
        reason: resolvedEvaluation.reason,
        errorKind: resolvedEvaluation.error?.kind ?? null,
        errorCode: resolvedEvaluation.error?.code ?? null,
        errorMessage: resolvedEvaluation.error?.message ?? null,
        completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(workflowEvalTestRun.id, testRunId),
          eq(workflowEvalTestRun.runId, runId),
          eq(workflowEvalTestRun.phase, expectedPhase)
        )
      )
      .returning(testRunProjectionSelection)
    if (!testRow) {
      throw new Error(`Workflow eval test run ${testRunId} could not be finalized`)
    }

    const [runRow] = await tx
      .update(workflowEvalRun)
      .set({
        revision: sql`${workflowEvalRun.revision} + 1`,
        completedCount: sql`${workflowEvalRun.completedCount} + 1`,
        ...outcomeCountUpdate,
        updatedAt: completedAt,
      })
      .where(and(eq(workflowEvalRun.id, runId), eq(workflowEvalRun.status, 'running')))
      .returning(runProjectionSelection)
    if (!runRow) {
      throw new Error(`Workflow eval run ${runId} stopped while finalizing test ${testRunId}`)
    }

    const criteria = await loadCriterionRunProjections(tx, testRunId)
    return { run: toRunProjection(runRow), testRun: toTestRunProjection(testRow, criteria) }
  })
}

async function executeSubject({
  runId,
  scope,
  billingAttribution,
  test,
  testRun,
  abortSignal,
}: {
  runId: string
  scope: WorkflowEvalJobScope
  billingAttribution: BillingAttributionSnapshot
  test: RunnableWorkflowEvalTest
  testRun: TestRunProjectionRow
  abortSignal?: AbortSignal
}): Promise<
  | { success: true; output: unknown; durationMs: number }
  | { success: false; error: WorkflowEvalError }
> {
  try {
    const execution = await executeWorkflowJob(
      {
        workflowId: scope.workflowId,
        userId: scope.userId,
        billingAttribution,
        workspaceId: scope.workspaceId,
        input: test.input,
        triggerType: 'workflow',
        executionId: testRun.subjectExecutionId,
        correlation: {
          executionId: testRun.subjectExecutionId,
          requestId: `${runId}:${testRun.id}`,
          source: 'eval',
          workflowId: scope.workflowId,
          triggerType: 'workflow',
          evalRunId: runId,
          evalSuiteId: scope.suiteId,
          evalTestId: test.id,
          evalTestRunId: testRun.id,
        },
        executionMode: 'async',
        useDraftState: true,
        workflowStateSnapshotId: scope.subjectSnapshotId,
        blockMocks: test.mocks,
      },
      abortSignal
    )
    abortSignal?.throwIfAborted()
    if (!execution.success) {
      return {
        success: false,
        error: typedError(
          'subject',
          'subject_execution_failed',
          'Workflow execution did not complete successfully'
        ),
      }
    }
    return { success: true, output: execution.output, durationMs: execution.durationMs }
  } catch (error) {
    abortSignal?.throwIfAborted()
    if (error instanceof WorkflowExecutionAdmissionError) {
      throw error
    }
    return {
      success: false,
      error: typedError(
        'subject',
        'subject_execution_failed',
        `Workflow execution failed: ${toError(error).message}`
      ),
    }
  }
}

async function evaluateCode({
  runId,
  userId,
  testId,
  testInput,
  code,
  subjectOutput,
  subjectDurationMs,
  blockOutputs,
  abortSignal,
}: {
  runId: string
  userId: string
  testId: string
  testInput: unknown
  code: string
  subjectOutput: unknown
  subjectDurationMs: number
  blockOutputs: readonly WorkflowEvalJudgeSelectedOutput[]
  abortSignal?: AbortSignal
}): Promise<WorkflowEvalTestEvaluation> {
  try {
    const evaluatorContext = {
      input: testInput,
      output: subjectOutput ?? null,
      blockOutputs,
      metadata: { durationMs: subjectDurationMs },
    }
    const contextBytes = getBoundedJsonByteLength(evaluatorContext, MAX_EVALUATOR_CONTEXT_BYTES)
    if (contextBytes === undefined) {
      throw new Error('Code evaluator context is not JSON serializable')
    }
    if (contextBytes > MAX_EVALUATOR_CONTEXT_BYTES) {
      return {
        phase: 'error',
        outcome: null,
        score: null,
        reason: null,
        error: typedError(
          'evaluator',
          'evaluator_context_too_large',
          `Code evaluator context exceeds ${MAX_EVALUATOR_CONTEXT_BYTES} serialized bytes`
        ),
      }
    }

    const evaluation = await executeInIsolatedVM(
      {
        code,
        params: {},
        envVars: {},
        contextVariables: evaluatorContext,
        timeoutMs: CODE_EVALUATOR_TIMEOUT_MS,
        requestId: `${runId}:${testId}`,
        ownerKey: `user:${userId}`,
        ownerWeight: 1,
      },
      { signal: abortSignal }
    )
    abortSignal?.throwIfAborted()
    if (evaluation.error) {
      return {
        phase: 'error',
        outcome: null,
        score: null,
        reason: null,
        error: typedError(
          'evaluator',
          'code_evaluator_failed',
          `Code evaluator failed: ${evaluation.error.message}`
        ),
      }
    }

    const verdict = parseCodeEvaluatorVerdict(evaluation.result)
    if (!verdict.success) {
      return {
        phase: 'error',
        outcome: null,
        score: null,
        reason: null,
        error: verdict.error,
      }
    }
    return {
      phase: 'completed',
      outcome: verdict.passed ? 'pass' : 'fail',
      score: verdict.passed ? 10 : 0,
      reason: verdict.passed
        ? null
        : (verdict.reason ?? 'Code evaluator returned a failed verdict'),
      error: null,
    }
  } catch (error) {
    abortSignal?.throwIfAborted()
    return {
      phase: 'error',
      outcome: null,
      score: null,
      reason: null,
      error: typedError(
        'evaluator',
        'code_evaluator_failed',
        `Code evaluator failed: ${toError(error).message}`
      ),
    }
  }
}

function workflowJudgeError(code: string, message: string): WorkflowEvalTestEvaluation {
  return {
    phase: 'error',
    outcome: null,
    score: null,
    reason: null,
    error: typedError('evaluator', code, message),
  }
}

function evaluateWorkflowJudgeScore(value: unknown): WorkflowEvalTestEvaluation {
  const parsed = workflowEvalScoreSchema.safeParse(value)
  if (!parsed.success) {
    return workflowJudgeError(
      'invalid_workflow_judge_score',
      'Workflow judge score must be a raw finite number between 0 and 10'
    )
  }

  const score = parsed.data
  const outcome: WorkflowEvalOutcome = score >= 8 ? 'pass' : score >= 5 ? 'warning' : 'fail'
  return {
    phase: 'completed',
    outcome,
    score,
    reason:
      outcome === 'pass'
        ? null
        : outcome === 'warning'
          ? `Workflow judge scored this test ${score}/10, below the pass threshold of 8.`
          : `Workflow judge scored this test ${score}/10, below the warning threshold of 5.`,
    error: null,
  }
}

async function evaluateWorkflowJudge({
  runId,
  scope,
  billingAttribution,
  testId,
  evaluator,
  testRun,
  judgeSnapshotId,
  triggerBlockId,
  abortSignal,
}: {
  runId: string
  scope: WorkflowEvalJobScope
  billingAttribution: BillingAttributionSnapshot
  testId: string
  evaluator: WorkflowJudgeEvaluator
  testRun: TestRunProjectionRow
  judgeSnapshotId: string
  triggerBlockId: string
  abortSignal?: AbortSignal
}): Promise<WorkflowEvalTestEvaluation> {
  if (!testRun.judgeExecutionId) {
    throw new Error(`Workflow eval test run ${testRun.id} is missing its judge execution ID`)
  }

  let judgeInput: Record<string, unknown>
  try {
    judgeInput = await loadProjectedWorkflowEvalJudgeInput({
      executionId: testRun.subjectExecutionId,
      workflowId: scope.workflowId,
      workspaceId: scope.workspaceId,
      runId,
      suiteId: scope.suiteId,
      testId,
      testRunId: testRun.id,
      mappings: evaluator.inputMappings,
    })
  } catch (error) {
    if (!(error instanceof WorkflowEvalJudgeTraceError)) throw error
    return workflowJudgeError(error.code, error.message)
  }

  try {
    const execution = await executeWorkflowJob(
      {
        workflowId: evaluator.workflowId,
        userId: scope.userId,
        billingAttribution,
        workspaceId: scope.workspaceId,
        input: judgeInput,
        triggerType: 'workflow',
        triggerBlockId,
        executionId: testRun.judgeExecutionId,
        correlation: {
          executionId: testRun.judgeExecutionId,
          requestId: `${runId}:${testRun.id}:judge`,
          source: 'eval',
          workflowId: evaluator.workflowId,
          triggerType: 'workflow',
          evalRunId: runId,
          evalSuiteId: scope.suiteId,
          evalTestId: testId,
          evalTestRunId: testRun.id,
        },
        callChain: [evaluator.workflowId],
        executionMode: 'async',
        useDraftState: true,
        workflowStateSnapshotId: judgeSnapshotId,
      },
      abortSignal
    )
    abortSignal?.throwIfAborted()
    if (!execution.success) {
      return workflowJudgeError(
        'workflow_judge_execution_failed',
        'Workflow judge execution did not complete successfully'
      )
    }
  } catch (error) {
    abortSignal?.throwIfAborted()
    if (error instanceof WorkflowExecutionAdmissionError) throw error
    return workflowJudgeError(
      'workflow_judge_execution_failed',
      `Workflow judge execution failed: ${toError(error).message}`
    )
  }

  let rawScore: unknown
  try {
    rawScore = await loadProjectedWorkflowEvalJudgeScore({
      executionId: testRun.judgeExecutionId,
      workflowId: evaluator.workflowId,
      workspaceId: scope.workspaceId,
      runId,
      suiteId: scope.suiteId,
      testId,
      testRunId: testRun.id,
      selector: evaluator.scoreOutput,
    })
  } catch (error) {
    if (!(error instanceof WorkflowEvalJudgeTraceError)) throw error
    return workflowJudgeError(error.code, error.message)
  }

  return evaluateWorkflowJudgeScore(rawScore)
}

/**
 * Runs one suite sequentially and persists each explicit test phase before publishing it.
 */
export async function runWorkflowEvalSuiteJob(
  payload: WorkflowEvalSuiteJobPayload,
  abortSignal?: AbortSignal
): Promise<void> {
  const eventTransport = workflowEvalPubSub
  if (!eventTransport) {
    const cause = new Error('Workflow eval event transport is unavailable')
    try {
      await markRunError(payload.runId, 'event_transport_unavailable', cause.message, 'queued')
    } catch (markError) {
      throw new AggregateError(
        [cause, toError(markError)],
        `Workflow eval run ${payload.runId} has no event transport and could not be marked as error`
      )
    }
    throw cause
  }

  let ownsRunningRun = false
  let scope: WorkflowEvalJobScope | null = null

  try {
    const [run] = await db
      .select({
        id: workflowEvalRun.id,
        suiteId: workflowEvalRun.suiteId,
        workspaceId: workflowEvalRun.workspaceId,
        status: workflowEvalRun.status,
        definitionSnapshot: workflowEvalRun.definitionSnapshot,
        billingAttribution: workflowEvalRun.billingAttribution,
        totalCount: workflowEvalRun.totalCount,
        triggeredByUserId: workflowEvalRun.triggeredByUserId,
      })
      .from(workflowEvalRun)
      .where(eq(workflowEvalRun.id, payload.runId))
      .limit(1)

    if (!run) throw new Error(`Workflow eval run ${payload.runId} was not found`)
    if (run.status !== 'queued') {
      logger.info('Skipping duplicate workflow eval suite delivery', {
        runId: payload.runId,
        status: run.status,
      })
      return
    }

    const startedAt = new Date()
    const [claimedRow] = await db
      .update(workflowEvalRun)
      .set({
        status: 'running',
        startedAt,
        updatedAt: startedAt,
        revision: sql`${workflowEvalRun.revision} + 1`,
      })
      .where(and(eq(workflowEvalRun.id, payload.runId), eq(workflowEvalRun.status, 'queued')))
      .returning(runProjectionSelection)
    if (!claimedRow) {
      const [currentRun] = await db
        .select({ status: workflowEvalRun.status })
        .from(workflowEvalRun)
        .where(eq(workflowEvalRun.id, payload.runId))
        .limit(1)
      if (!currentRun) {
        throw new Error(`Workflow eval run ${payload.runId} disappeared while being claimed`)
      }
      if (currentRun.status !== 'queued') {
        logger.info('Lost duplicate workflow eval suite claim', {
          runId: payload.runId,
          status: currentRun.status,
        })
        return
      }
      throw new Error(`Workflow eval run ${payload.runId} remained queued after a failed claim`)
    }
    ownsRunningRun = true
    abortSignal?.throwIfAborted()

    if (!run.triggeredByUserId) {
      throw new Error(`Workflow eval run ${payload.runId} no longer has an initiating actor`)
    }

    const targetRows = await db
      .select({
        workflowId: workflowEvalRunTarget.workflowId,
        snapshotId: workflowEvalRunTarget.snapshotId,
        stateHash: workflowEvalRunTarget.stateHash,
        isSubject: workflowEvalRunTarget.isSubject,
        snapshotWorkflowId: workflowExecutionSnapshots.workflowId,
        snapshotStateHash: workflowExecutionSnapshots.stateHash,
      })
      .from(workflowEvalRunTarget)
      .innerJoin(
        workflowExecutionSnapshots,
        eq(workflowExecutionSnapshots.id, workflowEvalRunTarget.snapshotId)
      )
      .where(eq(workflowEvalRunTarget.runId, payload.runId))
      .limit(MAX_WORKFLOW_EVAL_SNAPSHOT_TARGETS + 1)
    if (targetRows.length > MAX_WORKFLOW_EVAL_SNAPSHOT_TARGETS) {
      throw new Error(
        `Workflow eval run ${payload.runId} exceeds the ${MAX_WORKFLOW_EVAL_SNAPSHOT_TARGETS} target limit`
      )
    }
    const subjectTargets = targetRows.filter((target) => target.isSubject)
    if (subjectTargets.length !== 1) {
      throw new Error(
        `Workflow eval run ${payload.runId} has ${subjectTargets.length} subject targets, expected exactly 1`
      )
    }
    const subjectTarget = subjectTargets[0]
    if (!subjectTarget) {
      throw new Error(`Workflow eval run ${payload.runId} has no subject target`)
    }

    scope = {
      suiteId: run.suiteId,
      workflowId: subjectTarget.workflowId,
      workspaceId: run.workspaceId,
      userId: run.triggeredByUserId,
      subjectSnapshotId: subjectTarget.snapshotId,
    }
    const billingAttribution = assertBillingAttributionSnapshot(run.billingAttribution)
    if (
      billingAttribution.actorUserId !== scope.userId ||
      billingAttribution.workspaceId !== scope.workspaceId
    ) {
      throw new Error('Eval run billing attribution does not match its actor and workspace')
    }

    const definitionSnapshot = workflowEvalDefinitionSnapshotSchema.parse(run.definitionSnapshot)
    if (definitionSnapshot.suiteId !== scope.suiteId) {
      throw new Error(`Workflow eval run ${payload.runId} has a mismatched definition snapshot`)
    }
    const tests = requireRunnableTests(scope.suiteId, definitionSnapshot.tests)
    if (tests.length !== run.totalCount) {
      throw new Error(
        `Workflow eval run ${payload.runId} has ${run.totalCount} total tests but its snapshot contains ${tests.length}`
      )
    }

    const expectedTargetIds = new Set<string>([scope.workflowId])
    for (const test of definitionSnapshot.tests) {
      if (test.evaluator.type === 'workflow') {
        expectedTargetIds.add(test.evaluator.workflowId)
      }
    }
    if (targetRows.length !== expectedTargetIds.size) {
      throw new Error(
        `Workflow eval run ${payload.runId} has ${targetRows.length} targets, expected ${expectedTargetIds.size}`
      )
    }
    const targetByWorkflowId = new Map<string, (typeof targetRows)[number]>()
    for (const target of targetRows) {
      if (!expectedTargetIds.has(target.workflowId)) {
        throw new Error(
          `Workflow eval run ${payload.runId} contains unexpected target ${target.workflowId}`
        )
      }
      if (targetByWorkflowId.has(target.workflowId)) {
        throw new Error(
          `Workflow eval run ${payload.runId} contains duplicate target ${target.workflowId}`
        )
      }
      if (!/^[a-f0-9]{64}$/.test(target.stateHash)) {
        throw new Error(
          `Workflow eval run ${payload.runId} target ${target.workflowId} has an invalid state hash`
        )
      }
      if (
        target.snapshotWorkflowId !== target.workflowId ||
        target.snapshotStateHash !== target.stateHash
      ) {
        throw new Error(
          `Workflow eval run ${payload.runId} target ${target.workflowId} does not match its immutable snapshot`
        )
      }
      targetByWorkflowId.set(target.workflowId, target)
    }

    const testRows = await db
      .select(testRunProjectionSelection)
      .from(workflowEvalTestRun)
      .where(eq(workflowEvalTestRun.runId, payload.runId))
      .orderBy(asc(workflowEvalTestRun.ordinal))
    if (testRows.length !== tests.length) {
      throw new Error(
        `Workflow eval run ${payload.runId} has ${testRows.length} test rows but ${tests.length} definitions`
      )
    }
    for (const [ordinal, test] of tests.entries()) {
      abortSignal?.throwIfAborted()
      const testRow = testRows[ordinal]
      if (
        !testRow ||
        testRow.ordinal !== ordinal ||
        testRow.testId !== test.id ||
        testRow.name !== test.name ||
        testRow.evaluatorType !== test.evaluator.type ||
        testRow.phase !== 'queued'
      ) {
        throw new Error(`Workflow eval test row ${ordinal} does not match its definition snapshot`)
      }
    }

    const expectedCriterionCount = tests.reduce(
      (count, test) =>
        count + (test.evaluator.type === 'agent' ? test.evaluator.criteria.length : 0),
      0
    )
    const criterionRows: CriterionRunWorkerRow[] =
      testRows.length === 0
        ? []
        : await db
            .select(criterionRunWorkerSelection)
            .from(workflowEvalCriterionRun)
            .where(
              inArray(
                workflowEvalCriterionRun.testRunId,
                testRows.map((testRow) => testRow.id)
              )
            )
            .orderBy(
              asc(workflowEvalCriterionRun.testRunId),
              asc(workflowEvalCriterionRun.ordinal),
              asc(workflowEvalCriterionRun.id)
            )
            .limit(expectedCriterionCount + 1)
    if (criterionRows.length !== expectedCriterionCount) {
      throw new Error(
        `Workflow eval run ${payload.runId} has ${criterionRows.length} criterion rows, expected ${expectedCriterionCount}`
      )
    }
    const criterionRowsByTestRunId = new Map<string, CriterionRunWorkerRow[]>()
    for (const row of criterionRows) {
      const rows = criterionRowsByTestRunId.get(row.testRunId) ?? []
      rows.push(row)
      criterionRowsByTestRunId.set(row.testRunId, rows)
    }
    for (const [ordinal, test] of tests.entries()) {
      const testRow = testRows[ordinal]
      if (!testRow) throw new Error(`Missing test row at ordinal ${ordinal}`)
      const rows = criterionRowsByTestRunId.get(testRow.id) ?? []
      if (test.evaluator.type !== 'agent') {
        if (rows.length !== 0) {
          throw new Error(`Non-agent eval test ${test.id} has persisted criterion rows`)
        }
        continue
      }
      if (rows.length !== test.evaluator.criteria.length) {
        throw new Error(
          `Agent eval test ${test.id} has ${rows.length} criteria, expected ${test.evaluator.criteria.length}`
        )
      }
      for (const [criterionOrdinal, criterion] of test.evaluator.criteria.entries()) {
        const row = rows[criterionOrdinal]
        if (
          !row ||
          row.ordinal !== criterionOrdinal ||
          row.criterionId !== criterion.id ||
          row.name !== criterion.name ||
          row.requestedModel !== test.evaluator.model ||
          row.promptVersion !== WORKFLOW_EVAL_CRITERION_PROMPT_VERSION ||
          row.phase !== 'queued'
        ) {
          throw new Error(
            `Workflow eval criterion row ${criterionOrdinal} for test ${test.id} does not match its definition snapshot`
          )
        }
      }
    }

    publishWorkflowEvalEvent(
      eventTransport,
      buildRunEvent({ scope, run: toRunProjection(claimedRow) })
    )

    for (const [ordinal, test] of tests.entries()) {
      abortSignal?.throwIfAborted()
      const testRow = testRows[ordinal]
      if (!testRow) throw new Error(`Missing test row at ordinal ${ordinal}`)

      const subjectStarted = await transitionTestPhase({
        runId: payload.runId,
        testRunId: testRow.id,
        expectedPhase: 'queued',
        nextPhase: 'running_subject',
        startedAt: new Date(),
      })
      publishWorkflowEvalEvent(
        eventTransport,
        buildTestEvent({ scope, run: subjectStarted.run, testRun: subjectStarted.testRun })
      )

      let workflowJudgeExecution: { snapshotId: string; triggerBlockId: string } | null = null
      if (test.evaluator.type === 'workflow') {
        const judgeTarget = targetByWorkflowId.get(test.evaluator.workflowId)
        if (!judgeTarget) {
          throw new Error(
            `Workflow eval test ${test.id} is missing pinned judge target ${test.evaluator.workflowId}`
          )
        }

        const judgeSnapshot = await snapshotService.getBoundedSnapshotForWorkflow(
          judgeTarget.snapshotId,
          test.evaluator.workflowId
        )
        try {
          const validated = validatePinnedWorkflowJudgeDefinition({
            state: judgeSnapshot.stateData,
            inputMappings: test.evaluator.inputMappings,
            scoreOutput: test.evaluator.scoreOutput,
          })
          workflowJudgeExecution = {
            snapshotId: judgeTarget.snapshotId,
            triggerBlockId: validated.startBlockId,
          }
        } catch (error) {
          if (!(error instanceof WorkflowEvalWorkflowJudgeValidationError)) throw error
          const finalized = await finalizeTestRun({
            runId: payload.runId,
            testRunId: testRow.id,
            expectedPhase: 'running_subject',
            evaluation: workflowJudgeError(error.code, error.message),
          })
          publishWorkflowEvalEvent(
            eventTransport,
            buildTestEvent({ scope, run: finalized.run, testRun: finalized.testRun })
          )
          continue
        }
      }

      const subject = await executeSubject({
        runId: payload.runId,
        scope,
        billingAttribution,
        test,
        testRun: testRow,
        abortSignal,
      })
      if (!subject.success) {
        const finalized = await finalizeTestRun({
          runId: payload.runId,
          testRunId: testRow.id,
          expectedPhase: 'running_subject',
          evaluation: {
            phase: 'error',
            outcome: null,
            score: null,
            reason: null,
            error: subject.error,
          },
        })
        publishWorkflowEvalEvent(
          eventTransport,
          buildTestEvent({ scope, run: finalized.run, testRun: finalized.testRun })
        )
        continue
      }

      const evaluatorStarted = await transitionTestPhase({
        runId: payload.runId,
        testRunId: testRow.id,
        expectedPhase: 'running_subject',
        nextPhase: 'running_evaluator',
      })
      publishWorkflowEvalEvent(
        eventTransport,
        buildTestEvent({ scope, run: evaluatorStarted.run, testRun: evaluatorStarted.testRun })
      )

      if (test.evaluator.type === 'code') {
        let blockOutputs: WorkflowEvalJudgeSelectedOutput[] = []
        const outputSelectors = test.evaluator.outputSelectors ?? []
        if (outputSelectors.length > 0) {
          try {
            blockOutputs = await loadProjectedWorkflowEvalCodeBlockOutputs({
              executionId: testRow.subjectExecutionId,
              workflowId: scope.workflowId,
              workspaceId: scope.workspaceId,
              runId: payload.runId,
              suiteId: scope.suiteId,
              testId: test.id,
              testRunId: testRow.id,
              selectors: outputSelectors,
            })
          } catch (error) {
            if (!(error instanceof WorkflowEvalJudgeTraceError)) throw error
            const finalized = await finalizeTestRun({
              runId: payload.runId,
              testRunId: testRow.id,
              expectedPhase: 'running_evaluator',
              evaluation: {
                phase: 'error',
                outcome: null,
                score: null,
                reason: null,
                error: typedError('evaluator', error.code, error.message),
              },
            })
            publishWorkflowEvalEvent(
              eventTransport,
              buildTestEvent({ scope, run: finalized.run, testRun: finalized.testRun })
            )
            continue
          }
        }
        const evaluation = await evaluateCode({
          runId: payload.runId,
          userId: scope.userId,
          testId: test.id,
          testInput: test.input,
          code: test.evaluator.code,
          subjectOutput: subject.output,
          subjectDurationMs: subject.durationMs,
          blockOutputs,
          abortSignal,
        })
        const finalized = await finalizeTestRun({
          runId: payload.runId,
          testRunId: testRow.id,
          expectedPhase: 'running_evaluator',
          evaluation,
        })
        publishWorkflowEvalEvent(
          eventTransport,
          buildTestEvent({ scope, run: finalized.run, testRun: finalized.testRun })
        )
        continue
      }

      if (test.evaluator.type === 'workflow') {
        if (!workflowJudgeExecution) {
          throw new Error(`Workflow eval test ${test.id} has no validated judge execution target`)
        }
        const evaluation = await evaluateWorkflowJudge({
          runId: payload.runId,
          scope,
          billingAttribution,
          testId: test.id,
          evaluator: test.evaluator,
          testRun: testRow,
          judgeSnapshotId: workflowJudgeExecution.snapshotId,
          triggerBlockId: workflowJudgeExecution.triggerBlockId,
          abortSignal,
        })
        const finalized = await finalizeTestRun({
          runId: payload.runId,
          testRunId: testRow.id,
          expectedPhase: 'running_evaluator',
          evaluation,
        })
        publishWorkflowEvalEvent(
          eventTransport,
          buildTestEvent({ scope, run: finalized.run, testRun: finalized.testRun })
        )
        continue
      }

      let trace
      try {
        trace = await loadProjectedWorkflowEvalJudgeTrace({
          executionId: testRow.subjectExecutionId,
          workflowId: scope.workflowId,
          workspaceId: scope.workspaceId,
          runId: payload.runId,
          suiteId: scope.suiteId,
          testId: test.id,
          testRunId: testRow.id,
          selectors: test.evaluator.outputSelectors,
        })
      } catch (error) {
        if (!(error instanceof WorkflowEvalJudgeTraceError)) throw error
        const finalized = await finalizeTestRun({
          runId: payload.runId,
          testRunId: testRow.id,
          expectedPhase: 'running_evaluator',
          evaluation: {
            phase: 'error',
            outcome: null,
            score: null,
            reason: null,
            error: typedError('evaluator', error.code, error.message),
          },
        })
        publishWorkflowEvalEvent(
          eventTransport,
          buildTestEvent({ scope, run: finalized.run, testRun: finalized.testRun })
        )
        continue
      }

      const persistedCriterionRows = criterionRowsByTestRunId.get(testRow.id) ?? []
      const criterionEventScope = {
        suiteId: scope.suiteId,
        workflowId: scope.workflowId,
        workspaceId: scope.workspaceId,
      }
      const criterionItems = test.evaluator.criteria.map<WorkflowEvalAgentCriterionWorkItem>(
        (criterion, criterionOrdinal) => {
          const persisted = persistedCriterionRows[criterionOrdinal]
          if (!persisted) {
            throw new Error(
              `Agent eval test ${test.id} is missing criterion row ${criterionOrdinal}`
            )
          }
          return { criterionRunId: persisted.id, criterion }
        }
      )
      await evaluateWorkflowEvalAgentCriteria({
        runId: payload.runId,
        testId: test.id,
        testRunId: testRow.id,
        workflowId: scope.workflowId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        model: test.evaluator.model,
        billingAttribution,
        trace,
        criteria: criterionItems,
        abortSignal,
        onCriterionStarted: async (item) => {
          const started = await transitionCriterionToRunning({
            runId: payload.runId,
            testRunId: testRow.id,
            criterionRunId: item.criterionRunId,
          })
          publishWorkflowEvalEvent(
            eventTransport,
            buildCriterionEvent({
              scope: criterionEventScope,
              run: started.run,
              testRunId: testRow.id,
              testId: test.id,
              criterionRun: started.criterionRun,
            })
          )
        },
        onCriterionFinished: async (item, _criterionOrdinal, evaluation) => {
          const finished = await finalizeCriterionRun({
            runId: payload.runId,
            testRunId: testRow.id,
            criterionRunId: item.criterionRunId,
            evaluation,
          })
          publishWorkflowEvalEvent(
            eventTransport,
            buildCriterionEvent({
              scope: criterionEventScope,
              run: finished.run,
              testRunId: testRow.id,
              testId: test.id,
              criterionRun: finished.criterionRun,
            })
          )
        },
      })
      const finalized = await finalizeTestRun({
        runId: payload.runId,
        testRunId: testRow.id,
        expectedPhase: 'running_evaluator',
        agentFinalization: { model: test.evaluator.model, items: criterionItems },
      })
      publishWorkflowEvalEvent(
        eventTransport,
        buildTestEvent({ scope, run: finalized.run, testRun: finalized.testRun })
      )
    }

    const completedAt = new Date()
    const [completedRow] = await db
      .update(workflowEvalRun)
      .set({
        status: 'completed',
        completedAt,
        updatedAt: completedAt,
        revision: sql`${workflowEvalRun.revision} + 1`,
      })
      .where(
        and(
          eq(workflowEvalRun.id, payload.runId),
          eq(workflowEvalRun.status, 'running'),
          eq(workflowEvalRun.completedCount, workflowEvalRun.totalCount)
        )
      )
      .returning(runProjectionSelection)
    if (!completedRow) {
      throw new Error(`Workflow eval run ${payload.runId} could not transition to completed`)
    }
    const completedRun = toRunProjection(completedRow)
    publishWorkflowEvalEvent(eventTransport, buildRunEvent({ scope, run: completedRun }))

    logger.info('Workflow eval suite run completed', {
      runId: payload.runId,
      suiteId: scope.suiteId,
      totalCount: completedRun.totalCount,
      passedCount: completedRun.passedCount,
      failedCount: completedRun.failedCount,
      errorCount: completedRun.errorCount,
    })
  } catch (error) {
    const cause = toError(error)
    if (!ownsRunningRun) {
      throw cause
    }
    try {
      const marked = await markRunError(
        payload.runId,
        'coordinator_failed',
        cause.message,
        'running'
      )
      if (scope) {
        publishErroredRun({ scope, marked, transport: eventTransport })
      }
    } catch (markError) {
      try {
        if (await runIsCancelled(payload.runId)) {
          logger.info('Workflow eval suite run stopped', { runId: payload.runId })
          return
        }
      } catch (statusError) {
        throw new AggregateError(
          [cause, toError(markError), toError(statusError)],
          `Workflow eval run ${payload.runId} failed and its terminal status could not be determined`
        )
      }
      throw new AggregateError(
        [cause, toError(markError)],
        `Workflow eval run ${payload.runId} failed and could not be marked as error`
      )
    }
    throw cause
  }
}
