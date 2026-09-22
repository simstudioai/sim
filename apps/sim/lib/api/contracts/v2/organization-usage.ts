import { z } from 'zod'
import {
  organizationMemberUsageLimitDataSchema,
  updateOrganizationMemberUsageLimitBodySchema,
} from '@/lib/api/contracts/organization'
import {
  MAX_CUSTOM_RANGE_DAYS,
  organizationUsageBreakdownQuerySchema,
  organizationUsageBreakdownResponseSchema,
  organizationUsageSummaryQuerySchema,
  organizationUsageSummaryResponseSchema,
} from '@/lib/api/contracts/organization-usage'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { usageLogSourceSchema } from '@/lib/api/contracts/user'
import {
  v2OrganizationMemberParamsSchema,
  v2OrganizationParamsSchema,
} from '@/lib/api/contracts/v2/organizations'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'

export const v2OrganizationMemberUsageLimitSchema = organizationMemberUsageLimitDataSchema
  .extend({
    billingInterval: organizationMemberUsageLimitDataSchema.shape.billingInterval.describe(
      'Organization billing interval used for the credit cap.'
    ),
    creditsUsed: z
      .number()
      .describe('Credits used by this person during the organization billing period.'),
    creditLimit: z
      .number()
      .nullable()
      .describe(
        'Per-person credit cap. Null means no per-person cap; organization limits still apply. Zero prevents further credit-consuming usage.'
      ),
  })
  .meta({ id: 'V2OrganizationMemberUsageLimit' })
export type V2OrganizationMemberUsageLimit = z.output<typeof v2OrganizationMemberUsageLimitSchema>

export const v2UpdateOrganizationMemberUsageLimitBodySchema =
  updateOrganizationMemberUsageLimitBodySchema
    .extend({
      creditLimit: updateOrganizationMemberUsageLimitBodySchema.shape.creditLimit.describe(
        'Credit cap for this person. Send null to clear the cap or 0 to prevent further credit-consuming usage. Organization limits still apply.'
      ),
    })
    .strict()
export type V2UpdateOrganizationMemberUsageLimitBody = z.input<
  typeof v2UpdateOrganizationMemberUsageLimitBodySchema
>

export const v2OrganizationMemberUsageLimitParamsSchema = v2OrganizationMemberParamsSchema.extend({
  userId: v2OrganizationMemberParamsSchema.shape.userId.describe(
    'User ID from List Organization Members or List Workspace Members, including external workspace collaborators.'
  ),
})

export const v2GetOrganizationMemberUsageLimitContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/members/[userId]/usage-limit',
  params: v2OrganizationMemberUsageLimitParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2OrganizationMemberUsageLimitSchema) },
})

export const v2UpdateOrganizationMemberUsageLimitContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/organizations/[organizationId]/members/[userId]/usage-limit',
  params: v2OrganizationMemberUsageLimitParamsSchema,
  query: noInputSchema,
  body: v2UpdateOrganizationMemberUsageLimitBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      v2UpdateOrganizationMemberUsageLimitBodySchema.meta({
        id: 'V2OrganizationMemberUsageLimitUpdate',
      })
    ),
  },
})

const windowFields = {
  preset: organizationUsageSummaryQuerySchema.shape.preset
    .default('30d')
    .describe(
      'Reporting window. Custom requires startDate and endDate and is capped at 92 days; other presets reject those bounds. Resolved billing windows are capped at 366 days.'
    ),
  startDate: z.iso
    .date()
    .refine((value) => !value.startsWith('0000'), 'startDate must name a valid calendar year')
    .optional()
    .describe('First calendar date included, in the selected timezone. Requires preset=custom.'),
  endDate: z.iso
    .date()
    .refine((value) => !value.startsWith('0000'), 'endDate must name a valid calendar year')
    .refine(
      (value) => value < '9999-12-31',
      'endDate must be before 9999-12-31 to include the full final day'
    )
    .optional()
    .describe('Last calendar date included, in the selected timezone. Requires preset=custom.'),
}

function validateWindow(
  query: { preset: string; startDate?: string; endDate?: string },
  context: z.RefinementCtx
) {
  if (query.preset !== 'custom') {
    for (const field of ['startDate', 'endDate'] as const) {
      if (query[field] !== undefined)
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is only accepted with preset=custom`,
        })
    }
    return
  }
  for (const field of ['startDate', 'endDate'] as const) {
    if (query[field] === undefined)
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is required with preset=custom`,
      })
  }
  if (!query.startDate || !query.endDate) return
  const start = Date.parse(query.startDate)
  const end = Date.parse(query.endDate)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  if (end < start)
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'endDate must be on or after startDate',
    })
  if ((end - start) / 86_400_000 + 1 > MAX_CUSTOM_RANGE_DAYS)
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: `Custom usage windows cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days`,
    })
}

export const v2OrganizationUsageSummaryQuerySchema = organizationUsageSummaryQuerySchema
  .extend(windowFields)
  .strict()
  .superRefine(validateWindow)
export type V2OrganizationUsageSummaryQuery = z.input<typeof v2OrganizationUsageSummaryQuerySchema>

export const v2OrganizationUsageBreakdownQuerySchema = organizationUsageBreakdownQuerySchema
  .extend({
    ...windowFields,
    limit: v2PaginationFields({
      description: 'Maximum ranked groups to return. Remaining usage is summarized in other.',
    }).limit,
  })
  .strict()
  .superRefine(validateWindow)
export type V2OrganizationUsageBreakdownQuery = z.input<
  typeof v2OrganizationUsageBreakdownQuerySchema
>

export const v2OrganizationUsageEventsQuerySchema = organizationUsageSummaryQuerySchema
  .omit({ workspaceId: true })
  .extend({
    ...windowFields,
    source: usageLogSourceSchema.optional().describe('Restrict events to one product surface.'),
    ...v2PaginationFields({ description: 'Maximum usage events per page.' }),
    ...v2SortFields(['createdAt'] as const, { sortBy: 'createdAt', sortOrder: 'desc' }),
  })
  .strict()
  .superRefine(validateWindow)
export type V2OrganizationUsageEventsQuery = z.input<typeof v2OrganizationUsageEventsQuerySchema>

export const v2OrganizationUsageEventSchema = z
  .object({
    id: z.string().describe('Usage event identifier.'),
    createdAt: v2TimestampSchema.describe('When the usage event was recorded.'),
    source: usageLogSourceSchema.describe('Product surface that recorded the usage.'),
    description: z.string().describe('Usage event description, such as a model name.'),
    workflowName: z
      .string()
      .nullable()
      .describe('Workflow name, or null for non-workflow usage or a deleted workflow.'),
    credits: z.number().describe('Credits consumed by this event, rounded to whole credits.'),
    hasCost: z
      .boolean()
      .describe('Whether the event consumed credits before rounding, including sub-credit usage.'),
  })
  .meta({ id: 'V2OrganizationUsageEvent' })
export type V2OrganizationUsageEvent = z.output<typeof v2OrganizationUsageEventSchema>

export const v2GetOrganizationUsageSummaryContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/usage/summary',
  params: v2OrganizationParamsSchema,
  query: v2OrganizationUsageSummaryQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      organizationUsageSummaryResponseSchema
        .extend({
          window: organizationUsageSummaryResponseSchema.shape.window
            .extend({
              start: v2TimestampSchema.describe('Inclusive reporting-window start.'),
              end: v2TimestampSchema.describe('Exclusive reporting-window end.'),
            })
            .describe('Resolved reporting window.'),
          series: z
            .array(
              organizationUsageSummaryResponseSchema.shape.series.element.extend({
                timestamp: v2TimestampSchema.describe('Start of this calendar bucket.'),
              })
            )
            .describe('Chronological usage buckets, including buckets with no usage.'),
        })
        .meta({ id: 'V2OrganizationUsageSummary' })
    ),
  },
})

export const v2GetOrganizationUsageBreakdownContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/usage/breakdown',
  params: v2OrganizationParamsSchema,
  query: v2OrganizationUsageBreakdownQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(
      organizationUsageBreakdownResponseSchema.meta({ id: 'V2OrganizationUsageBreakdown' })
    ),
  },
})

export const v2ListOrganizationUsageEventsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/organizations/[organizationId]/usage/events',
  params: v2OrganizationParamsSchema,
  query: v2OrganizationUsageEventsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2OrganizationUsageEventSchema) },
})
