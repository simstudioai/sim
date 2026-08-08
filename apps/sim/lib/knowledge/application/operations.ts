import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_KINDS = [
  'session',
  'personal_api_key',
  'workspace_api_key',
  'delegated',
] as const

const HTTP_PRINCIPAL_KINDS = ['session', 'personal_api_key', 'workspace_api_key'] as const

export const knowledgeOperations = {
  list: defineWorkspaceOperation({
    id: 'knowledge.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  read: defineWorkspaceOperation({
    id: 'knowledge.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  create: defineWorkspaceOperation({
    id: 'knowledge.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  update: defineWorkspaceOperation({
    id: 'knowledge.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  delete: defineWorkspaceOperation({
    id: 'knowledge.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  search: defineWorkspaceOperation({
    id: 'knowledge.search',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  listFolders: defineWorkspaceOperation({
    id: 'knowledge.folders.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  createFolder: defineWorkspaceOperation({
    id: 'knowledge.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  relocateFolder: defineWorkspaceOperation({
    id: 'knowledge.folders.relocate',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  deleteFolder: defineWorkspaceOperation({
    id: 'knowledge.folders.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  listDocuments: defineWorkspaceOperation({
    id: 'knowledge.documents.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  readDocument: defineWorkspaceOperation({
    id: 'knowledge.documents.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  uploadDocument: defineWorkspaceOperation({
    id: 'knowledge.documents.upload',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  deleteDocument: defineWorkspaceOperation({
    id: 'knowledge.documents.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: ALL_PRINCIPAL_KINDS,
  }),
  uploadCreate: defineWorkspaceOperation({
    id: 'knowledge.documents.upload.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  uploadParts: defineWorkspaceOperation({
    id: 'knowledge.documents.upload.parts',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  uploadComplete: defineWorkspaceOperation({
    id: 'knowledge.documents.upload.complete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  uploadCancel: defineWorkspaceOperation({
    id: 'knowledge.documents.upload.cancel',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
} as const

export type KnowledgeOperation = (typeof knowledgeOperations)[keyof typeof knowledgeOperations]
