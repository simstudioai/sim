import { db } from '@sim/db'
import { auditLog } from '@sim/db/schema'
import { and, inArray, isNull, or, sql } from 'drizzle-orm'
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timeCursorOrderBy,
  timeCursorPredicate,
} from '@/lib/data-drains/sources/cursor'
import { getOrganizationWorkspaceIds } from '@/lib/data-drains/sources/helpers'
import type { Cursor, DrainSource, SourcePageInput } from '@/lib/data-drains/types'

type AuditLogRow = typeof auditLog.$inferSelect

/**
 * Drains audit events scoped to the organization: rows from any of the org's
 * workspaces, plus org-level rows (`workspace_id IS NULL`) where
 * `metadata->>'organizationId'` matches. Audit-log writers consistently set
 * `metadata.organizationId` for org-scoped actions even though the table has
 * no dedicated FK column.
 */
async function* pages(input: SourcePageInput): AsyncIterable<AuditLogRow[]> {
  const workspaceIds = await getOrganizationWorkspaceIds(input.organizationId)

  const orgScopedClause = and(
    isNull(auditLog.workspaceId),
    sql`${auditLog.metadata}->>'organizationId' = ${input.organizationId}`
  )
  const scopeClause =
    workspaceIds.length === 0
      ? orgScopedClause
      : or(inArray(auditLog.workspaceId, workspaceIds), orgScopedClause)

  let cursor = decodeTimeCursor(input.cursor)
  while (!input.signal.aborted) {
    const cursorClause = timeCursorPredicate(auditLog.createdAt, auditLog.id, cursor)

    const rows = await db
      .select()
      .from(auditLog)
      .where(and(scopeClause, cursorClause))
      .orderBy(...timeCursorOrderBy(auditLog.createdAt, auditLog.id))
      .limit(input.chunkSize)

    if (rows.length === 0) return
    yield rows
    const last = rows[rows.length - 1]
    cursor = { ts: last.createdAt.toISOString(), id: last.id }
    if (rows.length < input.chunkSize) return
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
      createdAt: row.createdAt.toISOString(),
    }
  },
  cursorAfter(row): Cursor {
    return encodeTimeCursor({ ts: row.createdAt.toISOString(), id: row.id })
  },
}
