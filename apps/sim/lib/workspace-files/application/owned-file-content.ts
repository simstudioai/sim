import type { DbOrTx } from '@/lib/db/types'
import type { ActiveWorkspaceFileContext } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

/**
 * Checks content headed for a file another resource owns before it is stored, and returns
 * the step the file write runs in its transaction. A test file's source must load and declare
 * one concern, and its test then records the new cases with the bytes; every other file has
 * no step.
 */
export async function prepareOwnedFileContentWrite(
  context: Pick<ActiveWorkspaceFileContext, 'fileId' | 'workspaceId' | 'fileContext'>,
  content: Buffer
): Promise<((tx: DbOrTx) => Promise<void>) | undefined> {
  if (context.fileContext !== 'test') return undefined
  const { prepareWorkflowTestSourceWrite } = await import('@/lib/workflow-tests/source-write')
  return prepareWorkflowTestSourceWrite({
    fileId: context.fileId,
    workspaceId: context.workspaceId,
    content,
  })
}
