import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'

/**
 * Session only.
 *
 * An organization's pooled ledger discloses every member's model spend, which is why
 * `workspace-billing-authority` treats organization membership alone as insufficient
 * for it. There is no API-key consumer of this surface today, and adding one should
 * be a deliberate decision rather than something inherited from a default.
 */
export type OrganizationUsagePrincipal = Extract<Principal, { kind: 'session' }>

export interface OrganizationUsageOperation<Id extends string = string>
  extends ApplicationOperation<Id> {
  readonly authority: 'organization_billing_admin'
  readonly organizationRoles: readonly ['admin', 'owner']
  readonly workspaceApiKey: 'deny'
  readonly principalKinds: readonly ['session']
}

function defineOrganizationUsageOperation<const Id extends string>(
  operation: OrganizationUsageOperation<Id>
): OrganizationUsageOperation<Id> {
  if ((operation.principalKinds as readonly string[]).some((kind) => kind !== 'session')) {
    throw new Error(
      `Organization usage operation ${operation.id} may only be performed by a session`
    )
  }
  Object.freeze(operation.organizationRoles)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

const BASE = {
  authority: 'organization_billing_admin',
  organizationRoles: ['admin', 'owner'],
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
} as const satisfies Omit<OrganizationUsageOperation, 'id'>

export const organizationUsageOperations = {
  readSummary: defineOrganizationUsageOperation({ id: 'organization_usage.summary.read', ...BASE }),
  readBreakdown: defineOrganizationUsageOperation({
    id: 'organization_usage.breakdown.read',
    ...BASE,
  }),
  listEvents: defineOrganizationUsageOperation({ id: 'organization_usage.events.list', ...BASE }),
  exportEvents: defineOrganizationUsageOperation({
    id: 'organization_usage.events.export',
    ...BASE,
  }),
} as const
