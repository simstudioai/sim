import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'
import { assertOperationCapability } from '@/lib/core/application'

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
  assertOperationCapability(operation)
  Object.freeze(operation.organizationRoles)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

const BASE = {
  authority: 'organization_billing_admin',
  organizationRoles: ['admin', 'owner'],
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
} as const satisfies Omit<OrganizationUsageOperation, 'id' | 'capability'>

/**
 * Every one takes `capability: 'none'`, written out at each call site rather than
 * folded into `BASE`: `check:permission-group-enforcement` reads the literal at
 * the call site, and a capability arriving through a spread is a capability
 * nothing outside the type system ever sees.
 */
export const organizationUsageOperations = {
  // permission-group-exempt: the organization's pooled ledger is authorized by organization billing-admin authority, which no workspace-shaped group key names
  readSummary: defineOrganizationUsageOperation({
    id: 'organization_usage.summary.read',
    capability: 'none',
    ...BASE,
  }),
  // permission-group-exempt: the same pooled ledger, broken down; organization billing-admin authority governs it
  readBreakdown: defineOrganizationUsageOperation({
    id: 'organization_usage.breakdown.read',
    capability: 'none',
    ...BASE,
  }),
  // permission-group-exempt: organization billing events, governed by organization billing-admin authority rather than a workspace group
  listEvents: defineOrganizationUsageOperation({
    id: 'organization_usage.events.list',
    capability: 'none',
    ...BASE,
  }),
  // permission-group-exempt: exports the same organization billing events; logs.export names workflow run logs, not the billing ledger
  exportEvents: defineOrganizationUsageOperation({
    id: 'organization_usage.events.export',
    capability: 'none',
    ...BASE,
  }),
} as const
