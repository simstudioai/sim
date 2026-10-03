import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { TASK_DELEGATION_AUDIENCE } from '@/lib/mothership/tasks/application/context'

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

export const organizationTaskOperations = {
  readStatus: defineOrganizationOperation({
    id: taskOperations.readStatus.id,
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session'],
  }),
  readWorkflowStatus: defineOrganizationOperation({
    id: taskOperations.readWorkflowStatus.id,
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: TASK_DELEGATION_AUDIENCE,
  }),
  wake: defineOrganizationOperation({
    id: taskOperations.wake.id,
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: TASK_DELEGATION_AUDIENCE,
  }),
} as const
