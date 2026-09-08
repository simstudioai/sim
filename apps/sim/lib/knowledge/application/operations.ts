import {
  type ApplicationOperation,
  assertOperationCapability,
} from '@/lib/core/application/operation'
import {
  defineOrganizationOperation,
  type OrganizationOperation,
} from '@/lib/core/application/organization-operation'
import {
  defineWorkspaceOperation,
  type WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'

export type ScopedKnowledgeOperation<O extends WorkspaceOperation = WorkspaceOperation> = O & {
  readonly organizationOperation: OrganizationOperation
}

interface KnowledgeOperationOptions {
  organizationDelegation?: 'deny'
}

/** Binds organization policy to the same semantic operation declared for workspace access. */
function defineKnowledgeOperation<const O extends WorkspaceOperation>(
  operation: O,
  options?: KnowledgeOperationOptions
): ScopedKnowledgeOperation<O> {
  const supportsOrganizationDelegation =
    options?.organizationDelegation !== 'deny' &&
    operation.minimumRole === 'read' &&
    operation.delegatedServices?.includes('copilot')
  const organizationOperation = defineOrganizationOperation({
    id: operation.id,
    capability: operation.capability,
    minimumRole: operation.minimumRole === 'read' ? 'member' : 'admin',
    /** Setup operations may admit readers but still write; bearer clients need write consent. */
    oauthScope: operation.oauthScope ?? 'api:write',
    ...(supportsOrganizationDelegation
      ? ({
          principalKinds: [
            'session',
            'personal_api_key',
            'oauth_access_token',
            'organization_delegated',
          ],
          delegationAudience: 'sim:knowledge',
        } as const)
      : ({ principalKinds: ['session', 'personal_api_key', 'oauth_access_token'] } as const)),
  })
  return Object.freeze({ ...operation, organizationOperation })
}

const ALL_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot'],
} as const
const COPILOT_PRINCIPAL_POLICY = {
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
} as const

const ALL_PRINCIPAL_WITH_EXECUTOR_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot', 'executor'],
} as const

const HTTP_PRINCIPAL_KINDS = [
  'session',
  'personal_api_key',
  'oauth_access_token',
  'workspace_api_key',
] as const

const HUMAN_AND_DELEGATED_PRINCIPAL_KINDS = [
  'session',
  'personal_api_key',
  'oauth_access_token',
  'delegated',
] as const

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
  list: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.list',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_POLICY,
    })
  ),
  read: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.read',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_POLICY,
    })
  ),
  /**
   * The only operation that brings a knowledge base into existence, so it is the
   * only one `knowledge.create` governs — a group may be allowed to query,
   * populate and organize the bases it already has without opening new ones.
   */
  create: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.create',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.create',
      ...ALL_PRINCIPAL_POLICY,
    })
  ),
  update: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.update',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_POLICY,
    })
  ),
  delete: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.delete',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_POLICY,
    })
  ),
  /**
   * Un-archives a soft-deleted knowledge base.
   *
   * Deliberately the same policy as {@link knowledgeOperations.delete}: an
   * operation's inverse must not be harder to reach than the operation, or a
   * principal can archive a knowledge base it is then unable to recover.
   */
  restore: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.restore',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_POLICY,
    })
  ),
  bulkMoveItems: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.bulk_move_items',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_POLICY,
    })
  ),
  bulkDeleteItems: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.bulk_delete_items',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_POLICY,
    })
  ),
  bulkDelete: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.bulk_delete',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_POLICY,
    })
  ),
  renameByVfsPath: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.vfs.rename',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...COPILOT_PRINCIPAL_POLICY,
    })
  ),
  moveByVfsPath: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.vfs.move',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...COPILOT_PRINCIPAL_POLICY,
    })
  ),
  manageVfsFolders: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.vfs.folders.manage',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...COPILOT_PRINCIPAL_POLICY,
    })
  ),
  deleteByVfsPath: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.vfs.delete',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...COPILOT_PRINCIPAL_POLICY,
    })
  ),
  search: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.search',
      oauthScope: 'search:read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
    })
  ),
  listFolders: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.folders.list',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_POLICY,
    }),
    /** Folder mentions resolve workspace folders; organization delegation stays disabled. */
    { organizationDelegation: 'deny' }
  ),
  createFolder: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.folders.create',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      principalKinds: HTTP_PRINCIPAL_KINDS,
    })
  ),
  relocateFolder: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.folders.relocate',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      principalKinds: HTTP_PRINCIPAL_KINDS,
    })
  ),
  deleteFolder: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.folders.delete',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      principalKinds: HTTP_PRINCIPAL_KINDS,
    })
  ),
  listDocuments: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.list',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
    })
  ),
  readDocument: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.read',
      oauthScope: 'search:read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
    })
  ),
  /**
   * The single-request upload path: the caller hands over file bytes, so the
   * document's provenance is whatever the caller chose. `knowledge.upload` is
   * what an organization withholds to admit documents only from the connectors
   * it sanctioned.
   */
  uploadDocument: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.upload',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.upload',
      ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
    })
  ),
  addWorkspaceFiles: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.add_workspace_files',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  deleteDocument: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.delete',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
    })
  ),
  bulkDeleteDocuments: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.bulk_delete',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  updateDocument: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.update',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
    })
  ),
  bulkDocuments: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.bulk',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  listChunks: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.chunks.list',
      oauthScope: 'search:read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
    })
  ),
  readChunk: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.chunks.read',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  createChunk: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.chunks.create',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
    })
  ),
  updateChunk: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.chunks.update',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
    })
  ),
  deleteChunk: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.chunks.delete',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
    })
  ),
  bulkChunks: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.chunks.bulk',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  /**
   * The tag vocabulary is required input for two operations a workspace API key
   * may already perform — filtering documents and search by tag display name —
   * so it carries the same policy as those sibling reads (`documents.list`,
   * `read`, `search`) rather than the stricter one the tag *writes* keep.
   */
  listTags: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.tags.list',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      ...ALL_PRINCIPAL_WITH_EXECUTOR_POLICY,
    })
  ),
  createTag: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.tags.create',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  updateTag: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.tags.update',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  deleteTag: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.tags.delete',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  readTagUsage: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.tags.read_usage',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  readDetailedTagUsage: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.tags.read_detailed_usage',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  readNextTagSlot: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.tags.read_next_slot',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  /**
   * Bulk upsert of a knowledge base's tag vocabulary.
   *
   * Named for the knowledge base it writes, not the document a caller used to
   * address it through: the write targets `knowledge_base_tag_definitions` and
   * its audit entry has always been a `KNOWLEDGE_BASE` one.
   */
  saveDocumentTagDefinitions: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.tags.bulk_save',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  /** Removal over that same vocabulary — unused definitions, or all of them. */
  deleteDocumentTagDefinitions: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.tags.cleanup',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  listConnectors: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.list',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
    })
  ),
  readConnector: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.read',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
    })
  ),
  createConnector: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.create',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  updateConnector: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.update',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  /**
   * Which people a connector crawls as is an admin decision: members mode
   * grants the connector every enrolled member's credential. Session only —
   * it is a settings action, not something an agent or key performs.
   */
  updateConnectorAccess: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.access.update',
      minimumRole: 'admin',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      principalKinds: ['session'],
    })
  ),
  listSearchSources: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.search.sources.list',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      principalKinds: ['session'],
    })
  ),
  listSearchIntegrations: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.search.integrations.list',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      principalKinds: ['session'],
    })
  ),
  approveSearchIntegration: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.search.integrations.approve',
      minimumRole: 'admin',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      principalKinds: ['session'],
    })
  ),
  /** Sources with a personal connection, including identities used by mirrored ACLs. */
  listWorkspaceMemberConnectors: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.members.list',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      principalKinds: ['session'],
    })
  ),
  /**
   * A workspace reader connecting their own account for a member crawl or a
   * mirrored-ACL identity. Enrollment never creates crawler access grants.
   */
  enrollConnectorMember: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.members.enroll',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      principalKinds: ['session'],
    })
  ),
  /**
   * Connecting a Sim Search source: any reader may connect their own account.
   * The first connect of a source also creates its knowledge base and
   * connector, which the use case reserves for an admin and refuses to anyone
   * else with the way forward (ask an admin to connect the source first).
   */
  simSearchConnect: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.simSearch.connect',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      principalKinds: ['session'],
    })
  ),
  createApprovedSearchSource: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.search.sources.connectApproved',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      principalKinds: ['session'],
    })
  ),
  readSearchIndex: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.search.index.read',
      oauthScope: 'search:read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      capability: 'knowledge.use',
      principalKinds: HTTP_PRINCIPAL_KINDS,
    })
  ),
  prepareSearchSource: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.search.sources.prepare',
      minimumRole: 'admin',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      principalKinds: ['session'],
    })
  ),
  deleteConnector: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.delete',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  syncConnector: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.sync',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_COPILOT_AND_EXECUTOR_PRINCIPAL_POLICY,
    })
  ),
  listConnectorDocuments: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.documents.list',
      oauthScope: 'api:read',
      minimumRole: 'read',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  updateConnectorDocuments: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.connectors.documents.update',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'deny',
      capability: 'knowledge.use',
      ...HUMAN_AND_COPILOT_PRINCIPAL_POLICY,
    })
  ),
  /**
   * The four session operations are one upload, split across requests only
   * because a large file cannot arrive in one. They carry the same capability
   * for that reason — including cancel, which would otherwise be the one open
   * door into a surface the group was denied.
   */
  uploadCreate: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.upload.create',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.upload',
      principalKinds: HTTP_PRINCIPAL_KINDS,
    })
  ),
  uploadParts: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.upload.parts',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.upload',
      principalKinds: HTTP_PRINCIPAL_KINDS,
    })
  ),
  uploadComplete: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.upload.complete',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.upload',
      principalKinds: HTTP_PRINCIPAL_KINDS,
    })
  ),
  uploadCancel: defineKnowledgeOperation(
    defineWorkspaceOperation({
      id: 'knowledge.documents.upload.cancel',
      oauthScope: 'api:write',
      minimumRole: 'write',
      workspaceApiKey: 'allow',
      capability: 'knowledge.upload',
      principalKinds: HTTP_PRINCIPAL_KINDS,
    })
  ),
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
