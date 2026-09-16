import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  getSearchStatsRangeError,
  SEARCH_STATS_MAX_DAYS,
  SEARCH_STATS_PEOPLE_LIMIT,
  SEARCH_STATS_PERIODS,
  SEARCH_STATS_SOURCE_LIMIT,
  SEARCH_STATS_SURFACES,
} from '@/lib/knowledge/search/stats'

export const organizationSearchStatsQuerySchema = z
  .object({
    organizationId: organizationIdSchema,
    period: z.enum(SEARCH_STATS_PERIODS).default('30d'),
    surface: z.enum(SEARCH_STATS_SURFACES).optional(),
    startDate: z.string().max(10).optional(),
    endDate: z.string().max(10).optional(),
  })
  .superRefine((query, context) => {
    if (query.period === 'custom') {
      const error = getSearchStatsRangeError(query)
      if (error) context.addIssue({ code: 'custom', path: ['startDate'], message: error })
    } else if (query.startDate !== undefined || query.endDate !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['period'],
        message: 'Choose Custom range to use start and end dates.',
      })
    }
  })
export type OrganizationSearchStatsQuery = z.input<typeof organizationSearchStatsQuerySchema>

const countSchema = z.number().int().nonnegative()
const sourceTypeSchema = z.string().min(1).max(100)
export const organizationSearchStatsSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  totals: z.object({
    invocations: countSchema,
    activePeople: countSchema,
    results: countSchema,
  }),
  series: z
    .array(z.object({ timestamp: z.string().datetime(), invocations: countSchema }))
    .max(SEARCH_STATS_MAX_DAYS),
  surfaces: z
    .array(z.object({ surface: z.enum(SEARCH_STATS_SURFACES), invocations: countSchema }))
    .max(7),
  sources: z
    .array(z.object({ sourceType: sourceTypeSchema, invocations: countSchema }))
    .max(SEARCH_STATS_SOURCE_LIMIT),
  people: z
    .array(
      z.object({
        userId: z.string().nullable(),
        name: z.string().nullable(),
        email: z.string().nullable(),
        invocations: countSchema,
        sourceTypes: z.array(sourceTypeSchema).max(SEARCH_STATS_SOURCE_LIMIT),
      })
    )
    .max(SEARCH_STATS_PEOPLE_LIMIT),
})
export type OrganizationSearchStats = z.output<typeof organizationSearchStatsSchema>

export const readOrganizationSearchStatsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/sim-search/stats',
  query: organizationSearchStatsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), data: organizationSearchStatsSchema }),
  },
})
