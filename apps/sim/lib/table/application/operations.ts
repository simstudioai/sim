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

const INTERNAL_EXECUTOR_PRINCIPAL_POLICY = {
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['executor'],
} as const

function readOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
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

function toolReadOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    oauthScope: 'api:read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    capability: 'tables.use',
    ...ALL_TABLE_TOOL_PRINCIPAL_POLICY,
  })
}

function internalExecutorReadOperation<const Id extends string>(
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
    ...INTERNAL_EXECUTOR_PRINCIPAL_POLICY,
  })
}

function internalExecutorWriteOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    oauthScope: 'api:write',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    capability: 'tables.use',
    ...INTERNAL_EXECUTOR_PRINCIPAL_POLICY,
  })
}

function delegatedWriteOperation<const Id extends string>(
  id: Id,
  capability: OperationDeclarableCapability
) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability,
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  })
}

export const tableOperations = {
  list: toolReadOperation('tables.list'),
  read: toolReadOperation('tables.read'),
  create: toolWriteOperation('tables.create', 'tables.create'),
  update: writeOperation('tables.update'),
  delete: writeOperation('tables.delete'),
  restore: writeOperation('tables.restore'),
  bulkMove: writeOperation('tables.bulk_move'),
  bulkDelete: writeOperation('tables.bulk_delete'),
  renameByVfsPath: defineWorkspaceOperation({
    id: 'tables.vfs.rename',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'tables.use',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  moveByVfsPath: defineWorkspaceOperation({
    id: 'tables.vfs.move',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'tables.use',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  deleteByVfsPath: defineWorkspaceOperation({
    id: 'tables.vfs.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    capability: 'tables.use',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  listFolders: readOperation('tables.folders.list'),
  createFolder: writeOperation('tables.folders.create'),
  updateFolder: writeOperation('tables.folders.update'),
  deleteFolder: writeOperation('tables.folders.delete'),
  restoreFolder: writeOperation('tables.folders.restore'),
  addColumn: writeOperation('tables.columns.add'),
  updateColumn: writeOperation('tables.columns.update'),
  deleteColumn: writeOperation('tables.columns.delete'),
  listRows: readOperation('tables.rows.list'),
  queryRows: toolReadOperation('tables.rows.query'),
  searchRows: readOperation('tables.rows.search'),
  readRow: toolReadOperation('tables.rows.read'),
  createRows: toolWriteOperation('tables.rows.create', 'tables.use'),
  replaceRows: writeOperation('tables.rows.replace'),
  updateRow: toolWriteOperation('tables.rows.update', 'tables.use'),
  updateRows: toolWriteOperation('tables.rows.update_many', 'tables.use'),
  deleteRow: toolWriteOperation('tables.rows.delete', 'tables.use'),
  deleteRows: toolWriteOperation('tables.rows.delete_many', 'tables.use'),
  upsertRow: toolWriteOperation('tables.rows.upsert', 'tables.use'),
  listViews: readOperation('tables.views.list'),
  readView: readOperation('tables.views.read'),
  createView: writeOperation('tables.views.create'),
  updateView: writeOperation('tables.views.update'),
  deleteView: writeOperation('tables.views.delete'),
  listGroups: readOperation('tables.groups.list'),
  createGroup: toolWriteOperation('tables.groups.create', 'tables.use'),
  updateGroup: toolWriteOperation('tables.groups.update', 'tables.use'),
  deleteGroup: toolWriteOperation('tables.groups.delete', 'tables.use'),
  startRun: writeOperation('tables.runs.start'),
  /** Reading the state of a run — including one you started — is a read. */
  readRun: readOperation('tables.runs.read'),
  cancelRuns: writeOperation('tables.runs.cancel'),
  createImport: internalExecutorWriteOperation('tables.imports.create'),
  createFromWorkspaceFile: delegatedWriteOperation(
    'tables.imports.create_from_workspace_file',
    'tables.create'
  ),
  importWorkspaceFile: delegatedWriteOperation('tables.imports.workspace_file', 'tables.use'),
  readImport: internalExecutorReadOperation('tables.imports.read', 'tables.use', 'api:read'),
  createImportParts: internalExecutorWriteOperation('tables.imports.create_parts'),
  completeImport: internalExecutorWriteOperation('tables.imports.complete'),
  cancelImport: internalExecutorWriteOperation('tables.imports.cancel'),
  /**
   * Only generating the file and fetching it are extraction. Reading an
   * export's status carries no rows, and cancelling one stops an extraction
   * rather than performing it — gating either would strand a member with an
   * export they can neither watch nor stop after the group changed.
   */
  createExport: internalExecutorReadOperation(
    'tables.exports.create',
    'tables.export',
    'api:write'
  ),
  readExport: internalExecutorReadOperation('tables.exports.read', 'tables.use', 'api:read'),
  cancelExport: internalExecutorReadOperation('tables.exports.cancel', 'tables.use', 'api:write'),
  downloadExport: internalExecutorReadOperation(
    'tables.exports.download',
    'tables.export',
    'api:read'
  ),
} as const

export type TableOperation = (typeof tableOperations)[keyof typeof tableOperations]
