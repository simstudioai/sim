import { runSandboxTask } from '@/lib/execution/sandbox/run-task'
import { type TestCollection, testCollectionSchema } from '@/lib/workflow-tests/protocol'

/** Evaluates a test file without running it: its top-level blocks and every test name. */
export async function collectWorkflowTestFile(input: {
  workspaceId: string
  source: string
  filePath: string
}): Promise<TestCollection> {
  const bytes = await runSandboxTask(
    'workflow-test-collect',
    { workspaceId: input.workspaceId, code: input.source, codeFilename: input.filePath },
    { ownerKey: `workspace:${input.workspaceId}` }
  )
  return testCollectionSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf-8')))
}
