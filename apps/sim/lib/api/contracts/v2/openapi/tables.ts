import {
  documentedSchema,
  type ErrorResponseId,
  FOLDER_TREE_TOO_LARGE,
  FULL_SET_LIST,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  RESOURCE_MUTATION_ERRORS,
  V2_AUTH_SECURITY,
  V2_AUTH_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  WORKSPACE_ERRORS,
  withErrorExamples,
  withRequestBodyErrors,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2AddTableColumnContract,
  v2AddWorkflowGroupContract,
  v2BulkDeleteTablesContract,
  v2BulkUpdateTableRowsContract,
  v2CancelTableDispatchContract,
  v2CancelTableExportContract,
  v2CancelTableImportContract,
  v2CancelTableRunsContract,
  v2CompleteTableImportContract,
  v2CreateTableContract,
  v2CreateTableDispatchContract,
  v2CreateTableExportContract,
  v2CreateTableFolderContract,
  v2CreateTableImportContract,
  v2CreateTableImportPartUrlsContract,
  v2CreateTableRowsContract,
  v2CreateTableViewContract,
  v2DeleteTableColumnContract,
  v2DeleteTableContract,
  v2DeleteTableFolderContract,
  v2DeleteTableRowContract,
  v2DeleteTableRowsContract,
  v2DeleteTableViewContract,
  v2DeleteWorkflowGroupContract,
  v2GetRowEnrichmentContract,
  v2GetTableContract,
  v2GetTableDispatchContract,
  v2GetTableExportContract,
  v2GetTableImportContract,
  v2GetTableRowContract,
  v2GetTableViewContract,
  v2ListTableDispatchesContract,
  v2ListTableFoldersContract,
  v2ListTableRowsContract,
  v2ListTablesContract,
  v2ListTableViewsContract,
  v2ListWorkflowGroupsContract,
  v2MoveTablesContract,
  v2QueryRowsContract,
  v2QueryRowsCountContract,
  v2RelocateTableFolderContract,
  v2RestoreTableContract,
  v2RestoreTableFolderContract,
  v2RunRowEnrichmentContract,
  v2SearchTableRowsContract,
  v2TableExportDownloadContract,
  v2UpdateRowsByFilterContract,
  v2UpdateTableColumnContract,
  v2UpdateTableContract,
  v2UpdateTableRowContract,
  v2UpdateTableViewContract,
  v2UpdateWorkflowGroupContract,
  v2UpsertTableRowContract,
} from '@/lib/api/contracts/v2/tables'
import {
  defineOpenApiDocument,
  defineOpenApiRoute,
  type OpenApiOperationMetadata,
  type OpenApiSuccessMetadata,
} from '@/lib/api/openapi/types'
import { tableOperations } from '@/lib/table/application/operations'
import { TABLE_LIMITS } from '@/lib/table/constants'

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'
const WORKFLOW_ID = '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'
const TABLE_ID = 'tbl_7c9e6679742540de944be07fc1f90ae7'
const ROW_ID = 'row_1f3e5d7c9b8a4c2d806e4a6b8d0f2e93'
const VIEW_ID = 'view_6b8d0f2a4c3e4e5da28f7c9b1d3f5a07'
const GROUP_ID = 'grp_5d8b2f0a6c1e4739a8b3d5f7e9c1a204'
const IMPORT_ID = 'imp_4f6a8c0e2b1d43759a7c9e1f3b5d7082'
const EXPORT_ID = 'exp_3e5f7a9c1b2d4068a0c2e4f6b8d0f193'
const DISPATCH_ID = 'dsp_9a1c3e5f7b2d40689c4e6a8b0d2f4173'

/**
 * Only for operations that genuinely reach a `lib/table/mutation-locks` assert
 * (`assertRowInsert` / `assertRowUpdate` / `assertRowDelete` /
 * `assertSchemaMutable` / `assertColumnDestructive`) or the equivalent inline
 * lock predicate in `deleteTable`, and that cannot also conflict.
 *
 * The four lock flags gate row writes and schema changes only. Reads, exports,
 * saved-view edits, table metadata edits (`renameTable` /
 * `updateTableDescription` / `moveTableToFolder` all assert nothing), and
 * run dispatch/cancellation are never blocked, so those operations must NOT use
 * this set — a documented `423` they cannot emit is worse than none.
 */
const TABLE_MUTATION_ERRORS = [
  ...RESOURCE_ERRORS,
  'Locked',
] as const satisfies readonly ErrorResponseId[]

/**
 * The two table query reads declare their own `maxBodyBytes` — 1 MiB, far below
 * the 50 MB default every JSON body is held to — so their `413` is a routine
 * answer to an oversized predicate rather than an abuse ceiling, and it is named
 * here and in their descriptions. Every other table read carries its input in
 * the query string and has no body ceiling to exceed.
 */
const TABLE_QUERY_ERRORS = [
  ...RESOURCE_ERRORS,
  'PayloadTooLarge',
] as const satisfies readonly ErrorResponseId[]

function tableOperation(
  operation: Omit<OpenApiOperationMetadata, 'tags' | 'success' | 'errors'> & {
    errors: readonly ErrorResponseId[]
    success: OpenApiSuccessMetadata
  }
): OpenApiOperationMetadata {
  return {
    ...operation,
    tags: ['Tables'],
    success: {
      ...operation.success,
      headers: [...(operation.success.headers ?? []), ...RATE_LIMIT_HEADERS],
    },
  }
}

const declaredRoutes = [
  defineOpenApiRoute(
    v2ListTablesContract,
    tableOperation({
      applicationOperation: tableOperations.list,
      operationId: 'listTables',
      summary: 'List Tables',
      description: `List active tables with folder filtering, search, sorting, and cursor pagination. Use \`scope=archived\` to find tables available for restoration. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'PayloadTooLarge'],
      success: { description: 'A page of tables in the workspace.' },
    }),
    {
      query: documentedSchema(
        v2ListTablesContract.query,
        'ListTablesQuery',
        'List tables query',
        'Workspace, folder, search, sorting, and pagination options for listing tables.'
      ),
      response: documentedSchema(
        v2ListTablesContract.response.schema,
        'V2TableListResponse',
        'Table list response',
        'A cursor-paginated page of tables.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateTableContract,
    tableOperation({
      applicationOperation: tableOperations.create,
      operationId: 'createTable',
      summary: 'Create Table',
      description: 'Create a table with a typed column schema and optional folder placement.',
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict', 'PayloadTooLarge'],
      success: { description: 'The created table.' },
    }),
    {
      query: v2CreateTableContract.query,
      body: documentedSchema(
        v2CreateTableContract.body,
        'CreateTableRequest',
        'Create table request',
        'Workspace, table metadata, folder placement, and typed columns.',
        [
          {
            workspaceId: WORKSPACE_ID,
            name: 'Customers',
            description: 'Customer accounts and lifecycle state.',
            schema: {
              columns: [
                { name: 'email', type: 'string', unique: true },
                { name: 'status', type: 'string' },
              ],
            },
          },
        ]
      ),
      response: documentedSchema(
        v2CreateTableContract.response.schema,
        'V2CreateTableResponse',
        'Create table response',
        'The created table.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetTableContract,
    tableOperation({
      applicationOperation: tableOperations.read,
      operationId: 'getTable',
      summary: 'Get Table',
      description: `Get a table with its metadata, column schema, locks, and current job. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The requested table.' },
    }),
    {
      params: documentedSchema(
        v2GetTableContract.params,
        'GetTableParams',
        'Get table path parameters',
        'Table selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetTableContract.query,
        'GetTableQuery',
        'Get table query',
        'Workspace scope for the table.'
      ),
      response: documentedSchema(
        v2GetTableContract.response.schema,
        'V2TableResponse',
        'Table response',
        'A single table.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteTableContract,
    tableOperation({
      applicationOperation: tableOperations.delete,
      operationId: 'deleteTable',
      summary: 'Delete Table',
      description:
        'Archive a table while retaining its rows. Use List Tables with `scope=archived` to find it and Restore Table to recover it.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'Table deletion acknowledgement.' },
    }),
    {
      params: documentedSchema(
        v2DeleteTableContract.params,
        'DeleteTableParams',
        'Delete table path parameters',
        'Table selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteTableContract.query,
        'DeleteTableQuery',
        'Delete table query',
        'Workspace scope for the table.'
      ),
      response: documentedSchema(
        v2DeleteTableContract.response.schema,
        'V2DeleteTableResponse',
        'Delete table response',
        'Table deletion acknowledgement.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateTableContract,
    tableOperation({
      applicationOperation: tableOperations.update,
      operationId: 'updateTable',
      summary: 'Update Table',
      description: `Rename a table, edit its description, or move it to a folder. Fields are saved independently: a failed request may leave partial changes. \`error.details.applied\` lists saved fields; retry only the remaining fields. If absent, nothing changed. Lock flags are read-only. ${FOLDER_TREE_TOO_LARGE}`,
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The updated table.' },
    }),
    {
      query: v2UpdateTableContract.query,
      params: documentedSchema(
        v2UpdateTableContract.params,
        'UpdateTableParams',
        'Update table path parameters',
        'Table selected for update.'
      ),
      body: documentedSchema(
        v2UpdateTableContract.body,
        'UpdateTableRequest',
        'Update table request',
        'Workspace scope and one or more table metadata or placement changes.',
        [{ workspaceId: WORKSPACE_ID, name: 'EnterpriseCustomers', folderPath: '/Sales' }]
      ),
      response: documentedSchema(
        v2UpdateTableContract.response.schema,
        'V2UpdateTableResponse',
        'Update table response',
        'The updated table.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2AddTableColumnContract,
    tableOperation({
      applicationOperation: tableOperations.addColumn,
      operationId: 'addTableColumn',
      summary: 'Add Column',
      description: 'Add a typed column and return the complete resulting table schema.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'The updated table columns.' },
    }),
    {
      query: v2AddTableColumnContract.query,
      params: documentedSchema(
        v2AddTableColumnContract.params,
        'AddTableColumnParams',
        'Add table column path parameters',
        'Table receiving the column.'
      ),
      body: documentedSchema(
        v2AddTableColumnContract.body,
        'AddTableColumnRequest',
        'Add table column request',
        'Workspace scope and the typed column to add.',
        [{ workspaceId: WORKSPACE_ID, column: { name: 'plan', type: 'string' } }]
      ),
      response: documentedSchema(
        v2AddTableColumnContract.response.schema,
        'V2TableColumnsResponse',
        'Table columns response',
        'The table column list after a schema mutation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateTableColumnContract,
    tableOperation({
      applicationOperation: tableOperations.updateColumn,
      operationId: 'updateTableColumn',
      summary: 'Update Column',
      description: 'Update a column by name and return the complete resulting table schema.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'The updated table columns.' },
    }),
    {
      query: v2UpdateTableColumnContract.query,
      params: documentedSchema(
        v2UpdateTableColumnContract.params,
        'UpdateTableColumnParams',
        'Update table column path parameters',
        'Table containing the column.'
      ),
      body: documentedSchema(
        v2UpdateTableColumnContract.body,
        'UpdateTableColumnRequest',
        'Update table column request',
        'Workspace scope, current column name, and fields to update.',
        [{ workspaceId: WORKSPACE_ID, columnName: 'plan', updates: { name: 'subscriptionPlan' } }]
      ),
      response: documentedSchema(
        v2UpdateTableColumnContract.response.schema,
        'V2TableColumnsResponse',
        'Table columns response',
        'The table column list after a schema mutation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteTableColumnContract,
    tableOperation({
      applicationOperation: tableOperations.deleteColumn,
      operationId: 'deleteTableColumn',
      summary: 'Delete Column',
      description: 'Delete a column by name while preserving at least one table column.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'The surviving table columns.' },
    }),
    {
      query: v2DeleteTableColumnContract.query,
      params: documentedSchema(
        v2DeleteTableColumnContract.params,
        'DeleteTableColumnParams',
        'Delete table column path parameters',
        'Table containing the column.'
      ),
      body: documentedSchema(
        v2DeleteTableColumnContract.body,
        'DeleteTableColumnRequest',
        'Delete table column request',
        'Workspace scope and column name to delete.',
        [{ workspaceId: WORKSPACE_ID, columnName: 'legacyStatus' }]
      ),
      response: documentedSchema(
        v2DeleteTableColumnContract.response.schema,
        'V2TableColumnsResponse',
        'Table columns response',
        'The table column list after a schema mutation.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListTableRowsContract,
    tableOperation({
      applicationOperation: tableOperations.listRows,
      operationId: 'listTableRows',
      summary: 'List Rows',
      description:
        'List rows in default order with cursor pagination. Pages default to a 5 MB limit and may contain fewer rows than requested; continue until `nextCursor` is null. Use Query Rows for filtering and sorting. `includeRunState=true` adds per-group run outcomes and reduces the row limit.',
      errors: RESOURCE_ERRORS,
      success: { description: 'A page of table rows.' },
    }),
    {
      params: documentedSchema(
        v2ListTableRowsContract.params,
        'ListTableRowsParams',
        'List table rows path parameters',
        'Table whose rows should be listed.'
      ),
      query: documentedSchema(
        v2ListTableRowsContract.query,
        'ListTableRowsQuery',
        'List table rows query',
        'Workspace scope and cursor pagination options.'
      ),
      response: documentedSchema(
        v2ListTableRowsContract.response.schema,
        'V2TableRowListResponse',
        'Table row list response',
        'A cursor-paginated page of table rows.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateTableRowsContract,
    tableOperation({
      applicationOperation: tableOperations.createRows,
      operationId: 'createTableRows',
      summary: 'Create Rows',
      description:
        'Insert one row with a data object or insert a bounded batch with a rows array. Cell keys are column names.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'The inserted row or rows.' },
    }),
    {
      query: v2CreateTableRowsContract.query,
      params: documentedSchema(
        v2CreateTableRowsContract.params,
        'CreateTableRowsParams',
        'Create table rows path parameters',
        'Table receiving the rows.'
      ),
      body: documentedSchema(
        v2CreateTableRowsContract.body,
        'CreateTableRowsRequest',
        'Create table rows request',
        'A single row or bounded row batch keyed by column name.',
        [{ workspaceId: WORKSPACE_ID, data: { email: 'jane@example.com', status: 'active' } }]
      ),
      response: documentedSchema(
        v2CreateTableRowsContract.response.schema,
        'V2CreateTableRowsResponse',
        'Create table rows response',
        'The inserted single row or inserted batch result.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateRowsByFilterContract,
    tableOperation({
      applicationOperation: tableOperations.updateRows,
      operationId: 'updateTableRows',
      summary: 'Update Rows by Filter',
      description: 'Apply the same partial data patch to every row matching a non-empty predicate.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'The bulk update result.' },
    }),
    {
      query: v2UpdateRowsByFilterContract.query,
      params: documentedSchema(
        v2UpdateRowsByFilterContract.params,
        'UpdateTableRowsParams',
        'Update table rows path parameters',
        'Table whose rows should be updated.'
      ),
      body: documentedSchema(
        v2UpdateRowsByFilterContract.body,
        'UpdateTableRowsRequest',
        'Update table rows request',
        'Workspace scope, typed predicate, and row-data patch.',
        [
          {
            workspaceId: WORKSPACE_ID,
            filter: { all: [{ field: 'status', op: 'eq', value: 'trial' }] },
            data: { status: 'active' },
          },
        ]
      ),
      response: documentedSchema(
        v2UpdateRowsByFilterContract.response.schema,
        'V2UpdateTableRowsResponse',
        'Update table rows response',
        'Updated row count and identifiers.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteTableRowsContract,
    tableOperation({
      applicationOperation: tableOperations.deleteRows,
      operationId: 'deleteTableRows',
      summary: 'Delete Rows',
      description:
        'Delete rows by a non-empty predicate or an explicit bounded list of row identifiers.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'The bulk deletion result.' },
    }),
    {
      query: v2DeleteTableRowsContract.query,
      params: documentedSchema(
        v2DeleteTableRowsContract.params,
        'DeleteTableRowsParams',
        'Delete table rows path parameters',
        'Table whose rows should be deleted.'
      ),
      body: documentedSchema(
        v2DeleteTableRowsContract.body,
        'DeleteTableRowsRequest',
        'Delete table rows request',
        'Workspace scope and exactly one of a predicate or row identifier list.',
        [{ workspaceId: WORKSPACE_ID, rowIds: [ROW_ID] }]
      ),
      response: documentedSchema(
        v2DeleteTableRowsContract.response.schema,
        'V2DeleteTableRowsResponse',
        'Delete table rows response',
        'Deleted row counts, identifiers, and optional missing identifiers.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetTableRowContract,
    tableOperation({
      applicationOperation: tableOperations.readRow,
      operationId: 'getTableRow',
      summary: 'Get Row',
      description:
        "Get one row by identifier. Set `includeRunState=true` to attach the row's per-workflow-group run outcomes.",
      errors: RESOURCE_ERRORS,
      success: { description: 'The requested table row.' },
    }),
    {
      params: documentedSchema(
        v2GetTableRowContract.params,
        'GetTableRowParams',
        'Get table row path parameters',
        'Table and row selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetTableRowContract.query,
        'GetTableRowQuery',
        'Get table row query',
        'Workspace scope for the row.'
      ),
      response: documentedSchema(
        v2GetTableRowContract.response.schema,
        'V2TableRowResponse',
        'Table row response',
        'A single table row.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateTableRowContract,
    tableOperation({
      applicationOperation: tableOperations.updateRow,
      operationId: 'updateTableRow',
      summary: 'Update Row',
      description: 'Merge a partial data patch into one row by identifier.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'The updated table row.' },
    }),
    {
      query: v2UpdateTableRowContract.query,
      params: documentedSchema(
        v2UpdateTableRowContract.params,
        'UpdateTableRowParams',
        'Update table row path parameters',
        'Table and row selected for update.'
      ),
      body: documentedSchema(
        v2UpdateTableRowContract.body,
        'UpdateTableRowRequest',
        'Update table row request',
        'Workspace scope and row-data patch keyed by column name.',
        [{ workspaceId: WORKSPACE_ID, data: { status: 'active' } }]
      ),
      response: documentedSchema(
        v2UpdateTableRowContract.response.schema,
        'V2TableRowResponse',
        'Table row response',
        'A single table row.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteTableRowContract,
    tableOperation({
      applicationOperation: tableOperations.deleteRow,
      operationId: 'deleteTableRow',
      summary: 'Delete Row',
      description: 'Delete one row by identifier.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'The row deletion result.' },
    }),
    {
      params: documentedSchema(
        v2DeleteTableRowContract.params,
        'DeleteTableRowParams',
        'Delete table row path parameters',
        'Table and row selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteTableRowContract.query,
        'DeleteTableRowQuery',
        'Delete table row query',
        'Workspace scope for the row.'
      ),
      response: documentedSchema(
        v2DeleteTableRowContract.response.schema,
        'V2DeleteTableRowResponse',
        'Delete table row response',
        'Row deletion acknowledgement.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpsertTableRowContract,
    tableOperation({
      applicationOperation: tableOperations.upsertRow,
      operationId: 'upsertTableRow',
      summary: 'Upsert Row',
      description:
        'Insert a row or replace the row matching a selected unique column. On replacement, omitted columns are cleared; send the complete row. Use Update Row for a partial patch.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'The upserted row and operation performed.' },
    }),
    {
      query: v2UpsertTableRowContract.query,
      params: documentedSchema(
        v2UpsertTableRowContract.params,
        'UpsertTableRowParams',
        'Upsert table row path parameters',
        'Table receiving the row.'
      ),
      body: documentedSchema(
        v2UpsertTableRowContract.body,
        'UpsertTableRowRequest',
        'Upsert table row request',
        'Workspace scope, row data, and optional unique-column conflict target.',
        [
          {
            workspaceId: WORKSPACE_ID,
            data: { email: 'jane@example.com', status: 'active' },
            conflictTarget: 'email',
          },
        ]
      ),
      response: documentedSchema(
        v2UpsertTableRowContract.response.schema,
        'V2UpsertTableRowResponse',
        'Upsert table row response',
        'The resulting row and whether it was inserted or updated.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2QueryRowsContract,
    tableOperation({
      applicationOperation: tableOperations.queryRows,
      operationId: 'queryTableRows',
      summary: 'Query Rows',
      description:
        'Query rows with typed predicates, sorting, and cursor pagination. Omit the predicate to match all rows. Pages default to a 5 MB limit; continue until `nextCursor` is null. Oversized predicates return `413`. `includeRunState` adds per-group outcomes and reduces the row limit. Counts are read separately and can differ from paged results if rows change.',
      errors: TABLE_QUERY_ERRORS,
      success: { description: 'A page of matching table rows.' },
    }),
    {
      query: v2QueryRowsContract.query,
      params: documentedSchema(
        v2QueryRowsContract.params,
        'QueryTableRowsParams',
        'Query table rows path parameters',
        'Table whose rows should be queried.'
      ),
      body: documentedSchema(
        v2QueryRowsContract.body,
        'QueryTableRowsRequest',
        'Query table rows request',
        'Workspace scope, optional predicate and sort, and cursor pagination controls. The predicate may be one condition or an `all`/`any` group; omitting it matches every row.',
        [
          {
            workspaceId: WORKSPACE_ID,
            limit: 100,
          },
          {
            workspaceId: WORKSPACE_ID,
            predicate: { field: 'status', op: 'eq', value: 'active' },
            sort: [{ field: 'createdAt', direction: 'desc' }],
            limit: 100,
          },
          {
            workspaceId: WORKSPACE_ID,
            predicate: {
              all: [
                { field: 'status', op: 'eq', value: 'active' },
                { field: 'score', op: 'gte', value: 80 },
              ],
            },
          },
        ]
      ),
      response: documentedSchema(
        v2QueryRowsContract.response.schema,
        'V2QueryTableRowsResponse',
        'Query table rows response',
        'A cursor-paginated page of matching table rows.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2QueryRowsCountContract,
    tableOperation({
      applicationOperation: tableOperations.queryRows,
      operationId: 'countTableRows',
      summary: 'Count Rows',
      description:
        'Count rows matching a typed predicate, or omit the predicate to count all rows. The count is read separately from row pages and can change between requests. Oversized predicates return `413`.',
      errors: TABLE_QUERY_ERRORS,
      success: { description: 'The number of matching table rows.' },
    }),
    {
      query: v2QueryRowsCountContract.query,
      params: documentedSchema(
        v2QueryRowsCountContract.params,
        'CountTableRowsParams',
        'Count table rows path parameters',
        'Table whose matching rows should be counted.'
      ),
      body: documentedSchema(
        v2QueryRowsCountContract.body,
        'CountTableRowsRequest',
        'Count table rows request',
        'Workspace scope and the optional condition or `all`/`any` predicate group whose matches are counted.',
        [
          {
            workspaceId: WORKSPACE_ID,
            predicate: { field: 'status', op: 'eq', value: 'active' },
          },
        ]
      ),
      response: documentedSchema(
        v2QueryRowsCountContract.response.schema,
        'V2CountTableRowsResponse',
        'Count table rows response',
        'The total number of table rows matching the predicate.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListTableViewsContract,
    tableOperation({
      applicationOperation: tableOperations.listViews,
      operationId: 'listTableViews',
      summary: 'List Views',
      description: `List saved table views, omitting references to removed columns. ${FULL_SET_LIST}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The saved table views.' },
    }),
    {
      params: documentedSchema(
        v2ListTableViewsContract.params,
        'ListTableViewsParams',
        'List table views path parameters',
        'Table whose views should be listed.'
      ),
      query: documentedSchema(
        v2ListTableViewsContract.query,
        'ListTableViewsQuery',
        'List table views query',
        'Workspace scope for the table.'
      ),
      response: documentedSchema(
        v2ListTableViewsContract.response.schema,
        'V2TableViewListResponse',
        'Table view list response',
        'A cursor envelope containing the saved views.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateTableViewContract,
    tableOperation({
      applicationOperation: tableOperations.createView,
      operationId: 'createTableView',
      summary: 'Create View',
      description: 'Save a filter, sort, and column layout as a named presentation of a table.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The created table view.' },
    }),
    {
      query: v2CreateTableViewContract.query,
      params: documentedSchema(
        v2CreateTableViewContract.params,
        'CreateTableViewParams',
        'Create table view path parameters',
        'Table receiving the saved view.'
      ),
      body: documentedSchema(
        v2CreateTableViewContract.body,
        'CreateTableViewRequest',
        'Create table view request',
        'Workspace scope, name, and saved filter, sort, and layout configuration.',
        [
          {
            workspaceId: WORKSPACE_ID,
            name: 'Active customers',
            config: {
              filter: { all: [{ field: 'status', op: 'eq', value: 'active' }] },
              sort: [{ field: 'createdAt', direction: 'desc' }],
            },
          },
        ]
      ),
      response: documentedSchema(
        v2CreateTableViewContract.response.schema,
        'V2CreateTableViewResponse',
        'Create table view response',
        'The created saved view.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetTableViewContract,
    tableOperation({
      applicationOperation: tableOperations.readView,
      operationId: 'getTableView',
      summary: 'Get View',
      description: 'Get one saved table view by identifier.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The requested table view.' },
    }),
    {
      params: documentedSchema(
        v2GetTableViewContract.params,
        'GetTableViewParams',
        'Get table view path parameters',
        'Table and saved view selected for retrieval.',
        [{ tableId: TABLE_ID, viewId: VIEW_ID }]
      ),
      query: documentedSchema(
        v2GetTableViewContract.query,
        'GetTableViewQuery',
        'Get table view query',
        'Workspace scope for the saved view.'
      ),
      response: documentedSchema(
        v2GetTableViewContract.response.schema,
        'V2TableViewResponse',
        'Table view response',
        'A single saved table view.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateTableViewContract,
    tableOperation({
      applicationOperation: tableOperations.updateView,
      operationId: 'updateTableView',
      summary: 'Update View',
      description:
        'Rename a view, replace or shallow-merge its configuration, or promote it to the table default.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The updated table view.' },
    }),
    {
      query: v2UpdateTableViewContract.query,
      params: documentedSchema(
        v2UpdateTableViewContract.params,
        'UpdateTableViewParams',
        'Update table view path parameters',
        'Table and saved view selected for update.'
      ),
      body: documentedSchema(
        v2UpdateTableViewContract.body,
        'UpdateTableViewRequest',
        'Update table view request',
        'Workspace scope and one or more saved-view changes.',
        [{ workspaceId: WORKSPACE_ID, name: 'Priority customers', isDefault: true }]
      ),
      response: documentedSchema(
        v2UpdateTableViewContract.response.schema,
        'V2TableViewResponse',
        'Table view response',
        'A single saved table view.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteTableViewContract,
    tableOperation({
      applicationOperation: tableOperations.deleteView,
      operationId: 'deleteTableView',
      summary: 'Delete View',
      description: 'Delete a saved presentation without changing any table rows.',
      errors: RESOURCE_ERRORS,
      success: { description: 'Table view deletion acknowledgement.' },
    }),
    {
      params: documentedSchema(
        v2DeleteTableViewContract.params,
        'DeleteTableViewParams',
        'Delete table view path parameters',
        'Table and saved view selected for deletion.'
      ),
      query: documentedSchema(
        v2DeleteTableViewContract.query,
        'DeleteTableViewQuery',
        'Delete table view query',
        'Workspace scope for the saved view.'
      ),
      response: documentedSchema(
        v2DeleteTableViewContract.response.schema,
        'V2DeleteTableViewResponse',
        'Delete table view response',
        'Saved-view deletion acknowledgement.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListWorkflowGroupsContract,
    tableOperation({
      applicationOperation: tableOperations.listGroups,
      operationId: 'listTableWorkflowGroups',
      summary: 'List Workflow Groups',
      description: `List the workflow and enrichment groups that can be dispatched for a table. ${FULL_SET_LIST}`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The table workflow groups.' },
    }),
    {
      params: documentedSchema(
        v2ListWorkflowGroupsContract.params,
        'ListTableWorkflowGroupsParams',
        'List table workflow groups path parameters',
        'Table whose producer groups should be listed.'
      ),
      query: documentedSchema(
        v2ListWorkflowGroupsContract.query,
        'ListTableWorkflowGroupsQuery',
        'List table workflow groups query',
        'Workspace scope for the table.'
      ),
      response: documentedSchema(
        v2ListWorkflowGroupsContract.response.schema,
        'V2TableWorkflowGroupListResponse',
        'Table workflow group list response',
        'A cursor envelope containing the table workflow groups.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2AddWorkflowGroupContract,
    tableOperation({
      applicationOperation: tableOperations.createGroup,
      operationId: 'addTableWorkflowGroup',
      summary: 'Add Workflow Group',
      description:
        'Bind a workflow or enrichment to the table and create the columns populated by its outputs.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'The created workflow group and resulting columns.' },
    }),
    {
      query: v2AddWorkflowGroupContract.query,
      params: documentedSchema(
        v2AddWorkflowGroupContract.params,
        'AddTableWorkflowGroupParams',
        'Add table workflow group path parameters',
        'Table receiving the producer group.'
      ),
      body: documentedSchema(
        v2AddWorkflowGroupContract.body,
        'AddTableWorkflowGroupRequest',
        'Add table workflow group request',
        'Workspace scope, producer definition, and output columns.',
        [
          {
            workspaceId: WORKSPACE_ID,
            group: {
              workflowId: WORKFLOW_ID,
              name: 'Enrich company',
              outputs: [{ blockId: 'block_lookup', path: 'output.revenue', columnName: 'revenue' }],
            },
            outputColumns: [{ name: 'revenue', type: 'number' }],
          },
        ]
      ),
      response: documentedSchema(
        v2AddWorkflowGroupContract.response.schema,
        'V2AddTableWorkflowGroupResponse',
        'Add table workflow group response',
        'The workflow group and complete resulting table columns.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2UpdateWorkflowGroupContract,
    tableOperation({
      applicationOperation: tableOperations.updateGroup,
      operationId: 'updateTableWorkflowGroup',
      summary: 'Update Workflow Group',
      description:
        'Restructure a workflow group, its producer, outputs, or execution behavior. Repointing the group at a different workflow concurrently invalidates the resolved output types and returns `409` — retry the update.',
      errors: RESOURCE_MUTATION_ERRORS,
      success: { description: 'The updated workflow group and resulting columns.' },
    }),
    {
      query: v2UpdateWorkflowGroupContract.query,
      params: documentedSchema(
        v2UpdateWorkflowGroupContract.params,
        'UpdateTableWorkflowGroupParams',
        'Update table workflow group path parameters',
        'Table containing the producer group.'
      ),
      body: documentedSchema(
        v2UpdateWorkflowGroupContract.body,
        'UpdateTableWorkflowGroupRequest',
        'Update table workflow group request',
        'Workspace scope, workflow group identifier, and producer changes.',
        [{ workspaceId: WORKSPACE_ID, groupId: GROUP_ID, name: 'Company profile enrichment' }]
      ),
      response: documentedSchema(
        v2UpdateWorkflowGroupContract.response.schema,
        'V2UpdateTableWorkflowGroupResponse',
        'Update table workflow group response',
        'The workflow group and complete resulting table columns.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteWorkflowGroupContract,
    tableOperation({
      applicationOperation: tableOperations.deleteGroup,
      operationId: 'deleteTableWorkflowGroup',
      summary: 'Delete Workflow Group',
      description: 'Delete a workflow group and every table column populated by that group.',
      errors: TABLE_MUTATION_ERRORS,
      success: { description: 'Workflow-group deletion acknowledgement and surviving columns.' },
    }),
    {
      query: v2DeleteWorkflowGroupContract.query,
      params: documentedSchema(
        v2DeleteWorkflowGroupContract.params,
        'DeleteTableWorkflowGroupParams',
        'Delete table workflow group path parameters',
        'Table containing the producer group.'
      ),
      body: documentedSchema(
        v2DeleteWorkflowGroupContract.body,
        'DeleteTableWorkflowGroupRequest',
        'Delete table workflow group request',
        'Workspace scope and workflow group identifier.',
        [{ workspaceId: WORKSPACE_ID, groupId: GROUP_ID }]
      ),
      response: documentedSchema(
        v2DeleteWorkflowGroupContract.response.schema,
        'V2DeleteTableWorkflowGroupResponse',
        'Delete table workflow group response',
        'Deletion acknowledgement and surviving table columns.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateTableDispatchContract,
    tableOperation({
      applicationOperation: tableOperations.startRun,
      operationId: 'createTableDispatch',
      summary: 'Create Run Dispatch',
      description:
        'Start workflow or enrichment groups across all rows or selected rows. Poll Get Run Dispatch until `complete` or `canceled`. A null `dispatchId` means no dispatch is available to poll; check row outcomes with `includeRunState`. Use Cancel Run Dispatch to stop further scheduling.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The accepted run dispatch.' },
    }),
    {
      query: v2CreateTableDispatchContract.query,
      params: documentedSchema(
        v2CreateTableDispatchContract.params,
        'CreateTableDispatchParams',
        'Create table dispatch path parameters',
        'Table whose producer groups should run.'
      ),
      body: documentedSchema(
        v2CreateTableDispatchContract.body,
        'CreateTableDispatchRequest',
        'Create table dispatch request',
        'Workspace scope, producer groups, execution mode, and optional row scope.',
        [{ workspaceId: WORKSPACE_ID, groupIds: [GROUP_ID] }]
      ),
      response: documentedSchema(
        v2CreateTableDispatchContract.response.schema,
        'V2CreateTableDispatchResponse',
        'Create table dispatch response',
        'Accepted background dispatch identifier.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RunRowEnrichmentContract,
    tableOperation({
      applicationOperation: tableOperations.startRun,
      operationId: 'runRowEnrichment',
      summary: 'Run Enrichment For One Row',
      description:
        'Start one workflow or enrichment group for a table row. Poll Get Run Dispatch using the returned `dispatchId`. A null `dispatchId` means no dispatch is available to poll; check row outcomes with `includeRunState`.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The accepted row enrichment dispatch.' },
    }),
    {
      query: v2RunRowEnrichmentContract.query,
      params: documentedSchema(
        v2RunRowEnrichmentContract.params,
        'RunRowEnrichmentParams',
        'Run row enrichment path parameters',
        'Table, row, and producer group selected for execution.'
      ),
      body: documentedSchema(
        v2RunRowEnrichmentContract.body,
        'RunRowEnrichmentRequest',
        'Run row enrichment request',
        'Workspace scope for the row enrichment.',
        [{ workspaceId: WORKSPACE_ID }]
      ),
      response: documentedSchema(
        v2RunRowEnrichmentContract.response.schema,
        'V2RunRowEnrichmentResponse',
        'Run row enrichment response',
        'Accepted background dispatch identifier.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2SearchTableRowsContract,
    tableOperation({
      applicationOperation: tableOperations.searchRows,
      operationId: 'searchTableRows',
      summary: 'Search Rows',
      description: `Search cell text for a case-insensitive substring within an optional filtered and sorted view. Returns cell coordinates, not row data; \`ordinal\` matches the view used by Query Rows. Results are unpaginated and capped at ${TABLE_LIMITS.MAX_FIND_MATCHES}. If \`truncated\` is true, narrow the search or predicate.`,
      errors: RESOURCE_ERRORS,
      success: { description: 'The matching table cells.' },
    }),
    {
      query: v2SearchTableRowsContract.query,
      params: documentedSchema(
        v2SearchTableRowsContract.params,
        'SearchTableRowsParams',
        'Search table rows path parameters',
        'Table whose cells should be searched.'
      ),
      body: documentedSchema(
        v2SearchTableRowsContract.body,
        'SearchTableRowsRequest',
        'Search table rows request',
        'Workspace scope, substring query, and optional predicate and sort.',
        [
          {
            workspaceId: WORKSPACE_ID,
            q: 'acme',
            predicate: { all: [{ field: 'status', op: 'eq', value: 'active' }] },
          },
        ]
      ),
      response: documentedSchema(
        v2SearchTableRowsContract.response.schema,
        'V2SearchTableRowsResponse',
        'Search table rows response',
        'Matching table cells and truncation state.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateTableImportContract,
    tableOperation({
      applicationOperation: tableOperations.createImport,
      operationId: 'createTableImport',
      summary: 'Create Table Import',
      description:
        'Create a CSV import. Upload sources receive signed transfer instructions; workspace-file sources start processing directly.',
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'Conflict', 'Locked', 'PayloadTooLarge'],
      success: { description: 'The created table import and optional transfer instructions.' },
    }),
    {
      query: v2CreateTableImportContract.query,
      body: documentedSchema(
        v2CreateTableImportContract.body,
        'CreateTableImportRequest',
        'Create table import request',
        'Workspace, CSV source, target table, optional mapping, and timezone.',
        [
          {
            workspaceId: WORKSPACE_ID,
            source: { type: 'upload', name: 'customers.csv', contentType: 'text/csv', size: 2048 },
            target: { type: 'new', name: 'ImportedCustomers', folderPath: '/Imports' },
            timezone: 'America/Los_Angeles',
          },
        ]
      ),
      response: documentedSchema(
        v2CreateTableImportContract.response.schema,
        'V2CreateTableImportResponse',
        'Create table import response',
        'The import session and upload instructions when transfer is required.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetTableImportContract,
    tableOperation({
      applicationOperation: tableOperations.readImport,
      operationId: 'getTableImport',
      summary: 'Get Table Import',
      description:
        "Get an import's progress and status. During `uploading`, the signed upload token is required; omitting it returns `404`.",
      errors: RESOURCE_ERRORS,
      success: { description: 'The requested table import.' },
    }),
    {
      params: documentedSchema(
        v2GetTableImportContract.params,
        'GetTableImportParams',
        'Get table import path parameters',
        'Import selected for retrieval.',
        [{ importId: IMPORT_ID }]
      ),
      query: documentedSchema(
        v2GetTableImportContract.query,
        'GetTableImportQuery',
        'Get table import query',
        'Workspace scope for the import.'
      ),
      headers: documentedSchema(
        v2GetTableImportContract.headers,
        'GetTableImportHeaders',
        'Get table import headers',
        'Optional signed upload control token for an upload-backed import.'
      ),
      response: documentedSchema(
        v2GetTableImportContract.response.schema,
        'V2TableImportResponse',
        'Table import response',
        'A durable table-import lifecycle resource.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CancelTableImportContract,
    tableOperation({
      applicationOperation: tableOperations.cancelImport,
      operationId: 'cancelTableImport',
      summary: 'Cancel Table Import',
      description:
        'Cancel an upload or processing import. Committed row batches remain. Non-cancelable states, including `expired`, return `409`; unknown or purged imports return `404`.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The canceled table import.' },
    }),
    {
      params: documentedSchema(
        v2CancelTableImportContract.params,
        'CancelTableImportParams',
        'Cancel table import path parameters',
        'Import selected for cancellation.'
      ),
      query: documentedSchema(
        v2CancelTableImportContract.query,
        'CancelTableImportQuery',
        'Cancel table import query',
        'Workspace scope for the import.'
      ),
      headers: documentedSchema(
        v2CancelTableImportContract.headers,
        'CancelTableImportHeaders',
        'Cancel table import headers',
        'Optional signed upload control token for an upload-backed import.'
      ),
      response: documentedSchema(
        v2CancelTableImportContract.response.schema,
        'V2CancelTableImportResponse',
        'Cancel table import response',
        'The canceled table-import lifecycle resource.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateTableImportPartUrlsContract,
    tableOperation({
      applicationOperation: tableOperations.createImportParts,
      operationId: 'createTableImportPartUrls',
      summary: 'Create Table Import Part URLs',
      description:
        'Create signed URLs for multipart upload parts. Requires the `uploading` state; other states return `409`. Unknown or purged imports return `404`.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The signed multipart upload URLs.' },
    }),
    {
      params: documentedSchema(
        v2CreateTableImportPartUrlsContract.params,
        'CreateTableImportPartUrlsParams',
        'Create table import part URLs path parameters',
        'Import receiving uploaded parts.'
      ),
      query: documentedSchema(
        v2CreateTableImportPartUrlsContract.query,
        'CreateTableImportPartUrlsQuery',
        'Create table import part URLs query',
        'Workspace scope for the import.'
      ),
      headers: documentedSchema(
        v2CreateTableImportPartUrlsContract.headers,
        'CreateTableImportPartUrlsHeaders',
        'Create table import part URLs headers',
        'Signed upload control token for the import.'
      ),
      body: documentedSchema(
        v2CreateTableImportPartUrlsContract.body,
        'CreateTableImportPartUrlsRequest',
        'Create table import part URLs request',
        'Multipart part numbers for which signed URLs should be created.',
        [{ partNumbers: [1, 2, 3] }]
      ),
      response: documentedSchema(
        v2CreateTableImportPartUrlsContract.response.schema,
        'V2CreateTableImportPartUrlsResponse',
        'Create table import part URLs response',
        'Signed URLs and required headers for each requested upload part.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CompleteTableImportContract,
    tableOperation({
      applicationOperation: tableOperations.completeImport,
      operationId: 'completeTableImportUpload',
      summary: 'Complete Table Import Upload',
      description:
        'Verify or assemble uploaded CSV bytes and start processing under the same import ID. Requires an import awaiting upload completion; other states return `409`. Unknown or purged imports return `404`.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'Locked'],
      success: { description: 'The table import after upload completion.' },
    }),
    {
      params: documentedSchema(
        v2CompleteTableImportContract.params,
        'CompleteTableImportUploadParams',
        'Complete table import upload path parameters',
        'Import whose upload should be completed.'
      ),
      query: documentedSchema(
        v2CompleteTableImportContract.query,
        'CompleteTableImportUploadQuery',
        'Complete table import upload query',
        'Workspace scope for the import.'
      ),
      headers: documentedSchema(
        v2CompleteTableImportContract.headers,
        'CompleteTableImportUploadHeaders',
        'Complete table import upload headers',
        'Signed upload control token for the import.'
      ),
      response: documentedSchema(
        v2CompleteTableImportContract.response.schema,
        'V2CompleteTableImportUploadResponse',
        'Complete table import upload response',
        'The import lifecycle resource after processing is queued.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateTableExportContract,
    tableOperation({
      applicationOperation: tableOperations.createExport,
      operationId: 'createTableExport',
      summary: 'Create Table Export',
      description:
        'Create a CSV or JSON export. Exports of small tables finish during the request; larger exports run asynchronously.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The created table export.' },
    }),
    {
      query: v2CreateTableExportContract.query,
      params: documentedSchema(
        v2CreateTableExportContract.params,
        'CreateTableExportParams',
        'Create table export path parameters',
        'Table selected for export.'
      ),
      body: documentedSchema(
        v2CreateTableExportContract.body,
        'CreateTableExportRequest',
        'Create table export request',
        'Workspace scope and export format.',
        [{ workspaceId: WORKSPACE_ID, format: 'csv' }]
      ),
      response: documentedSchema(
        v2CreateTableExportContract.response.schema,
        'V2CreateTableExportResponse',
        'Create table export response',
        'The created durable table-export lifecycle resource.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetTableExportContract,
    tableOperation({
      applicationOperation: tableOperations.readExport,
      operationId: 'getTableExport',
      summary: 'Get Table Export',
      description: "Get a table export's progress and status.",
      errors: RESOURCE_ERRORS,
      success: { description: 'The requested table export.' },
    }),
    {
      params: documentedSchema(
        v2GetTableExportContract.params,
        'GetTableExportParams',
        'Get table export path parameters',
        'Table that owns the export, and the export selected for retrieval.',
        [{ tableId: TABLE_ID, exportId: EXPORT_ID }]
      ),
      query: documentedSchema(
        v2GetTableExportContract.query,
        'GetTableExportQuery',
        'Get table export query',
        'Workspace scope for the export.'
      ),
      response: documentedSchema(
        v2GetTableExportContract.response.schema,
        'V2TableExportResponse',
        'Table export response',
        'A durable table-export lifecycle resource.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CancelTableExportContract,
    tableOperation({
      applicationOperation: tableOperations.cancelExport,
      operationId: 'cancelTableExport',
      summary: 'Cancel Table Export',
      description: 'Cancel an export that is still in progress.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The canceled table export.' },
    }),
    {
      params: documentedSchema(
        v2CancelTableExportContract.params,
        'CancelTableExportParams',
        'Cancel table export path parameters',
        'Table that owns the export, and the export selected for cancellation.'
      ),
      query: documentedSchema(
        v2CancelTableExportContract.query,
        'CancelTableExportQuery',
        'Cancel table export query',
        'Workspace scope for the export.'
      ),
      response: documentedSchema(
        v2CancelTableExportContract.response.schema,
        'V2CancelTableExportResponse',
        'Cancel table export response',
        'The canceled durable table-export lifecycle resource.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2TableExportDownloadContract,
    tableOperation({
      applicationOperation: tableOperations.downloadExport,
      operationId: 'downloadTableExport',
      summary: 'Download Table Export',
      description:
        'Get a short-lived signed download URL for a completed export. Other states return `409`; an unavailable export file returns `404`.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Signed table-export download information.' },
    }),
    {
      params: documentedSchema(
        v2TableExportDownloadContract.params,
        'DownloadTableExportParams',
        'Download table export path parameters',
        'Table that owns the export, and the export selected for download.'
      ),
      query: documentedSchema(
        v2TableExportDownloadContract.query,
        'DownloadTableExportQuery',
        'Download table export query',
        'Workspace scope for the export.'
      ),
      response: documentedSchema(
        v2TableExportDownloadContract.response.schema,
        'V2DownloadTableExportResponse',
        'Download table export response',
        'Short-lived signed URL, filename, and expiration timestamp.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CancelTableRunsContract,
    tableOperation({
      applicationOperation: tableOperations.cancelRuns,
      operationId: 'cancelTableRuns',
      summary: 'Cancel Column Runs',
      description:
        'Stop in-flight and pending workflow or enrichment cell runs across the table or one selected row.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The number of canceled cell runs.' },
    }),
    {
      query: v2CancelTableRunsContract.query,
      params: documentedSchema(
        v2CancelTableRunsContract.params,
        'CancelTableRunsParams',
        'Cancel table runs path parameters',
        'Table whose cell runs should be canceled.'
      ),
      body: documentedSchema(
        v2CancelTableRunsContract.body,
        'CancelTableRunsRequest',
        'Cancel table runs request',
        'Workspace scope, cancellation scope, and optional predicate or producer groups.',
        [{ workspaceId: WORKSPACE_ID, scope: 'row', rowId: ROW_ID }]
      ),
      response: documentedSchema(
        v2CancelTableRunsContract.response.schema,
        'V2CancelTableRunsResponse',
        'Cancel table runs response',
        'Count of canceled table cell runs.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListTableFoldersContract,
    tableOperation({
      applicationOperation: tableOperations.listFolders,
      operationId: 'listTablesFolders',
      summary: 'List Folders',
      description: `List table folders, optionally limiting results to direct children of a parent path. ${FULL_SET_LIST}`,
      errors: [...WORKSPACE_ERRORS, 'NotFound', 'PayloadTooLarge'],
      success: { description: 'The table folders.' },
    }),
    {
      query: documentedSchema(
        v2ListTableFoldersContract.query,
        'ListTableFoldersQuery',
        'List table folders query',
        'Workspace, parent folder, search, and sorting options.'
      ),
      response: documentedSchema(
        v2ListTableFoldersContract.response.schema,
        'V2TableFolderListResponse',
        'Table folder list response',
        'A cursor envelope containing table folders.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateTableFolderContract,
    tableOperation({
      applicationOperation: tableOperations.createFolder,
      operationId: 'createTablesFolder',
      summary: 'Create Folder',
      description: 'Create one table-folder leaf whose parent path already exists.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The created table folder.' },
    }),
    {
      query: v2CreateTableFolderContract.query,
      body: documentedSchema(
        v2CreateTableFolderContract.body,
        'CreateTableFolderRequest',
        'Create table folder request',
        'Workspace scope and canonical folder path to create.',
        [{ workspaceId: WORKSPACE_ID, path: '/Sales/Enterprise' }]
      ),
      response: documentedSchema(
        v2CreateTableFolderContract.response.schema,
        'V2CreateTableFolderResponse',
        'Create table folder response',
        'The created table folder.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RelocateTableFolderContract,
    tableOperation({
      applicationOperation: tableOperations.updateFolder,
      operationId: 'relocateTablesFolder',
      summary: 'Rename or Move Folder',
      description: 'Rename or move a table folder and update all descendant paths.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The relocated table folder.' },
    }),
    {
      query: v2RelocateTableFolderContract.query,
      body: documentedSchema(
        v2RelocateTableFolderContract.body,
        'RelocateTableFolderRequest',
        'Relocate table folder request',
        'Workspace scope, current canonical path, and destination path.',
        [
          {
            workspaceId: WORKSPACE_ID,
            path: '/Sales/Enterprise',
            destinationPath: '/Revenue/Enterprise',
          },
        ]
      ),
      response: documentedSchema(
        v2RelocateTableFolderContract.response.schema,
        'V2RelocateTableFolderResponse',
        'Relocate table folder response',
        'The relocated table folder.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2DeleteTableFolderContract,
    tableOperation({
      applicationOperation: tableOperations.deleteFolder,
      operationId: 'deleteTablesFolder',
      summary: 'Delete Folder',
      description:
        'Archive an empty folder, or set `recursive=true` to archive its tables and subfolders. Use Restore Folder to recover the archived contents.',
      errors: [...RESOURCE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Table-folder deletion acknowledgement.' },
    }),
    {
      query: documentedSchema(
        v2DeleteTableFolderContract.query,
        'DeleteTableFolderQuery',
        'Delete table folder query',
        'Workspace scope, canonical folder path, and recursive deletion flag.'
      ),
      response: documentedSchema(
        v2DeleteTableFolderContract.response.schema,
        'V2DeleteTableFolderResponse',
        'Delete table folder response',
        'Folder deletion acknowledgement and deleted resource counts.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RestoreTableFolderContract,
    tableOperation({
      applicationOperation: tableOperations.restoreFolder,
      operationId: 'restoreTablesFolder',
      summary: 'Restore Folder',
      description:
        'Restore an archived table folder, its descendants, and tables using its former path. An archived parent moves it to the root; name conflicts may change the returned `path`. Non-archived paths return `404`. Save the path from Delete Folder, because List Folders does not include archived table folders.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The restored table folder and what it brought back.' },
    }),
    {
      query: v2RestoreTableFolderContract.query,
      body: documentedSchema(
        v2RestoreTableFolderContract.body,
        'RestoreTableFolderRequest',
        'Restore table folder request',
        'Workspace scope and the canonical path the archived folder held.',
        [{ workspaceId: WORKSPACE_ID, path: '/Sales/Enterprise' }]
      ),
      response: documentedSchema(
        v2RestoreTableFolderContract.response.schema,
        'V2RestoreTableFolderResponse',
        'Restore table folder response',
        'The restored table folder and the counts of items it brought back.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RestoreTableContract,
    tableOperation({
      applicationOperation: tableOperations.restore,
      operationId: 'restoreTable',
      summary: 'Restore Table',
      description:
        'Restore a table and its archived rows, views, and workflow groups. Active tables return unchanged without a new audit event. Name conflicts may change the returned `name`. Find archived tables with List Tables and `scope=archived`.',
      errors: [...RESOURCE_CONFLICT_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The restored table.' },
    }),
    {
      query: v2RestoreTableContract.query,
      params: documentedSchema(
        v2RestoreTableContract.params,
        'RestoreTableParams',
        'Restore table path parameters',
        'Archived table selected for restoration.'
      ),
      body: documentedSchema(
        v2RestoreTableContract.body,
        'RestoreTableRequest',
        'Restore table request',
        'Workspace scope for the archived table.',
        [{ workspaceId: WORKSPACE_ID }]
      ),
      response: documentedSchema(
        v2RestoreTableContract.response.schema,
        'V2RestoreTableResponse',
        'Restore table response',
        'The restored table.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2BulkUpdateTableRowsContract,
    tableOperation({
      applicationOperation: tableOperations.updateRows,
      operationId: 'bulkUpdateTableRows',
      summary: 'Bulk Update Rows',
      description:
        'Apply separate partial patches to up to 1,000 rows, preserving omitted columns. A row outside the table rejects the entire request with `400` and lists missing IDs. Use Update Rows by Filter to apply one patch to every matching row.',
      errors: [...TABLE_MUTATION_ERRORS, 'PayloadTooLarge'],
      success: { description: 'The bulk update result.' },
    }),
    {
      query: v2BulkUpdateTableRowsContract.query,
      params: documentedSchema(
        v2BulkUpdateTableRowsContract.params,
        'BulkUpdateTableRowsParams',
        'Bulk update table rows path parameters',
        'Table whose rows should be updated.'
      ),
      body: documentedSchema(
        v2BulkUpdateTableRowsContract.body,
        'BulkUpdateTableRowsRequest',
        'Bulk update table rows request',
        'Workspace scope and one merge patch per row.',
        [
          {
            workspaceId: WORKSPACE_ID,
            updates: [
              { rowId: ROW_ID, data: { status: 'active' } },
              { rowId: 'row_2b4d6f8a0c1e3759b8d0f2a4c6e80193', data: { status: 'churned' } },
            ],
          },
        ]
      ),
      response: documentedSchema(
        v2BulkUpdateTableRowsContract.response.schema,
        'V2BulkUpdateTableRowsResponse',
        'Bulk update table rows response',
        'Updated row count and identifiers.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetRowEnrichmentContract,
    tableOperation({
      applicationOperation: tableOperations.readRow,
      operationId: 'getRowEnrichment',
      summary: 'Get Enrichment Run Detail',
      description:
        "Get an enrichment cell's provider attempts, statuses, hosted-key costs, durations, and matching provider. Null means no run detail was recorded; `404` means the table, row, or group does not exist.",
      errors: RESOURCE_ERRORS,
      success: { description: 'The enrichment run detail, or null when none was recorded.' },
    }),
    {
      params: documentedSchema(
        v2GetRowEnrichmentContract.params,
        'GetRowEnrichmentParams',
        'Get row enrichment path parameters',
        'Table, row, and producer group whose run detail is requested.'
      ),
      query: documentedSchema(
        v2GetRowEnrichmentContract.query,
        'GetRowEnrichmentQuery',
        'Get row enrichment query',
        'Workspace scope for the row.'
      ),
      response: documentedSchema(
        v2GetRowEnrichmentContract.response.schema,
        'V2RowEnrichmentResponse',
        'Row enrichment response',
        'Provider cascade, cost, and timing for one enrichment cell.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2GetTableDispatchContract,
    tableOperation({
      applicationOperation: tableOperations.readRun,
      operationId: 'getTableDispatch',
      summary: 'Get Run Dispatch',
      description:
        "Get a dispatch's current state. Poll until `complete` or `canceled`; use row reads with `includeRunState` for per-cell outcomes.",
      errors: RESOURCE_ERRORS,
      success: { description: 'The requested run dispatch.' },
    }),
    {
      params: documentedSchema(
        v2GetTableDispatchContract.params,
        'GetTableDispatchParams',
        'Get table dispatch path parameters',
        'Table that owns the dispatch, and the dispatch selected for retrieval.'
      ),
      query: documentedSchema(
        v2GetTableDispatchContract.query,
        'GetTableDispatchQuery',
        'Get table dispatch query',
        'Workspace scope for the dispatch.'
      ),
      response: documentedSchema(
        v2GetTableDispatchContract.response.schema,
        'V2TableRunDispatchResponse',
        'Table run dispatch response',
        'A single table run dispatch.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CancelTableDispatchContract,
    tableOperation({
      applicationOperation: tableOperations.cancelRuns,
      operationId: 'cancelTableDispatch',
      summary: 'Cancel Run Dispatch',
      description:
        'Stop a dispatch from scheduling more cells. Already queued or running cells continue; use Cancel Column Runs to stop them. Completed or canceled dispatches return unchanged.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The dispatch in its post-cancellation state.' },
    }),
    {
      params: documentedSchema(
        v2CancelTableDispatchContract.params,
        'CancelTableDispatchParams',
        'Cancel table dispatch path parameters',
        'Table that owns the dispatch, and the dispatch selected for cancellation.'
      ),
      query: documentedSchema(
        v2CancelTableDispatchContract.query,
        'CancelTableDispatchQuery',
        'Cancel table dispatch query',
        'Workspace scope for the dispatch.'
      ),
      response: documentedSchema(
        v2CancelTableDispatchContract.response.schema,
        'V2CancelTableDispatchResponse',
        'Cancel table dispatch response',
        'The dispatch in its post-cancellation state.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2ListTableDispatchesContract,
    tableOperation({
      applicationOperation: tableOperations.readRun,
      operationId: 'listTableDispatches',
      summary: 'List Active Run Dispatches',
      description:
        'List in-flight run dispatches for a table in one page; `nextCursor` is always null. Use Get Run Dispatch to read a settled dispatch.',
      errors: RESOURCE_ERRORS,
      success: { description: "The table's active run dispatches." },
    }),
    {
      params: documentedSchema(
        v2ListTableDispatchesContract.params,
        'ListTableDispatchesParams',
        'List table dispatches path parameters',
        'Table whose active run dispatches should be listed.'
      ),
      query: documentedSchema(
        v2ListTableDispatchesContract.query,
        'ListTableDispatchesQuery',
        'List table dispatches query',
        'Workspace scope for the table.'
      ),
      response: documentedSchema(
        v2ListTableDispatchesContract.response.schema,
        'V2TableRunDispatchListResponse',
        'Table run dispatch list response',
        "The table's active run dispatches."
      ),
    }
  ),
  defineOpenApiRoute(
    v2MoveTablesContract,
    tableOperation({
      applicationOperation: tableOperations.bulkMove,
      operationId: 'moveTables',
      summary: 'Move Tables and Folders',
      description:
        'Move up to 100 tables and folders to one destination. Items succeed or fail independently: covered tables are `skipped`, missing items are `notFound`, and lock or cycle failures include reasons in `failed`. An invalid destination rejects the request before any move.',
      errors: [...RESOURCE_ERRORS, 'PayloadTooLarge'],
      success: { description: 'Per-item outcome of the bulk move.' },
    }),
    {
      query: v2MoveTablesContract.query,
      body: documentedSchema(
        v2MoveTablesContract.body,
        'BulkMoveTablesRequest',
        'Bulk move tables request',
        'Workspace scope, the tables and folder paths to move, and the destination folder path.',
        [
          {
            workspaceId: WORKSPACE_ID,
            tableIds: [TABLE_ID],
            folderPaths: ['/Sales/Enterprise'],
            targetFolderPath: '/Revenue',
          },
        ]
      ),
      response: documentedSchema(
        v2MoveTablesContract.response.schema,
        'V2MoveTablesResponse',
        'Bulk move tables response',
        'Per-item outcome of a bulk table and folder move.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2BulkDeleteTablesContract,
    tableOperation({
      applicationOperation: tableOperations.bulkDelete,
      operationId: 'bulkDeleteTables',
      summary: 'Bulk Delete Tables and Folders',
      description:
        'Archive up to 100 selected tables and folders, including folder contents. Items succeed or fail independently, with `skipped`, `notFound`, and `failed` outcomes. `deletedItems` includes all descendants. Use Restore Table or Restore Folder to recover archived items.',
      errors: [...RESOURCE_ERRORS, 'Locked', 'PayloadTooLarge'],
      success: { description: 'Per-item outcome of the bulk delete.' },
    }),
    {
      query: v2BulkDeleteTablesContract.query,
      body: documentedSchema(
        v2BulkDeleteTablesContract.body,
        'BulkDeleteTablesRequest',
        'Bulk delete tables request',
        'Workspace scope, and the tables and folder paths to delete.',
        [
          {
            workspaceId: WORKSPACE_ID,
            tableIds: [TABLE_ID],
            folderPaths: ['/Sales/Archive'],
          },
        ]
      ),
      response: documentedSchema(
        v2BulkDeleteTablesContract.response.schema,
        'V2BulkDeleteTablesResponse',
        'Bulk delete tables response',
        'Per-item outcome of a bulk table and folder delete.'
      ),
    }
  ),
] as const

const routes = declaredRoutes.map(withRequestBodyErrors)

export const tablesOpenApiDocument = defineOpenApiDocument({
  output: 'apps/docs/openapi-v2-tables.json',
  info: {
    title: 'Sim Tables API v2',
    description:
      'Version 2 of the Sim REST API for tables, typed columns, rows, saved views, workflow groups, folders, imports, and exports. Row data is keyed by column name.',
    version: '2.0.0',
    contact: { name: 'Sim Support', email: 'help@sim.ai', url: 'https://www.sim.ai' },
    license: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0.html' },
  },
  servers: [{ url: 'https://www.sim.ai', description: 'Production' }],
  tags: [
    {
      name: 'Tables',
      description: 'Manage tables, columns, rows, views, runs, folders, imports, and exports.',
    },
  ],
  security: V2_AUTH_SECURITY,
  securitySchemes: V2_AUTH_SECURITY_SCHEMES,
  headers: V2_COMMON_HEADERS,
  errorSchema: V2_ERROR_SCHEMA,
  errorResponses: withErrorExamples({
    Conflict: { message: 'A table named "Orders" already exists in this workspace' },
    Locked: {
      message: 'This table is insert-locked: new rows cannot be added.',
      /** Names which of the four locks refused the write, so a caller can say which. */
      details: { lock: 'insert' },
    },
  }),
  routes,
})
