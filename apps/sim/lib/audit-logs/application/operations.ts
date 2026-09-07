import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application/operation'
import {
  assertOperationCapability,
  assertOperationOAuthPolicy,
} from '@/lib/core/application/operation'

export type AuditLogPrincipal = Extract<
  Principal,
  { kind: 'session' | 'personal_api_key' | 'oauth_access_token' }
>

export interface AuditLogOperation<Id extends string = string> extends ApplicationOperation<Id> {
  readonly authority: 'organization_admin'
  readonly organizationRoles: readonly ['admin', 'owner']
  readonly workspaceApiKey: 'deny'
  readonly oauthScope: 'api:read'
  readonly principalKinds: readonly ['session', 'personal_api_key', 'oauth_access_token']
}

function defineAuditLogOperation<const Id extends string>(
  operation: AuditLogOperation<Id>
): AuditLogOperation<Id> {
  if ((operation.principalKinds as readonly string[]).includes('workspace_api_key')) {
    throw new Error(`Organization-admin operation ${operation.id} cannot allow workspace API keys`)
  }
  assertOperationCapability(operation)
  assertOperationOAuthPolicy(operation)
  Object.freeze(operation.organizationRoles)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

export const auditLogOperations = {
  // permission-group-exempt: the organization audit trail is authorized by organization admin or owner role, a scope no workspace-shaped permission group can name
  list: defineAuditLogOperation({
    id: 'audit_logs.list',
    oauthScope: 'api:read',
    capability: 'none',
    authority: 'organization_admin',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
  }),
  // permission-group-exempt: same organization-admin authority as the list it expands; no group key names the audit trail
  readDetail: defineAuditLogOperation({
    id: 'audit_logs.read_detail',
    oauthScope: 'api:read',
    capability: 'none',
    authority: 'organization_admin',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
  }),
} as const
