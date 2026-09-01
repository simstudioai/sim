import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const
const COPILOT_PRINCIPAL_POLICY = {
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
} as const

const ALL_TABLE_TOOL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot', 'executor'],
} as const

const INTERNAL_EXECUTOR_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['executor'],
} as const

function readOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  })
}

function writeOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_PRINCIPAL_POLICY,
  })
}

function toolWriteOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...ALL_TABLE_TOOL_PRINCIPAL_POLICY,
  })
}

function toolReadOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...ALL_TABLE_TOOL_PRINCIPAL_POLICY,
  })
}

function internalExecutorReadOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...INTERNAL_EXECUTOR_PRINCIPAL_POLICY,
  })
}

function internalExecutorWriteOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    ...INTERNAL_EXECUTOR_PRINCIPAL_POLICY,
  })
}

function delegatedWriteOperation<const Id extends string>(id: Id) {
  return defineWorkspaceOperation({
    id,
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['copilot'],
  })
}

export const tableOperations = {
  list: toolReadOperation('tables.list'),
  read: toolReadOperation('tables.read'),
  create: toolWriteOperation('tables.create'),
  update: writeOperation('tables.update'),
  delete: writeOperation('tables.delete'),
  restore: writeOperation('tables.restore'),
  bulkMove: writeOperation('tables.bulk_move'),
  bulkDelete: writeOperation('tables.bulk_delete'),
  renameByVfsPath: defineWorkspaceOperation({
    id: 'tables.vfs.rename',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  moveByVfsPath: defineWorkspaceOperation({
    id: 'tables.vfs.move',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    ...COPILOT_PRINCIPAL_POLICY,
  }),
  deleteByVfsPath: defineWorkspaceOperation({
    id: 'tables.vfs.delete',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
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
  createRows: toolWriteOperation('tables.rows.create'),
  replaceRows: writeOperation('tables.rows.replace'),
  updateRow: toolWriteOperation('tables.rows.update'),
  updateRows: toolWriteOperation('tables.rows.update_many'),
  deleteRow: toolWriteOperation('tables.rows.delete'),
  deleteRows: toolWriteOperation('tables.rows.delete_many'),
  upsertRow: toolWriteOperation('tables.rows.upsert'),
  listViews: readOperation('tables.views.list'),
  readView: readOperation('tables.views.read'),
  createView: writeOperation('tables.views.create'),
  updateView: writeOperation('tables.views.update'),
  deleteView: writeOperation('tables.views.delete'),
  listGroups: readOperation('tables.groups.list'),
  createGroup: toolWriteOperation('tables.groups.create'),
  updateGroup: toolWriteOperation('tables.groups.update'),
  deleteGroup: toolWriteOperation('tables.groups.delete'),
  startRun: writeOperation('tables.runs.start'),
  /** Reading the state of a run — including one you started — is a read. */
  readRun: readOperation('tables.runs.read'),
  cancelRuns: writeOperation('tables.runs.cancel'),
  createImport: internalExecutorWriteOperation('tables.imports.create'),
  createFromWorkspaceFile: delegatedWriteOperation('tables.imports.create_from_workspace_file'),
  importWorkspaceFile: delegatedWriteOperation('tables.imports.workspace_file'),
  readImport: internalExecutorReadOperation('tables.imports.read'),
  createImportParts: internalExecutorWriteOperation('tables.imports.create_parts'),
  completeImport: internalExecutorWriteOperation('tables.imports.complete'),
  cancelImport: internalExecutorWriteOperation('tables.imports.cancel'),
  createExport: internalExecutorReadOperation('tables.exports.create'),
  readExport: internalExecutorReadOperation('tables.exports.read'),
  cancelExport: internalExecutorReadOperation('tables.exports.cancel'),
  downloadExport: internalExecutorReadOperation('tables.exports.download'),
} as const

export type TableOperation = (typeof tableOperations)[keyof typeof tableOperations]
