import { auditLog } from '@sim/db/schema'
import { and, inArray } from 'drizzle-orm'
import { buildOrgScopeCondition } from '@/lib/audit-logs/query'
import { DATA_DRAIN_LIMITS } from '@/lib/data-drains/limits'
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timeCursorOrderBy,
  timeCursorPredicate,
  timeCursorStabilityBound,
} from '@/lib/data-drains/sources/cursor'
import { readBoundedSourcePage } from '@/lib/data-drains/sources/helpers'
import type { Cursor, DrainSource, SourcePageInput } from '@/lib/data-drains/types'

type AuditLogRow = typeof auditLog.$inferSelect

/**
 * Drains audit events scoped to the organization: rows from any of the org's
 * workspaces, plus organization-level rows using the same tenant predicate as
 * the audit viewer. Departed actors remain part of the exported security trail.
 */
async function* pages(input: SourcePageInput): AsyncIterable<AuditLogRow[]> {
  const scopeClause = buildOrgScopeCondition({
    organizationId: input.organizationId,
    orgMemberIds: [],
    includeDeparted: true,
  })

  let cursor = decodeTimeCursor(input.cursor)
  while (!input.signal.aborted) {
    const cursorClause = timeCursorPredicate(auditLog.createdAt, auditLog.id, cursor)

    const orderBy = timeCursorOrderBy(auditLog.createdAt, auditLog.id)
    const rows = await readBoundedSourcePage({
      table: auditLog,
      idColumn: auditLog.id,
      condition: and(scopeClause, timeCursorStabilityBound(auditLog.createdAt), cursorClause),
      orderBy,
      chunkSize: input.chunkSize,
      read: (tx, ids) =>
        tx
          .select()
          .from(auditLog)
          .where(inArray(auditLog.id, ids))
          .orderBy(...orderBy),
    })

    if (rows.length === 0) return
    yield rows
    const last = rows[rows.length - 1]
    cursor = { ts: last.createdAt.toISOString(), id: last.id }
    if (rows.length < Math.min(input.chunkSize, DATA_DRAIN_LIMITS.pageRows)) return
  }
}

export const auditLogsSource: DrainSource<AuditLogRow> = {
  type: 'audit_logs',
  displayName: 'Audit logs',
  pages,
  serialize(row) {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      actorId: row.actorId,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      resourceName: row.resourceName,
      description: row.description,
      metadata: row.metadata,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      surface: row.surface,
      createdAt: row.createdAt.toISOString(),
    }
  },
  cursorAfter(row): Cursor {
    return encodeTimeCursor({ ts: row.createdAt.toISOString(), id: row.id })
  },
}
