import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_COPILOT_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const
const ALL_FILE_TOOL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot', 'executor'],
} as const
const HUMAN_FILE_TOOL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot', 'executor'],
} as const
const UPLOAD_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
} as const

export const fileOperations = {
  list: defineWorkspaceOperation({
    id: 'files.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  readMetadata: defineWorkspaceOperation({
    id: 'files.read_metadata',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  readContent: defineWorkspaceOperation({
    id: 'files.read_content',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  download: defineWorkspaceOperation({
    id: 'files.download',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
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
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  rename: defineWorkspaceOperation({
    id: 'files.rename',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  extractArchive: defineWorkspaceOperation({
    id: 'files.extract_archive',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  updateContent: defineWorkspaceOperation({
    id: 'files.update_content',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  updateMetadata: defineWorkspaceOperation({
    id: 'files.update_metadata',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  move: defineWorkspaceOperation({
    id: 'files.move',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  createVfsFolders: defineWorkspaceOperation({
    id: 'files.vfs.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  relocateVfsItems: defineWorkspaceOperation({
    id: 'files.vfs.relocate',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  deleteVfsItems: defineWorkspaceOperation({
    id: 'files.vfs.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  delete: defineWorkspaceOperation({
    id: 'files.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  restore: defineWorkspaceOperation({
    id: 'files.restore',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  readShare: defineWorkspaceOperation({
    id: 'files.share.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  updateShare: defineWorkspaceOperation({
    id: 'files.share.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...HUMAN_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  listFolders: defineWorkspaceOperation({
    id: 'files.folders.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  createFolder: defineWorkspaceOperation({
    id: 'files.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  updateFolder: defineWorkspaceOperation({
    id: 'files.folders.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  deleteFolder: defineWorkspaceOperation({
    id: 'files.folders.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  restoreFolder: defineWorkspaceOperation({
    id: 'files.folders.restore',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  uploadCreate: defineWorkspaceOperation({
    id: 'files.upload.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...UPLOAD_PRINCIPAL_POLICY,
  }),
  uploadParts: defineWorkspaceOperation({
    id: 'files.upload.parts',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...UPLOAD_PRINCIPAL_POLICY,
  }),
  uploadComplete: defineWorkspaceOperation({
    id: 'files.upload.complete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...UPLOAD_PRINCIPAL_POLICY,
  }),
  uploadCancel: defineWorkspaceOperation({
    id: 'files.upload.cancel',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...UPLOAD_PRINCIPAL_POLICY,
  }),
} as const

export type FileOperation = (typeof fileOperations)[keyof typeof fileOperations]
