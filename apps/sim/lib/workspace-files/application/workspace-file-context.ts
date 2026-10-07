import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  loadActiveWorkspaceFileContext,
  loadWorkspaceFileLifecycleContext,
  type WorkspaceFileLifecycleContext,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { matchesFileOwner } from '@/lib/workspace-files/ownership'

export interface WorkspaceFileContextInput {
  fileId: string
  assertedWorkspaceId?: string
  includeDeleted?: boolean
  /**
   * Admit a chat upload (`context = 'mothership'`) addressed by its own id. Only read
   * use cases set this: chat uploads stay out of listings and closed to writes.
   */
  includeChatUploads?: boolean
}

function requireWorkspaceFileContext<C extends ActiveWorkspaceFileContext>(
  canonical: C | null,
  assertedWorkspaceId: string | undefined
): C {
  if (
    !canonical ||
    (assertedWorkspaceId !== undefined &&
      !matchesFileOwner(
        { entityType: 'workspace', entityId: canonical.workspaceId },
        { entityType: 'workspace', entityId: assertedWorkspaceId }
      ))
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  return canonical
}

export async function resolveActiveWorkspaceFileContext(
  input: WorkspaceFileContextInput
): Promise<ActiveWorkspaceFileContext> {
  return requireWorkspaceFileContext(
    await loadActiveWorkspaceFileContext(input.fileId, {
      includeDeleted: input.includeDeleted,
      includeChatUploads: input.includeChatUploads,
    }),
    input.assertedWorkspaceId
  )
}

export async function resolveWorkspaceFileLifecycleContext(
  input: WorkspaceFileContextInput
): Promise<WorkspaceFileLifecycleContext> {
  return requireWorkspaceFileContext(
    await loadWorkspaceFileLifecycleContext(input.fileId),
    input.assertedWorkspaceId
  )
}
