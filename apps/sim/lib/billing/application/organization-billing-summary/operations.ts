import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'
import { assertOperationCapability } from '@/lib/core/application'

export type OrganizationBillingSummaryPrincipal = Extract<Principal, { kind: 'session' }>

export interface OrganizationBillingSummaryOperation<Id extends string = string>
  extends ApplicationOperation<Id> {
  readonly organizationRoles: readonly ['admin', 'owner']
  readonly workspaceApiKey: 'deny'
  readonly principalKinds: readonly ['session']
}

function defineOrganizationBillingSummaryOperation<const Id extends string>(
  operation: OrganizationBillingSummaryOperation<Id>
): OrganizationBillingSummaryOperation<Id> {
  assertOperationCapability(operation)
  Object.freeze(operation.organizationRoles)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

export const organizationBillingSummaryOperations = {
  // permission-group-exempt: an organization-admin surface — admins and owners sit above every group, and no group key names organization billing
  read: defineOrganizationBillingSummaryOperation({
    id: 'organization_billing.summary.read',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
    capability: 'none',
  }),
} as const
