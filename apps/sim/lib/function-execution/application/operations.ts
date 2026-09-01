import { defineWorkspaceOperation } from '@/lib/core/application'

export const functionExecutionOperations = {
  execute: defineWorkspaceOperation({
    id: 'function-executions.execute',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
    workflowExecution: 'allow',
  }),
} as const
