import { AuditAction, AuditResourceType } from '@sim/audit'
import { defineAuthorizedAuditLogUseCase } from '@/lib/audit-logs/application/authorized-audit-log-use-case'
import { auditLogOperations } from '@/lib/audit-logs/application/operations'
import { AUDIT_LOG_CSV_HEADER, toAuditLogCsvRow } from '@/lib/audit-logs/csv'
import {
  type AuditLogFilterParams,
  buildFilterConditions,
  buildOrgScopeCondition,
  getOrgWorkspaceIds,
  queryAuditLogs,
} from '@/lib/audit-logs/query'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const EXPORT_MAX_ROWS = 10_000
const EXPORT_PAGE_ROWS = 100
const EXPORT_MAX_BYTES = 64 * 1024 * 1024

interface ExportAuditLogsInput {
  organizationId: string
  includeDeparted: boolean
  filters: AuditLogFilterParams
}

/** Exports a bounded organization audit snapshot under the viewer's scope policy. */
export const exportAuditLogs = defineAuthorizedAuditLogUseCase({
  operation: auditLogOperations.export,
  organizationId: (input: ExportAuditLogsInput) => input.organizationId,
  execute: async ({ input, context, request }) => {
    const workspaceIds = await getOrgWorkspaceIds(context.organizationId)
    if (input.filters.workspaceId && !workspaceIds.includes(input.filters.workspaceId)) {
      throw new OrchestrationError('validation', 'workspaceId does not belong to your organization')
    }
    if (
      input.filters.actorId &&
      !input.includeDeparted &&
      !context.orgMemberIds.includes(input.filters.actorId)
    ) {
      throw new OrchestrationError('validation', 'actorId is not a member of your organization')
    }
    const scope = buildOrgScopeCondition({
      organizationId: context.organizationId,
      orgWorkspaceIds: workspaceIds,
      orgMemberIds: context.orgMemberIds,
      includeDeparted: input.includeDeparted,
    })
    const conditions = [scope, ...buildFilterConditions(input.filters)]
    const lines = [AUDIT_LOG_CSV_HEADER]
    let rowCount = 0
    let cursor: string | undefined
    let bytes = Buffer.byteLength(AUDIT_LOG_CSV_HEADER, 'utf8')
    let truncated = false
    pages: while (rowCount < EXPORT_MAX_ROWS && bytes < EXPORT_MAX_BYTES) {
      request?.signal?.throwIfAborted()
      const page = await queryAuditLogs(
        conditions,
        Math.min(EXPORT_PAGE_ROWS, EXPORT_MAX_ROWS - rowCount),
        cursor,
        EXPORT_MAX_BYTES
      )
      for (const row of page.data) {
        const line = toAuditLogCsvRow(row, EXPORT_MAX_BYTES - bytes - 1)
        if (line === undefined) {
          truncated = true
          break pages
        }
        bytes += Buffer.byteLength(line, 'utf8') + 1
        lines.push(line)
        rowCount++
      }
      if (page.truncated) {
        truncated = true
        break
      }
      if (!page.nextCursor) break
      cursor = page.nextCursor
      truncated = rowCount >= EXPORT_MAX_ROWS || bytes >= EXPORT_MAX_BYTES
    }
    return { csv: lines.join('\n'), rowCount, truncated }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.AUDIT_LOGS_EXPORTED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    description: 'Exported organization audit logs',
    metadata: {
      format: 'csv',
      rowCount: result.rowCount,
      truncated: result.truncated,
      includeDeparted: input.includeDeparted,
      filters: Object.keys(input.filters).filter((key) =>
        Boolean(input.filters[key as keyof AuditLogFilterParams])
      ),
    },
  }),
})
