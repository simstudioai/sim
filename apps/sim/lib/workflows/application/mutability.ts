import {
  assertFolderMutable,
  assertWorkflowMutable,
  FolderLockedError,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'

/** Refuses a mutation against a locked workflow as the `423` every surface renders. */
export async function requireMutableWorkflow(workflowId: string): Promise<void> {
  try {
    await assertWorkflowMutable(workflowId)
  } catch (error) {
    if (error instanceof WorkflowLockedError) {
      throw new OrchestrationError('locked', error.message)
    }
    throw error
  }
}

/**
 * Refuses a mutation inside a locked folder (or one under a locked folder) as the same `423`,
 * read through `tx` when given. `message` replaces the lock error's own text.
 */
export async function requireMutableFolder(
  folderId: string | null,
  tx?: DbOrTx,
  message?: string
): Promise<void> {
  try {
    await assertFolderMutable(folderId, tx)
  } catch (error) {
    if (error instanceof FolderLockedError) {
      throw new OrchestrationError('locked', message ?? error.message)
    }
    throw error
  }
}
