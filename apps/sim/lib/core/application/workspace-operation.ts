import type { PermissionType } from '@sim/platform-authz/workspace'
import type { ApplicationOperation } from '@/lib/core/application/operation'

type WorkspaceApiKeyPolicy<R extends PermissionType> = R extends 'admin' ? 'deny' : 'allow' | 'deny'

export interface WorkspaceOperation<
  Id extends string = string,
  Role extends PermissionType = PermissionType,
> extends ApplicationOperation<Id> {
  readonly minimumRole: Role
  readonly workspaceApiKey: WorkspaceApiKeyPolicy<Role>
}

export function defineWorkspaceOperation<
  const Id extends string,
  const Role extends PermissionType,
>(operation: WorkspaceOperation<Id, Role>): WorkspaceOperation<Id, Role> {
  return Object.freeze(operation)
}
