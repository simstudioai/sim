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
}

export async function resolveActiveWorkspaceFileContext(
  input: WorkspaceFileContextInput
): Promise<ActiveWorkspaceFileContext> {
  const canonical = await loadActiveWorkspaceFileContext(input.fileId, {
    includeDeleted: input.includeDeleted,
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
