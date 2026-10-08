import {
  type Principal,
  resolvePrincipalSubjectUserId,
  toPrincipalActor,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { workflowTestOperations } from '@/lib/workflow-tests/application/operations'
import { testSourceHash } from '@/lib/workflow-tests/definition'
import { requireWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'
import { testFilePath } from '@/lib/workflow-tests/paths'
import {
  completeWorkflowTestRun,
  failWorkflowTestRun,
  insertWorkflowTestRun,
  listLiveWorkflowTests,
  readExecutedDeployments,
  recordWorkflowTestProgress,
  type WorkflowTestRow,
} from '@/lib/workflow-tests/repository'
import { runWorkflowTestFile } from '@/lib/workflow-tests/run-test-file'
import { MAX_TEST_SOURCE_BYTES } from '@/lib/workflow-tests/source-write'
import type { WorkflowTestVersion } from '@/lib/workflows/application/run-workflow-for-test'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('WorkflowTestRuns')

const authorizationOptions = {
  delegation: { audience: 'sim:workspaces', isWithinScope: () => true },
} as const

async function executeTestRun(params: {
  runId: string
  test: WorkflowTestRow
  principal: Principal
  version: WorkflowTestVersion
  only: string[] | null
}): Promise<void> {
  const { runId, test, principal, version } = params
  let sourceHash: string | null = null
  try {
    const file = await getWorkspaceFile(test.workspaceId, test.bodyFileId, {
      includeTestFiles: true,
    })
    if (!file) throw new Error(`${testFilePath(test.name)} has no source file`)
    const buffer = await fetchWorkspaceFileBuffer(file, { maxBytes: MAX_TEST_SOURCE_BYTES })
    const source = buffer.toString('utf-8')
    sourceHash = testSourceHash(source)
    const report = await runWorkflowTestFile({
      principal,
      workspaceId: test.workspaceId,
      source,
      filePath: testFilePath(test.name),
      version,
      only: params.only,
      onProgress: (path, status) => recordWorkflowTestProgress(runId, path.join(' > '), status),
    })
    const executionIds = report.tests.flatMap((result) =>
      result.executions.map((execution) => execution.executionId)
    )
    const ranAgainst = await readExecutedDeployments(executionIds, test.workspaceId)
    await completeWorkflowTestRun(runId, report, sourceHash, ranAgainst)
  } catch (error) {
    logger.warn('Workflow test run failed', {
      runId,
      testId: test.id,
      error: getErrorMessage(error),
    })
    await failWorkflowTestRun(runId, getErrorMessage(error), sourceHash)
  }
}

export interface RunWorkflowTestsInput {
  workspaceId: string
  version: WorkflowTestVersion
  /** Test file names to run; omitted runs every test file in the workspace. */
  names?: string[]
  /** With exactly one name: the `describe > it` paths to run inside it. */
  only?: string[]
}

/**
 * Starts one run per test file and returns their ids at once; the runs finish in this
 * process and record their reports on `workflow_test_run`. Files run one after another so
 * a large suite does not occupy every sandbox slot.
 */
export const startWorkflowTestRuns = defineAuthorizedWorkspaceUseCase({
  operation: workflowTestOperations.run,
  resolveContext: ({ input }: { input: RunWorkflowTestsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ context }) => requireWorkflowTestsEnabled(context.workspaceOrganizationId),
  async execute({ principal, input, context }) {
    if (input.only && input.names?.length !== 1) {
      throw new OrchestrationError('validation', 'only needs exactly one test file name')
    }
    const all = await listLiveWorkflowTests(context.workspaceId)
    const tests = input.names
      ? input.names.map((name) => {
          const test = all.find((row) => row.name === name)
          if (!test) throw new OrchestrationError('not_found', `No test file ${testFilePath(name)}`)
          return test
        })
      : all
    if (tests.length === 0) throw new OrchestrationError('validation', 'There are no tests to run')

    const actor = toPrincipalActor(principal)
    const runs = tests.map((test) => ({ runId: generateId(), test }))
    for (const { runId, test } of runs) {
      await insertWorkflowTestRun({
        id: runId,
        testId: test.id,
        workspaceId: context.workspaceId,
        version: input.version,
        triggeredByActor: actor,
        triggeredByUserId: resolvePrincipalSubjectUserId(principal) ?? null,
      })
    }
    void (async () => {
      for (const { runId, test } of runs) {
        await executeTestRun({
          runId,
          test,
          principal,
          version: input.version,
          only: input.only ?? null,
        })
      }
    })()
    return { runs: runs.map(({ runId, test }) => ({ runId, name: test.name })) }
  },
})
