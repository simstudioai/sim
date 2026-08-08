import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_KINDS = [
  'session',
  'personal_api_key',
  'workspace_api_key',
  'delegated',
] as const
const HUMAN_PRINCIPAL_KINDS = ['session', 'personal_api_key', 'delegated'] as const

export const fileOperations = {
  list: defineWorkspaceOperation({
    id: 'files.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  readMetadata: defineWorkspaceOperation({
    id: 'files.read_metadata',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  readContent: defineWorkspaceOperation({
    id: 'files.read_content',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  download: defineWorkspaceOperation({
    id: 'files.download',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  compiledCheck: defineWorkspaceOperation({
    id: 'files.compiled_check',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  create: defineWorkspaceOperation({
    id: 'files.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  rename: defineWorkspaceOperation({
    id: 'files.rename',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  updateContent: defineWorkspaceOperation({
    id: 'files.update_content',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  updateMetadata: defineWorkspaceOperation({
    id: 'files.update_metadata',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  move: defineWorkspaceOperation({
    id: 'files.move',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  delete: defineWorkspaceOperation({
    id: 'files.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  restore: defineWorkspaceOperation({
    id: 'files.restore',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  readShare: defineWorkspaceOperation({
    id: 'files.share.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  updateShare: defineWorkspaceOperation({
    id: 'files.share.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: HUMAN_PRINCIPAL_KINDS,
  }),
  listFolders: defineWorkspaceOperation({
    id: 'files.folders.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  createFolder: defineWorkspaceOperation({
    id: 'files.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  updateFolder: defineWorkspaceOperation({
    id: 'files.folders.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  deleteFolder: defineWorkspaceOperation({
    id: 'files.folders.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  restoreFolder: defineWorkspaceOperation({
    id: 'files.folders.restore',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  uploadCreate: defineWorkspaceOperation({
    id: 'files.upload.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  uploadParts: defineWorkspaceOperation({
    id: 'files.upload.parts',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  uploadComplete: defineWorkspaceOperation({
    id: 'files.upload.complete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  uploadCancel: defineWorkspaceOperation({
    id: 'files.upload.cancel',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
} as const

export type FileOperation = (typeof fileOperations)[keyof typeof fileOperations]
