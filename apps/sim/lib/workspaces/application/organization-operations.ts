import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

export const organizationWorkspaceOperations = {
  list: defineOrganizationOperation({
    id: 'organization.workspaces.list',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:workspaces',
    delegatedServices: ['copilot'],
  }),
  create: defineOrganizationOperation({
    id: 'organization.workspaces.create',
    minimumRole: 'member',
    capability: 'workspace.create',
    principalKinds: ['organization_delegated'],
    delegationAudience: 'sim:workspaces',
    delegatedServices: ['copilot'],
  }),
} as const

export type OrganizationWorkspaceOperation =
  (typeof organizationWorkspaceOperations)[keyof typeof organizationWorkspaceOperations]
