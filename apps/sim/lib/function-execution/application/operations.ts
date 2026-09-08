import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const functionExecutionOperations = {
  // permission-group-exempt: running a Function block is the workflow executing its own code; no group key names code execution, and a gate here would fail runs the group permits
  execute: defineWorkspaceOperation({
    id: 'function-executions.execute',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['delegated'],
    delegatedServices: ['executor', 'copilot'],
  }),
} as const
