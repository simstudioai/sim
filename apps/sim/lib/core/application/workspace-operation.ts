import type { DelegatedPrincipal, DelegatedServiceId, Principal } from '@sim/auth/principal'
import type { PermissionType } from '@sim/platform-authz/workspace'
import type { ApplicationOperation, PrincipalKind } from '@/lib/core/application/operation'

type WorkspaceApiKeyPolicy<R extends PermissionType> = R extends 'admin' ? 'deny' : 'allow' | 'deny'

export type { PrincipalKind }

type WorkspaceOperationPrincipal = Extract<Principal, { kind: PrincipalKind }>

type NonDelegatedPrincipalForOperation<
  O extends { readonly principalKinds: readonly PrincipalKind[] },
> = Exclude<
  Extract<WorkspaceOperationPrincipal, { kind: O['principalKinds'][number] }>,
  DelegatedPrincipal
>

type DelegatedPrincipalForOperation<
  O extends {
    readonly principalKinds: readonly PrincipalKind[]
    readonly delegatedServices?: readonly DelegatedServiceId[]
  },
> = 'delegated' extends O['principalKinds'][number]
  ? DelegatedPrincipal & { serviceId: NonNullable<O['delegatedServices']>[number] }
  : never

export type PrincipalForOperation<
  O extends {
    readonly principalKinds: readonly PrincipalKind[]
    readonly delegatedServices?: readonly DelegatedServiceId[]
  },
> = NonDelegatedPrincipalForOperation<O> | DelegatedPrincipalForOperation<O>

export interface WorkspaceOperation<
  Id extends string = string,
  Role extends PermissionType = PermissionType,
  PrincipalKinds extends readonly PrincipalKind[] = readonly PrincipalKind[],
  DelegatedServices extends readonly DelegatedServiceId[] = readonly DelegatedServiceId[],
> extends ApplicationOperation<Id> {
  readonly minimumRole: Role
  readonly workspaceApiKey: WorkspaceApiKeyPolicy<Role>
  readonly principalKinds: PrincipalKinds
  readonly delegatedServices?: DelegatedServices
}

type WorkspaceApiKeyPrincipalConsistency<
  Role extends PermissionType,
  PrincipalKinds extends readonly PrincipalKind[],
> = 'workspace_api_key' extends PrincipalKinds[number]
  ? { readonly workspaceApiKey: Role extends 'admin' ? never : 'allow' }
  : { readonly workspaceApiKey: 'deny' }

type DelegatedPrincipalConsistency<
  PrincipalKinds extends readonly PrincipalKind[],
  DelegatedServices extends readonly DelegatedServiceId[],
> = 'delegated' extends PrincipalKinds[number]
  ? {
      readonly delegatedServices: DelegatedServices extends readonly [] ? never : DelegatedServices
    }
  : { readonly delegatedServices?: never }

export function defineWorkspaceOperation<
  const Id extends string,
  const Role extends PermissionType,
  const PrincipalKinds extends readonly PrincipalKind[],
  const DelegatedServices extends readonly DelegatedServiceId[] = readonly [],
>(
  operation: WorkspaceOperation<Id, Role, PrincipalKinds, DelegatedServices> &
    WorkspaceApiKeyPrincipalConsistency<Role, PrincipalKinds> &
    DelegatedPrincipalConsistency<PrincipalKinds, DelegatedServices>
): WorkspaceOperation<Id, Role, PrincipalKinds, DelegatedServices> &
  DelegatedPrincipalConsistency<PrincipalKinds, DelegatedServices> {
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

  const allowsDelegatedPrincipal = operation.principalKinds.includes('delegated')
  const delegatedServices = operation.delegatedServices ?? []
  if (allowsDelegatedPrincipal !== delegatedServices.length > 0) {
    throw new Error(`Operation ${operation.id} has inconsistent delegated service policy`)
  }
  if (new Set(delegatedServices).size !== delegatedServices.length) {
    throw new Error(`Operation ${operation.id} declares duplicate delegated services`)
  }

  Object.freeze(operation.principalKinds)
  if (operation.delegatedServices) Object.freeze(operation.delegatedServices)
  Object.freeze(operation)
  return operation
}
