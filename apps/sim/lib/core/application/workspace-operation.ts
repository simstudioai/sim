import type { Principal } from '@sim/auth/principal'
import type { PermissionType } from '@sim/platform-authz/workspace'
import type { ApplicationOperation } from '@/lib/core/application/operation'

type WorkspaceApiKeyPolicy<R extends PermissionType> = R extends 'admin' ? 'deny' : 'allow' | 'deny'

export type PrincipalKind = Principal['kind']

export type PrincipalForOperation<O extends { readonly principalKinds: readonly PrincipalKind[] }> =
  Extract<Principal, { kind: O['principalKinds'][number] }>

export interface WorkspaceOperation<
  Id extends string = string,
  Role extends PermissionType = PermissionType,
  PrincipalKinds extends readonly PrincipalKind[] = readonly PrincipalKind[],
> extends ApplicationOperation<Id> {
  readonly minimumRole: Role
  readonly workspaceApiKey: WorkspaceApiKeyPolicy<Role>
  readonly principalKinds: PrincipalKinds
}

type WorkspaceApiKeyPrincipalConsistency<
  Role extends PermissionType,
  PrincipalKinds extends readonly PrincipalKind[],
> = 'workspace_api_key' extends PrincipalKinds[number]
  ? { readonly workspaceApiKey: Role extends 'admin' ? never : 'allow' }
  : { readonly workspaceApiKey: 'deny' }

export function defineWorkspaceOperation<
  const Id extends string,
  const Role extends PermissionType,
  const PrincipalKinds extends readonly PrincipalKind[],
>(
  operation: WorkspaceOperation<Id, Role, PrincipalKinds> &
    WorkspaceApiKeyPrincipalConsistency<Role, PrincipalKinds>
): WorkspaceOperation<Id, Role, PrincipalKinds> {
  if (operation.principalKinds.length === 0) {
    throw new Error(`Operation ${operation.id} must allow at least one principal kind`)
  }
  if (new Set(operation.principalKinds).size !== operation.principalKinds.length) {
    throw new Error(`Operation ${operation.id} declares duplicate principal kinds`)
  }

  const allowsWorkspaceApiKey = operation.principalKinds.includes('workspace_api_key')
  if (allowsWorkspaceApiKey !== (operation.workspaceApiKey === 'allow')) {
    throw new Error(`Operation ${operation.id} has inconsistent workspace API key policy`)
  }
  if (allowsWorkspaceApiKey && !['read', 'write'].includes(operation.minimumRole)) {
    throw new Error(`Operation ${operation.id} exceeds the workspace API key write ceiling`)
  }

  Object.freeze(operation.principalKinds)
  return Object.freeze(operation)
}
