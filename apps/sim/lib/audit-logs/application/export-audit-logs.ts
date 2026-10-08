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
    const rows: Awaited<ReturnType<typeof queryAuditLogs>>['data'] = []
    let cursor: string | undefined
    let bytes = Buffer.byteLength(AUDIT_LOG_CSV_HEADER, 'utf8')
    let truncated = false
    pages: while (rows.length < EXPORT_MAX_ROWS) {
      request?.signal?.throwIfAborted()
      const page = await queryAuditLogs(
        conditions,
        Math.min(EXPORT_PAGE_ROWS, EXPORT_MAX_ROWS - rows.length),
        cursor
      )
      for (const row of page.data) {
        bytes += Buffer.byteLength(toAuditLogCsvRow(row), 'utf8') + 1
        if (bytes > EXPORT_MAX_BYTES) {
          truncated = true
          break pages
        }
        rows.push(row)
      }
      if (!page.nextCursor) break
      cursor = page.nextCursor
      truncated = rows.length >= EXPORT_MAX_ROWS
    }
    return { rows, truncated }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.AUDIT_LOGS_EXPORTED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    description: 'Exported organization audit logs',
    metadata: {
      format: 'csv',
      rowCount: result.rows.length,
      truncated: result.truncated,
      includeDeparted: input.includeDeparted,
      filters: Object.keys(input.filters).filter((key) =>
        Boolean(input.filters[key as keyof AuditLogFilterParams])
      ),
    },
  }),
})
