import type { DbOrTx } from '@/lib/db/types'
import type { ActiveWorkspaceFileContext } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { ownedFileKind } from '@/lib/workspace-files/owned-files'

/**
 * Checks content headed for a file another resource owns before it is stored, and returns
 * the step the file write runs in its transaction. Each owner checks its own files (a test
 * file's source must load and declare one concern, and its test records the new cases with the
 * bytes); every other file has no step.
 */
export async function prepareOwnedFileContentWrite(
  context: Pick<ActiveWorkspaceFileContext, 'fileId' | 'workspaceId' | 'fileContext'>,
  content: Buffer
): Promise<((tx: DbOrTx) => Promise<void>) | undefined> {
  const kind = ownedFileKind(context.fileContext)
  if (!kind) return undefined
  return kind.prepareWrite({ fileId: context.fileId, workspaceId: context.workspaceId, content })
}
