import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'
import { assertOperationCapability } from '@/lib/core/application/operation'

/** Acting session or delegated organization identity; workspace keys cannot manage billing. */
export type OrganizationBillingPrincipal = Extract<
  Principal,
  { kind: 'session' | 'organization_delegated' }
>

/** Organization billing policy requiring current administrator or owner membership. */
export interface OrganizationBillingOperation<Id extends string = string>
  extends ApplicationOperation<Id> {
  readonly organizationRoles: readonly ['admin', 'owner']
  readonly workspaceApiKey: 'deny'
  readonly principalKinds: readonly ['session', 'organization_delegated']
}

function defineOrganizationBillingOperation<const Id extends string>(
  operation: OrganizationBillingOperation<Id>
): OrganizationBillingOperation<Id> {
  assertOperationCapability(operation)
  Object.freeze(operation.organizationRoles)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

/** Shared authorization policies for billing summaries and lightweight plan/seat reads. */
export const organizationBillingOperations = {
  // permission-group-exempt: plan and seat management requires current organization administrator authority.
  planSeats: defineOrganizationBillingOperation({
    id: 'organization_billing.plan_seats.read',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'organization_delegated'],
    capability: 'none',
  }),
  // permission-group-exempt: an organization-admin surface — admins and owners sit above every group, and no group key names organization billing
  read: defineOrganizationBillingOperation({
    id: 'organization_billing.summary.read',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'organization_delegated'],
    capability: 'none',
  }),
} as const
