import { db } from '@sim/db'
import {
  workflowEvalCriterionRun,
  workflowEvalRun,
  workflowEvalSuite,
  workflowEvalTestRun,
} from '@sim/db/schema'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  type WorkflowEvalError,
  type WorkflowEvalSuite,
  type WorkflowEvalTest,
  type WorkflowEvalTestSummary,
  workflowEvalDefinitionSnapshotSchema,
  workflowEvalErrorSchema,
  workflowEvalSuiteSchema,
  workflowEvalTestsSchema,
} from '@/lib/api/contracts/workflow-evals'

const MAX_WORKFLOW_EVAL_SUITES = 1_000
export const MAX_WORKFLOW_EVAL_TEST_RUN_ROWS = 10_000
export const MAX_WORKFLOW_EVAL_CRITERION_RUN_ROWS = 120_000
export const MAX_WORKFLOW_EVAL_LOAD_BYTES = 64 * 1024 * 1024

interface PersistedErrorColumns {
  errorKind: unknown
  errorCode: unknown
  errorMessage: unknown
}

interface AggregateRow {
  count: number
  bytes: number
}

function summarizeTests(tests: readonly WorkflowEvalTest[]): WorkflowEvalTestSummary[] {
  return tests.map((test) => {
    if (test.evaluator.type !== 'agent') {
      return {
        id: test.id,
        name: test.name,
        evaluatorType: test.evaluator.type,
      }
    }

    return {
      id: test.id,
      name: test.name,
      evaluatorType: 'agent',
      criteria: test.evaluator.criteria.map((criterion) => ({
        id: criterion.id,
        name: criterion.name,
      })),
    }
  })
}

function materializeError(columns: PersistedErrorColumns, label: string): WorkflowEvalError | null {
  const values = [columns.errorKind, columns.errorCode, columns.errorMessage]
  const populatedCount = values.filter((value) => value !== null).length
  if (populatedCount === 0) return null
  if (populatedCount !== values.length) {
    throw new Error(`${label} has partially populated typed error columns`)
  }

  return workflowEvalErrorSchema.parse({
    kind: columns.errorKind,
    code: columns.errorCode,
    message: columns.errorMessage,
  })
}

function assertAggregateRow(
  rows: AggregateRow[],
  label: string,
  maximumCount: number
): AggregateRow {
  if (rows.length !== 1) {
    throw new Error(`${label} preflight returned ${rows.length} aggregate rows, expected exactly 1`)
  }

  const [row] = rows
  if (!Number.isSafeInteger(row.count) || row.count < 0) {
    throw new Error(`${label} preflight returned invalid row count ${row.count}`)
  }
  if (row.count > maximumCount) {
    throw new Error(
      `${label} preflight found ${row.count} rows, exceeding the ${maximumCount}-row limit`
    )
  }
  if (!Number.isSafeInteger(row.bytes) || row.bytes < 0) {
    throw new Error(`${label} preflight returned invalid byte size ${row.bytes}`)
  }
  return row
}

function assertPayloadByteBudget({
  workflowId,
  suiteRows,
  latestRunRows,
  testRunBytes,
  criterionRunBytes,
}: {
  workflowId: string
  suiteRows: Array<{ id: string; testsBytes: number }>
  latestRunRows: Array<{ id: string; definitionSnapshotBytes: number }>
  testRunBytes: number
  criterionRunBytes: number
}): void {
  let totalBytes = 0
  const addBytes = (bytes: number, label: string): void => {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`${label} has invalid persisted byte size ${bytes}`)
    }
    totalBytes += bytes
    if (totalBytes > MAX_WORKFLOW_EVAL_LOAD_BYTES) {
      throw new Error(
        `Workflow ${workflowId} eval payloads require ${totalBytes} bytes, exceeding the ${MAX_WORKFLOW_EVAL_LOAD_BYTES}-byte load limit`
      )
    }
  }

  for (const suite of suiteRows) {
    addBytes(suite.testsBytes, `Workflow eval suite ${suite.id}`)
  }
  for (const run of latestRunRows) {
    addBytes(run.definitionSnapshotBytes, `Workflow eval run ${run.id} definition snapshot`)
  }
  addBytes(testRunBytes, 'Workflow eval test rows')
  addBytes(criterionRunBytes, 'Workflow eval criterion rows')
}

function assertRunAggregates({
  run,
  testRuns,
}: {
  run: {
    id: string
    totalCount: number
    completedCount: number
    passedCount: number
    warningCount: number
    failedCount: number
    errorCount: number
  }
  testRuns: Array<{ phase: unknown; outcome: unknown }>
}): void {
  if (testRuns.length !== run.totalCount) {
    throw new Error(
      `Eval run ${run.id} has ${testRuns.length} test rows for totalCount ${run.totalCount}`
    )
  }

  const actual = {
    passedCount: 0,
    warningCount: 0,
    failedCount: 0,
    errorCount: 0,
  }
  for (const testRun of testRuns) {
    if (testRun.phase === 'error') {
      actual.errorCount++
    } else if (testRun.phase === 'completed') {
      if (testRun.outcome === 'pass') actual.passedCount++
      else if (testRun.outcome === 'warning') actual.warningCount++
      else if (testRun.outcome === 'fail') actual.failedCount++
      else throw new Error(`Completed test row in eval run ${run.id} has no valid outcome`)
    }
  }

  const actualCompletedCount =
    actual.passedCount + actual.warningCount + actual.failedCount + actual.errorCount
  const persistedCounts = {
    completedCount: run.completedCount,
    passedCount: run.passedCount,
    warningCount: run.warningCount,
    failedCount: run.failedCount,
    errorCount: run.errorCount,
  }
  const actualCounts = { completedCount: actualCompletedCount, ...actual }
  for (const key of Object.keys(persistedCounts) as Array<keyof typeof persistedCounts>) {
    if (persistedCounts[key] !== actualCounts[key]) {
      throw new Error(
        `Eval run ${run.id} has ${key} ${persistedCounts[key]}, but its test rows require ${actualCounts[key]}`
      )
    }
  }
}

/**
 * Loads workflow Eval suites and the deterministic latest run for each suite.
 * Every count and persisted payload byte size is bounded before JSON or row
 * payloads are materialized into the application process.
 */
export async function loadWorkflowEvalSuites(
  workflowId: string,
  workspaceId: string
): Promise<WorkflowEvalSuite[]> {
  const { suiteRows, latestRunRows, testRunRows, criterionRunRows } = await db.transaction(
    async (tx) => {
      const suiteMetadataRows = await tx
        .select({
          id: workflowEvalSuite.id,
          name: workflowEvalSuite.name,
          definitionVersion: workflowEvalSuite.definitionVersion,
          definitionRevision: workflowEvalSuite.definitionRevision,
          archivedAt: workflowEvalSuite.archivedAt,
          testsBytes: sql<number>`pg_column_size(${workflowEvalSuite.tests}::text)`,
          createdAt: workflowEvalSuite.createdAt,
        })
        .from(workflowEvalSuite)
        .where(
          and(eq(workflowEvalSuite.workflowId, workflowId), isNull(workflowEvalSuite.archivedAt))
        )
        .orderBy(asc(workflowEvalSuite.createdAt), asc(workflowEvalSuite.id))
        .limit(MAX_WORKFLOW_EVAL_SUITES + 1)

      if (suiteMetadataRows.length > MAX_WORKFLOW_EVAL_SUITES) {
        throw new Error(
          `Workflow ${workflowId} has more than ${MAX_WORKFLOW_EVAL_SUITES} eval suites; the eval pane supports at most ${MAX_WORKFLOW_EVAL_SUITES}`
        )
      }
      if (suiteMetadataRows.length === 0) {
        return { suiteRows: [], latestRunRows: [], testRunRows: [], criterionRunRows: [] }
      }
      for (const suite of suiteMetadataRows) {
        if (suite.definitionVersion !== 1) {
          throw new Error(
            `Workflow eval suite ${suite.id} has unsupported definition version ${suite.definitionVersion}`
          )
        }
      }

      const latestRunMetadataRows = await tx
        .selectDistinctOn([workflowEvalRun.suiteId, workflowEvalRun.scope], {
          id: workflowEvalRun.id,
          suiteId: workflowEvalRun.suiteId,
          workspaceId: workflowEvalRun.workspaceId,
          status: workflowEvalRun.status,
          scope: workflowEvalRun.scope,
          selectedTestId: workflowEvalRun.selectedTestId,
          suiteDefinitionRevision: workflowEvalRun.suiteDefinitionRevision,
          definitionSnapshotBytes: sql<number>`pg_column_size(${workflowEvalRun.definitionSnapshot}::text)`,
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
        .where(
          inArray(
            workflowEvalRun.suiteId,
            suiteMetadataRows.map((suite) => suite.id)
          )
        )
        .orderBy(
          workflowEvalRun.suiteId,
          workflowEvalRun.scope,
          desc(workflowEvalRun.createdAt),
          desc(workflowEvalRun.id)
        )

      const expectedTestRunCount = latestRunMetadataRows.reduce(
        (count, run) => count + run.totalCount,
        0
      )
      if (expectedTestRunCount > MAX_WORKFLOW_EVAL_TEST_RUN_ROWS) {
        throw new Error(
          `Workflow ${workflowId} latest eval runs require ${expectedTestRunCount} test rows, exceeding the ${MAX_WORKFLOW_EVAL_TEST_RUN_ROWS}-row limit`
        )
      }

      const latestRunIds = latestRunMetadataRows.map((run) => run.id)
      let testRunAggregate: AggregateRow = { count: 0, bytes: 0 }
      let criterionRunAggregate: AggregateRow = { count: 0, bytes: 0 }
      if (latestRunIds.length > 0) {
        const testAggregateRows = await tx
          .select({
            count: sql<number>`count(*)::integer`,
            bytes: sql<number>`coalesce(sum(pg_column_size(${workflowEvalTestRun})), 0)::double precision`,
          })
          .from(workflowEvalTestRun)
          .where(inArray(workflowEvalTestRun.runId, latestRunIds))
          .limit(1)
        testRunAggregate = assertAggregateRow(
          testAggregateRows,
          'Workflow eval test rows',
          MAX_WORKFLOW_EVAL_TEST_RUN_ROWS
        )
        if (testRunAggregate.count !== expectedTestRunCount) {
          throw new Error(
            `Workflow ${workflowId} latest eval runs expect ${expectedTestRunCount} test rows, but preflight found ${testRunAggregate.count}`
          )
        }

        const criterionAggregateRows = await tx
          .select({
            count: sql<number>`count(*)::integer`,
            bytes: sql<number>`coalesce(sum(pg_column_size(${workflowEvalCriterionRun})), 0)::double precision`,
          })
          .from(workflowEvalCriterionRun)
          .innerJoin(
            workflowEvalTestRun,
            eq(workflowEvalTestRun.id, workflowEvalCriterionRun.testRunId)
          )
          .where(inArray(workflowEvalTestRun.runId, latestRunIds))
          .limit(1)
        criterionRunAggregate = assertAggregateRow(
          criterionAggregateRows,
          'Workflow eval criterion rows',
          MAX_WORKFLOW_EVAL_CRITERION_RUN_ROWS
        )
      }

      assertPayloadByteBudget({
        workflowId,
        suiteRows: suiteMetadataRows,
        latestRunRows: latestRunMetadataRows,
        testRunBytes: testRunAggregate.bytes,
        criterionRunBytes: criterionRunAggregate.bytes,
      })

      const suitePayloadRows = await tx
        .select({ id: workflowEvalSuite.id, tests: workflowEvalSuite.tests })
        .from(workflowEvalSuite)
        .where(
          inArray(
            workflowEvalSuite.id,
            suiteMetadataRows.map((suite) => suite.id)
          )
        )
        .orderBy(asc(workflowEvalSuite.id))
      if (suitePayloadRows.length !== suiteMetadataRows.length) {
        throw new Error(
          `Workflow ${workflowId} loaded ${suitePayloadRows.length} suite payloads for ${suiteMetadataRows.length} suite metadata rows`
        )
      }
      const suitePayloadById = new Map(suitePayloadRows.map((suite) => [suite.id, suite.tests]))
      if (suitePayloadById.size !== suitePayloadRows.length) {
        throw new Error(`Workflow ${workflowId} loaded duplicate Eval suite payloads`)
      }

      const runPayloadRows =
        latestRunIds.length === 0
          ? []
          : await tx
              .select({
                id: workflowEvalRun.id,
                definitionSnapshot: workflowEvalRun.definitionSnapshot,
              })
              .from(workflowEvalRun)
              .where(inArray(workflowEvalRun.id, latestRunIds))
              .orderBy(asc(workflowEvalRun.id))
      if (runPayloadRows.length !== latestRunMetadataRows.length) {
        throw new Error(
          `Workflow ${workflowId} loaded ${runPayloadRows.length} run payloads for ${latestRunMetadataRows.length} latest runs`
        )
      }
      const runPayloadById = new Map(runPayloadRows.map((run) => [run.id, run.definitionSnapshot]))
      if (runPayloadById.size !== runPayloadRows.length) {
        throw new Error(`Workflow ${workflowId} loaded duplicate latest Eval run payloads`)
      }

      const loadedTestRunRows =
        latestRunIds.length === 0
          ? []
          : await tx
              .select({
                id: workflowEvalTestRun.id,
                runId: workflowEvalTestRun.runId,
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
              })
              .from(workflowEvalTestRun)
              .where(inArray(workflowEvalTestRun.runId, latestRunIds))
              .orderBy(
                asc(workflowEvalTestRun.runId),
                asc(workflowEvalTestRun.ordinal),
                asc(workflowEvalTestRun.id)
              )
      if (loadedTestRunRows.length !== testRunAggregate.count) {
        throw new Error(
          `Workflow ${workflowId} materialized ${loadedTestRunRows.length} test rows after preflighting ${testRunAggregate.count}`
        )
      }

      const loadedCriterionRunRows =
        latestRunIds.length === 0
          ? []
          : await tx
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
                errorKind: workflowEvalCriterionRun.errorKind,
                errorCode: workflowEvalCriterionRun.errorCode,
                errorMessage: workflowEvalCriterionRun.errorMessage,
              })
              .from(workflowEvalCriterionRun)
              .innerJoin(
                workflowEvalTestRun,
                eq(workflowEvalTestRun.id, workflowEvalCriterionRun.testRunId)
              )
              .where(inArray(workflowEvalTestRun.runId, latestRunIds))
              .orderBy(
                asc(workflowEvalCriterionRun.testRunId),
                asc(workflowEvalCriterionRun.ordinal),
                asc(workflowEvalCriterionRun.id)
              )
      if (loadedCriterionRunRows.length !== criterionRunAggregate.count) {
        throw new Error(
          `Workflow ${workflowId} materialized ${loadedCriterionRunRows.length} criterion rows after preflighting ${criterionRunAggregate.count}`
        )
      }

      const hydratedSuiteRows = suiteMetadataRows.map((suite) => {
        const tests = suitePayloadById.get(suite.id)
        if (tests === undefined) {
          throw new Error(
            `Workflow eval suite ${suite.id} payload was not found after metadata load`
          )
        }
        return { ...suite, tests }
      })
      const hydratedLatestRunRows = latestRunMetadataRows.map((run) => {
        const definitionSnapshot = runPayloadById.get(run.id)
        if (definitionSnapshot === undefined) {
          throw new Error(`Workflow eval run ${run.id} payload was not found after metadata load`)
        }
        return { ...run, definitionSnapshot }
      })

      return {
        suiteRows: hydratedSuiteRows,
        latestRunRows: hydratedLatestRunRows,
        testRunRows: loadedTestRunRows,
        criterionRunRows: loadedCriterionRunRows,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  )

  if (suiteRows.length === 0) return []

  const latestRunBySuiteId = new Map<string, (typeof latestRunRows)[number]>()
  const latestSuiteRunBySuiteId = new Map<string, (typeof latestRunRows)[number]>()
  for (const run of latestRunRows) {
    const current = latestRunBySuiteId.get(run.suiteId)
    if (
      !current ||
      run.createdAt.getTime() > current.createdAt.getTime() ||
      (run.createdAt.getTime() === current.createdAt.getTime() && run.id > current.id)
    ) {
      latestRunBySuiteId.set(run.suiteId, run)
    }
    if (run.scope === 'suite') {
      latestSuiteRunBySuiteId.set(run.suiteId, run)
    }
  }
  const latestRunIds = new Set(latestRunRows.map((run) => run.id))

  const testRunsByRunId = new Map<string, typeof testRunRows>()
  const testRunIds = new Set<string>()
  for (const row of testRunRows) {
    if (!latestRunIds.has(row.runId)) {
      throw new Error(`Eval test row ${row.id} belongs to unknown latest run ${row.runId}`)
    }
    if (testRunIds.has(row.id)) throw new Error(`Duplicate eval test row id ${row.id}`)
    testRunIds.add(row.id)
    const rows = testRunsByRunId.get(row.runId) ?? []
    rows.push(row)
    testRunsByRunId.set(row.runId, rows)
  }

  const criterionRunsByTestRunId = new Map<string, typeof criterionRunRows>()
  for (const row of criterionRunRows) {
    if (!testRunIds.has(row.testRunId)) {
      throw new Error(`Eval criterion row ${row.id} belongs to unknown test row ${row.testRunId}`)
    }
    const rows = criterionRunsByTestRunId.get(row.testRunId) ?? []
    rows.push(row)
    criterionRunsByTestRunId.set(row.testRunId, rows)
  }

  const suites = suiteRows.map((suite) => {
    const tests = workflowEvalTestsSchema.parse(suite.tests)
    const testSummaries = summarizeTests(tests)
    const run = latestRunBySuiteId.get(suite.id)
    const suiteRun = latestSuiteRunBySuiteId.get(suite.id)
    if (!run) {
      return {
        id: suite.id,
        name: suite.name,
        definitionRevision: suite.definitionRevision,
        archivedAt: suite.archivedAt,
        tests: testSummaries,
        testCount: tests.length,
        latestRun: null,
        latestSuiteRun: null,
      }
    }

    const materializeRun = (candidate: typeof run) => {
      if (candidate.workspaceId !== workspaceId) {
        throw new Error(
          `Eval run ${candidate.id} belongs to workspace ${candidate.workspaceId}, expected ${workspaceId}`
        )
      }

      const definitionSnapshot = workflowEvalDefinitionSnapshotSchema.parse(
        candidate.definitionSnapshot
      )
      if (definitionSnapshot.suiteId !== suite.id) {
        throw new Error(
          `Eval run ${candidate.id} snapshot belongs to suite ${definitionSnapshot.suiteId}, expected ${suite.id}`
        )
      }
      const persistedTestRuns = testRunsByRunId.get(candidate.id) ?? []
      assertRunAggregates({ run: candidate, testRuns: persistedTestRuns })

      return {
        id: candidate.id,
        scope: candidate.scope,
        selectedTestId: candidate.selectedTestId,
        suiteDefinitionRevision: candidate.suiteDefinitionRevision,
        status: candidate.status,
        revision: candidate.revision,
        completedCount: candidate.completedCount,
        passedCount: candidate.passedCount,
        warningCount: candidate.warningCount,
        failedCount: candidate.failedCount,
        errorCount: candidate.errorCount,
        totalCount: candidate.totalCount,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        startedAt: candidate.startedAt,
        completedAt: candidate.completedAt,
        error: materializeError(candidate, `Eval run ${candidate.id}`),
        tests: summarizeTests(definitionSnapshot.tests),
        testRuns: persistedTestRuns.map((testRun) => {
          const persistedCriteria = criterionRunsByTestRunId.get(testRun.id) ?? []
          return {
            id: testRun.id,
            testId: testRun.testId,
            ordinal: testRun.ordinal,
            name: testRun.name,
            evaluatorType: testRun.evaluatorType,
            phase: testRun.phase,
            outcome: testRun.outcome,
            score: testRun.score,
            reason: testRun.reason,
            errorBlockIds: testRun.errorBlockIds,
            subjectExecutionId: testRun.subjectExecutionId,
            judgeExecutionId: testRun.judgeExecutionId,
            error: materializeError(testRun, `Eval test row ${testRun.id}`),
            criteria: persistedCriteria.map((criterion) => ({
              id: criterion.id,
              criterionId: criterion.criterionId,
              ordinal: criterion.ordinal,
              name: criterion.name,
              phase: criterion.phase,
              verdict: criterion.verdict,
              confidence: criterion.confidence,
              reason: criterion.reason,
              error: materializeError(criterion, `Eval criterion row ${criterion.id}`),
            })),
          }
        }),
      }
    }

    return {
      id: suite.id,
      name: suite.name,
      definitionRevision: suite.definitionRevision,
      archivedAt: suite.archivedAt,
      tests: testSummaries,
      testCount: tests.length,
      latestRun: materializeRun(run),
      latestSuiteRun: suiteRun ? materializeRun(suiteRun) : null,
    }
  })

  return workflowEvalSuiteSchema.array().parse(suites)
}
