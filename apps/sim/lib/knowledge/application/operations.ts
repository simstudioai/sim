import type { ApplicationOperation } from '@/lib/core/application'
import { assertOperationCapability, defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const
const COPILOT_PRINCIPAL_POLICY = {
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
} as const

const ALL_PRINCIPAL_WITH_EXECUTOR_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot', 'executor'],
} as const

const HTTP_PRINCIPAL_KINDS = ['session', 'personal_api_key', 'workspace_api_key'] as const

const HUMAN_AND_DELEGATED_PRINCIPAL_KINDS = ['session', 'personal_api_key', 'delegated'] as const

const HUMAN_AND_COPILOT_PRINCIPAL_POLICY = {
  principalKinds: HUMAN_AND_DELEGATED_PRINCIPAL_KINDS,
  delegatedServices: ['copilot'],
} as const

const HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY = {
  principalKinds: HUMAN_AND_DELEGATED_PRINCIPAL_KINDS,
  delegatedServices: ['copilot', 'executor'],
} as const

export const knowledgeOperations = {
  /**
   * Lists the workspace's knowledge bases, active or archived.
   *
   * One operation covers both lifecycle scopes: the archived set is the same rows
   * under a different `deleted_at` predicate, and it is the only discovery read
   * that makes restore usable, so denying it to a principal that may archive and
   * restore leaves that principal able to recover only the ids it happened to
   * record itself.
   */
  list: defineWorkspaceOperation({
    id: 'knowledge.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  read: defineWorkspaceOperation({
    id: 'knowledge.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  /**
   * The only operation that brings a knowledge base into existence, so it is the
   * only one `knowledge.create` governs — a group may be allowed to query,
   * populate and organize the bases it already has without opening new ones.
   */
  create: defineWorkspaceOperation({
    id: 'knowledge.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.create',
    ...ALL_PRINCIPAL_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'knowledge.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'knowledge.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  /**
   * Un-archives a soft-deleted knowledge base.
   *
   * Deliberately the same policy as {@link knowledgeOperations.delete}: an
   * operation's inverse must not be harder to reach than the operation, or a
   * principal can archive a knowledge base it is then unable to recover.
   */
  restore: defineWorkspaceOperation({
    id: 'knowledge.restore',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  bulkMoveItems: defineWorkspaceOperation({
    id: 'knowledge.bulk_move_items',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  bulkDeleteItems: defineWorkspaceOperation({
    id: 'knowledge.bulk_delete_items',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  bulkDelete: defineWorkspaceOperation({
    id: 'knowledge.bulk_delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_POLICY,
  }),
  renameByVfsPath: defineWorkspaceOperation({
    id: 'knowledge.vfs.rename',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  moveByVfsPath: defineWorkspaceOperation({
    id: 'knowledge.vfs.move',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  manageVfsFolders: defineWorkspaceOperation({
    id: 'knowledge.vfs.folders.manage',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  deleteByVfsPath: defineWorkspaceOperation({
    id: 'knowledge.vfs.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  search: defineWorkspaceOperation({
    id: 'knowledge.search',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
  }),
  listFolders: defineWorkspaceOperation({
    id: 'knowledge.folders.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  createFolder: defineWorkspaceOperation({
    id: 'knowledge.folders.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  relocateFolder: defineWorkspaceOperation({
    id: 'knowledge.folders.relocate',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  deleteFolder: defineWorkspaceOperation({
    id: 'knowledge.folders.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  listDocuments: defineWorkspaceOperation({
    id: 'knowledge.documents.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
  }),
  readDocument: defineWorkspaceOperation({
    id: 'knowledge.documents.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
  }),
  /**
   * The single-request upload path: the caller hands over file bytes, so the
   * document's provenance is whatever the caller chose. `knowledge.upload` is
   * what an organization withholds to admit documents only from the connectors
   * it sanctioned.
   */
  uploadDocument: defineWorkspaceOperation({
    id: 'knowledge.documents.upload',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.upload',
    ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
  }),
  addWorkspaceFiles: defineWorkspaceOperation({
    id: 'knowledge.documents.add_workspace_files',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  deleteDocument: defineWorkspaceOperation({
    id: 'knowledge.documents.delete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
  }),
  bulkDeleteDocuments: defineWorkspaceOperation({
    id: 'knowledge.documents.bulk_delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  updateDocument: defineWorkspaceOperation({
    id: 'knowledge.documents.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
  }),
  bulkDocuments: defineWorkspaceOperation({
    id: 'knowledge.documents.bulk',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  listChunks: defineWorkspaceOperation({
    id: 'knowledge.chunks.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
  }),
  readChunk: defineWorkspaceOperation({
    id: 'knowledge.chunks.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  createChunk: defineWorkspaceOperation({
    id: 'knowledge.chunks.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
  }),
  updateChunk: defineWorkspaceOperation({
    id: 'knowledge.chunks.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
  }),
  deleteChunk: defineWorkspaceOperation({
    id: 'knowledge.chunks.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
  }),
  bulkChunks: defineWorkspaceOperation({
    id: 'knowledge.chunks.bulk',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  /**
   * The tag vocabulary is required input for two operations a workspace API key
   * may already perform — filtering documents and search by tag display name —
   * so it carries the same policy as those sibling reads (`documents.list`,
   * `read`, `search`) rather than the stricter one the tag *writes* keep.
   */
  listTags: defineWorkspaceOperation({
    id: 'knowledge.tags.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'knowledge.use',
    ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
  }),
  createTag: defineWorkspaceOperation({
    id: 'knowledge.tags.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  updateTag: defineWorkspaceOperation({
    id: 'knowledge.tags.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  deleteTag: defineWorkspaceOperation({
    id: 'knowledge.tags.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  readTagUsage: defineWorkspaceOperation({
    id: 'knowledge.tags.read_usage',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  readDetailedTagUsage: defineWorkspaceOperation({
    id: 'knowledge.tags.read_detailed_usage',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  readNextTagSlot: defineWorkspaceOperation({
    id: 'knowledge.tags.read_next_slot',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  /**
   * Bulk upsert of a knowledge base's tag vocabulary.
   *
   * Named for the knowledge base it writes, not the document a caller used to
   * address it through: the write targets `knowledge_base_tag_definitions` and
   * its audit entry has always been a `KNOWLEDGE_BASE` one.
   */
  saveDocumentTagDefinitions: defineWorkspaceOperation({
    id: 'knowledge.tags.bulk_save',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  /** Removal over that same vocabulary — unused definitions, or all of them. */
  deleteDocumentTagDefinitions: defineWorkspaceOperation({
    id: 'knowledge.tags.cleanup',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  listConnectors: defineWorkspaceOperation({
    id: 'knowledge.connectors.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
  }),
  readConnector: defineWorkspaceOperation({
    id: 'knowledge.connectors.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
  }),
  createConnector: defineWorkspaceOperation({
    id: 'knowledge.connectors.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  updateConnector: defineWorkspaceOperation({
    id: 'knowledge.connectors.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  /**
   * Which people a connector crawls as is an admin decision: members mode
   * grants the connector every enrolled member's credential. Session only —
   * it is a settings action, not something an agent or key performs.
   */
  updateConnectorAccess: defineWorkspaceOperation({
    id: 'knowledge.connectors.access.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    principalKinds: ['session'],
  }),
  /**
   * A workspace member joining a per-member connector: any reader may connect
   * their own account, which only ever widens what they themselves see.
   */
  enrollConnectorMember: defineWorkspaceOperation({
    id: 'knowledge.connectors.members.enroll',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    principalKinds: ['session'],
  }),
  deleteConnector: defineWorkspaceOperation({
    id: 'knowledge.connectors.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  syncConnector: defineWorkspaceOperation({
    id: 'knowledge.connectors.sync',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
  }),
  listConnectorDocuments: defineWorkspaceOperation({
    id: 'knowledge.connectors.documents.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  updateConnectorDocuments: defineWorkspaceOperation({
    id: 'knowledge.connectors.documents.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'knowledge.use',
    ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
  }),
  /**
   * The four session operations are one upload, split across requests only
   * because a large file cannot arrive in one. They carry the same capability
   * for that reason — including cancel, which would otherwise be the one open
   * door into a surface the group was denied.
   */
  uploadCreate: defineWorkspaceOperation({
    id: 'knowledge.documents.upload.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.upload',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  uploadParts: defineWorkspaceOperation({
    id: 'knowledge.documents.upload.parts',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.upload',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  uploadComplete: defineWorkspaceOperation({
    id: 'knowledge.documents.upload.complete',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.upload',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
  uploadCancel: defineWorkspaceOperation({
    id: 'knowledge.documents.upload.cancel',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'knowledge.upload',
    principalKinds: HTTP_PRINCIPAL_KINDS,
  }),
} as const

/**
 * The session-scoped entry points, which resolve a knowledge base first and then
 * hand authorization to the workspace-scoped `knowledgeOperations` sibling that
 * matches. The capability rides on that sibling, so each of these declares
 * `'none'` — but declares it, rather than being minted from a bare object
 * literal as they were, which is the form that kept them out of
 * `check:permission-group-enforcement` entirely.
 */
function defineKnowledgeSessionOperation<const Id extends string>(
  operation: ApplicationOperation<Id>
): ApplicationOperation<Id> {
  assertOperationCapability(operation)
  return Object.freeze(operation)
}

export const knowledgeSessionOperations = {
  // permission-group-exempt: delegates to knowledgeOperations.list, which carries knowledge.use
  list: defineKnowledgeSessionOperation({ id: 'knowledge.session.list', capability: 'none' }),
  // permission-group-exempt: delegates to knowledgeOperations.read, which carries knowledge.use
  read: defineKnowledgeSessionOperation({ id: 'knowledge.session.read', capability: 'none' }),
  // permission-group-exempt: delegates to knowledgeOperations.update, which carries knowledge.use
  update: defineKnowledgeSessionOperation({ id: 'knowledge.session.update', capability: 'none' }),
  // permission-group-exempt: delegates to knowledgeOperations.delete, which carries knowledge.use
  delete: defineKnowledgeSessionOperation({ id: 'knowledge.session.delete', capability: 'none' }),
  // permission-group-exempt: delegates to knowledgeOperations.restore, which carries knowledge.use
  restore: defineKnowledgeSessionOperation({ id: 'knowledge.session.restore', capability: 'none' }),
} as const

export type KnowledgeOperation = (typeof knowledgeOperations)[keyof typeof knowledgeOperations]
