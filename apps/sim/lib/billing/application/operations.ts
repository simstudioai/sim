import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'

export type BillingReadPrincipal = Extract<
  Principal,
  { kind: 'personal_api_key' | 'workspace_api_key' }
>

export interface BillingReadOperation<Id extends string = string> extends ApplicationOperation<Id> {
  readonly accountScope: 'personal_self'
  readonly workspaceMinimumRole: 'read'
  readonly workspaceApiKey: 'workspace_only'
  readonly principalKinds: readonly ['personal_api_key', 'workspace_api_key']
}

function defineBillingReadOperation<const Id extends string>(
  operation: BillingReadOperation<Id>
): BillingReadOperation<Id> {
  if (operation.workspaceMinimumRole !== 'read') {
    throw new Error(`Billing read operation ${operation.id} exceeds its workspace-key ceiling`)
  }
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

export const billingOperations = {
  readStatus: defineBillingReadOperation({
    id: 'billing.status.read',
    accountScope: 'personal_self',
    workspaceMinimumRole: 'read',
    workspaceApiKey: 'workspace_only',
    principalKinds: ['personal_api_key', 'workspace_api_key'],
  }),
  listLogs: defineBillingReadOperation({
    id: 'billing.logs.list',
    accountScope: 'personal_self',
    workspaceMinimumRole: 'read',
    workspaceApiKey: 'workspace_only',
    principalKinds: ['personal_api_key', 'workspace_api_key'],
  }),
} as const
