import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

const policy = {
  principalKinds: ['session', 'organization_delegated'],
  delegationAudience: 'sim:settings',
  delegatedServices: ['copilot'],
  /** permission-group-exempt: organization domain security is governed by membership, admin role and Enterprise entitlement. */
  capability: 'none',
} as const
export const organizationSecurityOperations = {
  // permission-group-exempt: organization domain security is governed by membership, admin role and Enterprise entitlement.
  listDomains: defineOrganizationOperation({
    id: 'organizations.domains.list',
    minimumRole: 'member',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization domain security is governed by membership, admin role and Enterprise entitlement.
  addDomain: defineOrganizationOperation({
    id: 'organizations.domains.add',
    minimumRole: 'admin',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization domain security is governed by membership, admin role and Enterprise entitlement.
  verifyDomain: defineOrganizationOperation({
    id: 'organizations.domains.verify',
    minimumRole: 'admin',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization domain security is governed by membership, admin role and Enterprise entitlement.
  removeDomain: defineOrganizationOperation({
    id: 'organizations.domains.remove',
    minimumRole: 'admin',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization domain security is governed by membership, admin role and Enterprise entitlement.
  revokeSessions: defineOrganizationOperation({
    id: 'organizations.sessions.revoke',
    minimumRole: 'admin',
    principalKinds: ['session'],
    /** permission-group-exempt: session revocation requires current administrator session and Enterprise entitlement. */
    capability: 'none',
  }),
} as const
