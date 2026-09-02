import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import type { folder } from '@sim/db/schema'
import type { ContractBody, ContractQuery } from '@/lib/api/contracts'
import type {
  createTableContract,
  deleteTableRowContract,
  deleteTableRowsContract,
  getTableRowContract,
  insertTableRowsContract,
  listTableRowsContract,
  listTablesContract,
  rowQueryContract,
  updateTableRowContract,
  updateTableRowsByFilterContract,
  upsertTableRowContract,
} from '@/lib/api/contracts/tables'
import {
  type CreateTableFolderToolBody,
  DEFAULT_TABLE_FOLDER_LIST_LIMIT,
  type DeleteTableFolderToolBody,
  type ListTableFoldersToolBody,
  type MoveTableToolBody,
  type RestoreTableFolderToolBody,
  type UpdateTableFolderToolBody,
} from '@/lib/api/contracts/tools/table'
import {
  type FolderPathIndex,
  type FolderPathView,
  ROOT_FOLDER_PATH,
  toFolderPathView,
} from '@/lib/folders/paths'
import {
  presentCreatedTable,
  presentNamedTableQueryRow,
  presentNamedTableRow,
  presentTableDetails,
  presentTableListItem,
} from '@/lib/internal/table/presentation'
import {
  readTableToolProvenanceEnvelope,
  tableToolRequestsProvenance,
} from '@/lib/internal/table/provenance'
import type { Filter, RowData, Sort, SortSpec, TablePredicate, TableSchema } from '@/lib/table'
import {
  createTableFolderUseCase,
  deleteTableFolderUseCase,
  listTableFoldersUseCase,
  restoreTableFolderUseCase,
  updateTableFolderUseCase,
} from '@/lib/table/application/folders'
import {
  createTableRows,
  deleteTableRow,
  deleteTableRows,
  queryTableRows,
  readTableRow,
  updateTableRow,
  updateTableRows,
  upsertTableRow,
} from '@/lib/table/application/rows'
import {
  createTableUseCase,
  listTableDefinitionsUseCase,
  readTableDetailsUseCase,
  updateTableUseCase,
} from '@/lib/table/application/tables'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { isTablePredicate } from '@/lib/table/query-builder/converters'
import { normalizeColumn } from '@/lib/table/wire'

export interface TableToolOperationContext {
  principal: WorkflowExecutionDelegatedPrincipal
  headers: Headers
  requestId: string
  signal?: AbortSignal
}

export interface TableToolOperationResult {
  body: Record<string, unknown>
  provenance?: unknown
}

function complete<T>(context: TableToolOperationContext, value: T): T {
  context.signal?.throwIfAborted()
  return value
}

export async function executeTableCreate(
  body: ContractBody<typeof createTableContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const result = await createTableUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      name: body.name,
      description: body.description,
      schema: {
        columns: body.schema.columns.map(normalizeColumn),
      } as TableSchema,
      initialRowCount: body.initialRowCount,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: {
        table: presentCreatedTable(result.table),
        message: 'Table created successfully',
      },
    },
  })
}

export async function executeTableList(
  _query: ContractQuery<typeof listTablesContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const result = await listTableDefinitionsUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
    },
  })
  const tables = result.tables.map(presentTableListItem)
  return complete(context, {
    body: { success: true, data: { tables, totalCount: tables.length } },
  })
}

export async function executeTableGetSchema(
  tableId: string,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const result = await readTableDetailsUseCase.execute({
    principal: context.principal,
    input: { tableId, workspaceId: context.principal.workspaceId },
  })
  return complete(context, {
    body: {
      success: true,
      data: { table: presentTableDetails(result.table, result.maxRows) },
    },
  })
}

export async function executeTableGetRow(
  tableId: string,
  rowId: string,
  _query: ContractQuery<typeof getTableRowContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const includePersistedSecretProvenance = tableToolRequestsProvenance(context.headers)
  const result = await readTableRow.execute({
    principal: context.principal,
    input: {
      tableId,
      rowId,
      assertedWorkspaceId: context.principal.workspaceId,
      includePersistedSecretProvenance,
      requestId: context.requestId,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: { row: presentNamedTableRow(result.row, result.table) },
    },
    provenance: result.secretProvenance,
  })
}

export async function executeTableInsertRows(
  tableId: string,
  body: ContractBody<typeof insertTableRowsContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const includePersistedSecretProvenance = tableToolRequestsProvenance(context.headers)
  const secretProvenanceEnvelope = readTableToolProvenanceEnvelope(context.headers, body)
  const result = await createTableRows.execute({
    principal: context.principal,
    input:
      'rows' in body
        ? {
            kind: 'batch',
            tableId,
            assertedWorkspaceId: context.principal.workspaceId,
            rows: body.rows as RowData[],
            orderKeys: body.orderKeys,
            strictWrite: false,
            dataKeying: 'names',
            secretProvenanceEnvelope,
            includePersistedSecretProvenance,
            requestId: context.requestId,
          }
        : {
            kind: 'single',
            tableId,
            assertedWorkspaceId: context.principal.workspaceId,
            data: body.data as RowData,
            position: body.position,
            afterRowId: body.afterRowId,
            beforeRowId: body.beforeRowId,
            strictWrite: false,
            dataKeying: 'names',
            secretProvenanceEnvelope,
            includePersistedSecretProvenance,
            requestId: context.requestId,
          },
  })

  if (result.kind === 'single') {
    return complete(context, {
      body: {
        success: true,
        data: {
          row: presentNamedTableQueryRow(result.row, result.table),
          message: 'Row inserted successfully',
        },
      },
      provenance: result.secretProvenance,
    })
  }

  return complete(context, {
    body: {
      success: true,
      data: {
        rows: result.rows.map((row) => presentNamedTableQueryRow(row, result.table)),
        insertedCount: result.rows.length,
        message: `Successfully inserted ${result.rows.length} rows`,
      },
    },
    provenance: result.secretProvenance,
  })
}

export async function executeTableQueryRows(
  tableId: string,
  query: ContractQuery<typeof listTableRowsContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const filter = query.filter as Filter | TablePredicate | undefined
  const sort = query.sort as Sort | SortSpec | undefined
  const includePersistedSecretProvenance = tableToolRequestsProvenance(context.headers)
  const result = await queryTableRows.execute({
    principal: context.principal,
    input: {
      tableId,
      assertedWorkspaceId: context.principal.workspaceId,
      ...(filter && isTablePredicate(filter)
        ? { predicate: filter }
        : { legacyFilter: filter as Filter | undefined }),
      ...(Array.isArray(sort)
        ? { sort: sort as SortSpec }
        : { legacySort: sort as Sort | undefined }),
      legacyKeying: 'names',
      limit: query.limit,
      offset: query.offset,
      includeTotal: query.includeTotal,
      includeRunState: query.limit !== undefined && query.limit <= TABLE_LIMITS.MAX_QUERY_LIMIT,
      allowExpandedLimit: true,
      includePersistedSecretProvenance,
      requestId: context.requestId,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: {
        rows: result.rows.map((row) => presentNamedTableQueryRow(row, result.table)),
        rowCount: result.rowCount,
        totalCount: result.totalCount,
        limit: result.limit,
        offset: result.offset,
        nextCursor: result.nextCursor,
      },
    },
    provenance: result.secretProvenance,
  })
}

export async function executeTableQueryRowsV2(
  tableId: string,
  body: ContractBody<typeof rowQueryContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const includePersistedSecretProvenance = tableToolRequestsProvenance(context.headers)
  const result = await queryTableRows.execute({
    principal: context.principal,
    input: {
      tableId,
      assertedWorkspaceId: context.principal.workspaceId,
      predicate: body.predicate,
      sort: body.sort,
      columns: body.columns,
      limit: body.limit,
      cursor: body.cursor,
      includeTotal: !body.cursor,
      includeRunState: false,
      allowExpandedLimit: true,
      requireV2Feature: true,
      includePersistedSecretProvenance,
      requestId: context.requestId,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: {
        rows: result.rows.map((row) => presentNamedTableQueryRow(row, result.table)),
        rowCount: result.rowCount,
        totalCount: result.totalCount,
        limit: result.limit,
        nextCursor: result.nextCursor,
      },
    },
    provenance: result.secretProvenance,
  })
}

export async function executeTableUpdateRow(
  tableId: string,
  rowId: string,
  body: ContractBody<typeof updateTableRowContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const includePersistedSecretProvenance = tableToolRequestsProvenance(context.headers)
  const result = await updateTableRow.execute({
    principal: context.principal,
    input: {
      tableId,
      rowId,
      assertedWorkspaceId: context.principal.workspaceId,
      data: body.data as RowData,
      dataKeying: 'names',
      strictWrite: false,
      secretProvenanceEnvelope: readTableToolProvenanceEnvelope(context.headers, body),
      includePersistedSecretProvenance,
      requestId: context.requestId,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: {
        row: presentNamedTableRow(result.row, result.table),
        message: 'Row updated successfully',
      },
    },
    provenance: result.secretProvenance,
  })
}

export async function executeTableUpdateRowsByFilter(
  tableId: string,
  body: ContractBody<typeof updateTableRowsByFilterContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const result = await updateTableRows.execute({
    principal: context.principal,
    input: {
      tableId,
      assertedWorkspaceId: context.principal.workspaceId,
      filter: body.filter,
      filterKeying: 'names',
      data: body.data as RowData,
      dataKeying: 'names',
      strictWrite: false,
      limit: body.limit,
      secretProvenanceEnvelope: readTableToolProvenanceEnvelope(context.headers, body),
      requestId: context.requestId,
    },
  })
  const matched = result.affectedCount > 0
  return complete(context, {
    body: {
      success: true,
      data: {
        message: matched ? 'Rows updated successfully' : 'No rows matched the filter criteria',
        updatedCount: result.affectedCount,
        ...(matched ? { updatedRowIds: result.affectedRowIds } : {}),
      },
    },
  })
}

export async function executeTableDeleteRow(
  tableId: string,
  rowId: string,
  _body: ContractBody<typeof deleteTableRowContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  await deleteTableRow.execute({
    principal: context.principal,
    input: {
      tableId,
      rowId,
      assertedWorkspaceId: context.principal.workspaceId,
      requestId: context.requestId,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: { message: 'Row deleted successfully', deletedCount: 1 },
    },
  })
}

export async function executeTableDeleteRows(
  tableId: string,
  body: ContractBody<typeof deleteTableRowsContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const result = await deleteTableRows.execute({
    principal: context.principal,
    input: body.rowIds
      ? {
          kind: 'ids',
          tableId,
          assertedWorkspaceId: context.principal.workspaceId,
          rowIds: body.rowIds,
          requestId: context.requestId,
        }
      : {
          kind: 'filter',
          tableId,
          assertedWorkspaceId: context.principal.workspaceId,
          filter: body.filter!,
          filterKeying: 'names',
          limit: body.limit,
          requestId: context.requestId,
        },
  })

  if (result.kind === 'ids') {
    return complete(context, {
      body: {
        success: true,
        data: {
          message:
            result.deletedCount === 0
              ? 'No matching rows found for the provided IDs'
              : 'Rows deleted successfully',
          deletedCount: result.deletedCount,
          deletedRowIds: result.deletedRowIds,
          requestedCount: result.requestedCount,
          ...(result.missingRowIds.length > 0 ? { missingRowIds: result.missingRowIds } : {}),
        },
      },
    })
  }

  return complete(context, {
    body: {
      success: true,
      data: {
        message:
          result.affectedCount === 0
            ? 'No rows matched the filter criteria'
            : 'Rows deleted successfully',
        deletedCount: result.affectedCount,
        deletedRowIds: result.affectedRowIds,
      },
    },
  })
}

export async function executeTableUpsertRow(
  tableId: string,
  body: ContractBody<typeof upsertTableRowContract>,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const includePersistedSecretProvenance = tableToolRequestsProvenance(context.headers)
  const result = await upsertTableRow.execute({
    principal: context.principal,
    input: {
      tableId,
      assertedWorkspaceId: context.principal.workspaceId,
      data: body.data as RowData,
      dataKeying: 'names',
      strictWrite: false,
      conflictTarget: body.conflictTarget,
      secretProvenanceEnvelope: readTableToolProvenanceEnvelope(context.headers, body),
      includePersistedSecretProvenance,
      requestId: context.requestId,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: {
        row: presentNamedTableRow(result.row, result.table),
        operation: result.operation,
        message: `Row ${result.operation === 'update' ? 'updated' : 'inserted'} successfully`,
      },
    },
    provenance: result.secretProvenance,
  })
}

/**
 * Projects a stored folder row onto the canonical path view the folder tools
 * return. The path comes from the index rather than the row, because a folder's
 * path is a property of its ancestry and the row holds only its own name.
 */
function presentTableFolder(
  row: Pick<typeof folder.$inferSelect, 'id' | 'name' | 'createdAt' | 'updatedAt'>,
  index: FolderPathIndex<typeof folder.$inferSelect>
): FolderPathView {
  const path = index.pathById.get(row.id)
  if (!path) throw new Error('Folder is missing from the active folder tree')
  return toFolderPathView(row, path)
}

export async function executeTableListFolders(
  body: ListTableFoldersToolBody,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const path = body.path ?? ROOT_FOLDER_PATH
  const result = await listTableFoldersUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      parentPath: path,
      search: body.search,
      /*
       * A depth asks to walk deeper, so it implies the walk. Reading `depth: 3`
       * without `recursive` as "direct children only" would answer a question
       * nobody asked and report success doing it.
       */
      recursive: body.recursive === true || body.depth !== undefined,
      maxDepth: body.depth,
    },
  })

  const limit = body.limit ?? DEFAULT_TABLE_FOLDER_LIST_LIMIT
  const folders = result.folders.map((row) => ({
    ...presentTableFolder(row, result.index),
    /*
     * A direct child is depth 1. `depthById` is absent only for the unscoped
     * legacy listing, which this tool never asks for — it always sends a path.
     */
    depth: result.depthById?.get(row.id) ?? 1,
  }))

  return complete(context, {
    body: {
      success: true,
      data: {
        path,
        folders: folders.slice(0, limit),
        truncated: folders.length > limit,
      },
    },
  })
}

export async function executeTableCreateFolder(
  body: CreateTableFolderToolBody,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const result = await createTableFolderUseCase.execute({
    principal: context.principal,
    input: { workspaceId: context.principal.workspaceId, path: body.path },
  })
  return complete(context, {
    body: { success: true, data: { folder: presentTableFolder(result.folder, result.index) } },
  })
}

export async function executeTableUpdateFolder(
  body: UpdateTableFolderToolBody,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const result = await updateTableFolderUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      path: body.path,
      destinationPath: body.destinationPath,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: {
        folder: presentTableFolder(result.folder, result.index),
        previousPath: result.sourcePath,
      },
    },
  })
}

export async function executeTableDeleteFolder(
  body: DeleteTableFolderToolBody,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const result = await deleteTableFolderUseCase.execute({
    principal: context.principal,
    input: {
      workspaceId: context.principal.workspaceId,
      path: body.path,
      /*
       * The use case takes a required boolean, and the default is off: a
       * non-empty folder refuses to delete unless someone asked for the
       * cascade. Absent must therefore become `false`, never "unspecified".
       */
      recursive: body.recursive === true,
    },
  })
  return complete(context, {
    body: {
      success: true,
      data: { path: result.path, deleted: result.deleted, deletedItems: result.deletedItems },
    },
  })
}

export async function executeTableRestoreFolder(
  body: RestoreTableFolderToolBody,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const result = await restoreTableFolderUseCase.execute({
    principal: context.principal,
    input: { workspaceId: context.principal.workspaceId, path: body.path },
  })
  return complete(context, {
    body: {
      success: true,
      data: {
        folder: presentTableFolder(result.folder, result.index),
        requestedPath: result.requestedPath,
        restoredItems: result.restoredItems,
      },
    },
  })
}

export async function executeTableMove(
  body: MoveTableToolBody,
  context: TableToolOperationContext
): Promise<TableToolOperationResult> {
  const result = await updateTableUseCase.execute({
    principal: context.principal,
    input: {
      tableId: body.tableId,
      workspaceId: context.principal.workspaceId,
      folderPath: body.folderPath ?? ROOT_FOLDER_PATH,
    },
  })
  /*
   * `updateTableUseCase` collects a failure rather than throwing, so the caller
   * can report which fields it did apply. Only `folderPath` is ever set here,
   * so a failure always means nothing was applied and the honest answer is to
   * rethrow it rather than present a move that did not happen.
   */
  if (result.failure) throw result.failure
  if (!result.table || result.folderPath === null) {
    throw new Error('Moved table is missing from the authoritative result')
  }
  return complete(context, {
    body: {
      success: true,
      data: {
        tableId: result.table.id,
        name: result.table.name,
        folderPath: result.folderPath,
      },
    },
  })
}
