import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const workspacePolicy = {
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'delegated'],
  delegatedServices: ['copilot'],
  /** permission-group-exempt: restoring and listing a user's own chats preserves workspace access policy. */
  capability: 'none',
} as const

export const mothershipChatOperations = {
  // permission-group-exempt: restoring and listing a user's own chats preserves workspace access policy.
  listWorkspace: defineWorkspaceOperation({
    id: 'mothership.chats.list',
    ...workspacePolicy,
    capability: 'none',
  }),
  restore: Object.freeze({
    // permission-group-exempt: restoring and listing a user's own chats preserves workspace access policy.
    ...defineWorkspaceOperation({
      id: 'mothership.chats.restore',
      ...workspacePolicy,
      capability: 'none',
    }),
    // permission-group-exempt: restoring and listing a user's own chats preserves workspace access policy.
    organizationOperation: defineOrganizationOperation({
      id: 'mothership.chats.restore',
      minimumRole: 'member',
      principalKinds: ['session', 'organization_delegated'],
      delegationAudience: 'sim:settings',
      delegatedServices: ['copilot'],
      capability: 'copilot.use',
    }),
  }),
} as const
