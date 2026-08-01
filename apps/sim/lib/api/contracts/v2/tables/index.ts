import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  predicateSchema,
  sortSpecSchema,
  tableColumnSchema,
  tableIdParamsSchema,
} from '@/lib/api/contracts/tables'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Public v2 tables API — typed predicate grammar, cursor paging.
 *
 * Filters are the `{ all | any: [...] }` predicate tree (same shape the engine
 * consumes); no string querystring dialect. Response bodies are fully typed. Row
 * data is name-keyed and carries no storage internals (`position`/`orderKey`/
 * `executions`) — the public wire is `{ id, data, createdAt, updatedAt }`.
 */

/** Default page size when `limit` is omitted (bounded, unlike the internal surface). */
export const V2_DEFAULT_ROW_LIMIT = 100
/** Hard cap on an explicit page `limit`. Larger pulls use `limit=0` or the async export. */
export const V2_MAX_ROW_LIMIT = 1000

const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

const v2TableSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  schema: z.object({ columns: z.array(tableColumnSchema) }),
  rowCount: z.number(),
  maxRows: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Public row shape: name-keyed data, no storage internals. */
export const v2TableRowSchema = z.object({
  id: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const v2ListTablesQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})

/**
 * Rows query body. `predicate`/`sort` are the typed predicate tree / sort spec.
 * `limit`: omitted → {@link V2_DEFAULT_ROW_LIMIT}; `0` → unbounded (whole result
 * or a 400 `TABLE_QUERY_RESULT_TOO_LARGE`); `1..{@link V2_MAX_ROW_LIMIT}` → page cap.
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

export type V2ListTablesQuery = z.output<typeof v2ListTablesQuerySchema>
export type V2QueryRowsBody = z.input<typeof v2QueryRowsBodySchema>
export type V2TableRow = z.output<typeof v2TableRowSchema>

export const v2ListTablesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/tables',
  query: v2ListTablesQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        tables: z.array(v2TableSummarySchema),
        totalCount: z.number(),
      })
    ),
  },
})

export const v2QueryRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/tables/[tableId]/query',
  params: tableIdParamsSchema,
  body: v2QueryRowsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        rows: z.array(v2TableRowSchema),
        rowCount: z.number(),
        totalCount: z.number().nullable(),
        limit: z.number(),
        /** Opaque, short-lived token. Non-null when more rows remain; stop on null. */
        nextCursor: z.string().nullable(),
      })
    ),
  },
})

export type V2ListTablesResponse = z.output<(typeof v2ListTablesContract)['response']['schema']>
export type V2QueryRowsResponse = z.output<(typeof v2QueryRowsContract)['response']['schema']>
