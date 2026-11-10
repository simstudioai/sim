import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/**
 * Workspace membership administration, kept free of the stores so route
 * declarations and the OpenAPI registry can name the operations without
 * loading their implementations.
 */
export const workspacePermissionOperations = {
  /** permission-group-exempt: the roster describes the workspace the caller belongs to. */
  read: defineWorkspaceOperation({
    id: 'workspaces.permissions.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
    capability: 'none',
    contentDelivery: 'none',
  }),
  /** permission-group-exempt: workspace administrators manage existing collaborator roles. */
  update: defineWorkspaceOperation({
    id: 'workspaces.permissions.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    oauthScope: 'api:write',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
    delegatedServices: ['copilot'],
    capability: 'none',
    contentDelivery: 'none',
  }),
} as const

/** permission-group-exempt: members may leave; workspace administrators may remove existing collaborators. */
export const removeWorkspaceMemberOperation = defineWorkspaceOperation({
  id: 'workspaces.members.remove',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'none',
  contentDelivery: 'none',
  oauthScope: 'api:write',
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot'],
})
