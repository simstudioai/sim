import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  addWorkflowGroupBodySchema,
  cancelTableRunsBodyBaseSchema,
  createTableColumnBodySchema,
  createTableViewBodySchema,
  deleteTableColumnBodySchema,
  deleteWorkflowGroupBodySchema,
  exportTableAsyncBodySchema,
  predicateSchema,
  refineCancelTableRunsScope,
  runColumnBodyBaseSchema,
  runColumnExcludeMutexRefine,
  runColumnScopeMutexRefine,
  sortSpecSchema,
  tableColumnSchema,
  tableIdParamsSchema,
  tableLocksSchema,
  tableNameSchema,
  tableRowParamsSchema,
  tableRowsQueryBaseSchema,
  tableViewConfigSchema,
  tableViewParamsSchema,
  updateRowsByFilterBodySchema,
  updateTableColumnBodySchema,
  updateTableRowBodySchema,
  updateTableViewBodySchema,
  updateWorkflowGroupBodySchema,
  upsertTableRowBodySchema,
  workflowGroupOutputColumnSchema,
} from '@/lib/api/contracts/tables'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { ianaTimezoneSchema } from '@/lib/api/contracts/user'
import {
  v1CreateTableBodySchema,
  v1CreateTableRowsBodySchema,
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
} from '@/lib/api/contracts/v2/shared'
import {
  v2OptionalUploadTokenHeadersSchema,
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
  v2UploadTokenHeadersSchema,
  v2UploadTransferSchema,
} from '@/lib/api/contracts/v2/uploads'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { CSV_MAX_FILE_SIZE_BYTES, CSV_MAX_FILE_SIZE_MESSAGE } from '@/lib/table/import'

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
 * Public table shape emitted by `toApiTable` (timestamps ISO-serialized).
 * Concrete so the v2 contract describes exactly what the wire carries.
 */
/**
 * The table's current background job, or `null` when idle.
 *
 * Import and delete jobs are also derived onto the table (one write job per table at a time).
 * Durable imports and exports have their own resource endpoints for complete lifecycle state.
 */
export const v2TableJobStateSchema = z.object({
  id: z.string().nullable(),
  type: z.enum(['import', 'delete', 'export', 'backfill', 'update']).nullable(),
  status: z.enum(['running', 'ready', 'failed', 'canceled']),
  rowsProcessed: z.number(),
  /** Failure reason for a `failed` job; `null` otherwise. */
  error: z.string().nullable(),
})
export type V2TableJobState = z.output<typeof v2TableJobStateSchema>

export const v2ApiTableSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  schema: z.object({ columns: z.array(tableColumnSchema) }),
  rowCount: z.number(),
  maxRows: z.number(),
  /** Canonical containing-folder path; `/` means the workspace root. */
  folderPath: v2FolderPathSchema,
  /**
   * Governance flags, read-only on the public API. They are enforced on every
   * write (a locked verb returns 423), but flipping them is a first-party admin
   * action — see {@link v2UpdateTableBodySchema}.
   */
  locks: tableLocksSchema,
  /** In-flight background job, or `null` when the table is idle. */
  job: v2TableJobStateSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type V2ApiTable = z.output<typeof v2ApiTableSchema>

/**
 * Public row shape emitted by `toApiRow`: `{ id, data, createdAt, updatedAt }`,
 * no storage internals (`position`/`orderKey`/`executions`). `data` is keyed by
 * column NAME and select cells carry their option NAME; cell values are
 * user-defined, so the map is `Record<string, unknown>`. Timestamps ISO.
 */
export const v2ApiRowSchema = z.object({
  id: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type V2ApiRow = z.output<typeof v2ApiRowSchema>

/** A single table definition payload. */
export const v2TableDataSchema = z.object({ table: v2ApiTableSchema })
export type V2TableData = z.output<typeof v2TableDataSchema>

export const v2DeleteTableDataSchema = z.object({ id: z.string(), deleted: z.literal(true) })
export type V2DeleteTableData = z.output<typeof v2DeleteTableDataSchema>

/** The table's full column list after a column mutation. */
export const v2TableColumnsDataSchema = z.object({ columns: z.array(tableColumnSchema) })
export type V2TableColumnsData = z.output<typeof v2TableColumnsDataSchema>

/** A single row payload. */
export const v2TableRowDataSchema = z.object({ row: v2ApiRowSchema })
export type V2TableRowData = z.output<typeof v2TableRowDataSchema>

/** Batch-insert payload. */
export const v2BatchInsertRowsDataSchema = z.object({
  rows: z.array(v2ApiRowSchema),
  insertedCount: z.number(),
})
export type V2BatchInsertRowsData = z.output<typeof v2BatchInsertRowsDataSchema>

/**
 * Bulk update-by-filter payload. v2 always returns `updatedRowIds` (`[]` when
 * nothing matched) — v1 dropped the field on the zero-match branch.
 */
export const v2UpdateRowsDataSchema = z.object({
  updatedCount: z.number(),
  updatedRowIds: z.array(z.string()),
})
export type V2UpdateRowsData = z.output<typeof v2UpdateRowsDataSchema>

/**
 * Bulk delete payload — one consistent shape for both id-based and
 * filter-based deletes. `requestedCount`/`missingRowIds` are populated for the
 * id-based delete (which has a requested set) and omitted for the filter-based
 * delete; v1 emitted two divergent shapes here.
 */
export const v2DeleteRowsDataSchema = z.object({
  deletedCount: z.number(),
  deletedRowIds: z.array(z.string()),
  requestedCount: z.number().optional(),
  missingRowIds: z.array(z.string()).optional(),
})
export type V2DeleteRowsData = z.output<typeof v2DeleteRowsDataSchema>

/** Single-row delete payload — mirrors the bulk shape's required fields. */
export const v2DeleteRowDataSchema = z.object({
  deletedCount: z.number(),
  deletedRowIds: z.array(z.string()),
})
export type V2DeleteRowData = z.output<typeof v2DeleteRowDataSchema>

/** Upsert payload — the row object matches every other v2 row endpoint. */
export const v2UpsertRowDataSchema = z.object({
  row: v2ApiRowSchema,
  operation: z.enum(['insert', 'update']),
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
    workspaceId: workspaceIdSchema,
    folderPath: v2FolderPathInputSchema.optional(),
    search: v2SearchSchema,
    ...v2SortFields(v2TableSortFields, { sortBy: 'createdAt', sortOrder: 'asc' }),
    limit: z.coerce
      .number()
      .optional()
      .default(100)
      .transform((v) => Math.min(Math.max(1, Math.trunc(v)), 1000)),
    cursor: z.string().min(1).optional(),
  })
  .strict()

export type V2ListTablesQuery = z.output<typeof v2ListTablesQuerySchema>

export const v2CreateTableBodySchema = v1CreateTableBodySchema
  .omit({ folderId: true })
  .extend({ folderPath: v2FolderPathInputSchema.optional() })
  .strict()

/**
 * Table list. `listTables` returns every table in the workspace (a small,
 * bounded per-workspace set), so today the cursor list is a single full page
 * (`nextCursor` is always `null`). Using the canonical cursor envelope keeps the
 * whole v2 list surface uniform, and real pagination can be added later behind
 * the opaque cursor without an interface change. Search, folder filter, and
 * sort all run in that query, not over its result.
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
    schema: v2DataResponse(v2TableDataSchema),
  },
})

export const v2GetTableContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/[tableId]',
  params: tableIdParamsSchema,
  query: v1ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2TableDataSchema),
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
    name: tableNameSchema.optional(),
    description: v1CreateTableBodySchema.shape.description.nullable(),
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
    schema: v2DataResponse(v2TableDataSchema),
  },
})
export type V2UpdateTableBody = z.input<typeof v2UpdateTableBodySchema>

export const v2TableFolderDataSchema = z.object({ folder: v2FolderSchema })

export const v2DeleteTableFolderDataSchema = z.object({
  path: v2FolderPathSchema,
  deleted: z.literal(true),
  deletedItems: z.object({ folders: z.number().int(), tables: z.number().int() }),
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
  response: { mode: 'json', schema: v2DataResponse(v2TableFolderDataSchema) },
})

export const v2RelocateTableFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/folders',
  body: v2RelocateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableFolderDataSchema) },
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
  query: v1ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteTableDataSchema),
  },
})

export const v2AddTableColumnContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/columns',
  params: tableIdParamsSchema,
  body: createTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2TableColumnsDataSchema),
  },
})

export const v2UpdateTableColumnContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/[tableId]/columns',
  params: tableIdParamsSchema,
  body: updateTableColumnBodySchema,
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
 * `POST /query` endpoint's predicate grammar. The opaque cursor encodes the
 * underlying offset today; it can move to a keyset implementation later without
 * an interface change. Total row count is available as `rowCount` on the table.
 */
export const v2TableRowsQuerySchema = tableRowsQueryBaseSchema
  .pick({ workspaceId: true, limit: true })
  .extend({
    cursor: z.string().min(1, 'cursor must be a non-empty token').optional(),
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
  sort: sortSpecSchema.optional(),
  limit: z
    .number({ error: 'Limit must be a number' })
    .int('Limit must be an integer')
    .min(0, 'Limit must be at least 0 (use 0 for an unbounded query)')
    .max(
      V2_MAX_ROW_LIMIT,
      `Limit cannot exceed ${V2_MAX_ROW_LIMIT}; use limit=0 for a full result or create an export resource for large datasets`
    )
    .optional(),
  cursor: z.string().min(1, 'cursor must be a non-empty token').optional(),
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
 * union (`{ data: { row } }` for a single insert, `{ data: { rows,
 * insertedCount } }` for a batch).
 */
export const v2CreateTableRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  body: v1CreateTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: z.union([
      v2DataResponse(v2TableRowDataSchema),
      v2DataResponse(v2BatchInsertRowsDataSchema),
    ]),
  },
})

/** Bulk update body — v2 accepts ONLY the predicate tree as the filter. */
export const v2UpdateRowsByPredicateBodySchema = updateRowsByFilterBodySchema.extend({
  filter: predicateSchema,
})
export type V2UpdateRowsByPredicateBody = z.input<typeof v2UpdateRowsByPredicateBodySchema>

export const v2UpdateRowsByFilterContract = defineRouteContract({
  method: 'PUT',
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
      .optional(),
    rowIds: z
      .array(z.string().min(1))
      .min(1, 'At least one row ID is required')
      .max(
        TABLE_LIMITS.MAX_BULK_OPERATION_SIZE,
        `Cannot delete more than ${TABLE_LIMITS.MAX_BULK_OPERATION_SIZE} rows per operation`
      )
      .optional(),
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

export const v2GetTableRowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  query: v1ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2TableRowDataSchema),
  },
})

export const v2UpdateTableRowContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  body: updateTableRowBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2TableRowDataSchema),
  },
})

export const v2DeleteTableRowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  query: v1ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteRowDataSchema),
  },
})

export const v2UpsertTableRowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/rows/upsert',
  params: tableIdParamsSchema,
  body: upsertTableRowBodySchema,
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

/**
 * A saved view: a named preset of `{ filter, sort, column layout }` over a
 * table. Presentation state only — a view narrows what a reader sees by
 * default, it is never an access boundary, and every row it hides stays
 * reachable by reading the table without it. Timestamps ISO-serialized.
 */
export const v2ApiViewSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  name: z.string(),
  config: tableViewConfigSchema,
  isDefault: z.boolean(),
  /** Current email of the user who saved the view; `null` for a removed author. */
  createdByEmail: z.email().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type V2ApiView = z.output<typeof v2ApiViewSchema>

/** A single view payload. */
export const v2TableViewDataSchema = z.object({ view: v2ApiViewSchema })
export type V2TableViewData = z.output<typeof v2TableViewDataSchema>

/** Delete confirmation — the id of the view that was removed. */
export const v2DeleteTableViewDataSchema = z.object({ id: z.string() })
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
  query: v1ListTablesQuerySchema,
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
    schema: v2DataResponse(v2TableViewDataSchema),
  },
})

export const v2GetTableViewContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/[tableId]/views/[viewId]',
  params: tableViewParamsSchema,
  query: v1ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2TableViewDataSchema),
  },
})

export const v2UpdateTableViewContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/tables/[tableId]/views/[viewId]',
  params: tableViewParamsSchema,
  body: updateTableViewBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2TableViewDataSchema),
  },
})

/** Deleting the default view simply leaves the table unfiltered. */
export const v2DeleteTableViewContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/[tableId]/views/[viewId]',
  params: tableViewParamsSchema,
  query: v1ListTablesQuerySchema,
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
export const v2WorkflowGroupSchema = z.object({
  id: z.string(),
  /** Backing workflow id for `manual` groups; `''` for enrichment groups. */
  workflowId: z.string(),
  /** Registry enrichment id for `enrichment` groups. */
  enrichmentId: z.string().optional(),
  name: z.string().optional(),
  type: z.enum(['manual', 'enrichment']).optional(),
  dependencies: z.object({ columns: z.array(z.string()).optional() }).optional(),
  outputs: z.array(
    z.object({
      blockId: z.string(),
      path: z.string(),
      outputId: z.string().optional(),
      columnName: z.string(),
    })
  ),
  inputMappings: z.array(z.object({ inputName: z.string(), columnName: z.string() })).optional(),
  deploymentMode: z.enum(['live', 'deployed']).optional(),
  /** When `false` the group never auto-fires; it runs only on an explicit request. */
  autoRun: z.boolean().optional(),
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
  query: v1ListTablesQuerySchema,
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
    group: addWorkflowGroupBodySchema.shape.group.extend({
      id: z.string().min(1).optional(),
    }),
    outputColumns: z.array(v2WorkflowGroupOutputColumnSchema).min(1),
    autoRun: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((body, ctx) => refineGroupSource(body.group, ctx, ['group']))
export type V2AddWorkflowGroupBody = z.input<typeof v2AddWorkflowGroupBodySchema>

/** Update body. Omitted fields keep their stored values. */
export const v2UpdateWorkflowGroupBodySchema = updateWorkflowGroupBodySchema
  .extend({
    newOutputColumns: z.array(v2WorkflowGroupOutputColumnSchema).optional(),
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
export const v2WorkflowGroupDataSchema = z.object({
  group: v2WorkflowGroupSchema,
  columns: z.array(tableColumnSchema),
})
export type V2WorkflowGroupData = z.output<typeof v2WorkflowGroupDataSchema>

/**
 * Delete acknowledgement. Removing a group removes the columns it fed, so the
 * surviving column list is returned rather than left for the caller to guess.
 */
export const v2DeleteWorkflowGroupDataSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
  columns: z.array(tableColumnSchema),
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
export const v2RunColumnDataSchema = z.object({ dispatchId: z.string().nullable() })
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
  groupId: z.string().min(1),
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
  q: z.string().min(1, 'q must be a non-empty search string'),
  predicate: predicateSchema.optional(),
  sort: sortSpecSchema.optional(),
})
export type V2FindRowsBody = z.input<typeof v2FindRowsBodySchema>

/**
 * One matching cell. `ordinal` is the row's 0-based index in the
 * predicate-filtered, sorted view, so it lines up with the same page a
 * `POST /query` with the same predicate and sort would return. `column` is the
 * column NAME, matching how row `data` is keyed everywhere on the public wire.
 */
export const v2RowMatchSchema = z.object({
  ordinal: z.number(),
  rowId: z.string(),
  column: z.string(),
})
export type V2RowMatch = z.output<typeof v2RowMatchSchema>

/**
 * Match set. `truncated` is `true` when the search hit the server-side cap and
 * more cells match than were returned — narrow the predicate rather than
 * paging, since matches have no cursor.
 */
export const v2FindRowsDataSchema = z.object({
  matches: z.array(v2RowMatchSchema),
  truncated: z.boolean(),
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

export const v2TableImportParamsSchema = z.object({ importId: z.string().min(1) })
export const v2TableExportParamsSchema = z.object({ exportId: z.string().min(1) })
export const v2TableTransferWorkspaceQuerySchema = z.object({ workspaceId: workspaceIdSchema })

export const v2TableUploadImportSourceSchema = z
  .object({
    type: z.literal('upload'),
    name: z.string().trim().min(1, 'name is required').max(255),
    contentType: z.string().trim().min(1, 'contentType is required').max(255),
    size: z.number().int().min(1).max(CSV_MAX_FILE_SIZE_BYTES, CSV_MAX_FILE_SIZE_MESSAGE),
  })
  .strict()

export const v2TableWorkspaceFileImportSourceSchema = z
  .object({ type: z.literal('workspace_file'), fileId: z.string().min(1) })
  .strict()

export const v2TableImportSourceSchema = z.discriminatedUnion('type', [
  v2TableUploadImportSourceSchema,
  v2TableWorkspaceFileImportSourceSchema,
])
export type V2TableImportSource = z.input<typeof v2TableImportSourceSchema>

export const v2TableImportTargetSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('new'),
      name: tableNameSchema,
      folderPath: v2FolderPathInputSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('existing'),
      tableId: z.string().min(1),
      mode: z.enum(['append', 'replace']),
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
    source: v2TableImportSourceSchema,
    target: v2TableImportTargetSchema,
    mapping: v2CsvImportMappingSchema.optional(),
    createColumns: v2CsvImportCreateColumnsSchema.optional(),
    timezone: ianaTimezoneSchema.optional(),
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

export const v2TableImportSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  status: v2TableImportStatusSchema,
  source: v2TableImportSourceSchema,
  target: v2TableImportTargetSchema,
  tableId: z.string().nullable(),
  rowsProcessed: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
})
export type V2TableImport = z.output<typeof v2TableImportSchema>

const v2UploadBackedTableImportSchema = v2TableImportSchema.extend({
  source: v2TableUploadImportSourceSchema,
})

const v2WorkspaceFileTableImportSchema = v2TableImportSchema.extend({
  source: v2TableWorkspaceFileImportSourceSchema,
})

export const v2CreateTableImportDataSchema = z.union([
  z
    .object({
      session: v2UploadBackedTableImportSchema,
      uploadToken: z.string().min(1),
      transfer: v2UploadTransferSchema,
    })
    .strict(),
  z
    .object({
      session: v2WorkspaceFileTableImportSchema,
      uploadToken: z.null(),
      transfer: z.null(),
    })
    .strict(),
])
export type V2CreateTableImportData = z.output<typeof v2CreateTableImportDataSchema>

export const v2CreateTableImportContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/imports',
  body: v2CreateTableImportBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2CreateTableImportDataSchema) },
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
  headers: v2OptionalUploadTokenHeadersSchema,
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

export const v2TableExportSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  workspaceId: z.string(),
  format: z.enum(['csv', 'json']),
  status: v2TableExportStatusSchema,
  rowsProcessed: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
})
export type V2TableExport = z.output<typeof v2TableExportSchema>

export const v2CreateTableExportContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/exports',
  params: tableIdParamsSchema,
  body: exportTableAsyncBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2TableExportSchema) },
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

export const v2TableExportDownloadDataSchema = z.object({
  url: z.string().url(),
  fileName: z.string(),
  expiresAt: z.string().datetime(),
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
export const v2CancelTableRunsDataSchema = z.object({ cancelled: z.number() })
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
