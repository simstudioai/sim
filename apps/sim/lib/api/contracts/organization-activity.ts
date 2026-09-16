import { z } from 'zod'
import { organizationUsageSummaryQuerySchema } from '@/lib/api/contracts/organization-usage'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  ACTIVITY_DIMENSIONS,
  ACTIVITY_MAX_PAGE,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_SORTS,
} from '@/lib/billing/core/organization-activity'

export const organizationActivityBreakdownQuerySchema = organizationUsageSummaryQuerySchema.extend({
  dimension: z.enum(ACTIVITY_DIMENSIONS).default('workspace'),
  sort: z.enum(ACTIVITY_SORTS).default('runs'),
  page: z.coerce.number().int().min(0).max(ACTIVITY_MAX_PAGE).default(0),
})
export type OrganizationActivityBreakdownQuery = z.input<
  typeof organizationActivityBreakdownQuerySchema
>

export const organizationActivityMetricsSchema = z.object({
  workflowRuns: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  chatRuns: z.number().int().nonnegative(),
  chatMembers: z.number().int().nonnegative(),
  failureRate: z.number().min(0).max(1).nullable(),
  averageDurationMs: z.number().nonnegative().nullable(),
})

export const organizationActivitySummarySchema = z.object({
  workspace: z.object({ id: workspaceIdSchema, name: z.string() }).nullable(),
  totals: organizationActivityMetricsSchema,
  series: z
    .array(
      z.object({
        timestamp: z.string(),
        workflowRuns: z.number().int().nonnegative(),
        chatRuns: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
    )
    .max(1000),
})
export type OrganizationActivitySummary = z.output<typeof organizationActivitySummarySchema>

export const organizationActivityBreakdownSchema = z.object({
  rows: z
    .array(
      organizationActivityMetricsSchema.extend({
        id: z.string(),
        label: z.string(),
        workspaceId: workspaceIdSchema.nullable(),
        workspaceName: z.string().nullable(),
      })
    )
    .max(ACTIVITY_PAGE_SIZE),
  hasMore: z.boolean(),
})
export type OrganizationActivityBreakdown = z.output<typeof organizationActivityBreakdownSchema>

export const getOrganizationActivitySummaryContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/usage/activity/summary',
  params: z.object({ id: organizationIdSchema }),
  query: organizationUsageSummaryQuerySchema,
  response: { mode: 'json', schema: organizationActivitySummarySchema },
})

export const getOrganizationActivityBreakdownContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/usage/activity/breakdown',
  params: z.object({ id: organizationIdSchema }),
  query: organizationActivityBreakdownQuerySchema,
  response: { mode: 'json', schema: organizationActivityBreakdownSchema },
})
