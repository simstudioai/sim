import {
  type AuthorizedOrganizationUsageContext,
  defineAuthorizedOrganizationUsageUseCase,
} from '@/lib/billing/application/organization-usage/authorized-organization-usage-use-case'
import type { OrganizationUsageSummaryInput } from '@/lib/billing/application/organization-usage/get-organization-usage-summary'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import type { ActivityDimension, ActivitySort } from '@/lib/billing/core/organization-activity'
import {
  readActivityBreakdown,
  readActivityDays,
  readActivityWorkspace,
} from '@/lib/billing/core/organization-activity-queries'
import { summarizeActivityDays } from '@/lib/billing/core/organization-activity-summary'
import {
  resolveUsageAnalyticsWindow,
  resolveUsageBucket,
  usageBucketTimestamps,
  usageWindowBounds,
} from '@/lib/billing/core/usage-analytics'
import { OrchestrationError } from '@/lib/core/orchestration/types'

interface OrganizationActivityBreakdownInput extends OrganizationUsageSummaryInput {
  dimension: ActivityDimension
  sort: ActivitySort
  page: number
}

async function resolveActivityScope(
  input: OrganizationUsageSummaryInput,
  context: AuthorizedOrganizationUsageContext
) {
  const workspace = input.workspaceId
    ? await readActivityWorkspace(context.organizationId, input.workspaceId)
    : null
  if (input.workspaceId && !workspace) {
    throw new OrchestrationError('not_found', 'Workspace not found')
  }
  const window = resolveUsageAnalyticsWindow({
    preset: input.preset,
    period: context.period,
    customStart: input.startDate,
    customEnd: input.endDate,
    timezone: input.timezone,
  })
  return {
    window,
    workspace,
    scope: {
      organizationId: context.organizationId,
      workspaceId: workspace?.id,
      ...usageWindowBounds(window),
    },
  }
}

export const getOrganizationActivitySummary = defineAuthorizedOrganizationUsageUseCase({
  operation: organizationUsageOperations.readActivitySummary,
  organizationId: (input: OrganizationUsageSummaryInput) => input.organizationId,
  async execute({ input, context }) {
    const { window, workspace, scope } = await resolveActivityScope(input, context)
    const bucket = resolveUsageBucket(window)
    const days = await readActivityDays(scope, input.timezone)
    return {
      workspace,
      ...summarizeActivityDays(days, usageBucketTimestamps(window, bucket, input.timezone), bucket),
    }
  },
})

export const getOrganizationActivityBreakdown = defineAuthorizedOrganizationUsageUseCase({
  operation: organizationUsageOperations.readActivityBreakdown,
  organizationId: (input: OrganizationActivityBreakdownInput) => input.organizationId,
  async execute({ input, context }) {
    const { scope } = await resolveActivityScope(input, context)
    return readActivityBreakdown(scope, input.dimension, input.sort, input.page)
  },
})
