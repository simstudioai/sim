import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

const configurationPolicy = {
  principalKinds: ['session', 'organization_delegated'],
  delegationAudience: 'sim:settings',
  delegatedServices: ['copilot'],
} as const

export const organizationConfigurationOperations = {
  // permission-group-exempt: organization branding is readable by current organization members.
  readWhitelabel: defineOrganizationOperation({
    ...configurationPolicy,
    id: 'organizations.whitelabel.read',
    minimumRole: 'member',
    capability: 'none',
  }),
  // permission-group-exempt: organization branding uses administrator authority and enterprise entitlement.
  updateWhitelabel: defineOrganizationOperation({
    ...configurationPolicy,
    id: 'organizations.whitelabel.update',
    minimumRole: 'admin',
    capability: 'none',
  }),
  // permission-group-exempt: session policy is readable by current organization members.
  readSessionPolicy: defineOrganizationOperation({
    ...configurationPolicy,
    id: 'organizations.session_policy.read',
    minimumRole: 'member',
    capability: 'none',
  }),
  // permission-group-exempt: session policy uses administrator authority and enterprise entitlement.
  updateSessionPolicy: defineOrganizationOperation({
    ...configurationPolicy,
    id: 'organizations.session_policy.update',
    minimumRole: 'admin',
    capability: 'none',
  }),
  // permission-group-exempt: retention configuration is readable by current organization members.
  readDataRetention: defineOrganizationOperation({
    ...configurationPolicy,
    id: 'organizations.data_retention.read',
    minimumRole: 'member',
    capability: 'none',
  }),
  // permission-group-exempt: retention configuration uses administrator authority and enterprise entitlement.
  updateDataRetention: defineOrganizationOperation({
    ...configurationPolicy,
    id: 'organizations.data_retention.update',
    minimumRole: 'admin',
    capability: 'none',
  }),
} as const

export type OrganizationConfigurationOperation =
  (typeof organizationConfigurationOperations)[keyof typeof organizationConfigurationOperations]
