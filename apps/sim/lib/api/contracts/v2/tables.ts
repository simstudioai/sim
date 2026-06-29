import { z } from 'zod'
import {
  createTableColumnBodySchema,
  deleteTableColumnBodySchema,
  deleteTableRowsBodySchema,
  tableColumnSchema,
  tableIdParamsSchema,
  tableRowParamsSchema,
  updateRowsByFilterBodySchema,
  updateTableColumnBodySchema,
  updateTableRowBodySchema,
  upsertTableRowBodySchema,
} from '@/lib/api/contracts/tables'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v1CreateTableBodySchema,
  v1CreateTableRowsBodySchema,
  v1ListTablesQuerySchema,
  v1TableRowsQuerySchema,
} from '@/lib/api/contracts/v1/tables'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * v2 tables contracts.
 *
 * Request shapes (params/query/body) are reused verbatim from the v1 contract
 * and the first-party `/api/table` contract — the public table request surface
 * is unchanged. Only the response envelope is upgraded to the canonical v2
 * shapes (`{ data }` for single/mutation, `{ data, pagination }` for the
 * list/offset surfaces), and the outcome-dependent payloads are made consistent
 * (see per-contract notes below).
 *
 * The `data` item schemas are concrete and describe exactly what the route's
 * `toApiTable`/`toApiRow` serializers emit. The first-party
 * `tableDefinitionSchema`/`tableRowSchema` are NOT reused here because they are
 * opaque (`z.custom`) and their inferred types include fields the public wire
 * never carries (`executions`, `workspaceId`, `Date` timestamps, …). Column
 * shape is reused from the concrete first-party `tableColumnSchema`.
 */

/**
 * Public table shape emitted by `toApiTable` (timestamps ISO-serialized).
 * Concrete so the v2 contract describes exactly what the wire carries.
 */
export const v2ApiTableSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  schema: z.object({ columns: z.array(tableColumnSchema) }),
  rowCount: z.number(),
  maxRows: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type V2ApiTable = z.output<typeof v2ApiTableSchema>

/**
 * Public row shape emitted by `toApiRow`. `data` is keyed by column NAME (the
 * id→name translation the route applies); cell values are user-defined, so the
 * map is `Record<string, unknown>`. Timestamps ISO.
 */
export const v2ApiRowSchema = z.object({
  id: z.string(),
  data: z.record(z.string(), z.unknown()),
  position: z.number(),
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

/** Upsert payload — the row object includes `position` like every other row endpoint. */
export const v2UpsertRowDataSchema = z.object({
  row: v2ApiRowSchema,
  operation: z.enum(['insert', 'update']),
})
export type V2UpsertRowData = z.output<typeof v2UpsertRowDataSchema>

/**
 * Table list. `listTables` returns every table in the workspace (a small,
 * bounded per-workspace set), so today the cursor list is a single full page
 * (`nextCursor` is always `null`). Using the canonical cursor envelope keeps the
 * whole v2 list surface uniform, and real pagination can be added later behind
 * the opaque cursor without an interface change.
 */
export const v2ListTablesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables',
  query: v1ListTablesQuerySchema,
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
 * Row list query: the v1 filter/sort/limit request shape with `offset` swapped
 * for an opaque `cursor` (cursor-uniform v2 pagination). The cursor encodes the
 * underlying offset today; it can move to a keyset implementation later without
 * an interface change. Total row count is available as `rowCount` on the table.
 */
export const v2TableRowsQuerySchema = v1TableRowsQuerySchema.omit({ offset: true }).extend({
  cursor: z.string().min(1).optional(),
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

export const v2UpdateRowsByFilterContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  body: updateRowsByFilterBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UpdateRowsDataSchema),
  },
})

export const v2DeleteTableRowsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  body: deleteTableRowsBodySchema,
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
