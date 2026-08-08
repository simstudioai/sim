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
  list: defineWorkspaceOperation({
    id: 'files.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
  }),
  readMetadata: defineWorkspaceOperation({
    id: 'files.read_metadata',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
  }),
  readContent: defineWorkspaceOperation({
    id: 'files.read_content',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
  }),
  download: defineWorkspaceOperation({
    id: 'files.download',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
  }),
  create: defineWorkspaceOperation({
    id: 'files.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  rename: defineWorkspaceOperation({
    id: 'files.rename',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  updateContent: defineWorkspaceOperation({
    id: 'files.update_content',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  updateMetadata: defineWorkspaceOperation({
    id: 'files.update_metadata',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  move: defineWorkspaceOperation({
    id: 'files.move',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  delete: defineWorkspaceOperation({
    id: 'files.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  restore: defineWorkspaceOperation({
    id: 'files.restore',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  readShare: defineWorkspaceOperation({
    id: 'files.share.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
  }),
  updateShare: defineWorkspaceOperation({
    id: 'files.share.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
  }),
  listFolders: defineWorkspaceOperation({
    id: 'files.folders.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
  }),
  createFolder: defineWorkspaceOperation({
    id: 'files.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  updateFolder: defineWorkspaceOperation({
    id: 'files.folders.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  deleteFolder: defineWorkspaceOperation({
    id: 'files.folders.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  restoreFolder: defineWorkspaceOperation({
    id: 'files.folders.restore',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  uploadCreate: defineWorkspaceOperation({
    id: 'files.upload.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  uploadParts: defineWorkspaceOperation({
    id: 'files.upload.parts',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  uploadComplete: defineWorkspaceOperation({
    id: 'files.upload.complete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
  uploadCancel: defineWorkspaceOperation({
    id: 'files.upload.cancel',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
  }),
} as const

export type FileOperation = (typeof fileOperations)[keyof typeof fileOperations]
