import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { tableIdParamsSchema } from '@/lib/api/contracts/tables'
import { ANALYTICS_MAX_ROWS, analyticsQuerySchema } from '@/lib/table/analytics/schema'

export const queryTableAnalyticsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    query: analyticsQuerySchema,
  })
  .strict()
export const queryTableAnalyticsResponseSchema = z.object({
  rows: z
    .array(
      z.record(
        z.string().max(128),
        z.union([z.string().max(8192), z.number(), z.boolean(), z.null()])
      )
    )
    .max(ANALYTICS_MAX_ROWS),
  columns: z.array(z.string().max(128)).max(12),
  columnLabels: z.record(z.string().max(128), z.string().max(255)),
  truncated: z.boolean(),
  bucket: z.enum(['minute', 'hour', 'day', 'week', 'month', 'year']).nullable(),
})
export const queryTableAnalyticsContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/analytics',
  params: tableIdParamsSchema,
  body: queryTableAnalyticsBodySchema,
  response: { mode: 'json', schema: queryTableAnalyticsResponseSchema },
})
export type QueryTableAnalyticsBody = z.input<typeof queryTableAnalyticsBodySchema>
export type QueryTableAnalyticsResponse = z.output<typeof queryTableAnalyticsResponseSchema>
