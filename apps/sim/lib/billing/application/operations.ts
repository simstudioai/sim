import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application/operation'
import {
  assertOperationCapability,
  assertOperationOAuthPolicy,
} from '@/lib/core/application/operation'

export type BillingReadPrincipal = Extract<
  Principal,
  { kind: 'personal_api_key' | 'oauth_access_token' | 'workspace_api_key' }
>

export interface BillingReadOperation<Id extends string = string> extends ApplicationOperation<Id> {
  readonly accountScope: 'personal_self'
  readonly workspaceMinimumRole: 'read'
  readonly workspaceApiKey: 'workspace_only'
  readonly oauthScope: 'api:read'
  readonly principalKinds: readonly ['personal_api_key', 'oauth_access_token', 'workspace_api_key']
}

function defineBillingReadOperation<const Id extends string>(
  operation: BillingReadOperation<Id>
): BillingReadOperation<Id> {
  if (operation.workspaceMinimumRole !== 'read') {
    throw new Error(`Billing read operation ${operation.id} exceeds its workspace-key ceiling`)
  }
  assertOperationCapability(operation)
  assertOperationOAuthPolicy(operation)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

export const billingOperations = {
  // permission-group-exempt: a personal account reading its own plan and balance; permission groups scope a workspace, not the billing account that owns it
  readStatus: defineBillingReadOperation({
    id: 'billing.status.read',
    oauthScope: 'api:read',
    capability: 'none',
    accountScope: 'personal_self',
    workspaceMinimumRole: 'read',
    workspaceApiKey: 'workspace_only',
    principalKinds: ['personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
  // permission-group-exempt: the same personal billing account reading its own usage records; no group key names it
  listLogs: defineBillingReadOperation({
    id: 'billing.logs.list',
    oauthScope: 'api:read',
    capability: 'none',
    accountScope: 'personal_self',
    workspaceMinimumRole: 'read',
    workspaceApiKey: 'workspace_only',
    principalKinds: ['personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
} as const
