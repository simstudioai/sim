import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const policy = {
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot'],
} as const

/** Release bodies are workspace files, so the changelog keeps their access policy, like tests. */
export const changelogOperations = {
  read: defineWorkspaceOperation({
    ...policy,
    oauthScope: 'api:read',
    capability: 'files.use',
    contentDelivery: 'none',
    id: 'changelog.read',
    minimumRole: 'read',
  }),
  publish: defineWorkspaceOperation({
    ...policy,
    oauthScope: 'api:write',
    capability: 'files.use',
    contentDelivery: 'none',
    id: 'changelog.publish',
    minimumRole: 'write',
  }),
  update: defineWorkspaceOperation({
    ...policy,
    oauthScope: 'api:write',
    capability: 'files.use',
    contentDelivery: 'none',
    id: 'changelog.update',
    minimumRole: 'write',
  }),
} as const
