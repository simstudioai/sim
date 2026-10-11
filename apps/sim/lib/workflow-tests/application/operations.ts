import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

/** Workspace API keys are refused: a test run's workflow runs are attributed to the acting user. */
const policy = {
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot'],
} as const

/** Test files keep the access policy of their file-backed source, like dashboards. */
export const workflowTestOperations = {
  read: defineWorkspaceOperation({
    ...policy,
    oauthScope: 'api:read',
    capability: 'files.use',
    id: 'workflow_tests.read',
    minimumRole: 'read',
  }),
  create: defineWorkspaceOperation({
    ...policy,
    oauthScope: 'api:write',
    capability: 'files.use',
    id: 'workflow_tests.create',
    minimumRole: 'write',
  }),
  update: defineWorkspaceOperation({
    ...policy,
    oauthScope: 'api:write',
    capability: 'files.use',
    id: 'workflow_tests.update',
    minimumRole: 'write',
  }),
  run: defineWorkspaceOperation({
    ...policy,
    oauthScope: 'api:write',
    capability: 'files.use',
    id: 'workflow_tests.run',
    minimumRole: 'write',
  }),
  delete: defineWorkspaceOperation({
    ...policy,
    oauthScope: 'api:write',
    capability: 'files.use',
    id: 'workflow_tests.delete',
    minimumRole: 'write',
  }),
} as const
