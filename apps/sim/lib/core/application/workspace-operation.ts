import type {
  BoundWorkflowExecutionPrincipal,
  DelegatedPrincipal,
  DelegatedServiceId,
  Principal,
} from '@sim/auth/principal'
import type { PermissionType } from '@sim/platform-authz/workspace'
import type { ApplicationOperation, PrincipalKind } from '@/lib/core/application/operation'
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

type WorkflowExecutionPrincipalForOperation<O extends { readonly workflowExecution?: 'allow' }> =
  O['workflowExecution'] extends 'allow' ? BoundWorkflowExecutionPrincipal : never

export type PrincipalForOperation<
  O extends {
    readonly principalKinds: readonly PrincipalKind[]
    readonly delegatedServices?: readonly DelegatedServiceId[]
    readonly workflowExecution?: 'allow'
  },
> =
  | NonDelegatedPrincipalForOperation<O>
  | DelegatedPrincipalForOperation<O>
  | WorkflowExecutionPrincipalForOperation<O>

export interface WorkspaceOperation<
  Id extends string = string,
  Role extends PermissionType = PermissionType,
  PrincipalKinds extends readonly PrincipalKind[] = readonly PrincipalKind[],
  DelegatedServices extends readonly DelegatedServiceId[] = readonly DelegatedServiceId[],
  WorkflowExecution extends 'allow' | undefined = 'allow' | undefined,
> extends ApplicationOperation<Id> {
  readonly minimumRole: Role
  readonly workspaceApiKey: WorkspaceApiKeyPolicy<Role>
  readonly principalKinds: PrincipalKinds
  readonly delegatedServices?: DelegatedServices
  readonly workflowExecution?: WorkflowExecution
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
  const WorkflowExecution extends 'allow' | undefined = undefined,
  const ResourcePolicy extends ResourcePolicyBinding | undefined = undefined,
>(
  operation: WorkspaceOperation<Id, Role, PrincipalKinds, DelegatedServices, WorkflowExecution> &
    WorkspaceApiKeyPrincipalConsistency<Role, PrincipalKinds> &
    DelegatedPrincipalConsistency<PrincipalKinds, DelegatedServices> &
    ResourcePolicyOperationConsistency<ResourcePolicy>
): WorkspaceOperation<Id, Role, PrincipalKinds, DelegatedServices, WorkflowExecution> &
  DelegatedPrincipalConsistency<PrincipalKinds, DelegatedServices> &
  ResourcePolicyOperationConsistency<ResourcePolicy> {
  if (operation.principalKinds.length === 0 && operation.workflowExecution !== 'allow') {
    throw new Error(
      `Operation ${operation.id} must allow at least one principal kind or workflow execution`
    )
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

  Object.freeze(operation.principalKinds)
  if (operation.delegatedServices) Object.freeze(operation.delegatedServices)
  if (operation.resourcePolicy) Object.freeze(operation.resourcePolicy)
  Object.freeze(operation)
  return operation
}
