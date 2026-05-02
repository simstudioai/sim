import { z } from 'zod'
import {
  createTableBodySchema,
  createTableColumnBodySchema,
  deleteTableColumnBodySchema,
  deleteTableRowsBodySchema,
  insertTableRowBodySchema,
  rowDataSchema,
  tableIdParamsSchema,
  tableRowParamsSchema,
  tableRowsQuerySchema,
  updateRowsByFilterBodySchema,
  updateTableColumnBodySchema,
  updateTableRowBodySchema,
  upsertTableRowBodySchema,
} from '@/lib/api/contracts/tables'
import { defineRouteContract } from '@/lib/api/contracts/types'
import type { Filter, Sort } from '@/lib/table'
import { TABLE_LIMITS } from '@/lib/table/constants'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const domainObjectSchema = <T>() => z.custom<T>(isRecord)

const optionalJsonObjectQuerySchema = <T>(label: string) =>
  z
    .union([z.string(), domainObjectSchema<T>()])
    .optional()
    .transform((value, ctx): T | undefined => {
      if (value === undefined || value === '') return undefined
      if (typeof value !== 'string') return value

      try {
        const parsed: unknown = JSON.parse(value)
        if (isRecord(parsed)) return parsed as T
      } catch {
        ctx.addIssue({ code: 'custom', message: `Invalid ${label} JSON` })
        return z.NEVER
      }

      ctx.addIssue({ code: 'custom', message: `${label} must be a JSON object` })
      return z.NEVER
    })

export const v1TableRowsQuerySchema = tableRowsQuerySchema.extend({
  filter: optionalJsonObjectQuerySchema<Filter>('filter'),
  sort: optionalJsonObjectQuerySchema<Sort>('sort'),
})

export const v1ListTablesQuerySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId query parameter is required'),
})

export const v1CreateTableBodySchema = createTableBodySchema.omit({
  initialRowCount: true,
})

/**
 * Public API insert row body — no caller-controlled `position`. Server places
 * new rows at the tail; ordering by index is an in-app affordance only.
 */
export const v1InsertTableRowBodySchema = insertTableRowBodySchema.omit({ position: true })

/**
 * Public API batch insert body — no `positions`. Same rationale as above.
 */
export const v1BatchInsertTableRowsBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  rows: z
    .array(rowDataSchema)
    .min(1, 'At least one row is required')
    .max(
      TABLE_LIMITS.MAX_BATCH_INSERT_SIZE,
      `Cannot insert more than ${TABLE_LIMITS.MAX_BATCH_INSERT_SIZE} rows per batch`
    ),
})

export const v1CreateTableRowsBodySchema = z.union([
  v1BatchInsertTableRowsBodySchema,
  v1InsertTableRowBodySchema,
])

export type V1ListTablesQuery = z.output<typeof v1ListTablesQuerySchema>
export type V1TableRowsQuery = z.output<typeof v1TableRowsQuerySchema>
export type V1InsertTableRowBody = z.output<typeof v1InsertTableRowBodySchema>
export type V1BatchInsertTableRowsBody = z.output<typeof v1BatchInsertTableRowsBodySchema>
export type V1CreateTableRowsBody = z.output<typeof v1CreateTableRowsBodySchema>

const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

const v1TableApiResponseSchema = successResponseSchema(z.unknown()).passthrough()

export const v1ListTablesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/tables',
  query: v1ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1CreateTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/tables',
  body: v1CreateTableBodySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1GetTableContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/tables/[tableId]',
  params: tableIdParamsSchema,
  query: v1ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1DeleteTableContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/tables/[tableId]',
  params: tableIdParamsSchema,
  query: v1ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1AddTableColumnContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/tables/[tableId]/columns',
  params: tableIdParamsSchema,
  body: createTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1UpdateTableColumnContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/tables/[tableId]/columns',
  params: tableIdParamsSchema,
  body: updateTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1DeleteTableColumnContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/tables/[tableId]/columns',
  params: tableIdParamsSchema,
  body: deleteTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1ListTableRowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  query: v1TableRowsQuerySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1CreateTableRowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  body: v1CreateTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1BatchCreateTableRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  body: v1BatchInsertTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1UpdateRowsByFilterContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v1/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  body: updateRowsByFilterBodySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1DeleteTableRowsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/tables/[tableId]/rows',
  params: tableIdParamsSchema,
  body: deleteTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1GetTableRowContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/tables/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  query: v1ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1UpdateTableRowContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v1/tables/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  body: updateTableRowBodySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1DeleteTableRowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/tables/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  query: v1ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})

export const v1UpsertTableRowContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/tables/[tableId]/rows/upsert',
  params: tableIdParamsSchema,
  body: upsertTableRowBodySchema,
  response: {
    mode: 'json',
    schema: v1TableApiResponseSchema,
  },
})
