import {
  documentedSchema,
  type ErrorResponseId,
  FOLDER_TREE_TOO_LARGE,
  FULL_SET_LIST,
  RATE_LIMIT_HEADERS,
  RESOURCE_CONFLICT_ERRORS,
  RESOURCE_ERRORS,
  RESOURCE_MUTATION_ERRORS,
  V2_API_KEY_SECURITY,
  V2_API_KEY_SECURITY_SCHEMES,
  V2_COMMON_HEADERS,
  V2_ERROR_SCHEMA,
  WORKSPACE_ERRORS,
  withErrorExamples,
  withRequestBodyErrors,
} from '@/lib/api/contracts/v2/openapi/shared'
import {
  v2AddTableColumnContract,
  v2AddWorkflowGroupContract,
  v2CancelTableExportContract,
  v2CancelTableImportContract,
  v2CancelTableRunsContract,
  v2CompleteTableImportContract,
  v2CreateTableContract,
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
  v2FindTableRowsContract,
  v2GetTableContract,
  v2GetTableExportContract,
  v2GetTableImportContract,
  v2GetTableRowContract,
  v2GetTableViewContract,
  v2ListTableFoldersContract,
  v2ListTableRowsContract,
  v2ListTablesContract,
  v2ListTableViewsContract,
  v2ListWorkflowGroupsContract,
  v2QueryRowsContract,
  v2QueryRowsCountContract,
  v2RelocateTableFolderContract,
  v2RunRowEnrichmentContract,
  v2RunTableColumnContract,
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

const WORKSPACE_ID = 'a91c4b2e-6d3f-4e8a-b5c7-0d9e2f1a8c64'
const TABLE_ID = 'tbl_7c9e6679742540de944be07fc1f90ae7'
const ROW_ID = 'row_1f3e5d7c9b8a4c2d806e4a6b8d0f2e93'
const VIEW_ID = 'view_6b8d0f2a4c3e4e5da28f7c9b1d3f5a07'
const GROUP_ID = 'grp_5d8b2f0a6c1e4739a8b3d5f7e9c1a204'
const IMPORT_ID = 'imp_4f6a8c0e2b1d43759a7c9e1f3b5d7082'
const EXPORT_ID = 'exp_3e5f7a9c1b2d4068a0c2e4f6b8d0f193'

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
      operationId: 'listTables',
      summary: 'List Tables',
      description: `List tables in a workspace with optional folder filtering, search, sorting, and an opaque cursor envelope. ${FOLDER_TREE_TOO_LARGE}`,
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
      operationId: 'getTable',
      summary: 'Get Table',
      description: `Retrieve a table with its metadata, column schema, locks, and current job. ${FOLDER_TREE_TOO_LARGE}`,
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
      operationId: 'deleteTable',
      summary: 'Delete Table',
      description: 'Delete a table and return an explicit deletion acknowledgement.',
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
      operationId: 'updateTable',
      summary: 'Update Table',
      description: `Rename a table, edit its description, or move it to a canonical folder. At least one mutable field is required; lock flags remain read-only.\n\nNOT atomic: name, description, and folder are written independently, so a 4xx does not mean nothing changed. The error body carries \`details.applied\` naming the fields that landed — retry with only the ones missing from it.\n\n${FOLDER_TREE_TOO_LARGE}`,
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
      operationId: 'listTableRows',
      summary: 'List Rows',
      description:
        'List a plain cursor page in default row order. Pages are capped at 5MB by default and may contain fewer rows than the requested limit; continue until nextCursor is null. Use the query endpoint for predicate filtering and sorting.',
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
      operationId: 'getTableRow',
      summary: 'Get Row',
      description: 'Retrieve one row by identifier.',
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
      operationId: 'upsertTableRow',
      summary: 'Upsert Row',
      description:
        'Insert a row or update the existing row that conflicts on a selected unique column.\n\nWARNING — the update branch REPLACES the row, it does not merge. `data` is the complete new row value, so every column you omit is cleared on the matched row. Send the full row here, or use `PATCH /api/v2/tables/{tableId}/rows/{rowId}` to change a subset.',
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
      operationId: 'queryTableRows',
      summary: 'Query Rows',
      description:
        'Query rows with an optional typed predicate, ordered sort specification, and opaque cursor pagination. A predicate may be one condition or an `all`/`any` group; omit it to match every row. Bounded pages are capped at 5MB by default and may contain fewer rows than the requested limit; continue until nextCursor is null. A predicate larger than the request-body ceiling is a `413`.',
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
      operationId: 'countTableRows',
      summary: 'Count Rows',
      description:
        'Count the rows matching a typed predicate across the entire table. A predicate may be one condition or an `all`/`any` group. The paged reads carry no total, and `rowCount` on the table resource counts every row rather than the matches. Omit the predicate to count the whole table. A predicate larger than the request-body ceiling is a `413`.',
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
      operationId: 'listTableViews',
      summary: 'List Views',
      description: `List the bounded set of saved table views, with references to removed columns pruned on read. ${FULL_SET_LIST}`,
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
      operationId: 'getTableView',
      summary: 'Get View',
      description: 'Retrieve one saved table view by identifier.',
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
              workflowId: 'wf_1b3d5f7a9c2e4680b4d6f8a0c2e4b619',
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
    v2RunTableColumnContract,
    tableOperation({
      operationId: 'runTableColumns',
      summary: 'Run Column Groups',
      description:
        'Asynchronously run workflow or enrichment groups across all rows or a selected row subset.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The accepted table-column dispatch.' },
    }),
    {
      query: v2RunTableColumnContract.query,
      params: documentedSchema(
        v2RunTableColumnContract.params,
        'RunTableColumnsParams',
        'Run table columns path parameters',
        'Table whose producer groups should run.'
      ),
      body: documentedSchema(
        v2RunTableColumnContract.body,
        'RunTableColumnsRequest',
        'Run table columns request',
        'Workspace scope, producer groups, execution mode, and optional row scope.',
        [{ workspaceId: WORKSPACE_ID, groupIds: [GROUP_ID] }]
      ),
      response: documentedSchema(
        v2RunTableColumnContract.response.schema,
        'V2RunTableColumnsResponse',
        'Run table columns response',
        'Accepted background dispatch identifier.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2RunRowEnrichmentContract,
    tableOperation({
      operationId: 'runRowEnrichment',
      summary: 'Run Enrichment For One Row',
      description: 'Asynchronously run one workflow or enrichment group for one table row.',
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
    v2FindTableRowsContract,
    tableOperation({
      operationId: 'findTableRows',
      summary: 'Find Rows',
      description:
        'Search every cell case-insensitively, optionally within a predicate-filtered and sorted view.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The matching table cells.' },
    }),
    {
      query: v2FindTableRowsContract.query,
      params: documentedSchema(
        v2FindTableRowsContract.params,
        'FindTableRowsParams',
        'Find table rows path parameters',
        'Table whose cells should be searched.'
      ),
      body: documentedSchema(
        v2FindTableRowsContract.body,
        'FindTableRowsRequest',
        'Find table rows request',
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
        v2FindTableRowsContract.response.schema,
        'V2FindTableRowsResponse',
        'Find table rows response',
        'Matching table cells and truncation state.'
      ),
    }
  ),
  defineOpenApiRoute(
    v2CreateTableImportContract,
    tableOperation({
      operationId: 'createTableImport',
      summary: 'Create Table Import',
      description:
        'Create a durable CSV import. Upload sources receive signed transfer instructions; workspace-file sources begin processing directly.',
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
      operationId: 'getTableImport',
      summary: 'Get Table Import',
      description:
        'Read progress and terminal state for a durable table import.\n\nAn upload-backed import has no durable record until its upload completes, so send the signed upload control token to read it during the `uploading` phase; without the token that phase is a `404`.',
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
      operationId: 'cancelTableImport',
      summary: 'Cancel Table Import',
      description:
        'Cancel an upload or processing import without rolling back committed row batches.\n\nAn import that is not in a cancelable state, including an `expired` one, is a `409` naming the current status. An unknown or already-purged import id is a `404`.',
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
      operationId: 'createTableImportPartUrls',
      summary: 'Create Table Import Part URLs',
      description:
        'Issue short-lived signed PUT URLs for a bounded set of multipart part numbers.\n\nThe import must still be `uploading`; one that has moved on, including an `expired` one, is a `409` naming the current status. An unknown or already-purged import id is a `404`.',
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
      operationId: 'completeTableImportUpload',
      summary: 'Complete Table Import Upload',
      description:
        'Verify or assemble the uploaded CSV and begin processing with the same import id.\n\nAn import no longer awaiting an upload, including an `expired` one, is a `409` naming the current status. An unknown or already-purged import id is a `404`.',
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
      operationId: 'createTableExport',
      summary: 'Create Table Export',
      description:
        'Create a durable CSV or JSON export that completes inline for small tables and queues larger work.',
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
      operationId: 'getTableExport',
      summary: 'Get Table Export',
      description: 'Read progress and terminal state for a durable table export.',
      errors: RESOURCE_ERRORS,
      success: { description: 'The requested table export.' },
    }),
    {
      params: documentedSchema(
        v2GetTableExportContract.params,
        'GetTableExportParams',
        'Get table export path parameters',
        'Export selected for retrieval.',
        [{ exportId: EXPORT_ID }]
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
      operationId: 'cancelTableExport',
      summary: 'Cancel Table Export',
      description: 'Cancel an export that has not reached a terminal state.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'The canceled table export.' },
    }),
    {
      params: documentedSchema(
        v2CancelTableExportContract.params,
        'CancelTableExportParams',
        'Cancel table export path parameters',
        'Export selected for cancellation.'
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
      operationId: 'downloadTableExport',
      summary: 'Download Table Export',
      description:
        'Return a short-lived signed download URL for a completed table export.\n\nThe export must have reached `completed`; one still processing, failed, or canceled is a `409` naming the current status. An export whose file is no longer available is a `404`, not a `410`.',
      errors: RESOURCE_CONFLICT_ERRORS,
      success: { description: 'Signed table-export download information.' },
    }),
    {
      params: documentedSchema(
        v2TableExportDownloadContract.params,
        'DownloadTableExportParams',
        'Download table export path parameters',
        'Export selected for download.'
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
      operationId: 'listTablesFolders',
      summary: 'List Folders',
      description: `List table folders, optionally restricting the result to direct children of a canonical parent path. ${FULL_SET_LIST}`,
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
      operationId: 'deleteTablesFolder',
      summary: 'Delete Folder',
      description:
        'Delete an empty table folder, or recursively delete its descendants and tables when explicitly requested.',
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
  security: V2_API_KEY_SECURITY,
  securitySchemes: V2_API_KEY_SECURITY_SCHEMES,
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
