import { sha256Hex } from '@sim/security/hash'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { SandboxUserCodeError } from '@/lib/execution/sandbox/run-task'
import { collectWorkflowTestFile } from '@/lib/workflow-tests/collect'
import { testFilePath } from '@/lib/workflow-tests/paths'
import type { WorkflowTestCases } from '@/lib/workflow-tests/repository'

/**
 * Evaluates a test file's source and returns the cases it declares. A file is one concern:
 * exactly one top-level `describe`, holding every test. Anything else is refused with a message
 * the writer can act on, so an invalid file is never saved.
 */
export async function readWorkflowTestCases(input: {
  workspaceId: string
  name: string
  source: string
}): Promise<WorkflowTestCases> {
  const filePath = testFilePath(input.name)
  let collection: Awaited<ReturnType<typeof collectWorkflowTestFile>>
  try {
    collection = await collectWorkflowTestFile({
      workspaceId: input.workspaceId,
      source: input.source,
      filePath,
    })
  } catch (error) {
    if (error instanceof SandboxUserCodeError) {
      throw new OrchestrationError('validation', `${filePath} does not load: ${error.message}`)
    }
    throw error
  }

  const [top, ...rest] = collection.topLevel
  if (!top || top.kind !== 'suite' || rest.length > 0) {
    throw new OrchestrationError(
      'validation',
      `${filePath} must contain exactly one top-level describe(...) with every test inside it`
    )
  }
  const seen = new Set<string>()
  for (const testCase of collection.tests) {
    const key = testCase.path.join(' > ')
    if (seen.has(key)) {
      throw new OrchestrationError(
        'validation',
        `${filePath} has two tests named "${key}"; give each test its own name`
      )
    }
    seen.add(key)
  }
  return collection.tests
}

/** Identifies the exact source a test's cases and runs were read from. */
export function testSourceHash(source: string): string {
  return sha256Hex(source)
}

/** The source `tests create` starts a test file with: one empty describe, ready for cases. */
export function starterTestSource(title: string): string {
  return [
    "import { describe, expect, it } from 'vitest'",
    "import { mockBlock, runWorkflow, spyOnBlock } from 'sim:test'",
    '',
    `describe(${JSON.stringify(title)}, () => {})`,
    '',
  ].join('\n')
}
