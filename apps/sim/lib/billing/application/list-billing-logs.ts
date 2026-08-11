import { defineAuthorizedBillingReadUseCase } from '@/lib/billing/application/authorized-billing-read-use-case'
import { billingOperations } from '@/lib/billing/application/operations'
import {
  getUserUsageLogs,
  getWorkspaceUsageLogs,
  type UsageLogSource,
} from '@/lib/billing/core/usage-log'
import { apportionCredits } from '@/lib/billing/credits/conversion'

export interface ListBillingLogsInput {
  workspaceId?: string
  source?: UsageLogSource[]
  startDate?: Date
  endDate: Date
  limit: number
  cursor?: string
}

export interface ListBillingLogsResult {
  usage: Awaited<ReturnType<typeof getUserUsageLogs>>
  creditsByLogId: Record<string, number>
}

export const listBillingLogs = defineAuthorizedBillingReadUseCase({
  operation: billingOperations.listLogs,
  requestedWorkspaceId: (input: ListBillingLogsInput) => input.workspaceId,
  execute: async ({ principal, input, scope }): Promise<ListBillingLogsResult> => {
    const workspaceId = scope.kind === 'workspace' ? scope.workspace.workspaceId : undefined
    const query = {
      source: input.source,
      startDate: input.startDate,
      endDate: input.endDate,
      limit: input.limit,
      cursor: input.cursor,
      includeSummary: false,
    }
    let usage: ListBillingLogsResult['usage']
    if (principal.kind === 'personal_api_key') {
      usage = await getUserUsageLogs(principal.userId, { ...query, workspaceId })
    } else {
      if (scope.kind !== 'workspace') {
        throw new Error('Workspace API key billing logs require a workspace scope')
      }
      usage = await getWorkspaceUsageLogs(scope.workspace.workspaceId, query)
    }
    const creditsByLogId = apportionCredits(
      usage.logs.map((log) => ({ key: log.id, dollars: log.cost }))
    )
    return { usage, creditsByLogId }
  },
})
