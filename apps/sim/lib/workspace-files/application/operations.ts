import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const ALL_COPILOT_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot'],
} as const
const ALL_FILE_TOOL_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot', 'executor'],
} as const
const HUMAN_FILE_TOOL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'delegated'],
  delegatedServices: ['copilot', 'executor'],
} as const
const UPLOAD_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
} as const

export const fileOperations = {
  list: defineWorkspaceOperation({
    id: 'files.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  readMetadata: defineWorkspaceOperation({
    id: 'files.read_metadata',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  readContent: defineWorkspaceOperation({
    id: 'files.read_content',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  searchContent: defineWorkspaceOperation({
    id: 'files.search_content',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  download: defineWorkspaceOperation({
    id: 'files.download',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  compiledCheck: defineWorkspaceOperation({
    id: 'files.compiled_check',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'files.use',
    principalKinds: ['session'],
  }),
  create: defineWorkspaceOperation({
    id: 'files.create',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  rename: defineWorkspaceOperation({
    id: 'files.rename',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  /**
   * Unzipping an archive into a folder beside it.
   *
   * Reachable by API keys because extraction grants no capability those keys
   * lack: every file it writes could be created one at a time through
   * `files.create` and `files.upload.create`, both already `workspaceApiKey:
   * 'allow'` at the same `write` role. Extraction only makes it one call, so
   * the previous `['session']` restriction read as an artifact of the UI having
   * been its only caller rather than a decided policy. Delegated services stay
   * out: no copilot or executor caller exists today and admitting one is a
   * separate decision.
   */
  extractArchive: defineWorkspaceOperation({
    id: 'files.extract_archive',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
  updateContent: defineWorkspaceOperation({
    id: 'files.update_content',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  updateMetadata: defineWorkspaceOperation({
    id: 'files.update_metadata',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  move: defineWorkspaceOperation({
    id: 'files.move',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  createVfsFolders: defineWorkspaceOperation({
    id: 'files.vfs.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'files.use',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  relocateVfsItems: defineWorkspaceOperation({
    id: 'files.vfs.relocate',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'files.use',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  deleteVfsItems: defineWorkspaceOperation({
    id: 'files.vfs.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'files.use',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  }),
  delete: defineWorkspaceOperation({
    id: 'files.delete',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  restore: defineWorkspaceOperation({
    id: 'files.restore',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_COPILOT_PRINCIPAL_POLICY,
  }),
  readShare: defineWorkspaceOperation({
    id: 'files.share.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  updateShare: defineWorkspaceOperation({
    id: 'files.share.update',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'files.use',
    ...HUMAN_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  listFolders: defineWorkspaceOperation({
    id: 'files.folders.list',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  createFolder: defineWorkspaceOperation({
    id: 'files.folders.create',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  updateFolder: defineWorkspaceOperation({
    id: 'files.folders.update',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  deleteFolder: defineWorkspaceOperation({
    id: 'files.folders.delete',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  restoreFolder: defineWorkspaceOperation({
    id: 'files.folders.restore',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...ALL_FILE_TOOL_PRINCIPAL_POLICY,
  }),
  uploadCreate: defineWorkspaceOperation({
    id: 'files.upload.create',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...UPLOAD_PRINCIPAL_POLICY,
  }),
  /**
   * Reading an upload session's current state. Distinct from `uploadCancel`,
   * which is the only other resource-id upload control today: cancelling is a
   * `write`, and asking whether a session is still alive or already finalized
   * must not require permission to destroy it.
   */
  uploadRead: defineWorkspaceOperation({
    id: 'files.upload.read',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...UPLOAD_PRINCIPAL_POLICY,
  }),
  uploadParts: defineWorkspaceOperation({
    id: 'files.upload.parts',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...UPLOAD_PRINCIPAL_POLICY,
  }),
  uploadComplete: defineWorkspaceOperation({
    id: 'files.upload.complete',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...UPLOAD_PRINCIPAL_POLICY,
  }),
  uploadCancel: defineWorkspaceOperation({
    id: 'files.upload.cancel',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'files.use',
    ...UPLOAD_PRINCIPAL_POLICY,
  }),
} as const

export type FileOperation = (typeof fileOperations)[keyof typeof fileOperations]
