import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application'

export type AuditLogPrincipal = Extract<Principal, { kind: 'session' | 'personal_api_key' }>

export interface AuditLogOperation<Id extends string = string> extends ApplicationOperation<Id> {
  readonly authority: 'organization_admin'
  readonly organizationRoles: readonly ['admin', 'owner']
  readonly workspaceApiKey: 'deny'
  readonly principalKinds: readonly ['session', 'personal_api_key']
}

function defineAuditLogOperation<const Id extends string>(
  operation: AuditLogOperation<Id>
): AuditLogOperation<Id> {
  if ((operation.principalKinds as readonly string[]).includes('workspace_api_key')) {
    throw new Error(`Organization-admin operation ${operation.id} cannot allow workspace API keys`)
  }
  Object.freeze(operation.organizationRoles)
  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}

export const auditLogOperations = {
  list: defineAuditLogOperation({
    id: 'audit_logs.list',
    authority: 'organization_admin',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key'],
  }),
  readDetail: defineAuditLogOperation({
    id: 'audit_logs.read_detail',
    authority: 'organization_admin',
    organizationRoles: ['admin', 'owner'],
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'personal_api_key'],
  }),
} as const
