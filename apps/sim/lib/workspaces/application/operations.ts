import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const PUBLIC_API_PRINCIPAL_KINDS = [
  'personal_api_key',
  'oauth_access_token',
  'workspace_api_key',
] as const

export const workspaceOperations = {
  // permission-group-exempt: the public API's own view of the workspaces a key can reach; it answers what that credential already proves, and `disablePublicApi` governs whether the key reaches the surface at all
  listPublic: defineWorkspaceOperation({
    id: 'workspaces.list_public',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    principalKinds: PUBLIC_API_PRINCIPAL_KINDS,
  }),
  // permission-group-exempt: the same surface as the list, describing one workspace the key already reaches
  readPublicDetail: defineWorkspaceOperation({
    id: 'workspaces.read_public_detail',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    contentDelivery: 'none',
    principalKinds: [...PUBLIC_API_PRINCIPAL_KINDS, 'delegated'],
    delegatedServices: ['copilot'],
  }),
  // permission-group-exempt: names of people the caller already shares a workspace with; `hideOrgMemberDirectory` covers the organization-wide roster and its email addresses, which is the materially different disclosure
  listPublicMembers: defineWorkspaceOperation({
    id: 'workspaces.members.list_public',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'none',
    contentDelivery: 'none',
    principalKinds: [...PUBLIC_API_PRINCIPAL_KINDS, 'delegated'],
    delegatedServices: ['copilot'],
  }),
} as const

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

export const workspaceMemberOperations = {
  /** permission-group-exempt: members may leave; workspace administrators may remove existing collaborators. */
  remove: defineWorkspaceOperation({
    id: 'workspaces.members.remove',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    contentDelivery: 'none',
    oauthScope: 'api:write',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
    delegatedServices: ['copilot'],
  }),
} as const
