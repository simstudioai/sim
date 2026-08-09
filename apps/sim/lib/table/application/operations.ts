import { defineWorkspaceOperation } from '@/lib/core/application'

const ALL_PRINCIPAL_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
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

export const tableOperations = {
  list: readOperation('tables.list'),
  read: readOperation('tables.read'),
  create: writeOperation('tables.create'),
  update: writeOperation('tables.update'),
  delete: writeOperation('tables.delete'),
  listFolders: readOperation('tables.folders.list'),
  createFolder: writeOperation('tables.folders.create'),
  updateFolder: writeOperation('tables.folders.update'),
  deleteFolder: writeOperation('tables.folders.delete'),
  addColumn: writeOperation('tables.columns.add'),
  updateColumn: writeOperation('tables.columns.update'),
  deleteColumn: writeOperation('tables.columns.delete'),
  listRows: readOperation('tables.rows.list'),
  queryRows: readOperation('tables.rows.query'),
  findRows: readOperation('tables.rows.find'),
  readRow: readOperation('tables.rows.read'),
  createRows: writeOperation('tables.rows.create'),
  replaceRows: writeOperation('tables.rows.replace'),
  updateRow: writeOperation('tables.rows.update'),
  updateRows: writeOperation('tables.rows.update_many'),
  deleteRow: writeOperation('tables.rows.delete'),
  deleteRows: writeOperation('tables.rows.delete_many'),
  upsertRow: writeOperation('tables.rows.upsert'),
  listViews: readOperation('tables.views.list'),
  readView: readOperation('tables.views.read'),
  createView: writeOperation('tables.views.create'),
  updateView: writeOperation('tables.views.update'),
  deleteView: writeOperation('tables.views.delete'),
  listGroups: readOperation('tables.groups.list'),
  createGroup: writeOperation('tables.groups.create'),
  updateGroup: writeOperation('tables.groups.update'),
  deleteGroup: writeOperation('tables.groups.delete'),
  startRun: writeOperation('tables.runs.start'),
  cancelRuns: writeOperation('tables.runs.cancel'),
  createImport: writeOperation('tables.imports.create'),
  readImport: readOperation('tables.imports.read'),
  createImportParts: writeOperation('tables.imports.create_parts'),
  completeImport: writeOperation('tables.imports.complete'),
  cancelImport: writeOperation('tables.imports.cancel'),
  createExport: readOperation('tables.exports.create'),
  readExport: readOperation('tables.exports.read'),
  cancelExport: readOperation('tables.exports.cancel'),
  downloadExport: readOperation('tables.exports.download'),
} as const

export type TableOperation = (typeof tableOperations)[keyof typeof tableOperations]
