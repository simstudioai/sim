import { defineWorkspaceOperation } from '@/lib/core/application'

const taskPrincipalPolicy = {
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
} as const

export const taskOperations = {
  readStatus: defineWorkspaceOperation({
    id: 'mothership.tasks.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    principalKinds: ['session'],
  }),
  readWorkflowStatus: defineWorkspaceOperation({
    id: 'mothership.tasks.workflow_status',
    ...taskPrincipalPolicy,
    capability: 'copilot.use',
  }),
  wake: defineWorkspaceOperation({
    id: 'mothership.tasks.wake',
    ...taskPrincipalPolicy,
    capability: 'copilot.use',
  }),
} as const
