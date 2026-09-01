import { db } from '@sim/db'
import { auditLog } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { defineAuthorizedAuditLogUseCase } from '@/lib/audit-logs/application/authorized-audit-log-use-case'
import { auditLogOperations } from '@/lib/audit-logs/application/operations'
import { buildOrgScopeCondition, getOrgWorkspaceIds } from '@/lib/audit-logs/query'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface GetAuditLogInput {
  /** Omitted when the caller belongs to exactly one organization and let it be derived. */
  organizationId?: string
  id: string
}

export interface GetAuditLogResult {
  log: typeof auditLog.$inferSelect
}

export const getAuditLog = defineAuthorizedAuditLogUseCase({
  operation: auditLogOperations.readDetail,
  organizationId: (input: GetAuditLogInput) => input.organizationId,
  execute: async ({ input, context }): Promise<GetAuditLogResult> => {
    const orgWorkspaceIds = await getOrgWorkspaceIds(context.organizationId)
    const scopeCondition = buildOrgScopeCondition({
      organizationId: context.organizationId,
      orgWorkspaceIds,
      orgMemberIds: context.orgMemberIds,
      includeDeparted: true,
    })
    const [log] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.id, input.id), scopeCondition))
      .limit(1)
    if (!log) throw new OrchestrationError('not_found', 'Audit log not found')
    return { log }
  },
})
