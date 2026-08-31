import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'

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
  Object.freeze(operation.organizationRoles)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

export const organizationBillingSummaryOperations = {
  read: defineOrganizationBillingSummaryOperation({
    id: 'organization_billing.summary.read',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
