import type { DelegatedPrincipal, DelegatedServiceId, Principal } from '@sim/auth/principal'
import type { PermissionType } from '@sim/platform-authz/workspace'
import type {
  ApplicationOperation,
  OAuthOperationPolicy,
  PrincipalKind,
} from '@/lib/core/application/operation'
import {
  assertOperationCapability,
  assertOperationOAuthPolicy,
} from '@/lib/core/application/operation'
import {
  type ResourcePolicyBinding,
  requireResourcePolicyBinding,
} from '@/lib/resource-policies/registry'

type WorkspaceApiKeyPolicy<R extends PermissionType> = R extends 'admin' ? 'deny' : 'allow' | 'deny'

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

type ResourcePolicyOperationConsistency<Binding extends ResourcePolicyBinding | undefined> =
  Binding extends ResourcePolicyBinding
    ? { readonly resourcePolicy: Binding }
    : { readonly resourcePolicy?: never }

export function defineWorkspaceOperation<
  const Id extends string,
  const Role extends PermissionType,
  const PrincipalKinds extends readonly PrincipalKind[],
  const DelegatedServices extends readonly DelegatedServiceId[] = readonly [],
  const ResourcePolicy extends ResourcePolicyBinding | undefined = undefined,
>(
  operation: WorkspaceOperation<Id, Role, PrincipalKinds, DelegatedServices> &
    OAuthOperationPolicy<PrincipalKinds> &
    WorkspaceApiKeyPrincipalConsistency<Role, PrincipalKinds> &
    DelegatedPrincipalConsistency<PrincipalKinds, DelegatedServices> &
    ResourcePolicyOperationConsistency<ResourcePolicy>
): WorkspaceOperation<Id, Role, PrincipalKinds, DelegatedServices> &
  OAuthOperationPolicy<PrincipalKinds> &
  DelegatedPrincipalConsistency<PrincipalKinds, DelegatedServices> &
  ResourcePolicyOperationConsistency<ResourcePolicy> {
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

  if (operation.resourcePolicy) requireResourcePolicyBinding(operation.resourcePolicy)

  /**
   * `capability` is required, so refusing an absent one reads as unreachable.
   * It is not. `apps/sim/tsconfig.json` excludes test files from type-checking,
   * and `check-permission-group-enforcement.ts` walks past them too, so a test
   * fixture is the one construction site no static check reads — and fixtures
   * are where an operation is written from memory rather than from the
   * surrounding domain.
   *
   * Left to reach authorization, an absent capability does not deny; it throws
   * `Cannot read properties of undefined` from inside `capabilityDeniedBy`, and
   * only for a caller whose organization has a permission group. It would pass
   * every personal workspace and every non-enterprise test, then fail in the
   * tenants that bought the feature. Named here instead, at definition time.
   */
  assertOperationCapability(operation)
  assertOperationOAuthPolicy(operation)

  Object.freeze(operation.principalKinds)
  if (operation.delegatedServices) Object.freeze(operation.delegatedServices)
  if (operation.resourcePolicy) Object.freeze(operation.resourcePolicy)
  Object.freeze(operation)
  return operation
}
