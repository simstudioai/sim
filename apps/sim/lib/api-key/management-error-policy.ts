import { internalErrorResponse, internalOrchestrationErrorPolicy } from '@/lib/api/server/routes'
import { WorkspaceApiKeyWorkspaceNotFoundError } from '@/lib/api-key/application/workspace-api-keys'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application/workspace-authorization'

/** Retains existing workspace-key access error status and messages. */
export function workspaceApiKeyErrorPolicy(mode: 'read' | 'write') {
  return {
    project(error: unknown) {
      if (mode === 'write' && error instanceof WorkspaceApiKeyWorkspaceNotFoundError) {
        return internalErrorResponse(403, { error: 'Forbidden' })
      }
      if (
        error instanceof NoWorkspaceAccessError ||
        error instanceof InsufficientWorkspacePermissionsError
      ) {
        return internalErrorResponse(mode === 'read' ? 401 : 403, {
          error: mode === 'read' ? 'Unauthorized' : 'Forbidden',
        })
      }
      return internalOrchestrationErrorPolicy.project(error)
    },
    unhandled: () => internalErrorResponse(500, { error: 'Failed to manage workspace API key' }),
  }
}
