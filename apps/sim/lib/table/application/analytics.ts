import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import { queryTableAnalytics } from '@/lib/table/analytics/query'
import { type AnalyticsQuery, analyticsQuerySchema } from '@/lib/table/analytics/schema'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { TableQueryValidationError } from '@/lib/table/errors'

export interface QueryTableAnalyticsInput {
  tableId: string
  assertedWorkspaceId: string
  query: AnalyticsQuery
}

export const readTableAnalytics = defineAuthorizedTableUseCase({
  operation: tableOperations.analytics,
  resolveContext: ({ input }: { input: QueryTableAnalyticsInput }) =>
    resolveActiveTableContext(input),
  authorizeResource: ({ context }) => requireDashboardsEnabled(context.workspaceOrganizationId),
  async execute({ input, context }) {
    const parsed = analyticsQuerySchema.safeParse(input.query)
    if (!parsed.success)
      throw new OrchestrationError(
        'validation',
        parsed.error.issues.map((issue) => issue.message).join('; ')
      )
    try {
      return await queryTableAnalytics(context.table, parsed.data)
    } catch (error) {
      if (error instanceof TableQueryValidationError)
        throw new OrchestrationError('validation', error.message)
      throw error
    }
  },
})
