import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  addWorkflowGroupBodySchema,
  cancelTableRunsBodyBaseSchema,
  columnNameSchema,
  columnTypeSchema,
  createTableViewBodySchema,
  currencyCodeSchema,
  deleteTableColumnBodySchema,
  deleteWorkflowGroupBodySchema,
  exportTableAsyncBodySchema,
  insertTableRowBodyBaseSchema,
  predicateSchema,
  refineCancelTableRunsScope,
  refineColumnOptions,
  rowAnchorMutexRefine,
  runColumnBodyBaseSchema,
  runColumnExcludeMutexRefine,
  runColumnScopeMutexRefine,
  selectOptionsSchema,
  sortSpecSchema,
  tableColumnSchema,
  tableIdParamsSchema,
  tableLocksSchema,
  tableMetadataSchema,
  tableNameSchema,
  tableRowParamsSchema,
  tableRowsQueryBaseSchema,
  tableViewParamsSchema,
  updateRowsByFilterBodySchema,
  updateTableRowBodySchema,
  updateTableViewBodySchema,
  updateWorkflowGroupBodySchema,
  upsertTableRowBodySchema,
  workflowGroupOutputColumnSchema,
} from '@/lib/api/contracts/tables'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { ianaTimezoneSchema } from '@/lib/api/contracts/user'
import {
  v1BatchInsertTableRowsBodySchema,
  v1CreateTableBodySchema,
  v1ListTablesQuerySchema,
} from '@/lib/api/contracts/v1/tables'
import {
  v2CreateFolderBodySchema,
  v2CursorListResponse,
  v2DataResponse,
  v2DeleteFolderQuerySchema,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2FolderSchema,
  v2ListFoldersQuerySchema,
  v2RelocateFolderBodySchema,
  v2SearchSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'
import {
  v2OptionalUploadTokenHeadersSchema,
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
  v2UploadTokenHeadersSchema,
  v2UploadTransferSchema,
} from '@/lib/api/contracts/v2/uploads'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  CSV_DURABLE_MAX_FILE_SIZE_BYTES,
  CSV_DURABLE_MAX_FILE_SIZE_MESSAGE,
} from '@/lib/table/import'
import type { RowData } from '@/lib/table/types'

/**
 * v2 tables contracts.
 *
 * Request shapes (params/query/body) are reused from the v1 contract and the
 * first-party `/api/table` contract where the surface is unchanged. Two things
 * are upgraded relative to v1:
 *
 * - The response envelope is the canonical v2 family (`{ data }` for
 *   single/mutation, `{ data, nextCursor }` for lists).
 * - Filters speak ONLY the typed predicate tree (`{ all | any: [...] }` — the
 *   same grammar the table_v2 block consumes). The legacy MongoDB-style
 *   `$`-operator object stays a v1-only dialect. Rich filtered reads live on
 *   the dedicated `POST /query` endpoint; the rows GET is a plain cursor page.
 *
 * The `data` item schemas are concrete and describe exactly what the route's
 * `toApiTable`/`toApiRow` serializers emit. The first-party
 * `tableDefinitionSchema`/`tableRowSchema` are NOT reused here because they are
 * opaque (`z.custom`) and their inferred types include fields the public wire
 * never carries (`executions`, `workspaceId`, `Date` timestamps, …). Column
 * shape is reused from the concrete first-party `tableColumnSchema`.
 */

/** Default page size when a row query/list `limit` is omitted. */
export const V2_DEFAULT_ROW_LIMIT = 100
/** Hard cap on an explicit page `limit`. Larger pulls use `limit=0` (query) or an export resource. */
export const V2_MAX_ROW_LIMIT = 1000
/** Keeps upload-token metadata comfortably below common 8 KiB request-header limits after signing. */
export const V2_TABLE_IMPORT_OPTIONS_MAX_BYTES = 2 * 1024

/**
 * Omit mask stripping `__privateSecretProvenance` from a first-party body reused
 * as a v2 public body.
 *
 * The field is an in-process channel for trusted internal callers (Copilot,
 * the executor) and no v2 route reads it. Left in place it would be published in
 * the OpenAPI document as a request property whose own description says it is
 * "for trusted internal callers" — advertising an internal affordance to every
 * public consumer.
 */
const OMIT_PRIVATE_PROVENANCE = { [PRIVATE_SECRET_PROVENANCE_FIELD]: true } as const

/**
 * Public table shape emitted by `toApiTable` (timestamps ISO-serialized).
 * Concrete so the v2 contract describes exactly what the wire carries.
 */
/**
 * The table's current background job, or `null` when idle.
 *
 * Import and delete jobs are also derived onto the table (one write job per table at a time).
 * Durable imports and exports have their own resource endpoints for complete lifecycle state.
 */
export const v2TableJobStateSchema = z
  .object({
    id: z.string().nullable().describe('Background job identifier, or null when unavailable.'),
    type: z
      .enum(['import', 'delete', 'export', 'backfill', 'update'])
      .nullable()
      .describe('Kind of background table work.'),
    status: z
      .enum(['running', 'ready', 'failed', 'canceled'])
      .describe('Current background job state.'),
    rowsProcessed: z.number().describe('Number of rows processed by the job.'),
    /** Failure reason for a `failed` job; `null` otherwise. */
    error: z.string().nullable().describe('Failure reason, or null when the job has not failed.'),
  })
  .meta({
    id: 'V2TableJobState',
    title: 'Table job state',
    description: 'Current background work associated with a table.',
  })
export type V2TableJobState = z.output<typeof v2TableJobStateSchema>

export const v2ApiTableSchema = z
  .object({
    id: z.string().describe('Unique table identifier.'),
    name: z.string().describe('Table name.'),
    description: z.string().nullable().describe('Table description, or null when none is set.'),
    ownerEmail: z
      .email()
      .describe('Current email address of the table owner.')
      .meta({ examples: ['owner@example.com'] }),
    schema: z
      .object({ columns: z.array(tableColumnSchema).describe('Table column definitions.') })
      .describe('Typed table schema.'),
    rowCount: z.number().describe('Current number of rows in the table.'),
    maxRows: z.number().describe('Maximum rows allowed by the workspace plan.'),
    /** Canonical containing-folder path; `/` means the workspace root. */
    folderPath: v2FolderPathSchema,
    /**
     * Governance flags, read-only on the public API. They are enforced on every
     * write (a locked verb returns 423), but flipping them is a first-party admin
     * action — see {@link v2UpdateTableBodySchema}.
     */
    locks: tableLocksSchema.describe('Read-only table governance locks.'),
    /** In-flight background job, or `null` when the table is idle. */
    job: v2TableJobStateSchema.nullable().describe('Current background job, or null when idle.'),
    createdAt: v2TimestampSchema.describe('ISO 8601 timestamp when the table was created.'),
    updatedAt: v2TimestampSchema.describe('ISO 8601 timestamp when the table was last modified.'),
  })
  .meta({
    id: 'V2ApiTable',
    title: 'Table',
    description: 'A user-defined table with typed columns and governance state.',
  })
export type V2ApiTable = z.output<typeof v2ApiTableSchema>

/**
 * Public row shape emitted by `toApiRow`: `{ id, data, createdAt, updatedAt }`,
 * no storage internals (`position`/`orderKey`/`executions`). `data` is keyed by
 * column NAME and select cells carry their option NAME; cell values are
 * user-defined, so the map is `Record<string, unknown>`. Timestamps ISO.
 */
export const v2RowDataSchema = z
  .record(
    z.string(),
    z.unknown().describe('User-defined cell value interpreted by its column definition.')
  )
  .describe('Row cells keyed by column name.')
  .meta({
    id: 'V2TableRowData',
    title: 'Table row data',
    description: 'User-defined row cells keyed by column name.',
    examples: [{ email: 'jane@example.com', name: 'Jane Doe', age: 30 }],
  }) as z.ZodType<RowData, RowData>

export const v2ApiRowSchema = z
  .object({
    id: z.string().describe('Unique row identifier.'),
    data: v2RowDataSchema.describe('Row cells keyed by column name.'),
    createdAt: v2TimestampSchema.describe('ISO 8601 timestamp when the row was created.'),
    updatedAt: v2TimestampSchema.describe('ISO 8601 timestamp when the row was last modified.'),
  })
  .meta({
    id: 'V2ApiTableRow',
    title: 'Table row',
    description: 'A table row with user-defined cell values.',
  })
export type V2ApiRow = z.output<typeof v2ApiRowSchema>

export const v2DeleteTableDataSchema = z
  .object({
    id: z.string().describe('Identifier of the deleted table.'),
    deleted: z.literal(true).describe('Confirms that the table was deleted.'),
  })
  .meta({
    id: 'V2DeleteTableData',
    title: 'Delete table data',
    description: 'Table deletion acknowledgement.',
  })
export type V2DeleteTableData = z.output<typeof v2DeleteTableDataSchema>

/** The table's full column list after a column mutation. */
export const v2TableColumnsDataSchema = z
  .object({ columns: z.array(tableColumnSchema).describe('Current table columns.') })
  .meta({
    id: 'V2TableColumnsData',
    title: 'Table columns data',
    description: 'The table column list after a schema mutation.',
  })
export type V2TableColumnsData = z.output<typeof v2TableColumnsDataSchema>

/** Batch-insert payload. */
export const v2BatchInsertRowsDataSchema = z
  .object({
    rows: z.array(v2ApiRowSchema).describe('Inserted table rows.'),
    insertedCount: z.number().describe('Number of inserted rows.'),
  })
  .meta({
    id: 'V2BatchInsertRowsData',
    title: 'Batch insert rows data',
    description: 'Rows created by a batch insert.',
  })
export type V2BatchInsertRowsData = z.output<typeof v2BatchInsertRowsDataSchema>

export const v2CreateSingleTableRowResponseSchema = v2DataResponse(v2ApiRowSchema).meta({
  id: 'V2CreateSingleTableRowResponse',
  title: 'Create single table row response',
  description: 'Response returned after inserting one table row.',
})

export const v2CreateBatchTableRowsResponseSchema = v2DataResponse(
  v2BatchInsertRowsDataSchema
).meta({
  id: 'V2CreateBatchTableRowsResponse',
  title: 'Create batch table rows response',
  description: 'Response returned after inserting a batch of table rows.',
})

/**
 * Bulk update-by-filter payload. v2 always returns `updatedRowIds` (`[]` when
 * nothing matched) — v1 dropped the field on the zero-match branch.
 */
export const v2UpdateRowsDataSchema = z
  .object({
    updatedCount: z.number().describe('Number of updated rows.'),
    updatedRowIds: z.array(z.string()).describe('Identifiers of updated rows.'),
  })
  .meta({
    id: 'V2UpdateRowsData',
    title: 'Update rows data',
    description: 'Result of a bulk row update.',
  })
export type V2UpdateRowsData = z.output<typeof v2UpdateRowsDataSchema>

/**
 * Bulk delete payload — one consistent shape for both id-based and
 * filter-based deletes. `requestedCount`/`missingRowIds` are populated for the
 * id-based delete (which has a requested set) and omitted for the filter-based
 * delete; v1 emitted two divergent shapes here.
 */
export const v2DeleteRowsDataSchema = z
  .object({
    deletedCount: z.number().describe('Number of deleted rows.'),
    deletedRowIds: z.array(z.string()).describe('Identifiers of deleted rows.'),
    requestedCount: z.number().optional().describe('Number of row identifiers requested.'),
    missingRowIds: z.array(z.string()).optional().describe('Requested row identifiers not found.'),
  })
  .meta({
    id: 'V2DeleteRowsData',
    title: 'Delete rows data',
    description: 'Result of a bulk row deletion.',
  })
export type V2DeleteRowsData = z.output<typeof v2DeleteRowsDataSchema>

/** Single-row delete payload — mirrors every other v2 single-resource delete. */
export const v2DeleteRowDataSchema = z
  .object({
    id: z.string().describe('Identifier of the deleted row.'),
    deleted: z.literal(true).describe('Confirms that the row was deleted.'),
  })
  .meta({
    id: 'V2DeleteRowData',
    title: 'Delete row data',
    description: 'Row deletion acknowledgement.',
  })
export type V2DeleteRowData = z.output<typeof v2DeleteRowDataSchema>

/** Upsert payload — the row object matches every other v2 row endpoint. */
export const v2UpsertRowDataSchema = z
  .object({
    row: v2ApiRowSchema.describe('The inserted or updated table row.'),
    operation: z.enum(['insert', 'update']).describe('Whether the row was inserted or updated.'),
  })
  .meta({
    id: 'V2UpsertRowData',
    title: 'Upsert row data',
    description: 'Row returned by an upsert and the operation performed.',
  })
export type V2UpsertRowData = z.output<typeof v2UpsertRowDataSchema>

export const v2TableSortFields = ['name', 'createdAt', 'updatedAt'] as const

export type V2TableSortBy = (typeof v2TableSortFields)[number]

/**
 * Table list query: the workspace scope every table route shares, plus the v2
 * search/sort convention and a folder filter. Kept separate from
 * `v1ListTablesQuerySchema` — the single-table read/delete routes reuse that
 * schema and have no list params.
 */
export const v2ListTablesQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace whose tables should be listed.'),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe('Restrict results to tables in this folder.'),
    search: v2SearchSchema,
    ...v2SortFields(v2TableSortFields, { sortBy: 'createdAt', sortOrder: 'asc' }),
    /**
     * The `.transform()` clamp erases every bound from `z.toJSONSchema`, which
     * published a bare `type: number` while the description promised a 1–1000
     * range. `.meta()` restores the JSON Schema keywords without touching the
     * runtime pipeline: the published schema states the supported domain, and
     * the server stays deliberately lenient about inputs outside it.
     */
    limit: z.coerce
      .number()
      .optional()
      .default(100)
      .transform((v) => Math.min(Math.max(1, Math.trunc(v)), 1000))
      .describe(
        'Maximum tables to return (1-1000). Fractional or out-of-range values are truncated and clamped into that range rather than rejected.'
      )
      .meta({ type: 'integer', minimum: 1, maximum: 1000 }),
    cursor: z.string().min(1).optional().describe('Opaque cursor from the previous page.'),
  })
  .strict()

export type V2ListTablesQuery = z.output<typeof v2ListTablesQuerySchema>

export const v2TableWorkspaceQuerySchema = v1ListTablesQuerySchema.extend({
  workspaceId: v1ListTablesQuerySchema.shape.workspaceId.describe('Workspace that owns the table.'),
})
export type V2TableWorkspaceQuery = z.output<typeof v2TableWorkspaceQuerySchema>

const v2TableColumnInputShape = {
  id: z.string().optional().describe('Optional client-provided column identifier.'),
  name: columnNameSchema.describe('Column name.'),
  type: columnTypeSchema.describe('Column data type.'),
  unique: z.boolean().optional().describe('Whether values in the column must be unique.'),
  options: selectOptionsSchema.optional().describe('Select options for select-type columns.'),
  multiple: z.boolean().optional().describe('Whether a select column accepts multiple values.'),
  currencyCode: currencyCodeSchema.optional().describe('ISO 4217 code for currency columns.'),
}

/** Public column input. `required` is response-only and rejected on every v2 write. */
export const v2TableColumnInputSchema = z
  .object(v2TableColumnInputShape)
  .strict()
  .superRefine(refineColumnOptions)

const v2InitialTableColumnInputSchema = z
  .object({
    ...v2TableColumnInputShape,
    workflowGroupId: z
      .string()
      .optional()
      .describe('Workflow group initially associated with the column.'),
  })
  .strict()
  .superRefine(refineColumnOptions)

export const v2CreateTableBodySchema = v1CreateTableBodySchema
  .omit({ folderId: true, schema: true })
  .extend({
    schema: z
      .object({
        columns: z
          .array(v2InitialTableColumnInputSchema)
          .min(1, 'Table must have at least one column')
          .max(
            TABLE_LIMITS.MAX_COLUMNS_PER_TABLE,
            `Table cannot have more than ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} columns`
          )
          .describe('Initial table columns.'),
      })
      .strict()
      .describe('Initial table column definitions.'),
    folderPath: v2FolderPathInputSchema.optional().describe('Folder in which to create the table.'),
  })
  .strict()

export type V2CreateTableBody = z.input<typeof v2CreateTableBodySchema>

/**
 * Table list. Keyset-paged over the active sort: `limit` (default 100, clamped
 * to 1..1000) plus an opaque sort-stamped `cursor`, so `nextCursor` is a real
 * cursor and not always `null`. Search, folder filter, sort, and the keyset all
 * run in the query, not over its result.
 */
export const v2ListTablesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables',
  query: v2ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2ApiTableSchema),
  },
})

export const v2CreateTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables',
  body: v2CreateTableBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ApiTableSchema),
    status: 201,
  },
})

export const v2GetTableContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/[tableId]',
  params: tableIdParamsSchema,
  query: v2TableWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ApiTableSchema),
  },
})

/**
 * Table update. Every field is optional but at least one must be present:
 * `name` renames, `description` edits metadata, and `folderPath` moves the
 * table. Omission leaves placement untouched; `/` moves it to the workspace
 * root.
 *
 * `locks` is deliberately **not** accepted here, which is why this body is
 * declared rather than reusing the first-party `updateTableBodySchema`. The
 * governance flags are read-only on the public surface: an API key that can
 * write a table must not also be able to clear the lock that was put there to
 * stop it. Flipping a lock stays a first-party admin action. The body is
 * `.strict()`, so a caller sending `locks` gets a 400 naming the field instead
 * of a silent no-op that reads as success.
 */
export const v2UpdateTableBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: tableNameSchema.optional().describe('Replacement table name.'),
    description: v1CreateTableBodySchema.shape.description
      .nullable()
      .describe('Replacement table description, or null to clear it.'),
    folderPath: v2FolderPathInputSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (
      body.name === undefined &&
      body.description === undefined &&
      body.folderPath === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide a new name, description, or folder',
        path: ['name'],
      })
    }
  })

export const v2UpdateTableContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/[tableId]',
  params: tableIdParamsSchema,
  body: v2UpdateTableBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ApiTableSchema),
  },
})
export type V2UpdateTableBody = z.input<typeof v2UpdateTableBodySchema>

export const v2DeleteTableFolderDataSchema = z
  .object({
    path: v2FolderPathSchema.describe('Canonical path of the deleted folder.'),
    deleted: z.literal(true).describe('Confirms that the folder was deleted.'),
    deletedItems: z
      .object({
        folders: z.number().int().describe('Number of deleted folders.'),
        tables: z.number().int().describe('Number of deleted tables.'),
      })
      .describe('Deleted resource counts.'),
  })
  .meta({
    id: 'V2DeleteTableFolderData',
    title: 'Delete table folder data',
    description: 'Folder deletion acknowledgement and deleted-resource counts.',
  })

export const v2ListTableFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/folders',
  query: v2ListFoldersQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2FolderSchema) },
})

export const v2CreateTableFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/folders',
  body: v2CreateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FolderSchema), status: 201 },
})

export const v2RelocateTableFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/folders',
  body: v2RelocateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FolderSchema) },
})

export const v2DeleteTableFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/folders',
  query: v2DeleteFolderQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2DeleteTableFolderDataSchema) },
})

export const v2DeleteTableContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/[tableId]',
  params: tableIdParamsSchema,
  query: v2TableWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteTableDataSchema),
  },
})

export const v2CreateTableColumnBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the table.'),
    column: z
      .object({
        ...v2TableColumnInputShape,
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based insertion position for the column.'),
      })
      .strict()
      .superRefine(refineColumnOptions)
      .describe('Column definition to add.'),
  })
  .strict()

export type V2CreateTableColumnBody = z.input<typeof v2CreateTableColumnBodySchema>

export const v2UpdateTableColumnBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the table.'),
    columnName: columnNameSchema.describe('Current name of the column to update.'),
    updates: z
      .object({
        name: columnNameSchema.optional().describe('Replacement column name.'),
        type: columnTypeSchema.optional().describe('Replacement column data type.'),
        unique: z.boolean().optional().describe('Whether values in the column must be unique.'),
        options: selectOptionsSchema
          .optional()
          .describe('Replacement select options for select-type columns.'),
        multiple: z
          .boolean()
          .optional()
          .describe('Whether a select column accepts multiple values.'),
        currencyCode: currencyCodeSchema
          .optional()
          .describe('Replacement ISO 4217 code for a currency column.'),
      })
      .strict()
      .superRefine(refineColumnOptions)
      .describe('Mutable column fields.'),
  })
  .strict()

export type V2UpdateTableColumnBody = z.input<typeof v2UpdateTableColumnBodySchema>

export const v2AddTableColumnContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/columns',
  params: tableIdParamsSchema,
  body: v2CreateTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2TableColumnsDataSchema),
  },
})

export const v2UpdateTableColumnContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/[tableId]/columns',
  params: tableIdParamsSchema,
  body: v2UpdateTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2TableColumnsDataSchema),
  },
})

export const v2DeleteTableColumnContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/[tableId]/columns',
  params: tableIdParamsSchema,
  body: deleteTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2TableColumnsDataSchema),
  },
})

/**
 * Row list query: a plain cursor page over the default row order. Filtering and
 * sorting are NOT part of this surface — rich reads go through the dedicated
 * `POST /query` endpoint's predicate grammar. The opaque cursor uses the
 * `(order_key, id)` keyset when possible and handles legacy rows without an order
 * key internally. Total row count is available as `rowCount` on the table.
 */
export const v2TableRowsQuerySchema = tableRowsQueryBaseSchema
  .pick({ workspaceId: true, limit: true })
  .extend({
    workspaceId: tableRowsQueryBaseSchema.shape.workspaceId.describe(
      'Workspace that owns the table.'
    ),
    /**
     * `.prefault()` is documentation, not behavior: the base schema's own
     * `.default()` sits outside a `z.preprocess` pipe, so `z.toJSONSchema`
     * dropped it and the published parameter advertised no default at all.
     * Re-declaring the same value on the outside restores `default: 100` in the
     * spec and is a no-op at runtime — an omitted `limit` already resolved to
     * `DEFAULT_QUERY_LIMIT` through the inner default.
     */
    limit: tableRowsQueryBaseSchema.shape.limit
      .describe('Maximum rows to return in the current page.')
      .prefault(TABLE_LIMITS.DEFAULT_QUERY_LIMIT),
    cursor: z
      .string()
      .min(1, 'cursor must be a non-empty token')
      .optional()
      .describe('Opaque cursor returned by the previous page.'),
  })
export type V2TableRowsQuery = z.output<typeof v2TableRowsQuerySchema>

/** Cursor-paginated row list. */
export const v2ListTableRowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  query: v2TableRowsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2ApiRowSchema),
  },
})

/**
 * Rows query body. `predicate`/`sort` are the typed predicate tree / sort spec,
 * field refs keyed by column NAME. `limit`: omitted →
 * {@link V2_DEFAULT_ROW_LIMIT}; `0` → unbounded (whole result or a 400
 * `TABLE_QUERY_RESULT_TOO_LARGE`); `1..{@link V2_MAX_ROW_LIMIT}` → page cap.
 */
export const v2QueryRowsBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  predicate: predicateSchema.optional(),
  sort: sortSpecSchema.optional().describe('Ordered table-row sort specification.'),
  limit: z
    .number({ error: 'Limit must be a number' })
    .int('Limit must be an integer')
    .min(0, 'Limit must be at least 0 (use 0 for an unbounded query)')
    .max(
      V2_MAX_ROW_LIMIT,
      `Limit cannot exceed ${V2_MAX_ROW_LIMIT}; use limit=0 for a full result or create an export resource for large datasets`
    )
    .optional()
    .describe('Maximum rows to return; zero requests an unbounded result.'),
  cursor: z
    .string()
    .min(1, 'cursor must be a non-empty token')
    .optional()
    .describe('Opaque cursor returned by the previous query page.'),
})
export type V2QueryRowsBody = z.input<typeof v2QueryRowsBodySchema>

/**
 * Rich filtered/sorted row read with cursor pagination — the v2 read surface
 * for anything beyond a plain page. POST because the predicate tree is a
 * structured body, not a querystring dialect.
 */
export const v2QueryRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/query',
  params: tableIdParamsSchema,
  body: v2QueryRowsBodySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2ApiRowSchema),
  },
})

/**
 * Single contract for `POST /rows` — the body is the single|batch union so the
 * route can dispatch in one `parseRequest`, and the response is the matching
 * union (`{ data: <row> }` for a single insert, `{ data: { rows,
 * insertedCount } }` for a batch).
 */
export const v2InsertTableRowBodySchema = insertTableRowBodyBaseSchema
  .omit({ position: true, ...OMIT_PRIVATE_PROVENANCE })
  .extend({
    data: v2RowDataSchema.describe('Row cells keyed by column name.'),
  })
  .refine(...rowAnchorMutexRefine)

export const v2BatchInsertTableRowsBodySchema = v1BatchInsertTableRowsBodySchema.extend({
  rows: z
    .array(v2RowDataSchema)
    .min(1, 'At least one row is required')
    .max(
      TABLE_LIMITS.MAX_BATCH_INSERT_SIZE,
      `Cannot insert more than ${TABLE_LIMITS.MAX_BATCH_INSERT_SIZE} rows per batch`
    )
    .describe('Rows to insert, with cells keyed by column name.'),
})

export const v2CreateTableRowsBodySchema = z.union([
  v2BatchInsertTableRowsBodySchema,
  v2InsertTableRowBodySchema,
])

export const v2CreateTableRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  body: v2CreateTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: z.union([v2CreateSingleTableRowResponseSchema, v2CreateBatchTableRowsResponseSchema]),
  },
})

/** Bulk update body — v2 accepts ONLY the predicate tree as the filter. */
export const v2UpdateRowsByPredicateBodySchema = updateRowsByFilterBodySchema
  .omit(OMIT_PRIVATE_PROVENANCE)
  .extend({
    filter: predicateSchema,
    data: v2RowDataSchema.describe('Row-data patch applied to every matching row.'),
  })
export type V2UpdateRowsByPredicateBody = z.input<typeof v2UpdateRowsByPredicateBodySchema>

/**
 * PATCH, not PUT: the body carries a row-data *patch* applied to every matching
 * row, never a replacement row. Pairs with `PATCH /rows/[rowId]` so partial
 * update is the same verb whether it targets one row or a predicate's worth.
 */
export const v2UpdateRowsByFilterContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  body: v2UpdateRowsByPredicateBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UpdateRowsDataSchema),
  },
})

/** Bulk delete body — either row ids or a predicate-tree filter, never both. */
export const v2DeleteTableRowsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    filter: predicateSchema.optional(),
    limit: z
      .number({ error: 'Limit must be a number' })
      .int('Limit must be an integer')
      .min(1, 'Limit must be at least 1')
      .max(
        TABLE_LIMITS.MAX_BULK_OPERATION_SIZE,
        `Cannot delete more than ${TABLE_LIMITS.MAX_BULK_OPERATION_SIZE} rows per operation`
      )
      .optional()
      .describe('Maximum matching rows to delete.'),
    rowIds: z
      .array(z.string().min(1))
      .min(1, 'At least one row ID is required')
      .max(
        TABLE_LIMITS.MAX_BULK_OPERATION_SIZE,
        `Cannot delete more than ${TABLE_LIMITS.MAX_BULK_OPERATION_SIZE} rows per operation`
      )
      .optional()
      .describe('Explicit row identifiers to delete.'),
  })
  .refine((data) => Boolean(data.filter) !== Boolean(data.rowIds), {
    message: 'Provide either filter or rowIds, but not both',
  })
export type V2DeleteTableRowsBody = z.input<typeof v2DeleteTableRowsBodySchema>

export const v2DeleteTableRowsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  body: v2DeleteTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteRowsDataSchema),
  },
})

export const v2UpdateTableRowBodySchema = updateTableRowBodySchema
  .omit(OMIT_PRIVATE_PROVENANCE)
  .extend({
    data: v2RowDataSchema.describe('Partial row-data patch keyed by column name.'),
  })

/**
 * Upsert body. `data` is a WHOLE-ROW value, not a patch — on the update branch
 * the service replaces `user_table_rows.data` outright rather than merging it
 * into the matched row, so any column omitted here is cleared. This differs from
 * `PATCH /rows/[rowId]`, which merges. Send every column you want the row to
 * keep, or use PATCH when you only mean to change a subset.
 */
export const v2UpsertTableRowBodySchema = upsertTableRowBodySchema
  .omit(OMIT_PRIVATE_PROVENANCE)
  .extend({
    data: v2RowDataSchema.describe(
      'Complete set of row cells keyed by column name. On the update branch this REPLACES the matched row: any column not present here is cleared, unlike the merging PATCH /rows/{rowId}.'
    ),
  })

export const v2GetTableRowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  query: v2TableWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ApiRowSchema),
  },
})

export const v2UpdateTableRowContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  body: v2UpdateTableRowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ApiRowSchema),
  },
})

export const v2DeleteTableRowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  query: v2TableWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteRowDataSchema),
  },
})

export const v2UpsertTableRowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/rows/upsert',
  params: tableIdParamsSchema,
  body: v2UpsertTableRowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UpsertRowDataSchema),
  },
})

/**
 * Body for the endpoints whose only input is the workspace the table must
 * belong to. Present so every v2 mutation carries the same scope check the rest
 * of the surface applies through `resolveWorkspaceScope`.
 */
export const v2WorkspaceScopedBodySchema = z.object({ workspaceId: workspaceIdSchema })
export type V2WorkspaceScopedBody = z.input<typeof v2WorkspaceScopedBodySchema>

const v2TableViewPredicateOutputSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const parsed = predicateSchema.safeParse(value)
    if (parsed.success) return
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
    }
  })
  .describe(
    'Recursive saved predicate tree. Runtime validation uses the canonical predicate schema.'
  ) as z.ZodType<z.output<typeof predicateSchema>>

export const v2TableViewConfigSchema = tableMetadataSchema
  .extend({
    filter: v2TableViewPredicateOutputSchema
      .nullable()
      .optional()
      .describe('Saved row predicate, or null when the view is unfiltered.'),
    sort: sortSpecSchema
      .nullable()
      .optional()
      .describe('Saved ordered sort specification, or null for default ordering.'),
  })
  .meta({
    id: 'V2TableViewConfig',
    title: 'Table view configuration',
    description: 'Saved filter, sort, and column-layout settings for a table view.',
  })

/**
 * A saved view: a named preset of `{ filter, sort, column layout }` over a
 * table. Presentation state only — a view narrows what a reader sees by
 * default, it is never an access boundary, and every row it hides stays
 * reachable by reading the table without it. Timestamps ISO-serialized.
 */
export const v2ApiViewSchema = z
  .object({
    id: z.string().describe('Unique saved-view identifier.'),
    tableId: z.string().describe('Table to which the view belongs.'),
    name: z.string().describe('Saved-view display name.'),
    config: v2TableViewConfigSchema.describe(
      'Saved filter, sort, and column-layout configuration.'
    ),
    isDefault: z.boolean().describe('Whether this is the table default view.'),
    /** Current email of the user who saved the view; `null` for a removed author. */
    createdByEmail: z.email().nullable().describe('Current author email, or null when removed.'),
    createdAt: v2TimestampSchema.describe('ISO 8601 timestamp when the view was created.'),
    updatedAt: v2TimestampSchema.describe('ISO 8601 timestamp when the view was last modified.'),
  })
  .meta({
    id: 'V2ApiTableView',
    title: 'Table view',
    description: 'A named saved presentation of table rows and columns.',
  })
export type V2ApiView = z.output<typeof v2ApiViewSchema>

/** Delete confirmation — the id of the view that was removed. */
export const v2DeleteTableViewDataSchema = z
  .object({
    id: z.string().describe('Identifier of the deleted view.'),
    deleted: z.literal(true).describe('Confirms that the view was deleted.'),
  })
  .meta({
    id: 'V2DeleteTableViewData',
    title: 'Delete table view data',
    description: 'Saved-view deletion acknowledgement.',
  })
export type V2DeleteTableViewData = z.output<typeof v2DeleteTableViewDataSchema>

/**
 * Every saved view on a table, oldest first. A table carries a small bounded
 * set of views, so this is a single full page (`nextCursor` is always `null`);
 * the cursor envelope keeps the v2 list surface uniform.
 */
export const v2ListTableViewsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/[tableId]/views',
  params: tableIdParamsSchema,
  query: v2TableWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2ApiViewSchema),
  },
})

export const v2CreateTableViewContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/views',
  params: tableIdParamsSchema,
  body: createTableViewBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ApiViewSchema),
    status: 201,
  },
})

export const v2GetTableViewContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/[tableId]/views/[viewId]',
  params: tableViewParamsSchema,
  query: v2TableWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ApiViewSchema),
  },
})

export const v2UpdateTableViewContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/[tableId]/views/[viewId]',
  params: tableViewParamsSchema,
  body: updateTableViewBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ApiViewSchema),
  },
})

/** Deleting the default view simply leaves the table unfiltered. */
export const v2DeleteTableViewContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/[tableId]/views/[viewId]',
  params: tableViewParamsSchema,
  query: v2TableWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteTableViewDataSchema),
  },
})

/**
 * One workflow/enrichment column group: a backing workflow (or registry
 * enrichment) plus the output columns its runs populate. Read-only on v2 —
 * groups are authored in the workflow builder, and the public surface exposes
 * them so a caller can discover the `groupIds` the run endpoints take.
 */
export const v2WorkflowGroupSchema = z
  .object({
    id: z.string().describe('Unique workflow-group identifier.'),
    /** Backing workflow id for `manual` groups; `''` for enrichment groups. */
    workflowId: z.string().describe('Backing workflow identifier for a manual group.'),
    /** Registry enrichment id for `enrichment` groups. */
    enrichmentId: z.string().optional().describe('Registry enrichment identifier.'),
    name: z.string().optional().describe('Workflow-group display name.'),
    type: z.enum(['manual', 'enrichment']).optional().describe('Producer type.'),
    dependencies: z
      .object({
        columns: z.array(z.string()).optional().describe('Columns required as producer inputs.'),
      })
      .optional()
      .describe('Input column dependencies.'),
    outputs: z
      .array(
        z.object({
          blockId: z.string().describe('Workflow block producing this output.'),
          path: z.string().describe('Path to the value in the workflow block output.'),
          outputId: z.string().optional().describe('Registry enrichment output identifier.'),
          columnName: z.string().describe('Table column receiving the output.'),
        })
      )
      .describe('Workflow outputs mapped to table columns.'),
    inputMappings: z
      .array(
        z.object({
          inputName: z.string().describe('Workflow input name.'),
          columnName: z.string().describe('Source table column name.'),
        })
      )
      .optional()
      .describe('Workflow inputs mapped from table columns.'),
    deploymentMode: z.enum(['live', 'deployed']).optional().describe('Workflow execution mode.'),
    /** When `false` the group never auto-fires; it runs only on an explicit request. */
    autoRun: z.boolean().optional().describe('Whether the group automatically runs for new rows.'),
  })
  .meta({
    id: 'V2TableWorkflowGroup',
    title: 'Table workflow group',
    description: 'A workflow or enrichment producer and the columns it populates.',
  })
export type V2WorkflowGroup = z.output<typeof v2WorkflowGroupSchema>

/**
 * The table's workflow/enrichment groups. Bounded per table, so a single full
 * page (`nextCursor` is always `null`).
 */
export const v2ListWorkflowGroupsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/[tableId]/groups',
  params: tableIdParamsSchema,
  query: v2TableWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2WorkflowGroupSchema),
  },
})

/**
 * Output column of a group, as the public surface accepts it. The first-party
 * shape carries `workflowGroupId` because the client mints the group id before
 * posting; v2 server-generates it, so the field is stamped from the group being
 * written rather than being a caller's to supply (and get wrong).
 */
const v2WorkflowGroupOutputColumnSchema = workflowGroupOutputColumnSchema.omit({
  workflowGroupId: true,
})

/**
 * A group names its producer two mutually exclusive ways, and the underlying
 * shape leaves both optional. Rejecting the mismatch here means the route never
 * has to guess which one a half-specified group meant.
 */
function refineGroupSource(
  group: { type?: 'manual' | 'enrichment'; workflowId?: string; enrichmentId?: string },
  ctx: z.RefinementCtx,
  path: (string | number)[]
): void {
  // `manual` is the workflow-backed default — it does not mean hand-entered.
  const type = group.type ?? 'manual'
  if (type === 'enrichment' && !group.enrichmentId) {
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'enrichmentId'],
      message: 'enrichmentId is required when type is "enrichment"',
    })
  }
  if (type === 'manual' && !group.workflowId) {
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'workflowId'],
      message: 'workflowId is required when type is "manual"',
    })
  }
}

/**
 * Create a group and the columns its runs populate, in one call.
 *
 * Two deliberate departures from the first-party body:
 * - `group.id` is optional and server-generated. The UI mints an id so it can
 *   render optimistically; a public caller has no such need and a client-chosen
 *   id is a collision waiting to happen.
 * - `autoRun` defaults to **false**. On the first-party surface it defaults to
 *   true so a UI add fills cells immediately, but here it would make one POST
 *   fan out a metered run across every existing row. Callers opt in, or fire
 *   explicitly via `POST /columns/run`.
 */
export const v2AddWorkflowGroupBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    group: addWorkflowGroupBodySchema.shape.group
      .extend({
        id: z
          .string()
          .min(1)
          .optional()
          .describe('Optional client-provided workflow-group identifier.'),
      })
      .describe('Workflow or enrichment producer definition.'),
    outputColumns: z
      .array(v2WorkflowGroupOutputColumnSchema)
      .min(1)
      .describe('Columns created for producer outputs.'),
    autoRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to schedule existing rows after group creation.'),
  })
  .strict()
  .superRefine((body, ctx) => refineGroupSource(body.group, ctx, ['group']))
export type V2AddWorkflowGroupBody = z.input<typeof v2AddWorkflowGroupBodySchema>

/** Update body. Omitted fields keep their stored values. */
export const v2UpdateWorkflowGroupBodySchema = updateWorkflowGroupBodySchema
  .extend({
    newOutputColumns: z
      .array(v2WorkflowGroupOutputColumnSchema)
      .optional()
      .describe('Columns to add for new outputs.'),
  })
  .strict()
export type V2UpdateWorkflowGroupBody = z.input<typeof v2UpdateWorkflowGroupBodySchema>

export const v2DeleteWorkflowGroupBodySchema = deleteWorkflowGroupBodySchema.strict()
export type V2DeleteWorkflowGroupBody = z.input<typeof v2DeleteWorkflowGroupBodySchema>

/**
 * Create and update both mutate the group *and* the table's columns, so both
 * are returned — otherwise a caller has to re-read the table to learn which
 * columns it just got.
 */
export const v2WorkflowGroupDataSchema = z
  .object({
    group: v2WorkflowGroupSchema.describe('The created or updated workflow group.'),
    columns: z.array(tableColumnSchema).describe('Current table columns after the mutation.'),
  })
  .meta({
    id: 'V2WorkflowGroupData',
    title: 'Workflow group data',
    description: 'A workflow group and the resulting table columns.',
  })
export type V2WorkflowGroupData = z.output<typeof v2WorkflowGroupDataSchema>

/**
 * Delete acknowledgement. Removing a group removes the columns it fed, so the
 * surviving column list is returned rather than left for the caller to guess.
 */
export const v2DeleteWorkflowGroupDataSchema = z
  .object({
    id: z.string().describe('Identifier of the deleted workflow group.'),
    deleted: z.literal(true).describe('Confirms that the workflow group was deleted.'),
    columns: z.array(tableColumnSchema).describe('Surviving table columns.'),
  })
  .meta({
    id: 'V2DeleteWorkflowGroupData',
    title: 'Delete workflow group data',
    description: 'Workflow-group deletion acknowledgement and surviving columns.',
  })
export type V2DeleteWorkflowGroupData = z.output<typeof v2DeleteWorkflowGroupDataSchema>

export const v2AddWorkflowGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/groups',
  params: tableIdParamsSchema,
  body: v2AddWorkflowGroupBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowGroupDataSchema),
    status: 201,
  },
})

export const v2UpdateWorkflowGroupContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/[tableId]/groups',
  params: tableIdParamsSchema,
  body: v2UpdateWorkflowGroupBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2WorkflowGroupDataSchema),
  },
})

export const v2DeleteWorkflowGroupContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/[tableId]/groups',
  params: tableIdParamsSchema,
  body: v2DeleteWorkflowGroupBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteWorkflowGroupDataSchema),
  },
})

/**
 * Run-column body. Identical to the first-party shape except `filter`, which v2
 * narrows to the typed predicate tree — the legacy `$`-operator dialect stays
 * v1-only across the whole v2 surface.
 */
export const v2RunColumnBodySchema = runColumnBodyBaseSchema
  .extend({ filter: predicateSchema.optional() })
  .refine(...runColumnScopeMutexRefine)
  .refine(...runColumnExcludeMutexRefine)
export type V2RunColumnBody = z.input<typeof v2RunColumnBodySchema>

/**
 * A started run. `dispatchId` identifies the `table_run_dispatches` row the
 * dispatcher walks; it is `null` in deployments without a background runner,
 * where cells execute inline and no dispatch row is created.
 */
export const v2RunColumnDataSchema = z
  .object({
    dispatchId: z
      .string()
      .nullable()
      .describe('Background dispatch identifier, or null when execution is inline.'),
  })
  .meta({
    id: 'V2RunColumnData',
    title: 'Run column data',
    description: 'Acknowledgement for a table column run.',
  })
export type V2RunColumnData = z.output<typeof v2RunColumnDataSchema>

/**
 * Runs one or more workflow/enrichment groups across the table or a row subset.
 * Asynchronous: the response acknowledges the dispatch, and cell values land as
 * the runs complete. Poll the rows endpoints for results.
 */
export const v2RunTableColumnContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/columns/run',
  params: tableIdParamsSchema,
  body: v2RunColumnBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2RunColumnDataSchema),
  },
})

export const v2RowEnrichmentParamsSchema = tableRowParamsSchema.extend({
  groupId: z.string().min(1).describe('Workflow or enrichment group to run.'),
})
export type V2RowEnrichmentParams = z.output<typeof v2RowEnrichmentParamsSchema>

/**
 * The single-cell case of {@link v2RunTableColumnContract}: runs one group for
 * one row. The scope lives entirely in the path, so the body carries only the
 * workspace.
 */
export const v2RunRowEnrichmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]',
  params: v2RowEnrichmentParamsSchema,
  body: v2WorkspaceScopedBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2RunColumnDataSchema),
  },
})

/**
 * Lookup body: a case-insensitive substring search across every cell, narrowed
 * by the same predicate/sort grammar as `POST /query`. POST because the
 * predicate tree is a structured body, not a querystring dialect.
 */
export const v2FindRowsBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  q: z
    .string()
    .min(1, 'q must be a non-empty search string')
    .describe('Case-insensitive cell substring to find.'),
  predicate: predicateSchema.optional(),
  sort: sortSpecSchema.optional().describe('Ordered table-row sort specification.'),
})
export type V2FindRowsBody = z.input<typeof v2FindRowsBodySchema>

/**
 * One matching cell. `ordinal` is the row's 0-based index in the
 * predicate-filtered, sorted view, so it lines up with the same page a
 * `POST /query` with the same predicate and sort would return. `column` is the
 * column NAME, matching how row `data` is keyed everywhere on the public wire.
 */
export const v2RowMatchSchema = z
  .object({
    ordinal: z.number().describe('Zero-based row index in the filtered and sorted view.'),
    rowId: z.string().describe('Identifier of the matching row.'),
    column: z.string().describe('Column name containing the match.'),
  })
  .meta({
    id: 'V2TableRowMatch',
    title: 'Table row match',
    description: 'One matching cell returned by a table row search.',
  })
export type V2RowMatch = z.output<typeof v2RowMatchSchema>

/**
 * Match set. `truncated` is `true` when the search hit the server-side cap and
 * more cells match than were returned — narrow the predicate rather than
 * paging, since matches have no cursor.
 */
export const v2FindRowsDataSchema = z
  .object({
    matches: z.array(v2RowMatchSchema).describe('Matching table cells.'),
    truncated: z.boolean().describe('Whether more matches exist beyond the server cap.'),
  })
  .meta({
    id: 'V2FindRowsData',
    title: 'Find rows data',
    description: 'Matching table cells and truncation state.',
  })
export type V2FindRowsData = z.output<typeof v2FindRowsDataSchema>

export const v2FindTableRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/rows/find',
  params: tableIdParamsSchema,
  body: v2FindRowsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FindRowsDataSchema),
  },
})

export const v2TableImportParamsSchema = z.object({
  importId: z.string().min(1).describe('Unique table-import identifier.'),
})
export const v2TableExportParamsSchema = z.object({
  exportId: z.string().min(1).describe('Unique table-export identifier.'),
})
export const v2TableTransferWorkspaceQuerySchema = z.object({
  workspaceId: workspaceIdSchema.describe('Workspace that owns the transfer resource.'),
})

export const v2TableOptionalUploadTokenHeadersSchema = v2OptionalUploadTokenHeadersSchema.extend({
  'upload-token': v2OptionalUploadTokenHeadersSchema.shape['upload-token'].describe(
    'Signed upload control token returned when an upload-backed import was created.'
  ),
})

export const v2TableUploadImportSourceSchema = z
  .object({
    type: z.literal('upload').describe('Upload-backed import discriminator.'),
    name: z.string().trim().min(1, 'name is required').max(255).describe('CSV filename.'),
    contentType: z
      .string()
      .trim()
      .min(1, 'contentType is required')
      .max(255)
      .describe('CSV MIME type.'),
    size: z
      .number()
      .int()
      .min(1)
      .max(CSV_DURABLE_MAX_FILE_SIZE_BYTES, CSV_DURABLE_MAX_FILE_SIZE_MESSAGE)
      .describe('Exact CSV file size in bytes.'),
  })
  .strict()
  .meta({
    id: 'V2TableUploadImportSource',
    title: 'Upload table import source',
    description: 'CSV file uploaded through signed transfer instructions.',
  })

export const v2TableWorkspaceFileImportSourceSchema = z
  .object({
    type: z.literal('workspace_file').describe('Workspace-file source discriminator.'),
    fileId: z.string().min(1).describe('Existing workspace file identifier.'),
  })
  .strict()
  .meta({
    id: 'V2TableWorkspaceFileImportSource',
    title: 'Workspace file table import source',
    description: 'Existing workspace file used as a CSV import source.',
  })

export const v2TableImportSourceSchema = z.discriminatedUnion('type', [
  v2TableUploadImportSourceSchema,
  v2TableWorkspaceFileImportSourceSchema,
])
export type V2TableImportSource = z.input<typeof v2TableImportSourceSchema>

export const v2TableImportTargetSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('new').describe('Create-new-table target discriminator.'),
      name: tableNameSchema.describe('Name of the table to create.'),
      folderPath: v2FolderPathInputSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('existing').describe('Existing-table target discriminator.'),
      tableId: z.string().min(1).describe('Existing target table identifier.'),
      mode: z
        .enum(['append', 'replace'])
        .describe('Whether to append rows or replace existing rows.'),
    })
    .strict(),
])
export type V2TableImportTarget = z.input<typeof v2TableImportTargetSchema>

const v2CsvHeaderSchema = z
  .string()
  .min(1, 'CSV header must not be empty')
  .max(
    TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH,
    `CSV header must be ${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters or less`
  )

const v2CsvColumnNameSchema = z
  .string()
  .min(1, 'Column name must not be empty')
  .max(
    TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH,
    `Column name must be ${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters or less`
  )

export const v2CsvImportMappingSchema = z
  .record(v2CsvHeaderSchema, v2CsvColumnNameSchema.nullable())
  .refine(
    (mapping) => Object.keys(mapping).length <= TABLE_LIMITS.MAX_COLUMNS_PER_TABLE,
    `mapping cannot contain more than ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} entries`
  )

export const v2CsvImportCreateColumnsSchema = z
  .array(v2CsvHeaderSchema)
  .max(
    TABLE_LIMITS.MAX_COLUMNS_PER_TABLE,
    `createColumns cannot contain more than ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} items`
  )

export const v2CreateTableImportBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    source: v2TableImportSourceSchema.describe('CSV source for the import.'),
    target: v2TableImportTargetSchema.describe('New or existing table import target.'),
    mapping: v2CsvImportMappingSchema
      .optional()
      .describe('CSV headers mapped to existing table columns.'),
    createColumns: v2CsvImportCreateColumnsSchema
      .optional()
      .describe('CSV headers for which new columns should be created.'),
    timezone: ianaTimezoneSchema
      .optional()
      .describe('IANA timezone used to interpret local date values.'),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.target.type === 'new' && body.mapping !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['mapping'],
        message: 'mapping is only supported for an existing table target',
      })
    }
    if (body.target.type === 'new' && body.createColumns !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['createColumns'],
        message: 'createColumns is only supported for an existing table target',
      })
    }
    const serializedOptions = JSON.stringify({
      ...(body.mapping !== undefined ? { mapping: body.mapping } : {}),
      ...(body.createColumns !== undefined ? { createColumns: body.createColumns } : {}),
    })
    if (
      new TextEncoder().encode(serializedOptions).byteLength > V2_TABLE_IMPORT_OPTIONS_MAX_BYTES
    ) {
      ctx.addIssue({
        code: 'custom',
        path: [body.mapping !== undefined ? 'mapping' : 'createColumns'],
        message: `mapping and createColumns must serialize to at most ${V2_TABLE_IMPORT_OPTIONS_MAX_BYTES} bytes because upload metadata is carried in a signed request token`,
      })
    }
  })
export type V2CreateTableImportBody = z.input<typeof v2CreateTableImportBodySchema>

export const v2TableImportStatusSchema = z.enum([
  'uploading',
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
  'expired',
])
export type V2TableImportStatus = z.output<typeof v2TableImportStatusSchema>

export const v2TableImportSchema = z
  .object({
    id: z.string().describe('Unique table-import identifier.'),
    workspaceId: z.string().describe('Workspace that owns the import.'),
    status: v2TableImportStatusSchema.describe('Current import lifecycle state.'),
    source: v2TableImportSourceSchema.describe('CSV source for the import.'),
    target: v2TableImportTargetSchema.describe('New or existing table import target.'),
    tableId: z.string().nullable().describe('Resulting or target table identifier.'),
    rowsProcessed: z.number().int().nonnegative().describe('Rows processed so far.'),
    error: z.string().nullable().describe('Terminal failure reason, or null.'),
    createdAt: v2TimestampSchema.describe('ISO 8601 creation timestamp.'),
    updatedAt: v2TimestampSchema.describe('ISO 8601 last-update timestamp.'),
    completedAt: v2TimestampSchema.nullable().describe('ISO 8601 completion timestamp, or null.'),
  })
  .meta({
    id: 'V2TableImport',
    title: 'Table import',
    description: 'Durable CSV table-import lifecycle resource.',
  })
export type V2TableImport = z.output<typeof v2TableImportSchema>

const v2UploadBackedTableImportSchema = v2TableImportSchema
  .extend({
    source: v2TableUploadImportSourceSchema.describe('Uploaded CSV source for this import.'),
  })
  .meta({
    id: 'V2UploadBackedTableImport',
    title: 'Upload-backed table import',
    description: 'Table import whose CSV source is uploaded through signed transfer instructions.',
  })

const v2WorkspaceFileTableImportSchema = v2TableImportSchema
  .extend({
    source: v2TableWorkspaceFileImportSourceSchema.describe(
      'Workspace-file CSV source for this import.'
    ),
  })
  .meta({
    id: 'V2WorkspaceFileTableImport',
    title: 'Workspace-file table import',
    description: 'Table import whose CSV source is an existing workspace file.',
  })

export const v2CreateTableImportDataSchema = z
  .union([
    z
      .object({
        session: v2UploadBackedTableImportSchema.describe('Created upload-backed import session.'),
        uploadToken: z.string().min(1).describe('Signed token for upload control requests.'),
        transfer: v2UploadTransferSchema.describe('Signed CSV upload instructions.'),
      })
      .strict(),
    z
      .object({
        session: v2WorkspaceFileTableImportSchema.describe(
          'Created workspace-file import session.'
        ),
        uploadToken: z.null().describe('Always null for workspace-file imports.'),
        transfer: z.null().describe('Always null for workspace-file imports.'),
      })
      .strict(),
  ])
  .meta({
    id: 'V2CreateTableImportData',
    title: 'Create table import data',
    description: 'Created import session and upload instructions when the source needs transfer.',
  })
export type V2CreateTableImportData = z.output<typeof v2CreateTableImportDataSchema>

export const v2CreateTableImportContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/imports',
  body: v2CreateTableImportBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CreateTableImportDataSchema),
    status: 201,
  },
})

export const v2GetTableImportContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/imports/[importId]',
  params: v2TableImportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableImportSchema) },
})

export const v2CancelTableImportContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/imports/[importId]',
  params: v2TableImportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  headers: v2TableOptionalUploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableImportSchema) },
})

export const v2CreateTableImportPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/imports/[importId]/parts',
  params: v2TableImportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  body: v2PartUrlsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2PartUrlsDataSchema) },
})

export const v2CompleteTableImportContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/imports/[importId]/complete',
  params: v2TableImportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableImportSchema) },
})

export const v2TableExportStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
])
export type V2TableExportStatus = z.output<typeof v2TableExportStatusSchema>

export const v2TableExportSchema = z
  .object({
    id: z.string().describe('Unique table-export identifier.'),
    tableId: z.string().describe('Exported table identifier.'),
    workspaceId: z.string().describe('Workspace that owns the export.'),
    format: z.enum(['csv', 'json']).describe('Export file format.'),
    status: v2TableExportStatusSchema.describe('Current export lifecycle state.'),
    rowsProcessed: z.number().int().nonnegative().describe('Rows exported so far.'),
    error: z.string().nullable().describe('Terminal failure reason, or null.'),
    createdAt: v2TimestampSchema.describe('ISO 8601 creation timestamp.'),
    updatedAt: v2TimestampSchema.describe('ISO 8601 last-update timestamp.'),
    completedAt: v2TimestampSchema.nullable().describe('ISO 8601 completion timestamp, or null.'),
  })
  .meta({
    id: 'V2TableExport',
    title: 'Table export',
    description: 'Durable asynchronous table-export lifecycle resource.',
  })
export type V2TableExport = z.output<typeof v2TableExportSchema>

export const v2CreateTableExportContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/exports',
  params: tableIdParamsSchema,
  body: exportTableAsyncBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableExportSchema), status: 201 },
})

export const v2GetTableExportContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/exports/[exportId]',
  params: v2TableExportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableExportSchema) },
})

export const v2CancelTableExportContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/exports/[exportId]',
  params: v2TableExportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableExportSchema) },
})

export const v2TableExportDownloadDataSchema = z
  .object({
    url: z.string().url().describe('Short-lived signed download URL.'),
    fileName: z.string().describe('Suggested export filename.'),
    expiresAt: v2TimestampSchema.describe('ISO 8601 URL expiration timestamp.'),
  })
  .meta({
    id: 'V2TableExportDownloadData',
    title: 'Table export download data',
    description: 'Signed URL and filename for a completed table export.',
  })

export const v2TableExportDownloadContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/exports/[exportId]/download',
  params: v2TableExportParamsSchema,
  query: v2TableTransferWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableExportDownloadDataSchema) },
})

/**
 * Cancel-runs body. Identical to the first-party shape except `filter`, which
 * v2 narrows to the typed predicate tree.
 */
export const v2CancelTableRunsBodySchema = cancelTableRunsBodyBaseSchema
  .extend({ filter: predicateSchema.optional() })
  .superRefine((value, ctx) => {
    for (const issue of refineCancelTableRunsScope(value)) {
      ctx.addIssue({ code: 'custom', ...issue })
    }
  })
export type V2CancelTableRunsBody = z.input<typeof v2CancelTableRunsBodySchema>

/** How many in-flight cell runs the cancel actually stopped. */
export const v2CancelTableRunsDataSchema = z
  .object({ cancelled: z.number().describe('Number of cell runs canceled.') })
  .meta({
    id: 'V2CancelTableRunsData',
    title: 'Cancel table runs data',
    description: 'Result of canceling in-flight table cell runs.',
  })
export type V2CancelTableRunsData = z.output<typeof v2CancelTableRunsDataSchema>

/**
 * Stops in-flight and pending workflow/enrichment cell runs — the counterpart
 * to `POST /columns/run`. Import and export work is canceled by deleting its
 * resource instead.
 */
export const v2CancelTableRunsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/cancel-runs',
  params: tableIdParamsSchema,
  body: v2CancelTableRunsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CancelTableRunsDataSchema),
  },
})
