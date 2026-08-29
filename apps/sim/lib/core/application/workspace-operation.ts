import type { DelegatedPrincipal, DelegatedServiceId, Principal } from '@sim/auth/principal'
import type { PermissionType } from '@sim/platform-authz/workspace'
import type { ApplicationOperation, PrincipalKind } from '@/lib/core/application/operation'
import {
  CAPABILITY_RULES,
  type StaticPermissionGroupCapability,
} from '@/lib/permission-groups/capabilities'
import {
  type ResourcePolicyBinding,
  requireResourcePolicyBinding,
} from '@/lib/resource-policies/registry'

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
  /**
   * The capability a permission group must not have withheld, or `'none'` when
   * no group governs this operation.
   *
   * `'none'` is spelled out rather than left as an omission, because an absent
   * field cannot be told apart from an unreviewed one — and unreviewed omission
   * is exactly how twelve config keys shipped with an admin checkbox and no
   * server gate. Required, so the question has to be answered once per
   * operation; `check:permission-group-enforcement` additionally requires a
   * `// permission-group-exempt:` reason wherever the answer is `'none'`.
   */
  readonly capability: StaticPermissionGroupCapability | 'none'
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
    WorkspaceApiKeyPrincipalConsistency<Role, PrincipalKinds> &
    DelegatedPrincipalConsistency<PrincipalKinds, DelegatedServices> &
    ResourcePolicyOperationConsistency<ResourcePolicy>
): WorkspaceOperation<Id, Role, PrincipalKinds, DelegatedServices> &
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

  if (operation.capability !== undefined && operation.capability !== 'none') {
    const rule = CAPABILITY_RULES[operation.capability]
    if (!rule) {
      throw new Error(`Operation ${operation.id} names unknown capability ${operation.capability}`)
    }
    /**
     * A parameterized rule reads a value only the request carries, which the
     * authorization funnel never sees. Declared on an operation it would be
     * silently skipped, so refuse it here rather than let it read as enforced.
     */
    if (rule.kind !== 'static') {
      throw new Error(
        `Operation ${operation.id} declares parameterized capability ${operation.capability}; assert it from the use case instead`
      )
    }
  }

  Object.freeze(operation.principalKinds)
  if (operation.delegatedServices) Object.freeze(operation.delegatedServices)
  if (operation.resourcePolicy) Object.freeze(operation.resourcePolicy)
  Object.freeze(operation)
  return operation
}
