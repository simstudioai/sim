import { defineAuthorizedBillingReadUseCase } from '@/lib/billing/application/authorized-billing-read-use-case'
import { billingOperations } from '@/lib/billing/application/operations'
import { resolveSystemBillingAttribution } from '@/lib/billing/core/billing-attribution'
import {
  getUsageCreditsByLogId,
  getUserUsageLogs,
  type UsageLogSource,
} from '@/lib/billing/core/usage-log'

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
    let ledgerUserId: string
    if (principal.kind === 'personal_api_key') {
      ledgerUserId = principal.userId
    } else {
      if (scope.kind !== 'workspace') {
        throw new Error('Workspace API key billing logs require a workspace scope')
      }
      ledgerUserId = (await resolveSystemBillingAttribution(scope.workspace.workspaceId))
        .billedAccountUserId
    }
    const filter = {
      source: input.source,
      workspaceId,
      startDate: input.startDate,
      endDate: input.endDate,
    }
    const [usage, creditsByLogId] = await Promise.all([
      getUserUsageLogs(ledgerUserId, {
        ...filter,
        limit: input.limit,
        cursor: input.cursor,
        includeSummary: false,
      }),
      getUsageCreditsByLogId(ledgerUserId, filter),
    ])
    return { usage, creditsByLogId }
  },
})
