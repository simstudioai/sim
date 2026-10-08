import type { ActiveWorkspaceFileContext } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

/**
 * Checks content headed for a file another resource owns before it is stored, and returns
 * what to run once it is. A test file's source must load and declare one concern, and its
 * test then records the new title and cases; every other file passes unchanged.
 */
export async function prepareOwnedFileContentWrite(
  context: Pick<ActiveWorkspaceFileContext, 'fileId' | 'workspaceId' | 'fileContext'>,
  content: Buffer
): Promise<() => Promise<void>> {
  if (context.fileContext !== 'test') return async () => {}
  const { prepareWorkflowTestSourceWrite } = await import('@/lib/workflow-tests/source-write')
  return prepareWorkflowTestSourceWrite({
    fileId: context.fileId,
    workspaceId: context.workspaceId,
    content,
  })
}
