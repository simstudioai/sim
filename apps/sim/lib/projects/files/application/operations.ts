import type { Principal, ResourceDelegatedPrincipal } from '@sim/auth/principal'
import {
  type ApplicationOperation,
  assertOperationCapability,
  assertOperationOAuthPolicy,
} from '@/lib/core/application/operation'

export type ProjectFilePrincipal = Extract<
  Principal,
  { kind: 'session' | 'personal_api_key' | 'oauth_access_token' | 'resource_delegated' }
>

interface ProjectFilePolicy extends ApplicationOperation {
  readonly access: 'read' | 'write'
  readonly target: 'project' | 'file' | 'collection_observation'
  readonly fileScope?: 'active' | 'all'
  readonly principalKinds: readonly ProjectFilePrincipal['kind'][]
  readonly delegatedServices: readonly ResourceDelegatedPrincipal['serviceId'][]
  readonly delegationAudience: 'sim:project-files' | 'sim:file-list-observation'
}

export const PROJECT_FILE_DELEGATION_TTL_MS = 60_000

function defineProjectFileOperation<const O extends ProjectFilePolicy>(operation: O): O {
  assertOperationCapability(operation)
  assertOperationOAuthPolicy(operation)
  const observesCollection = operation.target === 'collection_observation'
  if (
    observesCollection &&
    (operation.access !== 'read' ||
      operation.delegationAudience !== 'sim:file-list-observation' ||
      operation.principalKinds.length !== 1 ||
      operation.principalKinds[0] !== 'resource_delegated' ||
      operation.delegatedServices.length !== 1 ||
      operation.delegatedServices[0] !== 'realtime')
  ) {
    throw new Error('Collection observation requires an exclusive read-only realtime grant')
  }
  if (
    operation.target !== 'file' &&
    !observesCollection &&
    operation.delegatedServices.includes('realtime')
  ) {
    throw new Error('Realtime Project authority must target an existing file')
  }
  Object.freeze(operation.principalKinds)
  Object.freeze(operation.delegatedServices)
  return Object.freeze(operation)
}

const PRINCIPALS = [
  'session',
  'personal_api_key',
  'oauth_access_token',
  'resource_delegated',
] as const
const POLICY = {
  principalKinds: PRINCIPALS,
  delegationAudience: 'sim:project-files',
  delegatedServices: ['copilot'],
} as const

const HISTORY_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
  delegationAudience: 'sim:project-files',
  delegatedServices: [],
} as const

export const projectFileOperations = {
  observeCollection: defineProjectFileOperation({
    id: 'project_files.observe_collection',
    capability: 'files.use',
    access: 'read',
    target: 'collection_observation',
    principalKinds: ['resource_delegated'],
    delegatedServices: ['realtime'],
    delegationAudience: 'sim:file-list-observation',
  }),
  extractArchive: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.extract_archive',
    capability: 'files.use',
    access: 'write',
    target: 'file',
    oauthScope: 'api:write',
  }),
  downloadItems: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.download_items',
    capability: 'files.use',
    access: 'read',
    target: 'project',
    oauthScope: 'api:read',
  }),
  exportSnapshot: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.export_snapshot',
    capability: 'files.use',
    access: 'read',
    target: 'file',
    oauthScope: 'api:read',
  }),
  searchContent: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.search_content',
    capability: 'files.use',
    access: 'read',
    target: 'project',
    oauthScope: 'api:read',
  }),
  readShare: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.share.read',
    capability: 'files.use',
    access: 'read',
    target: 'file',
    oauthScope: 'api:read',
  }),
  updateShare: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.share.update',
    capability: 'files.use',
    access: 'write',
    target: 'file',
    oauthScope: 'api:write',
  }),
  listVersions: defineProjectFileOperation({
    ...HISTORY_POLICY,
    id: 'project_files.versions.list',
    capability: 'files.use',
    access: 'read',
    target: 'file',
    oauthScope: 'api:read',
  }),
  readVersion: defineProjectFileOperation({
    ...HISTORY_POLICY,
    id: 'project_files.versions.read',
    capability: 'files.use',
    access: 'read',
    target: 'file',
    oauthScope: 'api:read',
  }),
  readVersionContent: defineProjectFileOperation({
    ...HISTORY_POLICY,
    id: 'project_files.versions.read_content',
    capability: 'files.use',
    access: 'read',
    target: 'file',
    oauthScope: 'api:read',
  }),
  revertVersion: defineProjectFileOperation({
    ...HISTORY_POLICY,
    id: 'project_files.versions.revert',
    capability: 'files.use',
    access: 'write',
    target: 'file',
    oauthScope: 'api:write',
  }),
  deleteVersion: defineProjectFileOperation({
    ...HISTORY_POLICY,
    id: 'project_files.versions.delete',
    capability: 'files.use',
    access: 'write',
    target: 'file',
    oauthScope: 'api:write',
  }),
  readInline: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.read_inline',
    capability: 'files.use',
    access: 'read',
    target: 'project',
    oauthScope: 'api:read',
  }),
  uploadCreate: defineProjectFileOperation({
    ...POLICY,
    id: 'project_file_uploads.create',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
  uploadRead: defineProjectFileOperation({
    ...POLICY,
    id: 'project_file_uploads.read',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
  uploadParts: defineProjectFileOperation({
    ...POLICY,
    id: 'project_file_uploads.parts',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
  uploadComplete: defineProjectFileOperation({
    ...POLICY,
    id: 'project_file_uploads.complete',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
  uploadCancel: defineProjectFileOperation({
    ...POLICY,
    id: 'project_file_uploads.cancel',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
  listFolders: defineProjectFileOperation({
    ...POLICY,
    id: 'project_file_folders.list',
    capability: 'files.use',
    access: 'read',
    target: 'project',
    oauthScope: 'api:read',
  }),
  createFolder: defineProjectFileOperation({
    ...POLICY,
    id: 'project_file_folders.create',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
  updateFolder: defineProjectFileOperation({
    ...POLICY,
    id: 'project_file_folders.update',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
  list: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.list',
    capability: 'files.use',
    access: 'read',
    target: 'project',
    oauthScope: 'api:read',
  }),
  resolveReference: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.resolve_reference',
    capability: 'files.use',
    access: 'read',
    target: 'project',
    oauthScope: 'api:read',
  }),
  readMetadata: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.read_metadata',
    capability: 'files.use',
    access: 'read',
    target: 'file',
    oauthScope: 'api:read',
  }),
  readArtifact: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.read_artifact',
    capability: 'files.use',
    access: 'read',
    target: 'file',
    oauthScope: 'api:read',
  }),
  readContent: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.read_content',
    capability: 'files.use',
    access: 'read',
    target: 'file',
    oauthScope: 'api:read',
    delegatedServices: ['copilot', 'realtime'],
  }),
  create: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.create',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
  updateContent: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.update_content',
    capability: 'files.use',
    access: 'write',
    target: 'file',
    oauthScope: 'api:write',
    delegatedServices: ['copilot', 'realtime'],
  }),
  rename: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.rename',
    capability: 'files.use',
    access: 'write',
    target: 'file',
    oauthScope: 'api:write',
  }),
  archiveItems: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.archive_items',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
  moveItems: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.move_items',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
  restore: defineProjectFileOperation({
    ...POLICY,
    id: 'project_files.restore',
    capability: 'files.use',
    access: 'write',
    target: 'file',
    fileScope: 'all',
    oauthScope: 'api:write',
  }),
  restoreFolder: defineProjectFileOperation({
    ...POLICY,
    id: 'project_file_folders.restore',
    capability: 'files.use',
    access: 'write',
    target: 'project',
    oauthScope: 'api:write',
  }),
} as const

export type ProjectFileOperation =
  (typeof projectFileOperations)[keyof typeof projectFileOperations]
