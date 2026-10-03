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
  /** permission-group-exempt: runtime use is governed by the authorized Build conversation, independently of secret-management UI access. */
  listNames: defineOrganizationOperation({
    id: 'organization_secrets.names',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    delegationAudience: ORGANIZATION_SECRETS_AUDIENCE,
    delegatedServices: ['copilot'],
    capability: 'none',
  }),
  /** permission-group-exempt: runtime use is governed by the authorized Build conversation, independently of secret-management UI access. */
  mount: defineOrganizationOperation({
    id: 'organization_secrets.mount',
    minimumRole: 'member',
    principalKinds: ['organization_delegated'],
    delegationAudience: ORGANIZATION_SECRETS_AUDIENCE,
    delegatedServices: ['copilot'],
    capability: 'none',
  }),
} as const
