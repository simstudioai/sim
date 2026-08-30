import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/**
 * Chat is a user-actor surface: the run is attributed to a person, reads their
 * personal environment, and writes their memories. A workspace key names no
 * acting user, so it cannot express the caller and is denied rather than
 * silently substituting the key's owner.
 */
export const chatOperations = {
  send: defineWorkspaceOperation({
    id: 'chat.send',
    oauthScope: 'api:write',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    principalKinds: ['personal_api_key', 'oauth_access_token'],
  }),
} as const
