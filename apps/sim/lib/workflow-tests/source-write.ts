import { isUtf8 } from 'node:buffer'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readWorkflowTestCases, testSourceHash } from '@/lib/workflow-tests/definition'
import {
  getLiveWorkflowTestByBodyFileId,
  updateWorkflowTestCases,
} from '@/lib/workflow-tests/repository'

/** Test files are source code; anything larger is not a test file. */
export const MAX_TEST_SOURCE_BYTES = 512 * 1024

function decodeTestSource(content: Buffer): string {
  if (content.length > MAX_TEST_SOURCE_BYTES) {
    throw new OrchestrationError(
      'payload_too_large',
      `A test file can be at most ${MAX_TEST_SOURCE_BYTES / 1024}KB`
    )
  }
  if (!isUtf8(content)) throw new OrchestrationError('validation', 'A test file must be UTF-8 text')
  return content.toString('utf-8')
}

/** Validates new source for an existing test file; the returned step records its cases. */
export async function prepareWorkflowTestSourceWrite(input: {
  fileId: string
  workspaceId: string
  content: Buffer
}): Promise<() => Promise<void>> {
  const test = await getLiveWorkflowTestByBodyFileId(input.fileId)
  if (!test) throw new OrchestrationError('not_found', 'File not found')
  const source = decodeTestSource(input.content)
  const cases = await readWorkflowTestCases({
    workspaceId: input.workspaceId,
    name: test.name,
    source,
  })
  return () => updateWorkflowTestCases(test.id, cases, testSourceHash(source))
}
