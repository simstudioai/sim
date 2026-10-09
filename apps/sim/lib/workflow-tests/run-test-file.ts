import type { Principal } from '@sim/auth/principal'
import { generateShortId } from '@sim/utils/id'
import { runSandboxTask } from '@/lib/execution/sandbox/run-task'
import {
  type TestCaseStatus,
  type TestReport,
  testReportSchema,
} from '@/lib/workflow-tests/protocol'
import { WorkflowTestSession } from '@/lib/workflow-tests/session'
import {
  closeWorkflowTestSession,
  openWorkflowTestSession,
} from '@/lib/workflow-tests/session-registry'
import type { WorkflowTestVersion } from '@/lib/workflows/application/run-workflow-for-test'

export interface RunWorkflowTestFileInput {
  principal: Principal
  workspaceId: string
  /** The test file's source and its path, which stack traces and check lines refer to. */
  source: string
  filePath: string
  version: WorkflowTestVersion
  /** Full test names (`describe > it`) to run; null runs the whole file. */
  only: string[] | null
  onProgress: (path: string[], status: TestCaseStatus) => Promise<void>
  signal?: AbortSignal
}

/**
 * Runs one test file in the sandbox. Each `runWorkflow()` it makes becomes a real workflow
 * run whose mocked blocks are answered by the file's own mocks.
 */
export async function runWorkflowTestFile(
  input: RunWorkflowTestFileInput
): Promise<{ report: TestReport; enteredWorkflowIds: string[] }> {
  const requestId = generateShortId(12)
  const session = new WorkflowTestSession({
    workspaceId: input.workspaceId,
    principal: input.principal,
    version: input.version,
    only: input.only,
    onProgress: input.onProgress,
  })
  openWorkflowTestSession(requestId, session)
  try {
    const bytes = await runSandboxTask(
      'workflow-test-run',
      { workspaceId: input.workspaceId, code: input.source, codeFilename: input.filePath },
      { requestId, ownerKey: `workspace:${input.workspaceId}`, signal: input.signal }
    )
    return {
      report: testReportSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf-8'))),
      enteredWorkflowIds: [...session.enteredWorkflowIds],
    }
  } finally {
    closeWorkflowTestSession(requestId)
  }
}
