import { sleep } from '@sim/utils/helpers'
import { mothershipTestsInputSchema } from '@/lib/api/contracts/mothership-tests'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { executeWorkflowTestUseCase } from '@/lib/mothership/application/execute-workflow-test-use-case'
import { requireTrustedCopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/mothership/tools/server/base-tool'
import { startWorkflowTestRuns } from '@/lib/workflow-tests/application/run-tests'
import {
  createWorkflowTest,
  deleteWorkflowTest,
  getWorkflowTestDetail,
  listWorkflowTests,
  readWorkflowTestRuns,
  updateWorkflowTest,
} from '@/lib/workflow-tests/application/tests'
import type { TestReport } from '@/lib/workflow-tests/protocol'

const RUN_POLL_MS = 2_000

function workspaceFor(input: { workspaceId?: string }, context?: ServerToolContext): string {
  const trusted = requireTrustedCopilotExecutionContext(context)
  if (input.workspaceId && input.workspaceId !== trusted.workspaceId)
    throw new OrchestrationError('not_found', 'Workspace not found in this invocation')
  assertServerToolNotAborted(context)
  return trusted.workspaceId
}

/** Each failing case once: where it failed and why, in vitest's own words or the judge's. */
function failures(report: TestReport | null) {
  if (!report) return []
  return report.tests
    .filter((test) => test.status === 'fail')
    .map((test) => {
      const check = test.checks.find((candidate) => candidate.status === 'fail')
      return {
        test: test.path.join(' > '),
        line: check?.line ?? test.error?.line,
        message: check?.judge ?? check?.message ?? test.error?.message ?? 'Failed',
        executions: test.executions.map((execution) => execution.executionId),
      }
    })
}

export const testsServerTool: BaseServerTool = {
  name: 'tests',
  inputSchema: mothershipTestsInputSchema,
  async execute(raw, context) {
    const input = mothershipTestsInputSchema.parse(raw)
    const workspaceId = workspaceFor(input, context)
    switch (input.action) {
      case 'create': {
        const { test } = await executeWorkflowTestUseCase(context, createWorkflowTest, {
          workspaceId,
          name: input.name,
          title: input.title,
          description: input.description,
        })
        const resources: ResourceChange[] = [
          {
            op: 'upsert',
            resource: { type: 'test', workspaceId, id: test.name, title: test.title },
          },
        ]
        return { test: { name: test.name, title: test.title }, document: test.path, resources }
      }
      case 'update': {
        const { test } = await executeWorkflowTestUseCase(context, updateWorkflowTest, {
          workspaceId,
          name: input.name,
          title: input.title,
          description: input.description,
        })
        return { test: { name: test.name, title: test.title, description: test.description } }
      }
      case 'list': {
        const { tests } = await executeWorkflowTestUseCase(context, listWorkflowTests, {
          workspaceId,
          version: input.version,
        })
        return {
          tests: tests.map((test) => ({
            name: test.name,
            title: test.title,
            document: test.path,
            cases: test.caseCount,
            status: test.status,
          })),
        }
      }
      case 'get': {
        const detail = await executeWorkflowTestUseCase(context, getWorkflowTestDetail, {
          workspaceId,
          name: input.name,
          version: input.version,
        })
        return {
          test: {
            name: detail.test.name,
            title: detail.test.title,
            description: detail.test.description,
            document: detail.test.path,
            status: detail.test.status,
            cases: detail.test.cases.map((testCase) => testCase.path.join(' > ')),
          },
          latestRun: detail.latestRun
            ? {
                status: detail.latestRun.status,
                upToDate: detail.latestRun.current,
                ranAgainst: detail.latestRun.ranAgainst.map((workflow) => ({
                  workflow: workflow.name,
                  version: workflow.draft ? 'draft' : workflow.version,
                  redeployedSince: workflow.stale,
                })),
                passed: detail.latestRun.passed,
                failed: detail.latestRun.failed,
                error: detail.latestRun.error,
                failures: failures(detail.latestRun.report),
              }
            : null,
        }
      }
      case 'run': {
        const { runs } = await executeWorkflowTestUseCase(context, startWorkflowTestRuns, {
          workspaceId,
          version: input.version,
          names: input.names,
          only: input.only,
        })
        const runIds = runs.map((run) => run.runId)
        for (;;) {
          assertServerToolNotAborted(context)
          const { runs: current } = await executeWorkflowTestUseCase(
            context,
            readWorkflowTestRuns,
            {
              workspaceId,
              runIds,
            }
          )
          if (current.every((run) => run.status !== 'running')) {
            return {
              version: input.version,
              results: current.map((run) => ({
                name: run.name,
                status: run.status,
                passed: run.passed,
                failed: run.failed,
                skipped: run.skipped,
                ...(run.error ? { error: run.error } : {}),
                failures: failures(run.report),
              })),
            }
          }
          await sleep(RUN_POLL_MS)
        }
      }
      case 'delete': {
        await executeWorkflowTestUseCase(context, deleteWorkflowTest, {
          workspaceId,
          name: input.name,
        })
        return { deleted: input.name }
      }
    }
  },
}
