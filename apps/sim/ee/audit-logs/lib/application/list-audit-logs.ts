import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedAuditLogUseCase } from '@/ee/audit-logs/lib/application/authorized-audit-log-use-case'
import { auditLogOperations } from '@/ee/audit-logs/lib/application/operations'
import {
  type AuditLogFilterParams,
  buildFilterConditions,
  buildOrgScopeCondition,
  decodeAuditLogCursor,
  getOrgWorkspaceIds,
  queryAuditLogs,
} from '@/ee/audit-logs/lib/query'

export interface ListAuditLogsInput {
  /** Omitted when the caller belongs to exactly one organization and let it be derived. */
  organizationId?: string
  includeDeparted: boolean
  filters: AuditLogFilterParams
  limit: number
  cursor?: string
}

export type ListAuditLogsResult = Awaited<ReturnType<typeof queryAuditLogs>>

export const listAuditLogs = defineAuthorizedAuditLogUseCase({
  operation: auditLogOperations.list,
  organizationId: (input: ListAuditLogsInput) => input.organizationId,
  execute: async ({ input, context }): Promise<ListAuditLogsResult> => {
    if (input.cursor && !decodeAuditLogCursor(input.cursor)) {
      throw new OrchestrationError('validation', 'Invalid audit-log cursor')
    }
    const orgWorkspaceIds = await getOrgWorkspaceIds(context.organizationId)
    if (input.filters.workspaceId && !orgWorkspaceIds.includes(input.filters.workspaceId)) {
      throw new OrchestrationError('validation', 'workspaceId does not belong to your organization')
    }
    const scopeCondition = buildOrgScopeCondition({
      organizationId: context.organizationId,
      orgWorkspaceIds,
      orgMemberIds: context.orgMemberIds,
      includeDeparted: input.includeDeparted,
    })
    const filterConditions = buildFilterConditions(input.filters)
    return queryAuditLogs([scopeCondition, ...filterConditions], input.limit, input.cursor)
  },
})
