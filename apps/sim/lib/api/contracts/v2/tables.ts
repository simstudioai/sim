import { z } from 'zod'
import { folderIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  addWorkflowGroupBodySchema,
  cancelTableJobBodySchema,
  cancelTableRunsBodyBaseSchema,
  createTableColumnBodySchema,
  createTableViewBodySchema,
  csvImportCreateColumnsSchema,
  csvImportMappingSchema,
  csvImportModeSchema,
  deleteTableColumnBodySchema,
  deleteWorkflowGroupBodySchema,
  exportDownloadQuerySchema,
  exportTableAsyncBodySchema,
  importIntoTableAsyncBodySchema,
  listTableJobsQuerySchema,
  predicateSchema,
  refineCancelTableRunsScope,
  runColumnBodyBaseSchema,
  runColumnExcludeMutexRefine,
  runColumnScopeMutexRefine,
  sortSpecSchema,
  tableColumnSchema,
  tableIdParamsSchema,
  tableJobSummarySchema,
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
  v2CursorListResponse,
  v2DataResponse,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'
import { TABLE_LIMITS } from '@/lib/table/constants'

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
/** Hard cap on an explicit page `limit`. Larger pulls use `limit=0` (query) or the async export. */
export const V2_MAX_ROW_LIMIT = 1000

/**
 * Public table shape emitted by `toApiTable` (timestamps ISO-serialized).
 * Concrete so the v2 contract describes exactly what the wire carries.
 */
/**
 * The table's current background job, or `null` when idle.
 *
 * This is how an async import or delete is observed. Those jobs are derived
 * onto the table itself (one write job per table at a time), so the table is
 * their status endpoint — unlike exports, which are read-only, run concurrently,
 * and therefore have the dedicated `GET /api/v2/tables/jobs` list instead.
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
  /** Owning folder, or `null` when the table sits at the workspace root. */
  folderId: z.string().nullable(),
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

/** Archive confirmation — the id of the table that was archived. */
export const v2DeleteTableDataSchema = z.object({ id: z.string() })
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
export const v2ListTablesQuerySchema = v1ListTablesQuerySchema.extend({
  /** Restrict to one table folder. */
  folderId: z.string().min(1, 'folderId cannot be empty').optional(),
  search: v2SearchSchema,
  ...v2SortFields(v2TableSortFields, { sortBy: 'createdAt', sortOrder: 'asc' }),
})

export type V2ListTablesQuery = z.output<typeof v2ListTablesQuerySchema>

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
  body: v1CreateTableBodySchema,
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
 * `name` renames and `folderId` moves the table (explicit `null` moves it to
 * the workspace root; omission leaves the placement untouched).
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
    folderId: folderIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.name === undefined && body.folderId === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide a new name or folder',
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
      `Limit cannot exceed ${V2_MAX_ROW_LIMIT}; use limit=0 for a full result or the async export for large datasets`
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
 * Un-archives a table archived by `DELETE /api/v2/tables/[tableId]`. Resolves
 * the table with archived rows included, so it is the one table endpoint whose
 * target is expected NOT to be active.
 */
export const v2RestoreTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/restore',
  params: tableIdParamsSchema,
  body: v2WorkspaceScopedBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2TableDataSchema),
  },
})

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
  /** User who saved the view; `null` for views whose author is gone. */
  createdBy: z.string().nullable(),
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

/**
 * Multipart form fields for `POST /api/v2/tables/[tableId]/import`.
 *
 * Not declared as the contract's `body`: the request is `multipart/form-data`,
 * so the route reads the parts with the streaming multipart reader and parses
 * the collected text fields through this schema in one pass. Every value
 * arrives as a string — `mapping` and `createColumns` are JSON-encoded and
 * decoded by their shared field schemas.
 */
export const v2ImportIntoTableFormSchema = z.object({
  workspaceId: workspaceIdSchema,
  mode: csvImportModeSchema.default('append'),
  mapping: csvImportMappingSchema.optional(),
  createColumns: csvImportCreateColumnsSchema.optional(),
  timezone: ianaTimezoneSchema.optional(),
})
export type V2ImportIntoTableForm = z.input<typeof v2ImportIntoTableFormSchema>

/** Kickoff acknowledgement for a background import. */
export const v2ImportAsyncDataSchema = z.object({
  tableId: z.string(),
  importId: z.string(),
})
export type V2ImportAsyncData = z.output<typeof v2ImportAsyncDataSchema>

/**
 * Starts a background import of a file already uploaded to workspace storage
 * (`POST /api/v2/files` returns the `key`).
 *
 * The upload step is still a synchronous multipart request capped at 100 MB, so
 * the byte limit moved rather than vanished — but it now fails loudly on an
 * explicit size check instead of relying on a proxy cap that truncates, and the
 * table write itself is a job that can be watched and cancelled.
 *
 * Returns immediately. A table carries at most one write job, so progress is
 * read off the table itself (`GET /api/v2/tables/[tableId]` → `job`) rather than
 * the export-only jobs list; stop it with `POST /api/v2/tables/[tableId]/job/cancel`.
 */
export const v2ImportTableAsyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/import-async',
  params: tableIdParamsSchema,
  body: importIntoTableAsyncBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ImportAsyncDataSchema),
  },
})

/** Kickoff acknowledgement for a background export. */
export const v2ExportAsyncDataSchema = z.object({
  tableId: z.string(),
  jobId: z.string(),
})
export type V2ExportAsyncData = z.output<typeof v2ExportAsyncDataSchema>

/**
 * Starts a background export. Export jobs are read-only, so they bypass the
 * one-write-job-per-table gate and can run alongside an import or delete.
 */
export const v2ExportTableAsyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/export-async',
  params: tableIdParamsSchema,
  body: exportTableAsyncBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ExportAsyncDataSchema),
  },
})

/** A short-lived presigned URL for a finished export. */
export const v2ExportDownloadDataSchema = z.object({
  url: z.string(),
  fileName: z.string(),
})
export type V2ExportDownloadData = z.output<typeof v2ExportDownloadDataSchema>

/**
 * Resolves a `ready` export job to a presigned download URL. Returns 409 while
 * the job is still running and 410 once the generated file has aged out.
 */
export const v2ExportDownloadContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/[tableId]/export/download',
  params: tableIdParamsSchema,
  query: exportDownloadQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ExportDownloadDataSchema),
  },
})

/**
 * Workspace-scoped export-job listing: running jobs plus recently finished ones
 * (kept so a completed export stays re-downloadable). Bounded server-side, so a
 * single full page — `nextCursor` is always `null`.
 */
export const v2ListTableJobsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables/jobs',
  query: listTableJobsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(tableJobSummarySchema),
  },
})

/**
 * Cancel outcome. `canceled` is `false` when the job had already finished —
 * cancelling is idempotent and a late request is not an error.
 */
export const v2CancelTableJobDataSchema = z.object({
  jobId: z.string(),
  canceled: z.boolean(),
})
export type V2CancelTableJobData = z.output<typeof v2CancelTableJobDataSchema>

/**
 * Stops an in-flight import or delete. The worker halts at its next ownership
 * check; work already committed (rows inserted or deleted) stays — there is no
 * rollback.
 */
export const v2CancelTableJobContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/job/cancel',
  params: tableIdParamsSchema,
  body: cancelTableJobBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CancelTableJobDataSchema),
  },
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
 * to `POST /columns/run`. Distinct from `POST /job/cancel`, which stops an
 * import or delete job.
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
