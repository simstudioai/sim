import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  loadActiveWorkspaceFileContext,
  loadWorkspaceFileLifecycleContext,
  type WorkspaceFileLifecycleContext,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

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

export async function resolveActiveWorkspaceFileContext(
  input: WorkspaceFileContextInput
): Promise<ActiveWorkspaceFileContext> {
  const canonical = await loadActiveWorkspaceFileContext(input.fileId, {
    includeDeleted: input.includeDeleted,
    includeChatUploads: input.includeChatUploads,
  })
  if (
    !canonical ||
    (input.assertedWorkspaceId !== undefined && input.assertedWorkspaceId !== canonical.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  return canonical
}

export async function resolveWorkspaceFileLifecycleContext(
  input: WorkspaceFileContextInput
): Promise<WorkspaceFileLifecycleContext> {
  const canonical = await loadWorkspaceFileLifecycleContext(input.fileId)
  if (
    !canonical ||
    (input.assertedWorkspaceId !== undefined && input.assertedWorkspaceId !== canonical.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  return canonical
}
