import { db } from '@sim/db'
import {
  workflowEvalCriterionRun,
  workflowEvalRun,
  workflowEvalSuite,
  workflowEvalTestRun,
} from '@sim/db/schema'
import { and, asc, eq, gt, inArray, or } from 'drizzle-orm'
import { workflowEvalDefinitionSnapshotSchema } from '@/lib/api/contracts/workflow-evals'

export type WorkflowEvalRunView = 'summary' | 'failures' | 'all'

export class WorkflowEvalRunTestDefinitionNotFoundError extends Error {
  constructor(runId: string, testId: string) {
    super(`Workflow eval test ${testId} was not found in run ${runId}`)
    this.name = 'WorkflowEvalRunTestDefinitionNotFoundError'
  }
}

export async function loadWorkflowEvalRunTestDefinition({
  workflowId,
  workspaceId,
  suiteId,
  runId,
  testId,
}: {
  workflowId: string
  workspaceId: string
  suiteId: string
  runId: string
  testId: string
}) {
  const [run] = await db
    .select({
      definitionSnapshot: workflowEvalRun.definitionSnapshot,
      suiteDefinitionRevision: workflowEvalRun.suiteDefinitionRevision,
    })
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
  if (!run) throw new WorkflowEvalRunTestDefinitionNotFoundError(runId, testId)

  const snapshot = workflowEvalDefinitionSnapshotSchema.parse(run.definitionSnapshot)
  if (snapshot.suiteId !== suiteId) {
    throw new Error(`Workflow eval run ${runId} has a mismatched definition snapshot`)
  }
  const test = snapshot.tests.find((candidate) => candidate.id === testId)
  if (!test) throw new WorkflowEvalRunTestDefinitionNotFoundError(runId, testId)

  return {
    runId,
    suiteId,
    suiteDefinitionRevision: run.suiteDefinitionRevision,
    test,
  }
}

function decodeOrdinalCursor(cursor: string | undefined): number | null {
  if (!cursor) return null
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      typeof value !== 'object' ||
      value === null ||
      !('ordinal' in value) ||
      !Number.isInteger(value.ordinal) ||
      Number(value.ordinal) < 0
    ) {
      throw new Error('Invalid cursor')
    }
    return Number(value.ordinal)
  } catch {
    throw new Error('Invalid Eval run pagination cursor')
  }
}

function encodeOrdinalCursor(ordinal: number): string {
  return Buffer.from(JSON.stringify({ ordinal }), 'utf8').toString('base64url')
}

function typedError(kind: string | null, code: string | null, message: string | null) {
  const count = [kind, code, message].filter((value) => value !== null).length
  if (count === 0) return null
  if (count !== 3) throw new Error('Persisted Eval result contains a partial typed error')
  return { kind, code, message }
}

export async function loadWorkflowEvalRunDetail({
  workflowId,
  suiteId,
  runId,
  view = 'all',
  limit = 50,
  cursor,
}: {
  workflowId: string
  suiteId: string
  runId: string
  view?: WorkflowEvalRunView
  limit?: number
  cursor?: string
}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('limit must be between 1 and 100')
  }
  const [run] = await db
    .select({
      id: workflowEvalRun.id,
      suiteId: workflowEvalRun.suiteId,
      workspaceId: workflowEvalRun.workspaceId,
      workflowId: workflowEvalSuite.workflowId,
      scope: workflowEvalRun.scope,
      selectedTestId: workflowEvalRun.selectedTestId,
      suiteDefinitionRevision: workflowEvalRun.suiteDefinitionRevision,
      status: workflowEvalRun.status,
      revision: workflowEvalRun.revision,
      totalCount: workflowEvalRun.totalCount,
      completedCount: workflowEvalRun.completedCount,
      passedCount: workflowEvalRun.passedCount,
      warningCount: workflowEvalRun.warningCount,
      failedCount: workflowEvalRun.failedCount,
      errorCount: workflowEvalRun.errorCount,
      errorKind: workflowEvalRun.errorKind,
      errorCode: workflowEvalRun.errorCode,
      errorMessage: workflowEvalRun.errorMessage,
      startedAt: workflowEvalRun.startedAt,
      completedAt: workflowEvalRun.completedAt,
      createdAt: workflowEvalRun.createdAt,
      updatedAt: workflowEvalRun.updatedAt,
    })
    .from(workflowEvalRun)
    .innerJoin(workflowEvalSuite, eq(workflowEvalSuite.id, workflowEvalRun.suiteId))
    .where(
      and(
        eq(workflowEvalRun.id, runId),
        eq(workflowEvalRun.suiteId, suiteId),
        eq(workflowEvalSuite.workflowId, workflowId)
      )
    )
    .limit(1)
  if (!run) throw new Error(`Workflow eval run ${runId} was not found`)

  const ordinalCursor = decodeOrdinalCursor(cursor)
  const outcomeCondition =
    view === 'failures'
      ? or(
          inArray(workflowEvalTestRun.outcome, ['warning', 'fail']),
          eq(workflowEvalTestRun.phase, 'error')
        )
      : undefined
  const testRows =
    view === 'summary'
      ? []
      : await db
          .select({
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
            startedAt: workflowEvalTestRun.startedAt,
            completedAt: workflowEvalTestRun.completedAt,
          })
          .from(workflowEvalTestRun)
          .where(
            and(
              eq(workflowEvalTestRun.runId, runId),
              ordinalCursor === null ? undefined : gt(workflowEvalTestRun.ordinal, ordinalCursor),
              outcomeCondition
            )
          )
          .orderBy(asc(workflowEvalTestRun.ordinal), asc(workflowEvalTestRun.id))
          .limit(limit + 1)
  const page = testRows.slice(0, limit)
  const testRunIds = page.map((test) => test.id)
  const criterionRows =
    testRunIds.length === 0
      ? []
      : await db
          .select({
            id: workflowEvalCriterionRun.id,
            testRunId: workflowEvalCriterionRun.testRunId,
            criterionId: workflowEvalCriterionRun.criterionId,
            ordinal: workflowEvalCriterionRun.ordinal,
            name: workflowEvalCriterionRun.name,
            phase: workflowEvalCriterionRun.phase,
            verdict: workflowEvalCriterionRun.verdict,
            confidence: workflowEvalCriterionRun.confidence,
            reason: workflowEvalCriterionRun.reason,
            requestedModel: workflowEvalCriterionRun.requestedModel,
            providerId: workflowEvalCriterionRun.providerId,
            responseModel: workflowEvalCriterionRun.responseModel,
            promptVersion: workflowEvalCriterionRun.promptVersion,
            inputTokens: workflowEvalCriterionRun.inputTokens,
            outputTokens: workflowEvalCriterionRun.outputTokens,
            totalTokens: workflowEvalCriterionRun.totalTokens,
            cost: workflowEvalCriterionRun.cost,
            durationMs: workflowEvalCriterionRun.durationMs,
            errorKind: workflowEvalCriterionRun.errorKind,
            errorCode: workflowEvalCriterionRun.errorCode,
            errorMessage: workflowEvalCriterionRun.errorMessage,
            startedAt: workflowEvalCriterionRun.startedAt,
            completedAt: workflowEvalCriterionRun.completedAt,
          })
          .from(workflowEvalCriterionRun)
          .where(inArray(workflowEvalCriterionRun.testRunId, testRunIds))
          .orderBy(
            asc(workflowEvalCriterionRun.testRunId),
            asc(workflowEvalCriterionRun.ordinal),
            asc(workflowEvalCriterionRun.id)
          )
  const criteriaByTestRunId = new Map<string, typeof criterionRows>()
  for (const criterion of criterionRows) {
    const criteria = criteriaByTestRunId.get(criterion.testRunId) ?? []
    criteria.push(criterion)
    criteriaByTestRunId.set(criterion.testRunId, criteria)
  }

  const last = page.at(-1)
  return {
    id: run.id,
    suiteId: run.suiteId,
    workflowId: run.workflowId,
    workspaceId: run.workspaceId,
    scope: run.scope,
    selectedTestId: run.selectedTestId,
    suiteDefinitionRevision: run.suiteDefinitionRevision,
    status: run.status,
    revision: run.revision,
    totalCount: run.totalCount,
    completedCount: run.completedCount,
    passedCount: run.passedCount,
    warningCount: run.warningCount,
    failedCount: run.failedCount,
    errorCount: run.errorCount,
    error: typedError(run.errorKind, run.errorCode, run.errorMessage),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    tests: page.map((test) => ({
      id: test.id,
      testId: test.testId,
      ordinal: test.ordinal,
      name: test.name,
      evaluatorType: test.evaluatorType,
      phase: test.phase,
      outcome: test.outcome,
      score: test.score,
      reason: test.reason,
      errorBlockIds: test.errorBlockIds,
      error: typedError(test.errorKind, test.errorCode, test.errorMessage),
      subjectExecutionId: test.subjectExecutionId,
      judgeExecutionId: test.judgeExecutionId,
      startedAt: test.startedAt,
      completedAt: test.completedAt,
      criteria: (criteriaByTestRunId.get(test.id) ?? []).map((criterion) => ({
        id: criterion.id,
        criterionId: criterion.criterionId,
        ordinal: criterion.ordinal,
        name: criterion.name,
        phase: criterion.phase,
        verdict: criterion.verdict,
        confidence: criterion.confidence,
        reason: criterion.reason,
        requestedModel: criterion.requestedModel,
        providerId: criterion.providerId,
        responseModel: criterion.responseModel,
        promptVersion: criterion.promptVersion,
        inputTokens: criterion.inputTokens,
        outputTokens: criterion.outputTokens,
        totalTokens: criterion.totalTokens,
        cost: criterion.cost,
        durationMs: criterion.durationMs,
        error: typedError(criterion.errorKind, criterion.errorCode, criterion.errorMessage),
        startedAt: criterion.startedAt,
        completedAt: criterion.completedAt,
      })),
    })),
    nextCursor: testRows.length > limit && last ? encodeOrdinalCursor(last.ordinal) : null,
  }
}
