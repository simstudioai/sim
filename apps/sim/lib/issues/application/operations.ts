import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const policy = {
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'delegated'],
  delegatedServices: ['copilot'],
} as const

/**
 * Reading and filing issues is also open to the v2 API. Workspace keys are refused: a filed
 * issue's body is uploaded by, and attributed to, the acting user.
 */
const apiPolicy = {
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot'],
} as const

/** Issues keep the access policy of their file-backed body, like dashboards. */
export const issueOperations = {
  read: defineWorkspaceOperation({
    ...apiPolicy,
    oauthScope: 'api:read',
    capability: 'files.use',
    id: 'issues.read',
    minimumRole: 'read',
  }),
  create: defineWorkspaceOperation({
    ...apiPolicy,
    oauthScope: 'api:write',
    capability: 'files.use',
    id: 'issues.create',
    minimumRole: 'write',
  }),
  update: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'issues.update',
    minimumRole: 'write',
  }),
  start: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'issues.start',
    minimumRole: 'write',
  }),
  review: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'issues.review',
    minimumRole: 'write',
  }),
  close: defineWorkspaceOperation({
    ...policy,
    capability: 'files.use',
    id: 'issues.close',
    minimumRole: 'write',
  }),
} as const
