import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

export const organizationSettingsOperations = {
  /** permission-group-exempt: organization members may read their organization's identity. */
  read: defineOrganizationOperation({
    id: 'organization.settings.read',
    minimumRole: 'member',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    capability: 'none',
  }),
  /** permission-group-exempt: organization administrators manage its identity. */
  update: defineOrganizationOperation({
    id: 'organization.settings.update',
    minimumRole: 'admin',
    principalKinds: ['session', 'organization_delegated'],
    delegationAudience: 'sim:settings',
    delegatedServices: ['copilot'],
    capability: 'none',
  }),
} as const
