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
  restrictedExternalAccess?: 'workspace_read'
) {
  return defineWorkspaceOperation({
    id,
    restrictedExternalAccess,
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'tables.use',
    ...ALL_PRINCIPAL_POLICY,
  })
}

function writeOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
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
  capability: OperationDeclarableCapability
) {
  return defineWorkspaceOperation({
    id,
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability,
    ...ALL_TABLE_TOOL_PRINCIPAL_POLICY,
  })
}

function toolReadOperation<const Id extends string>(
  id: Id,
  restrictedExternalAccess?: 'workspace_read'
) {
  return defineWorkspaceOperation({
    id,
    restrictedExternalAccess,
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
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'tables.use',
    ...ALL_TABLE_TOOL_PRINCIPAL_POLICY,
  })
}

export const tableOperations = {
  list: toolReadOperation('tables.list', 'workspace_read'),
  read: toolReadOperation('tables.read', 'workspace_read'),
  readSnapshot: defineWorkspaceOperation({
    id: 'tables.snapshot.read',
    restrictedExternalAccess: 'workspace_read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'tables.use',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  create: toolWriteOperation('tables.create', 'tables.create'),
  update: writeOperation('tables.update'),
  delete: writeOperation('tables.delete'),
  restore: writeOperation('tables.restore'),
  bulkMove: writeOperation('tables.bulk_move'),
  bulkDelete: writeOperation('tables.bulk_delete'),
  listFolders: readOperation('tables.folders.list', 'workspace_read'),
  createFolder: writeOperation('tables.folders.create'),
  updateFolder: writeOperation('tables.folders.update'),
  deleteFolder: writeOperation('tables.folders.delete'),
  restoreFolder: writeOperation('tables.folders.restore'),
  addColumn: writeOperation('tables.columns.add'),
  updateColumn: writeOperation('tables.columns.update'),
  deleteColumn: writeOperation('tables.columns.delete'),
  listRows: readOperation('tables.rows.list', 'workspace_read'),
  analytics: defineWorkspaceOperation({
    id: 'tables.rows.analytics',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'tables.use',
    principalKinds: ['session'],
  }),
  queryRows: toolReadOperation('tables.rows.query', 'workspace_read'),
  searchRows: readOperation('tables.rows.search', 'workspace_read'),
  readRow: toolReadOperation('tables.rows.read', 'workspace_read'),
  createRows: toolWriteOperation('tables.rows.create', 'tables.use'),
  replaceRows: writeOperation('tables.rows.replace'),
  updateRow: toolWriteOperation('tables.rows.update', 'tables.use'),
  updateRows: toolWriteOperation('tables.rows.update_many', 'tables.use'),
  deleteRow: toolWriteOperation('tables.rows.delete', 'tables.use'),
  deleteRows: toolWriteOperation('tables.rows.delete_many', 'tables.use'),
  upsertRow: toolWriteOperation('tables.rows.upsert', 'tables.use'),
  listViews: readOperation('tables.views.list', 'workspace_read'),
  readView: readOperation('tables.views.read', 'workspace_read'),
  createView: writeOperation('tables.views.create'),
  updateView: writeOperation('tables.views.update'),
  deleteView: writeOperation('tables.views.delete'),
  listGroups: readOperation('tables.groups.list', 'workspace_read'),
  createGroup: toolWriteOperation('tables.groups.create', 'tables.use'),
  updateGroup: toolWriteOperation('tables.groups.update', 'tables.use'),
  deleteGroup: toolWriteOperation('tables.groups.delete', 'tables.use'),
  startRun: writeOperation('tables.runs.start'),
  /** Reading the state of a run — including one you started — is a read. */
  readRun: readOperation('tables.runs.read', 'workspace_read'),
  cancelRuns: writeOperation('tables.runs.cancel'),
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
  downloadExport: stagedReadOperation('tables.exports.download', 'tables.export', 'api:read'),
} as const

export type TableOperation = (typeof tableOperations)[keyof typeof tableOperations]
