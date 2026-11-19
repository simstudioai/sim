import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type AuthorizedOrganizationUsageContext,
  defineAuthorizedOrganizationUsageUseCase,
} from '@/lib/billing/application/organization-usage/authorized-organization-usage-use-case'
import type { OrganizationUsageSummaryInput } from '@/lib/billing/application/organization-usage/get-organization-usage-summary'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import type {
  ActivityDimension,
  ActivityScope,
  ActivitySort,
} from '@/lib/billing/core/organization-activity'
import {
  readActivityBreakdown,
  readActivityDays,
  readActivityWorkspace,
} from '@/lib/billing/core/organization-activity-queries'
import {
  readRollupActivityBreakdown,
  readRollupActivityDays,
} from '@/lib/billing/core/organization-activity-rollup-queries'
import { summarizeActivityDays } from '@/lib/billing/core/organization-activity-summary'
import {
  resolveUsageAnalyticsWindow,
  resolveUsageBucket,
  usageBucketTimestamps,
  usageWindowBounds,
} from '@/lib/billing/core/usage-analytics'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const logger = createLogger('OrganizationActivity')

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

/**
 * Reads through the hourly rollup when the organization's flag is on and the rollup can serve the
 * window, and through the legacy queries otherwise. The rollup reproduces the legacy results
 * exactly, so the fallback is invisible; a rollup read that fails falls back too, so turning the
 * flag on can never fail a request the legacy read would answer.
 */
async function readThroughRollup<T>(
  scope: ActivityScope,
  rollup: () => Promise<T | null>,
  legacy: () => Promise<T>
): Promise<T> {
  if (
    !(await isFeatureEnabled('organization-activity-rollup-reads', { orgId: scope.organizationId }))
  ) {
    return legacy()
  }
  try {
    const result = await rollup()
    if (result !== null) return result
  } catch (error) {
    logger.error('Organization activity rollup read failed; reading the source', {
      organizationId: scope.organizationId,
      error: getErrorMessage(error),
    })
  }
  return legacy()
}

export const getOrganizationActivitySummary = defineAuthorizedOrganizationUsageUseCase({
  operation: organizationUsageOperations.readActivitySummary,
  organizationId: (input: OrganizationUsageSummaryInput) => input.organizationId,
  async execute({ input, context }) {
    const { window, workspace, scope } = await resolveActivityScope(input, context)
    const bucket = resolveUsageBucket(window)
    const days = await readThroughRollup(
      scope,
      () => readRollupActivityDays(scope, input.timezone),
      () => readActivityDays(scope, input.timezone)
    )
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
    return readThroughRollup(
      scope,
      () => readRollupActivityBreakdown(scope, input.dimension, input.sort, input.page),
      () => readActivityBreakdown(scope, input.dimension, input.sort, input.page)
    )
  },
})
