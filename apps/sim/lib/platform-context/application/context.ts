import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceApplicationContext,
  loadActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

/** Loads canonical active workspace state before authorizing a live platform-context read. */
export async function resolvePlatformContextWorkspace(
  workspaceId: string
): Promise<ActiveWorkspaceApplicationContext> {
  const context = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}
