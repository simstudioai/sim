import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const functionExecutionOperations = {
  // permission-group-exempt: Function code runs under its authorized workflow or tool caller; no permission-group key names code execution, and tool admission enforces the integration and tool policies
  execute: defineWorkspaceOperation({
    id: 'function-executions.execute',
    oauthScope: 'api:write',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
    delegatedServices: ['executor', 'copilot'],
  }),
} as const
