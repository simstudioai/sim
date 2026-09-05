import { isUserCredentialPrincipal } from '@sim/auth/principal'
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

/**
 * Which question the returned rows answer. `'workspace'` is the workspace's
 * whole ledger — every member's events, because the workspace is the payer.
 * `'user'` is the calling person's own events, optionally narrowed to one
 * workspace. It is reported on the wire because the two are otherwise
 * indistinguishable: the same workspace and window can legitimately return
 * fewer rows on one scope than the other, and a caller reconciling spend needs
 * to know which set it received.
 */
export type BillingLogsScope = 'user' | 'workspace'

export interface ListBillingLogsResult {
  usage: Awaited<ReturnType<typeof getUserUsageLogs>>
  creditsByLogId: Record<string, number>
  scope: BillingLogsScope
}

function apportionLogCredits(usage: ListBillingLogsResult['usage']): Record<string, number> {
  return apportionCredits(usage.logs.map((log) => ({ key: log.id, dollars: log.cost })))
}

/**
 * An OAuth access token or personal API key reports the person holding it:
 * their own usage events, narrowed to the workspace they named when they named
 * one. A workspace API key has no actor behind it, so it reports the workspace
 * itself: every member's events for the workspace the key is pinned to.
 *
 * The two are deliberately different questions, and the answer says which one it
 * answered via `scope`. Harmonizing them onto the resolved scope would hand any
 * workspace member holding a user credential every other member's Wand, Chat,
 * voice, enrichment, and knowledge-base spend, none of which is exposed by any
 * other surface at this role.
 */
export const listBillingLogs = defineAuthorizedBillingReadUseCase({
  operation: billingOperations.listLogs,
  requestedWorkspaceId: (input: ListBillingLogsInput) => input.workspaceId,
  execute: async ({ principal, input, scope }): Promise<ListBillingLogsResult> => {
    const query = {
      source: input.source,
      startDate: input.startDate,
      endDate: input.endDate,
      limit: input.limit,
      cursor: input.cursor,
      includeSummary: false,
    }
    if (isUserCredentialPrincipal(principal)) {
      const workspaceId = scope.kind === 'workspace' ? scope.workspace.workspaceId : undefined
      const usage = await getUserUsageLogs(principal.userId, { ...query, workspaceId })
      return { usage, creditsByLogId: apportionLogCredits(usage), scope: 'user' }
    }
    /**
     * `resolveBillingReadScope` pins a workspace API key to `principal.workspaceId`
     * whatever the query asked for, and has already loaded and validated that
     * workspace, so this is the same id the resolved scope carries.
     */
    const usage = await getWorkspaceUsageLogs(principal.workspaceId, query)
    return { usage, creditsByLogId: apportionLogCredits(usage), scope: 'workspace' }
  },
})
