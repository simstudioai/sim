import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createOwnedWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { workflowTestOperations } from '@/lib/workflow-tests/application/operations'
import { starterTestSource, testSourceHash } from '@/lib/workflow-tests/definition'
import { requireWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'
import { assertTestName, testFilePath } from '@/lib/workflow-tests/paths'
import type { TestCaseStatus, TestReport } from '@/lib/workflow-tests/protocol'
import {
  type DeploymentFacts,
  getLatestWorkflowTestRun,
  getLiveWorkflowTestByName,
  getWorkflowTestRunById,
  insertWorkflowTestInTx,
  listLiveWorkflowTests,
  listRecentWorkflowTestRuns,
  listWorkflowTestRunsById,
  type RanAgainstEntry,
  RECENT_RUNS_PER_TEST,
  readDeploymentFacts,
  softDeleteWorkflowTest,
  updateWorkflowTestMetadata,
  type WorkflowTestCases,
  type WorkflowTestRow,
  type WorkflowTestRunRow,
} from '@/lib/workflow-tests/repository'
import type { WorkflowTestVersion } from '@/lib/workflows/application/run-workflow-for-test'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const authorizationOptions = {
  delegation: { audience: 'sim:workspaces', isWithinScope: () => true },
} as const

/** A run that has said nothing for this long died with its process. */
const ABANDONED_RUN_MS = 30 * 60_000

type WorkflowTestStatus = 'passing' | 'failing' | 'error' | 'running' | 'changed' | 'not_run'

export interface WorkflowTestRunSummary {
  id: string
  status: 'running' | 'passed' | 'failed' | 'error'
  passed: number
  failed: number
  skipped: number
  error: string | null
  triggeredByUserId: string | null
  version: WorkflowTestVersion
  /** The test file changed after this run. */
  sourceChanged: boolean
  ranAgainst: WorkflowTestRanAgainst[]
  /** Whether the run still describes the test: same source, and no workflow redeployed since. */
  current: boolean
  startedAt: string
  completedAt: string | null
}

interface WorkflowTestRanAgainst {
  workflowId: string
  /** `null` when the workflow has since been deleted. */
  name: string | null
  /** `null` for a draft run, or a deployment since removed. */
  version: number | null
  draft: boolean
  liveVersion: number | null
  /** The workflow was redeployed or deleted after this run. */
  stale: boolean
  /** One execution of it in this run, whose snapshot is the workflow as it ran. */
  executionId: string
}

type RunRow = Omit<WorkflowTestRunRow, 'report'>

/** Reads what every run's workflows look like now, in three queries for any number of runs. */
async function loadDeploymentFacts(rows: RunRow[]): Promise<DeploymentFacts> {
  const entries = rows.flatMap(ranAgainstEntries)
  return readDeploymentFacts(
    [...new Set(entries.map((entry) => entry.workflowId))],
    [...new Set(entries.flatMap((entry) => entry.deploymentVersionId ?? []))]
  )
}

function ranAgainstEntries(row: RunRow): RanAgainstEntry[] {
  return (row.ranAgainst ?? []) as RanAgainstEntry[]
}

function presentRanAgainst(row: RunRow, facts: DeploymentFacts): WorkflowTestRanAgainst[] {
  return ranAgainstEntries(row).map((entry) => {
    const name = facts.names.get(entry.workflowId) ?? null
    const live = facts.active.get(entry.workflowId)
    const deploymentId = entry.deploymentVersionId
    return {
      workflowId: entry.workflowId,
      name,
      version: deploymentId === null ? null : (facts.versions.get(deploymentId) ?? null),
      draft: deploymentId === null,
      liveVersion: live?.version ?? null,
      stale: name === null || (deploymentId !== null && live?.id !== deploymentId),
      executionId: entry.executionId,
    }
  })
}

function runStatus(row: Omit<WorkflowTestRunRow, 'report'>): WorkflowTestRunSummary['status'] {
  if (row.status !== 'running') return row.status as WorkflowTestRunSummary['status']
  return Date.now() - row.startedAt.getTime() > ABANDONED_RUN_MS ? 'error' : 'running'
}

function presentRun(
  row: RunRow,
  testSourceHash: string,
  facts: DeploymentFacts
): WorkflowTestRunSummary {
  const status = runStatus(row)
  const sourceChanged = row.sourceHash !== testSourceHash
  const ranAgainst = presentRanAgainst(row, facts)
  return {
    id: row.id,
    status,
    passed: row.passed,
    failed: row.failed,
    skipped: row.skipped,
    error:
      status === 'error' && row.status === 'running' ? 'The run stopped responding' : row.error,
    triggeredByUserId: row.triggeredByUserId,
    version: row.version as WorkflowTestVersion,
    sourceChanged,
    ranAgainst,
    current: !sourceChanged && !ranAgainst.some((workflow) => workflow.stale),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

function testStatus(latest: WorkflowTestRunSummary | undefined): WorkflowTestStatus {
  if (!latest) return 'not_run'
  if (latest.status !== 'running' && !latest.current) return 'changed'
  if (latest.status === 'passed') return 'passing'
  if (latest.status === 'failed') return 'failing'
  return latest.status
}

function presentTest(row: WorkflowTestRow, runs: WorkflowTestRunSummary[]) {
  const cases = row.cases as WorkflowTestCases
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    path: testFilePath(row.name),
    fileId: row.bodyFileId,
    caseCount: cases.length,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    status: testStatus(runs[0]),
    recentRuns: runs,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const listWorkflowTests = defineAuthorizedWorkspaceUseCase({
  operation: workflowTestOperations.read,
  resolveContext: ({ input }: { input: { workspaceId: string; version?: WorkflowTestVersion } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ context }) => requireWorkflowTestsEnabled(context.workspaceOrganizationId),
  async execute({ input, context }) {
    const rows = await listLiveWorkflowTests(context.workspaceId)
    const runs = await listRecentWorkflowTestRuns(
      rows.map((row) => row.id),
      input.version ?? null,
      RECENT_RUNS_PER_TEST
    )
    const facts = await loadDeploymentFacts(runs)
    const sourceHashByTest = new Map(rows.map((row) => [row.id, row.sourceHash]))
    const runsByTest = new Map<string, WorkflowTestRunSummary[]>()
    for (const run of runs) {
      const sourceHash = sourceHashByTest.get(run.testId)
      if (sourceHash === undefined) throw new Error(`Run ${run.id} belongs to no listed test`)
      const list = runsByTest.get(run.testId) ?? []
      list.push(presentRun(run, sourceHash, facts))
      runsByTest.set(run.testId, list)
    }
    return { tests: rows.map((row) => presentTest(row, runsByTest.get(row.id) ?? [])) }
  },
})

interface WorkflowTestInput {
  workspaceId: string
  name: string
}

async function resolveTestContext({ input }: { input: WorkflowTestInput }) {
  const context = await resolveActiveWorkspaceApplicationContext(input.workspaceId)
  const test = await getLiveWorkflowTestByName(context.workspaceId, input.name)
  if (!test) throw new OrchestrationError('not_found', `No test file ${testFilePath(input.name)}`)
  return { ...context, test }
}

export const getWorkflowTestDetail = defineAuthorizedWorkspaceUseCase({
  operation: workflowTestOperations.read,
  resolveContext: ({ input }: { input: WorkflowTestInput & { version?: WorkflowTestVersion } }) =>
    resolveTestContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => requireWorkflowTestsEnabled(context.workspaceOrganizationId),
  async execute({ input, context }) {
    const [latest, recent] = await Promise.all([
      getLatestWorkflowTestRun(context.test.id, input.version ?? null),
      listRecentWorkflowTestRuns([context.test.id], input.version ?? null, 20),
    ])
    const facts = await loadDeploymentFacts(latest ? [latest, ...recent] : recent)
    const history = recent.map((run) => presentRun(run, context.test.sourceHash, facts))
    return {
      test: {
        ...presentTest(context.test, history.slice(0, RECENT_RUNS_PER_TEST)),
        cases: context.test.cases as WorkflowTestCases,
      },
      latestRun: latest ? presentRunDetail(latest, context.test.sourceHash, facts) : null,
      history,
    }
  },
})

function presentRunDetail(row: WorkflowTestRunRow, testSourceHash: string, facts: DeploymentFacts) {
  return {
    ...presentRun(row, testSourceHash, facts),
    report: row.report as TestReport | null,
    progress: row.progress as Record<string, TestCaseStatus> | null,
  }
}

/** One run of a test with its report, for reading an earlier run's results. */
export const getWorkflowTestRunDetail = defineAuthorizedWorkspaceUseCase({
  operation: workflowTestOperations.read,
  resolveContext: ({ input }: { input: WorkflowTestInput & { runId: string } }) =>
    resolveTestContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => requireWorkflowTestsEnabled(context.workspaceOrganizationId),
  async execute({ input, context }) {
    const run = await getWorkflowTestRunById(context.test.id, input.runId)
    if (!run) throw new OrchestrationError('not_found', 'That run was not found')
    const facts = await loadDeploymentFacts([run])
    return { run: presentRunDetail(run, context.test.sourceHash, facts) }
  },
})

const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 2000

function cleanTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed || trimmed.length > MAX_TITLE_LENGTH) {
    throw new OrchestrationError(
      'validation',
      `A test title is 1 to ${MAX_TITLE_LENGTH} characters: the concern the file tests`
    )
  }
  return trimmed
}

function cleanDescription(description: string | null | undefined): string | null {
  const trimmed = description?.trim() ?? ''
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new OrchestrationError(
      'validation',
      `A test description is at most ${MAX_DESCRIPTION_LENGTH} characters`
    )
  }
  return trimmed || null
}

export interface CreateWorkflowTestInput {
  workspaceId: string
  name: string
  title: string
  description?: string
}

/**
 * Creates a test: its metadata, and `tests/<name>.test.js` holding an empty describe. The
 * cases are written into that file afterwards with the file tools, and every write is checked.
 */
export const createWorkflowTest = defineAuthorizedWorkspaceUseCase({
  operation: workflowTestOperations.create,
  resolveContext: ({ input }: { input: CreateWorkflowTestInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ context }) => requireWorkflowTestsEnabled(context.workspaceOrganizationId),
  async execute({ principal, input, context }) {
    assertTestName(input.name)
    const title = cleanTitle(input.title)
    const description = cleanDescription(input.description)
    const path = testFilePath(input.name)
    if (await getLiveWorkflowTestByName(context.workspaceId, input.name)) {
      throw new OrchestrationError('conflict', `${path} already exists`)
    }
    const userId = requirePrincipalSubjectUserId(principal)
    const source = starterTestSource(title)
    try {
      const { owner } = await createOwnedWorkspaceFile({
        context: 'test',
        workspaceId: context.workspaceId,
        userId,
        content: source,
        contentType: 'text/javascript',
        fileName: () => `${input.name}.test.js`,
        insertOwner: (tx, bodyFileId) =>
          insertWorkflowTestInTx(tx, {
            id: generateId(),
            workspaceId: context.workspaceId,
            name: input.name,
            title,
            description,
            bodyFileId,
            cases: [],
            sourceHash: testSourceHash(source),
            createdByUserId: userId,
          }),
      })
      return { test: presentTest(owner, []) }
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') {
        throw new OrchestrationError('conflict', `${path} already exists`)
      }
      throw error
    }
  },
})

export interface UpdateWorkflowTestInput extends WorkflowTestInput {
  title?: string
  description?: string | null
}

/** Changes a test's metadata; its cases change by editing the file. */
export const updateWorkflowTest = defineAuthorizedWorkspaceUseCase({
  operation: workflowTestOperations.update,
  resolveContext: ({ input }: { input: UpdateWorkflowTestInput }) => resolveTestContext({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => requireWorkflowTestsEnabled(context.workspaceOrganizationId),
  async execute({ input, context }) {
    if (input.title === undefined && input.description === undefined) {
      throw new OrchestrationError('validation', 'Pass a title or a description to change')
    }
    const row = await updateWorkflowTestMetadata(context.test.id, {
      ...(input.title !== undefined ? { title: cleanTitle(input.title) } : {}),
      ...(input.description !== undefined
        ? { description: cleanDescription(input.description) }
        : {}),
    })
    return { test: presentTest(row, []) }
  },
})

export const deleteWorkflowTest = defineAuthorizedWorkspaceUseCase({
  operation: workflowTestOperations.delete,
  resolveContext: resolveTestContext,
  authorizationOptions,
  authorizeResource: ({ context }) => requireWorkflowTestsEnabled(context.workspaceOrganizationId),
  async execute({ context }) {
    await softDeleteWorkflowTest(context.test.id)
    return { deleted: true }
  },
})

/** Runs by id with their reports, for a caller waiting on runs it started. */
export const readWorkflowTestRuns = defineAuthorizedWorkspaceUseCase({
  operation: workflowTestOperations.read,
  resolveContext: ({ input }: { input: { workspaceId: string; runIds: string[] } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ context }) => requireWorkflowTestsEnabled(context.workspaceOrganizationId),
  async execute({ input, context }) {
    const rows = await listWorkflowTestRunsById(input.runIds, context.workspaceId)
    const facts = await loadDeploymentFacts(rows)
    return {
      runs: rows.map((row) => ({
        ...presentRun(row, row.testSourceHash, facts),
        name: row.testName,
        report: row.report as TestReport | null,
      })),
    }
  },
})
