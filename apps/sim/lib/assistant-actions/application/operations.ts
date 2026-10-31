import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

export const assistantActionOperations = {
  // permission-group-exempt: reads the owner's existing action history without granting tool access.
  receipts: defineOrganizationOperation({
    id: 'assistant_actions.receipts',
    minimumRole: 'member',
    capability: 'none',
    principalKinds: ['session'],
  }),
  list: defineOrganizationOperation({
    id: 'assistant_actions.list',
    minimumRole: 'member',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
  decide: defineOrganizationOperation({
    id: 'assistant_actions.decide',
    minimumRole: 'member',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
  read: defineOrganizationOperation({
    id: 'assistant_actions.read',
    minimumRole: 'member',
    contentDelivery: 'none',
    capability: 'integrations.manage',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: 'sim:assistant-actions',
  }),
  prepare: defineOrganizationOperation({
    id: 'assistant_actions.prepare',
    minimumRole: 'member',
    contentDelivery: 'none',
    capability: 'integrations.manage',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: 'sim:assistant-actions',
  }),
  claim: defineOrganizationOperation({
    id: 'assistant_actions.claim',
    minimumRole: 'member',
    contentDelivery: 'none',
    capability: 'integrations.manage',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: 'sim:assistant-actions',
  }),
  readPermissions: defineOrganizationOperation({
    id: 'assistant_actions.permissions.read',
    minimumRole: 'member',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
  updatePermissions: defineOrganizationOperation({
    id: 'assistant_actions.permissions.update',
    minimumRole: 'member',
    capability: 'integrations.manage',
    principalKinds: ['session'],
  }),
} as const
