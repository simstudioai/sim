import type { PermissionType } from '@sim/platform-authz/workspace'

type WorkspaceApiKeyPolicy<R extends PermissionType> = R extends 'admin' ? 'deny' : 'allow' | 'deny'

export interface WorkspaceOperation<
  Id extends string = string,
  Role extends PermissionType = PermissionType,
> {
  readonly id: Id
  readonly minimumRole: Role
  readonly workspaceApiKey: WorkspaceApiKeyPolicy<Role>
}

function defineWorkspaceOperation<const Id extends string, const Role extends PermissionType>(
  operation: WorkspaceOperation<Id, Role>
): WorkspaceOperation<Id, Role> {
  return Object.freeze(operation)
}

export const fileOperations = {
  rename: defineWorkspaceOperation({
    id: 'files.rename',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
} as const

export type FileOperation = (typeof fileOperations)[keyof typeof fileOperations]
