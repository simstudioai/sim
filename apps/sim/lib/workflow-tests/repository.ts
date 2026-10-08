import { db } from '@sim/db'
import {
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowTest,
  workflowTestRun,
  workspaceFiles,
} from '@sim/db/schema'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import type { TestCaseStatus, TestCollection, TestReport } from '@/lib/workflow-tests/protocol'
import type { WorkflowTestVersion } from '@/lib/workflows/application/run-workflow-for-test'

export type WorkflowTestRow = typeof workflowTest.$inferSelect
export type WorkflowTestRunRow = typeof workflowTestRun.$inferSelect
export type WorkflowTestCases = TestCollection['tests']

/** Runs kept per test and version for the list's history dots. */
export const RECENT_RUNS_PER_TEST = 5

export async function insertWorkflowTestInTx(
  tx: DbTransaction,
  values: typeof workflowTest.$inferInsert
): Promise<WorkflowTestRow> {
  const [row] = await tx.insert(workflowTest).values(values).returning()
  return row
}

export async function getLiveWorkflowTestByName(
  workspaceId: string,
  name: string,
  executor: DbOrTx = db
): Promise<WorkflowTestRow | null> {
  const [row] = await executor
    .select()
    .from(workflowTest)
    .where(
      and(
        eq(workflowTest.workspaceId, workspaceId),
        eq(workflowTest.name, name),
        isNull(workflowTest.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

export async function getLiveWorkflowTestByBodyFileId(
  bodyFileId: string,
  executor: DbOrTx = db
): Promise<WorkflowTestRow | null> {
  const [row] = await executor
    .select()
    .from(workflowTest)
    .where(and(eq(workflowTest.bodyFileId, bodyFileId), isNull(workflowTest.deletedAt)))
    .limit(1)
  return row ?? null
}

export async function updateWorkflowTestCases(
  testId: string,
  cases: WorkflowTestCases,
  sourceHash: string,
  executor: DbOrTx = db
): Promise<void> {
  await executor
    .update(workflowTest)
    .set({ cases, sourceHash, updatedAt: new Date() })
    .where(eq(workflowTest.id, testId))
}

export async function updateWorkflowTestMetadata(
  testId: string,
  metadata: { title?: string; description?: string | null }
): Promise<WorkflowTestRow> {
  const [row] = await db
    .update(workflowTest)
    .set({ ...metadata, updatedAt: new Date() })
    .where(eq(workflowTest.id, testId))
    .returning()
  return row
}

export async function listLiveWorkflowTests(workspaceId: string): Promise<WorkflowTestRow[]> {
  return db
    .select()
    .from(workflowTest)
    .where(and(eq(workflowTest.workspaceId, workspaceId), isNull(workflowTest.deletedAt)))
    .orderBy(workflowTest.title)
}

/** Deletes a test with its source file; soft-delete cleanup later releases the file's storage. */
export async function softDeleteWorkflowTest(test: {
  id: string
  bodyFileId: string
}): Promise<void> {
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(workflowTest)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(workflowTest.id, test.id))
    await tx
      .update(workspaceFiles)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(workspaceFiles.id, test.bodyFileId),
          eq(workspaceFiles.context, 'test'),
          isNull(workspaceFiles.deletedAt)
        )
      )
  })
}

/** Every file's run row in one statement, so a failure leaves none of them running. */
export async function insertWorkflowTestRuns(
  rows: Array<{
    id: string
    testId: string
    workspaceId: string
    version: WorkflowTestVersion
    triggeredByActor: unknown
    triggeredByUserId: string | null
  }>
): Promise<void> {
  await db.insert(workflowTestRun).values(rows.map((row) => ({ ...row, status: 'running' })))
}

/** Files run one after another, so a run's clock starts when its file does, not when it queued. */
export async function markWorkflowTestRunStarted(runId: string): Promise<void> {
  await db
    .update(workflowTestRun)
    .set({ startedAt: new Date() })
    .where(eq(workflowTestRun.id, runId))
}

/** A workflow a run executed and the deployment it ran; `null` is the draft. */
export interface RanAgainstEntry {
  workflowId: string
  deploymentVersionId: string | null
  /** A `runWorkflow()` execution of it, whose snapshot is the workflow as it ran; null for a child. */
  executionId: string | null
  /** For a draft, the workflow's `updatedAt` when the run ended; a later edit makes the run stale. */
  draftUpdatedAt: string | null
}

type ExecutedWorkflow = Omit<RanAgainstEntry, 'draftUpdatedAt'>

/**
 * Every workflow a run executed: the ones `runWorkflow()` started, from their execution logs, and
 * the children they called, which run inside their parent's execution and so log nothing of their
 * own. A child ran the same version as its run: its live deployment, or its draft.
 */
export async function readRanAgainst(params: {
  executionIds: string[]
  enteredWorkflowIds: string[]
  workspaceId: string
  version: WorkflowTestVersion
}): Promise<RanAgainstEntry[]> {
  const started = await readExecutedDeployments(params.executionIds, params.workspaceId)
  const startedIds = new Set(started.map((entry) => entry.workflowId))
  const childIds = params.enteredWorkflowIds.filter((id) => !startedIds.has(id))
  const children = await readChildVersions(childIds, params.version)
  const executed = [...started, ...children]
  const drafts = executed.filter((entry) => entry.deploymentVersionId === null)
  const updatedAt = new Map(
    drafts.length === 0
      ? []
      : (
          await db
            .select({ id: workflow.id, updatedAt: workflow.updatedAt })
            .from(workflow)
            .where(
              inArray(
                workflow.id,
                drafts.map((entry) => entry.workflowId)
              )
            )
        ).map((row) => [row.id, row.updatedAt.toISOString()])
  )
  return executed.map((entry) => ({
    ...entry,
    draftUpdatedAt:
      entry.deploymentVersionId === null ? (updatedAt.get(entry.workflowId) ?? null) : null,
  }))
}

async function readChildVersions(
  workflowIds: string[],
  version: WorkflowTestVersion
): Promise<ExecutedWorkflow[]> {
  if (workflowIds.length === 0) return []
  if (version === 'draft') {
    return workflowIds.map((workflowId) => ({
      workflowId,
      deploymentVersionId: null,
      executionId: null,
    }))
  }
  const active = await db
    .select({ workflowId: workflowDeploymentVersion.workflowId, id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        inArray(workflowDeploymentVersion.workflowId, workflowIds),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
  return active.map((row) => ({
    workflowId: row.workflowId,
    deploymentVersionId: row.id,
    executionId: null,
  }))
}

/** The workflows and deployments these executions ran, from their execution logs. */
async function readExecutedDeployments(
  executionIds: string[],
  workspaceId: string
): Promise<ExecutedWorkflow[]> {
  if (executionIds.length === 0) return []
  const rows = await db
    .selectDistinctOn(
      [workflowExecutionLogs.workflowId, workflowExecutionLogs.deploymentVersionId],
      {
        workflowId: workflowExecutionLogs.workflowId,
        deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
        executionId: workflowExecutionLogs.executionId,
      }
    )
    .from(workflowExecutionLogs)
    .where(
      and(
        inArray(workflowExecutionLogs.executionId, executionIds),
        eq(workflowExecutionLogs.workspaceId, workspaceId)
      )
    )
    .orderBy(workflowExecutionLogs.workflowId, workflowExecutionLogs.deploymentVersionId)
  return rows.flatMap((row) =>
    row.workflowId
      ? [
          {
            workflowId: row.workflowId,
            deploymentVersionId: row.deploymentVersionId,
            executionId: row.executionId,
          },
        ]
      : []
  )
}

export interface DeploymentFacts {
  names: Map<string, string>
  /** When each workflow last changed, draft edits included. */
  updatedAt: Map<string, Date>
  /** Active deployment per workflow. */
  active: Map<string, { id: string; version: number }>
  /** Version number of every deployment asked about. */
  versions: Map<string, number>
}

/** Names, live deployments, and version numbers needed to tell whether a run is out of date. */
export async function readDeploymentFacts(
  workflowIds: string[],
  deploymentVersionIds: string[]
): Promise<DeploymentFacts> {
  const facts: DeploymentFacts = {
    names: new Map(),
    updatedAt: new Map(),
    active: new Map(),
    versions: new Map(),
  }
  if (workflowIds.length === 0) return facts
  const [workflows, active, versions] = await Promise.all([
    db
      .select({ id: workflow.id, name: workflow.name, updatedAt: workflow.updatedAt })
      .from(workflow)
      .where(and(inArray(workflow.id, workflowIds), isNull(workflow.archivedAt))),
    db
      .select({
        workflowId: workflowDeploymentVersion.workflowId,
        id: workflowDeploymentVersion.id,
        version: workflowDeploymentVersion.version,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          inArray(workflowDeploymentVersion.workflowId, workflowIds),
          eq(workflowDeploymentVersion.isActive, true)
        )
      ),
    deploymentVersionIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: workflowDeploymentVersion.id, version: workflowDeploymentVersion.version })
          .from(workflowDeploymentVersion)
          .where(inArray(workflowDeploymentVersion.id, deploymentVersionIds)),
  ])
  for (const row of workflows) {
    facts.names.set(row.id, row.name)
    facts.updatedAt.set(row.id, row.updatedAt)
  }
  for (const row of active) facts.active.set(row.workflowId, { id: row.id, version: row.version })
  for (const row of versions) facts.versions.set(row.id, row.version)
  return facts
}

export async function completeWorkflowTestRun(
  runId: string,
  report: TestReport,
  sourceHash: string,
  ranAgainst: RanAgainstEntry[]
): Promise<void> {
  const count = (status: 'pass' | 'fail' | 'skip') =>
    report.tests.filter((test) => test.status === status).length
  const failed = count('fail')
  await db
    .update(workflowTestRun)
    .set({
      status: failed > 0 ? 'failed' : 'passed',
      passed: count('pass'),
      failed,
      skipped: count('skip'),
      report,
      sourceHash,
      ranAgainst,
      completedAt: new Date(),
    })
    .where(eq(workflowTestRun.id, runId))
}

/** Records one case starting or finishing while its run is still going. */
export async function recordWorkflowTestProgress(
  runId: string,
  caseKey: string,
  status: TestCaseStatus
): Promise<void> {
  await db
    .update(workflowTestRun)
    .set({
      progress: sql`coalesce(${workflowTestRun.progress}, '{}'::jsonb) || jsonb_build_object(${caseKey}::text, ${status}::text)`,
    })
    .where(and(eq(workflowTestRun.id, runId), eq(workflowTestRun.status, 'running')))
}

export async function failWorkflowTestRun(
  runId: string,
  error: string,
  sourceHash: string | null
): Promise<void> {
  await db
    .update(workflowTestRun)
    .set({ status: 'error', error, sourceHash, completedAt: new Date() })
    .where(eq(workflowTestRun.id, runId))
}

/** The newest runs of each test, at one version or (null) both, newest first, without reports. */
export async function listRecentWorkflowTestRuns(
  testIds: string[],
  version: WorkflowTestVersion | null,
  perTest: number
): Promise<Array<Omit<WorkflowTestRunRow, 'report'>>> {
  if (testIds.length === 0) return []
  const ranked = db
    .select({
      id: workflowTestRun.id,
      rank: sql<number>`row_number() over (partition by ${workflowTestRun.testId} order by ${workflowTestRun.startedAt} desc)`.as(
        'rank'
      ),
    })
    .from(workflowTestRun)
    .where(
      and(
        inArray(workflowTestRun.testId, testIds),
        version ? eq(workflowTestRun.version, version) : undefined
      )
    )
    .as('ranked')
  return db
    .select({
      id: workflowTestRun.id,
      testId: workflowTestRun.testId,
      workspaceId: workflowTestRun.workspaceId,
      version: workflowTestRun.version,
      status: workflowTestRun.status,
      passed: workflowTestRun.passed,
      failed: workflowTestRun.failed,
      skipped: workflowTestRun.skipped,
      error: workflowTestRun.error,
      triggeredByActor: workflowTestRun.triggeredByActor,
      triggeredByUserId: workflowTestRun.triggeredByUserId,
      sourceHash: workflowTestRun.sourceHash,
      ranAgainst: workflowTestRun.ranAgainst,
      progress: workflowTestRun.progress,
      startedAt: workflowTestRun.startedAt,
      completedAt: workflowTestRun.completedAt,
    })
    .from(workflowTestRun)
    .innerJoin(ranked, eq(ranked.id, workflowTestRun.id))
    .where(sql`${ranked.rank} <= ${perTest}`)
    .orderBy(desc(workflowTestRun.startedAt))
}

/** The newest run of one test, at one version or (null) either, with its report. */
export async function getLatestWorkflowTestRun(
  testId: string,
  version: WorkflowTestVersion | null
): Promise<WorkflowTestRunRow | null> {
  const [row] = await db
    .select()
    .from(workflowTestRun)
    .where(
      and(
        eq(workflowTestRun.testId, testId),
        version ? eq(workflowTestRun.version, version) : undefined
      )
    )
    .orderBy(desc(workflowTestRun.startedAt))
    .limit(1)
  return row ?? null
}

export async function getWorkflowTestRunById(
  testId: string,
  runId: string
): Promise<WorkflowTestRunRow | null> {
  const [row] = await db
    .select()
    .from(workflowTestRun)
    .where(and(eq(workflowTestRun.id, runId), eq(workflowTestRun.testId, testId)))
    .limit(1)
  return row ?? null
}

export async function listWorkflowTestRunsById(
  runIds: string[],
  workspaceId: string
): Promise<Array<WorkflowTestRunRow & { testName: string; testSourceHash: string }>> {
  if (runIds.length === 0) return []
  const rows = await db
    .select({
      run: workflowTestRun,
      testName: workflowTest.name,
      testSourceHash: workflowTest.sourceHash,
    })
    .from(workflowTestRun)
    .innerJoin(workflowTest, eq(workflowTest.id, workflowTestRun.testId))
    .where(and(inArray(workflowTestRun.id, runIds), eq(workflowTestRun.workspaceId, workspaceId)))
  return rows.map(({ run, testName, testSourceHash }) => ({ ...run, testName, testSourceHash }))
}
