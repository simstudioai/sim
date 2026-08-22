import { defineAuthorizedAuditLogUseCase } from '@/lib/audit-logs/application/authorized-audit-log-use-case'
import { auditLogOperations } from '@/lib/audit-logs/application/operations'
import {
  type AuditLogFilterParams,
  buildFilterConditions,
  buildOrgScopeCondition,
  decodeAuditLogCursor,
  getOrgWorkspaceIds,
  queryAuditLogs,
} from '@/lib/audit-logs/query'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface ListAuditLogsInput {
  organizationId: string
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
