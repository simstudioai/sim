import { internalErrorResponse, internalOrchestrationErrorPolicy } from '@/lib/api/server/routes'
import { WorkspaceByokWorkspaceNotFoundError } from '@/lib/api-key/application/workspace-byok-keys'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application/workspace-authorization'

/** Preserves the workspace BYOK settings access refusals. */
export function workspaceByokErrorPolicy(mode: 'read' | 'write') {
  return {
    project(error: unknown) {
      if (
        error instanceof NoWorkspaceAccessError ||
        error instanceof InsufficientWorkspacePermissionsError ||
        (mode === 'write' && error instanceof WorkspaceByokWorkspaceNotFoundError)
      ) {
        return internalErrorResponse(mode === 'read' ? 401 : 403, {
          error: mode === 'read' ? 'Unauthorized' : 'Only workspace admins can manage BYOK keys',
        })
      }
      return internalOrchestrationErrorPolicy.project(error)
    },
    unhandled: () =>
      internalErrorResponse(500, {
        error: mode === 'read' ? 'Failed to load BYOK keys' : 'Failed to delete BYOK keys',
      }),
  }
}
