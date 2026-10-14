import type { ContentDeliveryDeclaration } from '@/lib/core/application'
import type { OperationDeclarableCapability } from '@/lib/core/application/operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

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

const ALL_TABLE_TOOL_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot', 'executor'],
} as const

function readOperation<const Id extends string>(
  id: Id,
  contentDelivery: ContentDeliveryDeclaration
) {
  return defineWorkspaceOperation({
    id,
    contentDelivery,
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'tables.use',
    ...ALL_PRINCIPAL_POLICY,
  })
}

function writeOperation<const Id extends string>(
  id: Id,
  contentDelivery: ContentDeliveryDeclaration
) {
  return defineWorkspaceOperation({
    id,
    contentDelivery,
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'tables.use',
    ...ALL_PRINCIPAL_POLICY,
  })
}

/**
 * Not every table operation needs the same capability — creating a table and
 * exporting one are each withheld separately from ordinary table use — so the
 * factories that mint more than one kind take the capability as an argument.
 *
 * No default, deliberately: a default would let a new operation inherit
 * `tables.use` without anyone deciding it should, which is exactly the
 * unreviewed omission this gate exists to prevent.
 */
function toolWriteOperation<const Id extends string>(
  id: Id,
  capability: OperationDeclarableCapability,
  contentDelivery: ContentDeliveryDeclaration
) {
  return defineWorkspaceOperation({
    id,
    contentDelivery,
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability,
    ...ALL_TABLE_TOOL_PRINCIPAL_POLICY,
  })
}

function toolReadOperation<const Id extends string>(
  id: Id,
  contentDelivery: ContentDeliveryDeclaration
) {
  return defineWorkspaceOperation({
    id,
    contentDelivery,
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'tables.use',
    ...ALL_TABLE_TOOL_PRINCIPAL_POLICY,
  })
}

function stagedReadOperation<const Id extends string>(
  id: Id,
  capability: OperationDeclarableCapability,
  oauthScope: 'api:read' | 'api:write'
) {
  return defineWorkspaceOperation({
    id,
    contentDelivery: 'none',
    oauthScope,
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability,
    ...ALL_TABLE_TOOL_PRINCIPAL_POLICY,
  })
}

function stagedWriteOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    contentDelivery: 'none',
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'tables.use',
    ...ALL_TABLE_TOOL_PRINCIPAL_POLICY,
  })
}

export const tableOperations = {
  list: toolReadOperation('tables.list', 'none'),
  read: toolReadOperation('tables.read', 'none'),
  readSnapshot: defineWorkspaceOperation({
    id: 'tables.snapshot.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'tables.use',
    contentDelivery: 'sourced',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  create: toolWriteOperation('tables.create', 'tables.create', 'none'),
  update: writeOperation('tables.update', 'none'),
  delete: writeOperation('tables.delete', 'none'),
  restore: writeOperation('tables.restore', 'none'),
  bulkMove: writeOperation('tables.bulk_move', 'none'),
  bulkDelete: writeOperation('tables.bulk_delete', 'none'),
  listFolders: readOperation('tables.folders.list', 'none'),
  createFolder: writeOperation('tables.folders.create', 'none'),
  updateFolder: writeOperation('tables.folders.update', 'none'),
  deleteFolder: writeOperation('tables.folders.delete', 'none'),
  restoreFolder: writeOperation('tables.folders.restore', 'none'),
  addColumn: writeOperation('tables.columns.add', 'none'),
  updateColumn: writeOperation('tables.columns.update', 'none'),
  deleteColumn: writeOperation('tables.columns.delete', 'none'),
  listRows: readOperation('tables.rows.list', 'sourced'),
  analytics: defineWorkspaceOperation({
    id: 'tables.rows.analytics',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'tables.use',
    principalKinds: ['session'],
  }),
  queryRows: toolReadOperation('tables.rows.query', 'sourced'),
  searchRows: readOperation('tables.rows.search', 'none'),
  readRow: toolReadOperation('tables.rows.read', 'sourced'),
  createRows: toolWriteOperation('tables.rows.create', 'tables.use', 'sourced'),
  replaceRows: writeOperation('tables.rows.replace', 'none'),
  updateRow: toolWriteOperation('tables.rows.update', 'tables.use', 'sourced'),
  updateRows: toolWriteOperation('tables.rows.update_many', 'tables.use', 'none'),
  deleteRow: toolWriteOperation('tables.rows.delete', 'tables.use', 'none'),
  deleteRows: toolWriteOperation('tables.rows.delete_many', 'tables.use', 'none'),
  upsertRow: toolWriteOperation('tables.rows.upsert', 'tables.use', 'sourced'),
  listViews: readOperation('tables.views.list', 'none'),
  readView: readOperation('tables.views.read', 'none'),
  createView: writeOperation('tables.views.create', 'none'),
  updateView: writeOperation('tables.views.update', 'none'),
  deleteView: writeOperation('tables.views.delete', 'none'),
  listGroups: readOperation('tables.groups.list', 'none'),
  createGroup: toolWriteOperation('tables.groups.create', 'tables.use', 'none'),
  updateGroup: toolWriteOperation('tables.groups.update', 'tables.use', 'none'),
  deleteGroup: toolWriteOperation('tables.groups.delete', 'tables.use', 'none'),
  startRun: writeOperation('tables.runs.start', 'none'),
  /** Reading the state of a run — including one you started — is a read. */
  readRun: readOperation('tables.runs.read', 'none'),
  cancelRuns: writeOperation('tables.runs.cancel', 'none'),
  createImport: stagedWriteOperation('tables.imports.create'),
  readImport: stagedReadOperation('tables.imports.read', 'tables.use', 'api:read'),
  createImportParts: stagedWriteOperation('tables.imports.create_parts'),
  completeImport: stagedWriteOperation('tables.imports.complete'),
  cancelImport: stagedWriteOperation('tables.imports.cancel'),
  /**
   * Only generating the file and fetching it are extraction. Reading an
   * export's status carries no rows, and cancelling one stops an extraction
   * rather than performing it — gating either would strand a member with an
   * export they can neither watch nor stop after the group changed.
   */
  createExport: stagedReadOperation('tables.exports.create', 'tables.export', 'api:write'),
  readExport: stagedReadOperation('tables.exports.read', 'tables.use', 'api:read'),
  cancelExport: stagedReadOperation('tables.exports.cancel', 'tables.use', 'api:write'),
  /**
   * A signed link to the whole table as plaintext, which no row provenance follows once fetched,
   * so Chat is not delegated to it; it reads rows, each under its own provenance, instead.
   */
  downloadExport: defineWorkspaceOperation({
    id: 'tables.exports.download',
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'tables.export',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token', 'workspace_api_key'],
  }),
} as const

export type TableOperation = (typeof tableOperations)[keyof typeof tableOperations]
