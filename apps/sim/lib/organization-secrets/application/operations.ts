import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

export const ORGANIZATION_SECRETS_AUDIENCE = 'sim:organization-secrets'

export const organizationSecretOperations = {
  /** permission-group-exempt: source availability is organization navigation, not secret access. */
  readSource: defineOrganizationOperation({
    id: 'organization_secrets.source.read',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'none',
  }),
  configureSource: defineOrganizationOperation({
    id: 'organization_secrets.source.configure',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'secrets.manage',
  }),
  removeSource: defineOrganizationOperation({
    id: 'organization_secrets.source.remove',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'secrets.manage',
  }),
  read: defineOrganizationOperation({
    id: 'organization_secrets.read',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'secrets.manage',
  }),
  save: defineOrganizationOperation({
    id: 'organization_secrets.save',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'secrets.manage',
  }),
  /** A member whose permission group revokes secrets gets no shared names, as with the values. */
  listNames: defineOrganizationOperation({
    id: 'organization_secrets.names',
    contentDelivery: 'none',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    delegationAudience: ORGANIZATION_SECRETS_AUDIENCE,
    delegatedServices: ['copilot'],
    capability: 'secrets.manage',
  }),
  mount: defineOrganizationOperation({
    id: 'organization_secrets.mount',
    contentDelivery: 'none',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    delegationAudience: ORGANIZATION_SECRETS_AUDIENCE,
    delegatedServices: ['copilot'],
    capability: 'secrets.manage',
  }),
} as const
