import { AuditResourceType } from '@sim/audit'
import { db, dbReplica } from '@sim/db'
import { auditLog, workspace } from '@sim/db/schema'
import type { InferSelectModel } from 'drizzle-orm'
import { and, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm'
import { parseUnorderedList } from '@/lib/api/cursor-binding'

type DbAuditLog = InferSelectModel<typeof auditLog>

interface CursorData {
  createdAt: string
  id: string
}

function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

export function decodeAuditLogCursor(cursor: string): CursorData | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64').toString())
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null
    const { createdAt, id } = decoded as Partial<CursorData>
    if (
      typeof createdAt !== 'string' ||
      Number.isNaN(new Date(createdAt).getTime()) ||
      typeof id !== 'string' ||
      !id
    ) {
      return null
    }
    return { createdAt, id }
  } catch {
    return null
  }
}

export interface AuditLogFilterParams {
  action?: string
  resourceType?: string
  resourceId?: string
  workspaceId?: string
  actorId?: string
  actorEmail?: string
  search?: string
  startDate?: string
  endDate?: string
}

/**
 * Compiles the caller-supplied filters into SQL conditions.
 *
 * `resourceType` is a comma-separated set, parsed through
 * {@link parseUnorderedList} — the same parse the v2 cursor scope fingerprints
 * through. Splitting it here independently is what let `file,workflow` and
 * `file, workflow` mean one thing to the query and another to the cursor.
 */
export function buildFilterConditions(params: AuditLogFilterParams): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = []

  if (params.action) conditions.push(eq(auditLog.action, params.action))
  if (params.resourceType) {
    const types = parseUnorderedList(params.resourceType) ?? []
    if (types.length === 1) conditions.push(eq(auditLog.resourceType, types[0]))
    else if (types.length > 1) conditions.push(inArray(auditLog.resourceType, types))
  }
  if (params.resourceId) conditions.push(eq(auditLog.resourceId, params.resourceId))
  if (params.workspaceId) conditions.push(eq(auditLog.workspaceId, params.workspaceId))
  if (params.actorId) conditions.push(eq(auditLog.actorId, params.actorId))
  if (params.actorEmail) conditions.push(eq(auditLog.actorEmail, params.actorEmail))

  if (params.search) {
    const escaped = params.search.replace(/[%_\\]/g, '\\$&')
    const searchTerm = `%${escaped}%`
    conditions.push(
      or(
        ilike(auditLog.action, searchTerm),
        ilike(auditLog.actorEmail, searchTerm),
        ilike(auditLog.actorName, searchTerm),
        ilike(auditLog.resourceName, searchTerm),
        ilike(auditLog.description, searchTerm)
      )!
    )
  }

  if (params.startDate) conditions.push(gte(auditLog.createdAt, new Date(params.startDate)))
  if (params.endDate) conditions.push(lte(auditLog.createdAt, new Date(params.endDate)))

  return conditions
}

/** Returns the IDs of all workspaces attached to the organization. */
export async function getOrgWorkspaceIds(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.organizationId, organizationId))
  return rows.map((row) => row.id)
}

export interface OrgScopeParams {
  organizationId: string
  orgWorkspaceIds: string[]
  orgMemberIds: string[]
  includeDeparted: boolean
}

/** Builds the tenant-boundary predicate for organization audit log access. */
export function buildOrgScopeCondition(params: OrgScopeParams): SQL<unknown> {
  const { organizationId, orgWorkspaceIds, orgMemberIds, includeDeparted } = params

  const orgLevelCondition = and(
    isNull(auditLog.workspaceId),
    or(
      sql`${auditLog.metadata}->>'organizationId' = ${organizationId}`,
      and(
        eq(auditLog.resourceType, AuditResourceType.ORGANIZATION),
        eq(auditLog.resourceId, organizationId)
      )
    )
  )!

  const orgScope =
    orgWorkspaceIds.length > 0
      ? or(inArray(auditLog.workspaceId, orgWorkspaceIds), orgLevelCondition)!
      : orgLevelCondition

  if (includeDeparted) return orgScope

  const currentActorCondition =
    orgMemberIds.length > 0
      ? or(inArray(auditLog.actorId, orgMemberIds), isNull(auditLog.actorId))!
      : isNull(auditLog.actorId)

  return and(orgScope, currentActorCondition)!
}

function buildCursorCondition(cursor: string): SQL<unknown> | null {
  const cursorData = decodeAuditLogCursor(cursor)
  if (!cursorData) return null
  const cursorDate = new Date(cursorData.createdAt)

  return or(
    lt(auditLog.createdAt, cursorDate),
    and(eq(auditLog.createdAt, cursorDate), lt(auditLog.id, cursorData.id))
  )!
}

interface CursorPaginatedResult {
  data: DbAuditLog[]
  nextCursor?: string
}

export async function queryAuditLogs(
  conditions: SQL<unknown>[],
  limit: number,
  cursor?: string
): Promise<CursorPaginatedResult> {
  const allConditions = [...conditions]
  if (cursor) {
    const cursorCondition = buildCursorCondition(cursor)
    if (cursorCondition) allConditions.push(cursorCondition)
  }

  const rows = await dbReplica
    .select()
    .from(auditLog)
    .where(allConditions.length > 0 ? and(...allConditions) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const data = rows.slice(0, limit)
  const last = data.at(-1)
  return {
    data,
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : undefined,
  }
}
