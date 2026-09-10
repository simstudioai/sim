import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const workspaceOperations = {
  /**
   * permission-group-exempt: operation reports describe changes in the caller's accessible workspace.
   */
  read: defineWorkspaceOperation({
    id: 'workspaces.operations.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
}
