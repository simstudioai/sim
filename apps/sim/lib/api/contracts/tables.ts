import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import type {
  CsvHeaderMapping,
  EnrichmentRunDetail,
  Filter,
  RowData,
  Sort,
  TableDefinition,
  TableMetadata,
  TableRow,
  TableRowsCursor,
} from '@/lib/table'
import { COLUMN_TYPES, NAME_PATTERN, TABLE_LIMITS } from '@/lib/table/constants'
import { CSV_MAX_FILE_SIZE_BYTES } from '@/lib/table/import'

export const domainObjectSchema = <T>() => z.custom<T>(isRecordLike)

/**
 * Column types are a fixed enum derived from `COLUMN_TYPES` so callers cannot
 * send arbitrary strings the server would reject downstream.
 */
export const columnTypeSchema = z.enum(COLUMN_TYPES)

/**
 * Identifier for tables/columns: starts with letter or underscore, contains
 * only alphanumerics + underscores, capped at `MAX_TABLE_NAME_LENGTH`.
 */
const tableNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(
    TABLE_LIMITS.MAX_TABLE_NAME_LENGTH,
    `Name must be ${TABLE_LIMITS.MAX_TABLE_NAME_LENGTH} characters or less`
  )
  .regex(
    NAME_PATTERN,
    'Name must start with a letter or underscore and contain only alphanumeric characters and underscores'
  )

const columnNameSchema = z
  .string()
  .min(1, 'Column name is required')
  .max(
    TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH,
    `Column name must be ${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters or less`
  )
  .regex(
    NAME_PATTERN,
    'Column name must start with a letter or underscore and contain only alphanumeric characters and underscores'
  )

const descriptionSchema = z
  .string()
  .max(
    TABLE_LIMITS.MAX_DESCRIPTION_LENGTH,
    `Description must be ${TABLE_LIMITS.MAX_DESCRIPTION_LENGTH} characters or less`
  )

export const tableScopeSchema = z.enum(['active', 'archived', 'all'])

export const tableIdParamsSchema = z.object({
  tableId: z.string().min(1),
})

export const tableRowParamsSchema = tableIdParamsSchema.extend({
  rowId: z.string().min(1),
})

export const listTablesQuerySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  scope: tableScopeSchema.default('active'),
})

export const getTableQuerySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

export const tableColumnSchema = z.object({
  /** Stable column id (server-assigned). Absent on legacy/ pre-backfill columns. */
  id: z.string().optional(),
  name: columnNameSchema,
  type: columnTypeSchema,
  required: z.boolean().optional().default(false),
  unique: z.boolean().optional().default(false),
  /** Set when the column is a workflow group's output. */
  workflowGroupId: z.string().optional(),
})

export const createTableBodySchema = z.object({
  name: tableNameSchema,
  description: descriptionSchema.optional(),
  schema: z.object({
    columns: z
      .array(tableColumnSchema)
      .min(1, 'Table must have at least one column')
      .max(
        TABLE_LIMITS.MAX_COLUMNS_PER_TABLE,
        `Table cannot have more than ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} columns`
      ),
  }),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  initialRowCount: z.number().int().min(0).max(100).optional(),
})

export const renameTableBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  name: tableNameSchema,
})

export const createTableColumnBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  column: z.object({
    // Optional stable id — first-party undo of a delete re-creates the column
    // with its original id so saved (id-keyed) cell data restores correctly.
    id: z.string().optional(),
    name: columnNameSchema,
    type: columnTypeSchema,
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
  }),
})

export const updateTableColumnBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  columnName: columnNameSchema,
  updates: z.object({
    name: columnNameSchema.optional(),
    type: columnTypeSchema.optional(),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
})

export const deleteTableColumnBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  columnName: columnNameSchema,
})

export const tableMetadataSchema = z.object({
  columnWidths: z.record(z.string(), z.number().positive()).optional(),
  columnOrder: z.array(z.string()).optional(),
  pinnedColumns: z.array(z.string()).optional(),
}) satisfies z.ZodType<TableMetadata>

export const updateTableMetadataBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  metadata: tableMetadataSchema,
})

export const rowDataSchema = domainObjectSchema<RowData>()
export const tableDefinitionSchema = domainObjectSchema<TableDefinition>()
export const tableRowSchema = domainObjectSchema<TableRow>()

/**
 * Plain-object base for the single-row insert body. Kept un-refined so callers
 * (e.g. the v1 public contract) can `.omit()` fields before applying
 * {@link rowAnchorMutexRefine} — Zod forbids `.omit()` on a refined schema.
 */
export const insertTableRowBodyBaseSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  data: rowDataSchema,
  position: z.number().int().min(0).optional(),
  /** Fractional ordering: insert directly after this row id. Takes precedence over `position`. */
  afterRowId: z.string().min(1).optional(),
  /** Fractional ordering: insert directly before this row id. Takes precedence over `position`. */
  beforeRowId: z.string().min(1).optional(),
})

/** `afterRowId` and `beforeRowId` are mutually exclusive insert anchors. */
export const rowAnchorMutexRefine = [
  (data: { afterRowId?: string; beforeRowId?: string }) => !data.afterRowId || !data.beforeRowId,
  { message: 'afterRowId and beforeRowId are mutually exclusive' },
] as const

export const insertTableRowBodySchema = insertTableRowBodyBaseSchema.refine(...rowAnchorMutexRefine)

/**
 * POST `/api/table/[tableId]/rows/upsert` body — insert-or-update keyed by a
 * unique column name. `conflictTarget` is optional (server picks a single
 * unique column when omitted).
 */
export const upsertTableRowBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  data: rowDataSchema,
  conflictTarget: z.string().min(1).optional(),
})

export const batchInsertTableRowsBodySchema = z
  .object({
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    rows: z
      .array(rowDataSchema)
      .min(1, 'At least one row is required')
      .max(
        TABLE_LIMITS.MAX_BATCH_INSERT_SIZE,
        `Cannot insert more than ${TABLE_LIMITS.MAX_BATCH_INSERT_SIZE} rows per batch`
      ),
    positions: z.array(z.number().int().min(0)).max(TABLE_LIMITS.MAX_BATCH_INSERT_SIZE).optional(),
    /** Fractional ordering: exact per-row order keys (undo restore). Takes precedence over `positions`. */
    orderKeys: z.array(z.string().min(1)).max(TABLE_LIMITS.MAX_BATCH_INSERT_SIZE).optional(),
  })
  .refine((data) => !data.positions || data.positions.length === data.rows.length, {
    message: 'positions array length must match rows array length',
  })
  .refine((data) => !data.positions || new Set(data.positions).size === data.positions.length, {
    message: 'positions must not contain duplicates',
  })
  .refine((data) => !data.orderKeys || data.orderKeys.length === data.rows.length, {
    message: 'orderKeys array length must match rows array length',
  })

/**
 * POST `/api/table/[tableId]/rows` body — accepts either a batch payload
 * (`{ rows: [...] }`) or a single-row payload (`{ data: {...} }`). Branches
 * narrow on `'rows' in body` since the discriminator is the shape, not a
 * literal field. Order matters: the batch schema is checked first so payloads
 * that include `rows` are routed to batch insert.
 */
export const insertTableRowsBodySchema = z.union([
  batchInsertTableRowsBodySchema,
  insertTableRowBodySchema,
])

export const updateTableRowBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  data: rowDataSchema,
})

export const batchUpdateTableRowsBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  updates: z
    .array(
      z.object({
        rowId: z.string().min(1),
        data: rowDataSchema,
      })
    )
    .min(1, 'At least one update is required')
    .max(
      TABLE_LIMITS.MAX_BULK_OPERATION_SIZE,
      `Cannot update more than ${TABLE_LIMITS.MAX_BULK_OPERATION_SIZE} rows per batch`
    )
    .refine((updates) => new Set(updates.map((update) => update.rowId)).size === updates.length, {
      message: 'updates must not contain duplicate rowId values',
    }),
})

/**
 * Filter object that requires at least one key. Bulk delete/update operations
 * cannot accept an empty filter — that would target every row in the table,
 * which is rejected by `buildFilterClause` downstream.
 */
const nonEmptyFilterSchema = domainObjectSchema<Filter>().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Filter must not be empty' }
)

const filterSchema = domainObjectSchema<Filter>()

const optionalPositiveLimit = (max: number, label: string) =>
  z.preprocess(
    (value) => (value === null || value === undefined || value === '' ? undefined : Number(value)),
    z
      .number()
      .int(`${label} must be an integer`)
      .min(1, `${label} must be at least 1`)
      .max(max, `Cannot ${label.toLowerCase()} more than ${max} rows per operation`)
      .optional()
  )

export const deleteTableRowBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

export const deleteTableRowsBodySchema = z
  .object({
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    filter: nonEmptyFilterSchema.optional(),
    limit: optionalPositiveLimit(TABLE_LIMITS.MAX_BULK_OPERATION_SIZE, 'Limit').optional(),
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

/** Unrefined base so v1 contracts can `.extend()` — consumers use {@link tableRowsQuerySchema}. */
export const tableRowsQueryBaseSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  filter: domainObjectSchema<Filter>().optional(),
  sort: domainObjectSchema<Sort>().optional(),
  /**
   * Keyset cursor `(orderKey, id)` for the default row order — each page is an index seek
   * instead of OFFSET's scan-and-discard. Mutually exclusive with `sort` (cursors only make
   * sense on the default order); takes precedence over `offset`.
   */
  after: domainObjectSchema<TableRowsCursor>().optional(),
  limit: z
    .preprocess(
      (value) =>
        value === null || value === undefined || value === '' ? undefined : Number(value),
      z
        .number({ error: 'Limit must be a number' })
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(TABLE_LIMITS.MAX_QUERY_LIMIT, `Limit cannot exceed ${TABLE_LIMITS.MAX_QUERY_LIMIT}`)
        .optional()
    )
    .default(TABLE_LIMITS.DEFAULT_QUERY_LIMIT),
  offset: z
    .preprocess(
      (value) =>
        value === null || value === undefined || value === '' ? undefined : Number(value),
      z
        .number({ error: 'Offset must be a number' })
        .int('Offset must be an integer')
        .min(0, 'Offset must be 0 or greater')
        .optional()
    )
    .default(0),
  includeTotal: z
    .preprocess(
      (value) =>
        value === null || value === undefined || value === '' ? undefined : value === 'true',
      z.boolean().optional()
    )
    .default(true),
})

export const tableRowsQuerySchema = tableRowsQueryBaseSchema.refine(
  (data) => !(data.after && data.sort),
  { message: 'after cursor cannot be combined with sort — cursors paginate the default order' }
)

export const updateRowsByFilterBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  filter: nonEmptyFilterSchema,
  data: rowDataSchema,
  limit: optionalPositiveLimit(TABLE_LIMITS.MAX_BULK_OPERATION_SIZE, 'Limit').optional(),
})

const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

const tableColumnsResponseDataSchema = z.object({
  columns: z.array(tableColumnSchema),
})

export const listTablesContract = defineRouteContract({
  method: 'GET',
  path: '/api/table',
  query: listTablesQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        tables: z.array(tableDefinitionSchema),
        totalCount: z.number(),
      })
    ),
  },
})
export type ListTablesResponse = ContractJsonResponse<typeof listTablesContract>

export const createTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/table',
  body: createTableBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        table: tableDefinitionSchema,
        message: z.string(),
      })
    ),
  },
})

/**
 * Kickoff body for an asynchronous large-CSV import into a NEW table. The file is
 * already uploaded to storage (the client sends its `fileKey`); the route creates an
 * `importing` table and runs the load in the background.
 */
export const importTableAsyncBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  fileKey: z.string().min(1, 'fileKey is required'),
  fileName: z.string().min(1, 'fileName is required'),
  /**
   * Whether the source object is deleted once the import is terminal. Defaults to true (the upload
   * flow stores a single-use temp object); pass false when importing an existing workspace file
   * (e.g. the file viewer's "Import as a table") that must survive the import.
   */
  deleteSourceFile: z.boolean().optional(),
})

export type ImportTableAsyncBody = z.input<typeof importTableAsyncBodySchema>

export const importTableAsyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/import-async',
  body: importTableAsyncBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        tableId: z.string(),
        importId: z.string(),
      })
    ),
  },
})

export const getTableContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]',
  params: tableIdParamsSchema,
  query: getTableQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ table: tableDefinitionSchema })),
  },
})
export type GetTableResponse = ContractJsonResponse<typeof getTableContract>

export const renameTableContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]',
  params: tableIdParamsSchema,
  body: renameTableBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ table: tableDefinitionSchema })),
  },
})

export const deleteTableContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]',
  params: tableIdParamsSchema,
  query: getTableQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ message: z.string() })),
  },
})

export const restoreTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/restore',
  params: tableIdParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ table: tableDefinitionSchema })),
  },
})

export const addTableColumnContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/columns',
  params: tableIdParamsSchema,
  body: createTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(tableColumnsResponseDataSchema),
  },
})

export const updateTableColumnContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]/columns',
  params: tableIdParamsSchema,
  body: updateTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(tableColumnsResponseDataSchema),
  },
})

export const deleteTableColumnContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]/columns',
  params: tableIdParamsSchema,
  body: deleteTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(tableColumnsResponseDataSchema),
  },
})

export const updateTableMetadataContract = defineRouteContract({
  method: 'PUT',
  path: '/api/table/[tableId]/metadata',
  params: tableIdParamsSchema,
  body: updateTableMetadataBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ metadata: tableMetadataSchema })),
  },
})

export const listTableRowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  query: tableRowsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        rows: z.array(tableRowSchema),
        rowCount: z.number(),
        totalCount: z.number().nullable(),
        limit: z.number(),
        offset: z.number(),
      })
    ),
  },
})

export const findTableRowsQuerySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  q: z.string().min(1, 'Search query is required'),
  filter: domainObjectSchema<Filter>().optional(),
  sort: domainObjectSchema<Sort>().optional(),
})

/** One matching cell: its 0-based ordinal in the filtered+sorted view, its row id, and the column name. */
export const tableFindMatchSchema = z.object({
  ordinal: z.number().int(),
  rowId: z.string(),
  /** Stable column id of the matching cell (JSONB storage key), not the display name. */
  column: z.string(),
})

export const findTableRowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/rows/find',
  params: tableIdParamsSchema,
  query: findTableRowsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        matches: z.array(tableFindMatchSchema),
        truncated: z.boolean(),
      })
    ),
  },
})
export type FindTableRowsQuery = z.input<typeof findTableRowsQuerySchema>
export type FindTableRowsResponse = ContractJsonResponse<typeof findTableRowsContract>
export type TableFindMatch = z.output<typeof tableFindMatchSchema>

export const createTableRowContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: insertTableRowBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        row: tableRowSchema,
        message: z.string(),
      })
    ),
  },
})

export const batchCreateTableRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: batchInsertTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        rows: z.array(tableRowSchema),
        insertedCount: z.number(),
        message: z.string(),
      })
    ),
  },
})

/**
 * Server-side contract for `POST /api/table/[tableId]/rows`. Accepts the
 * union body so the route can handle single and batch insert in one
 * `parseRequest` call. Clients use the resource-specific contracts above
 * (`createTableRowContract` / `batchCreateTableRowsContract`) to get a
 * narrow response type.
 */
export const insertTableRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: insertTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: z.union([
      successResponseSchema(
        z.object({
          row: tableRowSchema,
          message: z.string(),
        })
      ),
      successResponseSchema(
        z.object({
          rows: z.array(tableRowSchema),
          insertedCount: z.number(),
          message: z.string(),
        })
      ),
    ]),
  },
})

export type TableIdParamsInput = z.input<typeof tableIdParamsSchema>
export type TableRowParamsInput = z.input<typeof tableRowParamsSchema>
export type TableRowsQueryInput = z.input<typeof tableRowsQuerySchema>
export type CreateTableBodyInput = z.input<typeof createTableBodySchema>
export type CreateTableColumnBodyInput = z.input<typeof createTableColumnBodySchema>
export type UpdateTableColumnBodyInput = z.input<typeof updateTableColumnBodySchema>
export type InsertTableRowBodyInput = z.input<typeof insertTableRowBodySchema>
export type BatchInsertTableRowsBodyInput = z.input<typeof batchInsertTableRowsBodySchema>
export type BatchUpdateTableRowsBodyInput = z.input<typeof batchUpdateTableRowsBodySchema>
export type UpdateTableRowBodyInput = z.input<typeof updateTableRowBodySchema>
// ============================================================================
// CSV import form schemas
//
// Both `/api/table/import-csv` and `/api/table/[tableId]/import-csv` parse a
// `multipart/form-data` body, so these schemas are validated *form-field by
// form-field* in the routes (not as a single contract body).
// ============================================================================

export const csvFileSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (typeof File === 'undefined' || !(value instanceof File)) {
      ctx.addIssue({ code: 'custom', message: 'CSV file is required' })
      return
    }
    if (value.size > CSV_MAX_FILE_SIZE_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `File exceeds maximum allowed size of ${CSV_MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`,
      })
    }
  })
  .transform((value) => value as File)

export const csvImportFormSchema = z.object({
  file: csvFileSchema,
  workspaceId: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
})

export const csvImportModeSchema = z.enum(['append', 'replace'])

export const csvExtensionSchema = z.enum(['csv', 'tsv'], {
  error: 'Only CSV and TSV files are supported',
})

/**
 * Kickoff body for an asynchronous CSV import into an EXISTING table (append/replace).
 * The file is already uploaded to storage; `mapping`/`createColumns` are the client's
 * resolved column mapping (the dialog computes them from its preview).
 */
export const importIntoTableAsyncBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  fileKey: z.string().min(1, 'fileKey is required'),
  fileName: z.string().min(1, 'fileName is required'),
  mode: csvImportModeSchema,
  mapping: z.record(z.string(), z.string().nullable()).optional(),
  createColumns: z.array(z.string()).optional(),
})

export type ImportIntoTableAsyncBody = z.input<typeof importIntoTableAsyncBodySchema>

export const importIntoTableAsyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/import-async',
  params: tableIdParamsSchema,
  body: importIntoTableAsyncBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        tableId: z.string(),
        importId: z.string(),
      })
    ),
  },
})

/**
 * `createColumns` form field — a JSON-encoded array of CSV header names that
 * the import should auto-create as new columns on the target table.
 */
export const csvImportCreateColumnsSchema = z.unknown().transform((value, ctx): string[] => {
  if (typeof value !== 'string') {
    ctx.addIssue({ code: 'custom', message: 'createColumns must be valid JSON' })
    return z.NEVER
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.some((h) => typeof h !== 'string')) {
      ctx.addIssue({
        code: 'custom',
        message: 'createColumns must be a JSON array of CSV header names',
      })
      return z.NEVER
    }
    return parsed as string[]
  } catch {
    ctx.addIssue({ code: 'custom', message: 'createColumns must be valid JSON' })
    return z.NEVER
  }
})

/**
 * `format` query param for the table export route. Lower-cases the input
 * before validating against the supported formats and defaults to `'csv'`.
 */
export const tableExportFormatSchema = z
  .preprocess(
    (value) => (typeof value === 'string' ? value.toLowerCase() : value),
    z.enum(['csv', 'json'])
  )
  .default('csv')

export const exportTableAsyncBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  format: z.enum(['csv', 'json']).default('csv'),
})

export type ExportTableAsyncBody = z.input<typeof exportTableAsyncBodySchema>

/**
 * Kickoff for a background export (large tables — small ones use the synchronous streaming
 * `/export` route). The worker generates the file, uploads it to workspace storage, and the
 * client fetches a presigned URL from the download contract once the job is `ready`.
 */
export const exportTableAsyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/export-async',
  params: tableIdParamsSchema,
  body: exportTableAsyncBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ tableId: z.string(), jobId: z.string() })),
  },
})

export const tableJobSummarySchema = z.object({
  jobId: z.string(),
  tableId: z.string(),
  tableName: z.string(),
  status: z.enum(['running', 'ready', 'failed', 'canceled']),
  rowsProcessed: z.number(),
  format: z.enum(['csv', 'json']),
  hasResult: z.boolean(),
  error: z.string().nullable(),
})

export type TableJobSummary = z.output<typeof tableJobSummarySchema>

export const listTableJobsQuerySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  type: z.literal('export'),
})

/**
 * Workspace-scoped job listing the header tray polls. Export-only today: exports are excluded
 * from the table-level job derivation (they run concurrently with other jobs), so this is their
 * dedicated read path — running jobs plus recently-finished ones for re-download.
 */
export const listTableJobsContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/jobs',
  query: listTableJobsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ jobs: z.array(tableJobSummarySchema) })),
  },
})

export const exportDownloadQuerySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  jobId: z.string().min(1, 'Job ID is required'),
})

/** Resolves a completed export job to a short-lived presigned download URL. */
export const exportDownloadContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/export/download',
  params: tableIdParamsSchema,
  query: exportDownloadQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ url: z.string().min(1), fileName: z.string() })),
  },
})

/**
 * `mapping` form field — a JSON-encoded `CsvHeaderMapping` (CSV header →
 * column name, or `null` to skip the header).
 */
export const csvImportMappingSchema = z.unknown().transform((value, ctx): CsvHeaderMapping => {
  if (typeof value !== 'string') {
    ctx.addIssue({ code: 'custom', message: 'mapping must be valid JSON' })
    return z.NEVER
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      ctx.addIssue({
        code: 'custom',
        message: 'mapping must be a JSON object mapping CSV headers to column names',
      })
      return z.NEVER
    }
    return parsed as CsvHeaderMapping
  } catch {
    ctx.addIssue({ code: 'custom', message: 'mapping must be valid JSON' })
    return z.NEVER
  }
})

export const upsertTableRowContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/rows/upsert',
  params: tableIdParamsSchema,
  body: upsertTableRowBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        row: tableRowSchema,
        operation: z.enum(['insert', 'update']),
        message: z.string(),
      })
    ),
  },
})

export const updateTableRowContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  body: updateTableRowBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        row: tableRowSchema,
        message: z.string(),
      })
    ),
  },
})

export const batchUpdateTableRowsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: batchUpdateTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        message: z.string(),
        updatedCount: z.number(),
        updatedRowIds: z.array(z.string()),
      })
    ),
  },
})

export const deleteTableRowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  body: deleteTableRowBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        message: z.string(),
        deletedCount: z.number(),
      })
    ),
  },
})

export const enrichmentDetailParamsSchema = tableRowParamsSchema.extend({
  groupId: z.string().min(1),
})

/**
 * Per-(row, group) enrichment cascade breakdown. Modeled as a domain object so
 * the `EnrichmentRunDetail` TS type stays the single source of truth (matching
 * `tableRowSchema` / `tableDefinitionSchema`). `null` when the cell has no
 * recorded run or the run predates this feature.
 */
export const getEnrichmentDetailContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/rows/[rowId]/enrichment/[groupId]',
  params: enrichmentDetailParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({ detail: domainObjectSchema<EnrichmentRunDetail>().nullable() })
    ),
  },
})
export type GetEnrichmentDetailResponse = ContractJsonResponse<typeof getEnrichmentDetailContract>

export const deleteTableRowsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: deleteTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        message: z.string(),
        deletedCount: z.number(),
        deletedRowIds: z.array(z.string()),
        requestedCount: z.number().optional(),
        missingRowIds: z.array(z.string()).optional(),
      })
    ),
  },
})

/**
 * Kickoff body for an asynchronous "select all" delete. Sends the active filter (and an optional
 * exclusion set for "select all then deselect a few") instead of every row id, so the background
 * worker deletes in paginated batches. Omitting `filter` deletes the whole table (at the cutoff).
 */
export const deleteTableRowsAsyncBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  filter: nonEmptyFilterSchema.optional(),
  excludeRowIds: z
    .array(z.string().min(1))
    .max(
      TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS,
      `Cannot exclude more than ${TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS} rows`
    )
    .optional(),
  /** Display-only doomed-row estimate (the filtered total minus deselections the client just
   *  showed). Persisted on the job so list/detail counts can subtract the not-yet-deleted
   *  remainder mid-job; clamped server-side, never used to scope the delete itself. */
  estimatedCount: z.number().int().min(0).optional(),
})

export type DeleteTableRowsAsyncBody = z.input<typeof deleteTableRowsAsyncBodySchema>

export const deleteTableRowsAsyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/delete-async',
  params: tableIdParamsSchema,
  body: deleteTableRowsAsyncBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ tableId: z.string(), jobId: z.string() })),
  },
})

// ============================================================================
// Workflow group contracts (`/api/table/[tableId]/groups`, `/cancel-runs`,
// `/columns/run`, `/rows/run`, `/rows/[rowId]/cells/[groupId]/run`)
// ============================================================================

const workflowGroupOutputSchema = z.object({
  // Workflow outputs carry blockId/path; enrichment outputs carry outputId and
  // leave these empty. `.default('')` keeps the parsed value a plain string.
  blockId: z.string().default(''),
  path: z.string().default(''),
  outputId: z.string().optional(),
  columnName: z.string().min(1),
})

const workflowGroupDependenciesSchema = z.object({
  columns: z.array(z.string()).optional(),
})

const workflowGroupTypeSchema = z.enum(['manual', 'enrichment'])

/** Which workflow state a group's per-cell runs execute against: `'live'` (the
 *  editable draft) or `'deployed'` (the latest active deployment). Defaults to
 *  `'live'` when omitted. */
const workflowGroupDeploymentModeSchema = z.enum(['live', 'deployed'])

/** One workflow Start-block input field ← one table column. */
const workflowGroupInputMappingSchema = z.object({
  inputName: z.string().min(1, 'inputName cannot be empty'),
  columnName: z.string().min(1, 'columnName cannot be empty'),
})

const workflowGroupOutputColumnSchema = z.object({
  name: z.string().min(1),
  type: columnTypeSchema,
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  workflowGroupId: z.string().min(1),
})

export const groupIdParamsSchema = tableIdParamsSchema.extend({
  groupId: z.string().min(1),
})

export const addWorkflowGroupBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  group: z.object({
    id: z.string().min(1),
    /** Workflow id for manual groups; `''` (or omitted) for enrichment groups. */
    workflowId: z.string().default(''),
    /** Registry enrichment id for enrichment groups. */
    enrichmentId: z.string().min(1).optional(),
    name: z.string().optional(),
    /** Provenance of the group; defaults to `'manual'` when omitted. */
    type: workflowGroupTypeSchema.optional(),
    dependencies: workflowGroupDependenciesSchema.optional(),
    outputs: z.array(workflowGroupOutputSchema).min(1),
    /** Maps the workflow's Start-block inputs to table columns. */
    inputMappings: z.array(workflowGroupInputMappingSchema).optional(),
    /** Which workflow state per-cell runs execute against. Defaults to `'live'`. */
    deploymentMode: workflowGroupDeploymentModeSchema.optional(),
    /** When `false`, the group never auto-fires from the scheduler — it can
     *  only be triggered manually. Defaults to `true`. Persisted on the
     *  group; distinct from the top-level `autoRun` below which is a
     *  one-shot "schedule existing rows on creation" flag. */
    autoRun: z.boolean().optional(),
  }),
  outputColumns: z.array(workflowGroupOutputColumnSchema).min(1),
  /** When false, skip auto-scheduling existing rows after the group is added.
   *  Defaults to true so UI adds populate cells immediately; the Mothership
   *  tool sends `false` so the AI can stage groups without firing runs. */
  autoRun: z.boolean().optional(),
})

/**
 * Re-points an existing column to a different workflow output. Use when the
 * user changes which `(blockId, path)` flows into a column they already have,
 * without restructuring the rest of the group's outputs. Distinct from the
 * `outputs` add/remove diff: the column keeps its identity, type, deps, and
 * row position; only its source mapping changes. Existing row values for the
 * column are backfilled from saved execution logs at the new `(blockId, path)`
 * — rows whose log has no value for the new mapping end up empty.
 */
const workflowGroupMappingUpdateSchema = z.object({
  columnName: z.string().min(1),
  blockId: z.string().min(1),
  path: z.string().min(1),
})

export const updateWorkflowGroupBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  groupId: z.string().min(1),
  workflowId: z.string().min(1).optional(),
  name: z.string().optional(),
  dependencies: workflowGroupDependenciesSchema.optional(),
  outputs: z.array(workflowGroupOutputSchema).optional(),
  newOutputColumns: z.array(workflowGroupOutputColumnSchema).optional(),
  /**
   * Per-column mapping swaps: keep the column, change the source `(blockId,
   * path)`. Applied before the `outputs` add/remove diff. Each entry's
   * `columnName` must already exist in the group's outputs.
   */
  mappingUpdates: z.array(workflowGroupMappingUpdateSchema).optional(),
  /** Replace the group's input mappings. Omit to leave unchanged. */
  inputMappings: z.array(workflowGroupInputMappingSchema).optional(),
  /** Change which workflow state the group runs against. Omit to leave unchanged. */
  deploymentMode: workflowGroupDeploymentModeSchema.optional(),
  /** Update the group's provenance. Omit to leave unchanged. */
  type: workflowGroupTypeSchema.optional(),
  /** Toggle the group's persisted auto-run flag. Omit to leave unchanged. */
  autoRun: z.boolean().optional(),
})

export const deleteWorkflowGroupBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  groupId: z.string().min(1),
})

const workflowGroupColumnsResponseSchema = successResponseSchema(
  z.object({
    columns: z.array(z.unknown()),
    workflowGroups: z.array(z.unknown()),
  })
)

export const addWorkflowGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/groups',
  params: tableIdParamsSchema,
  body: addWorkflowGroupBodySchema,
  response: {
    mode: 'json',
    schema: workflowGroupColumnsResponseSchema,
  },
})

export const updateWorkflowGroupContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]/groups',
  params: tableIdParamsSchema,
  body: updateWorkflowGroupBodySchema,
  response: {
    mode: 'json',
    schema: workflowGroupColumnsResponseSchema,
  },
})

export const deleteWorkflowGroupContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]/groups',
  params: tableIdParamsSchema,
  body: deleteWorkflowGroupBodySchema,
  response: {
    mode: 'json',
    schema: workflowGroupColumnsResponseSchema,
  },
})

/**
 * Cancel scopes:
 *  - `all`     — every running/pending cell in the table; with `filter`, only
 *                cells on rows matching it (filtered "select all" Stop)
 *  - `row`     — every running/pending cell for a specific row (`rowId` required)
 */
export const cancelTableRunsBodySchema = z
  .object({
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    scope: z.enum(['all', 'row']),
    rowId: z.string().min(1).optional(),
    filter: domainObjectSchema<Filter>().optional(),
    /** Scope-`all` only: rows deselected from the selection — their cells keep running. */
    excludeRowIds: z
      .array(z.string().min(1))
      .max(
        TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS,
        `Cannot exclude more than ${TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS} rows`
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === 'row' && !value.rowId) {
      ctx.addIssue({
        code: 'custom',
        path: ['rowId'],
        message: 'rowId is required when scope is "row"',
      })
    }
    if (value.scope === 'row' && value.filter) {
      ctx.addIssue({
        code: 'custom',
        path: ['filter'],
        message: 'filter only applies to scope "all"',
      })
    }
    if (value.scope === 'row' && value.excludeRowIds) {
      ctx.addIssue({
        code: 'custom',
        path: ['excludeRowIds'],
        message: 'excludeRowIds only applies to scope "all"',
      })
    }
  })

export const cancelTableRunsContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/cancel-runs',
  params: tableIdParamsSchema,
  body: cancelTableRunsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ cancelled: z.number() })),
  },
})

export const cancelTableJobBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  jobId: z.string().min(1, 'Job ID is required'),
})

/**
 * Cancel an in-flight async table job (import or delete). The worker stops at its next ownership
 * check; committed work (inserted/deleted rows) is left in place.
 */
export const cancelTableJobContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/job/cancel',
  params: tableIdParamsSchema,
  body: cancelTableJobBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ canceled: z.boolean() })),
  },
})
export type CancelTableJobBody = z.input<typeof cancelTableJobBodySchema>

/**
 * Run modes for `POST /api/table/[tableId]/columns/run`:
 *  - `all`        — every dep-satisfied row not already running/pending
 *  - `incomplete` — same, but additionally restricted to rows whose group has
 *    never run, or whose last run ended in `failed`/`aborted`
 *
 * Field is named `runMode` (not `mode`) to disambiguate from the table-import
 * `mode` arg (`append` / `replace`) which lives on a different op.
 */
/**
 * Run a set of workflow groups across the table or a row subset. The single
 * canonical user-driven run op — every UI gesture (single cell, per-row Play,
 * action-bar Play/Refresh, column-header menu) reduces to a `groupIds` +
 * optional `rowIds` shape. AI uses the `run_column` tool op.
 */
/**
 * Optional cap on how much work the dispatch does before completing. The
 * discriminated `type` keeps it extensible — only `'rows'` exists today
 * (`max` = number of eligible rows to run before stopping), but future kinds
 * (`'cells'`, `'cost'`, …) can extend the union without reshaping the request.
 */
export const runLimitSchema = z.object({
  type: z.literal('rows'),
  max: z
    .number()
    .int('max must be a whole number')
    .min(1, 'max must be at least 1')
    .max(1_000_000, 'max cannot exceed 1,000,000'),
})

export const runColumnBodySchema = z
  .object({
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    groupIds: z.array(z.string().min(1)).min(1),
    runMode: z.enum(['all', 'incomplete']).default('all'),
    rowIds: z.array(z.string().min(1)).min(1).optional(),
    /** "Select all under a filter" — run every row matching this filter instead of `rowIds`. The
     *  dispatcher walks only matching rows (paginated), so no id list is materialized. */
    filter: nonEmptyFilterSchema.optional(),
    /** Select-all scope only: rows deselected from the selection — the dispatcher skips them. */
    excludeRowIds: z
      .array(z.string().min(1))
      .max(
        TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS,
        `Cannot exclude more than ${TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS} rows`
      )
      .optional(),
    /** Cap the run to the first `max` eligible rows. Omit for an unbounded run. */
    limit: runLimitSchema.optional(),
  })
  .refine((data) => !(data.rowIds && data.filter), {
    message: 'Provide either filter or rowIds, but not both',
  })
  .refine((data) => !(data.rowIds && data.excludeRowIds), {
    message: 'excludeRowIds only applies to select-all scope (no rowIds)',
  })

export const runColumnContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/columns/run',
  params: tableIdParamsSchema,
  body: runColumnBodySchema,
  response: {
    mode: 'json',
    /**
     * `dispatchId` is the id of the `table_run_dispatches` row created for
     * this run. The dispatcher task picks it up and crawls the table row by
     * row; clients receive cell + dispatch events via SSE. Null when
     * trigger.dev is disabled — in that mode cells run inline in-process and
     * no dispatch row is created.
     */
    schema: successResponseSchema(z.object({ dispatchId: z.string().min(1).nullable() })),
  },
})

export type AddWorkflowGroupBodyInput = z.input<typeof addWorkflowGroupBodySchema>
export type UpdateWorkflowGroupBodyInput = z.input<typeof updateWorkflowGroupBodySchema>
export type DeleteWorkflowGroupBodyInput = z.input<typeof deleteWorkflowGroupBodySchema>
export type CancelTableRunsBodyInput = z.input<typeof cancelTableRunsBodySchema>
export type RunColumnBodyInput = z.input<typeof runColumnBodySchema>
/** Shared `runMode` union — used by every UI / hook / Mothership site that
 *  builds a run-column payload. Single source of truth for the literal pair. */
export type RunMode = NonNullable<RunColumnBodyInput['runMode']>
/** Run cap shape consumed by hooks/components building a capped run payload. */
export type RunLimit = z.input<typeof runLimitSchema>

/**
 * Active dispatch overlay: rows in the scope ahead of `cursor` render as
 * `pending` on refresh, so a long Run-all doesn't lose its queued indicators.
 * Returned by `GET /api/table/[tableId]/dispatches`; mirrored client-side via
 * `kind: 'dispatch'` SSE events.
 */
export const activeDispatchSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'dispatching']),
  mode: z.enum(['all', 'incomplete', 'new']),
  isManualRun: z.boolean(),
  cursor: z.number().int(),
  scope: z.object({
    groupIds: z.array(z.string()),
    rowIds: z.array(z.string()).optional(),
  }),
  /** Present when the run is capped. The client's "about to run" overlay skips
   *  capped dispatches — it can't tell which rows ahead of the cursor fall
   *  within the budget, so it would over-render Queued; the dispatcher's real
   *  per-row pending stamps cover the actual rows instead. */
  limit: runLimitSchema.optional(),
})

export const listActiveDispatchesContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/dispatches',
  params: tableIdParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        dispatches: z.array(activeDispatchSchema),
        /** Map rowId → number of in-flight (queued/running/pending) cells on
         *  that row. Sums to the "X running" badge and drives the per-row
         *  gutter Run/Stop button. Server-authoritative: refetched on a
         *  throttle as cell SSE events arrive, plus optimistic stamps on
         *  run-click. */
        runningByRowId: z.record(z.string(), z.number().int().positive()),
        /** Whether any in-flight cell is actually claimed by a worker
         *  (`status === 'running'`) — table-wide, unlike the client's
         *  loaded-rows view. Drives the header's "Queueing" vs "N running"
         *  label once the run's active window scrolls past the loaded rows. */
        hasRunning: z.boolean(),
      })
    ),
  },
})

export type ActiveDispatch = z.output<typeof activeDispatchSchema>

export const tableEventStreamQuerySchema = z.object({
  /** Replay cursor: events with `eventId > from` are replayed on connect.
   *  `0` replays the whole buffer (prune recovery). Absent → the server tails
   *  from the latest event id — a fresh mount has just fetched current state
   *  from the DB, so replaying history would only rewind it. */
  from: z.preprocess((value) => {
    if (typeof value !== 'string') return undefined
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }, z.number().int().min(0).optional()),
})

export const tableEventStreamContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/events/stream',
  params: tableIdParamsSchema,
  query: tableEventStreamQuerySchema,
  response: {
    mode: 'stream',
  },
})
