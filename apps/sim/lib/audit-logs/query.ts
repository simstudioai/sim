import { AuditResourceType } from '@sim/audit'
import { db, dbReplica } from '@sim/db'
import { auditLog, workspace } from '@sim/db/schema'
import { escapeLikePattern } from '@sim/utils/string'
import type { InferSelectModel } from 'drizzle-orm'
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, type SQL, sql } from 'drizzle-orm'
import { parseUnorderedList } from '@/lib/api/cursor-binding'
import { textArrayLiteral } from '@/lib/db/arrays'

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
    const searchTerm = `%${escapeLikePattern(params.search)}%`
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
  orgWorkspaceIds?: string[]
  orgMemberIds: string[]
  includeDeparted: boolean
}

function orgLevelCondition(organizationId: string): SQL<unknown> {
  return and(
    isNull(auditLog.workspaceId),
    or(
      sql`${auditLog.metadata}->>'organizationId' = ${organizationId}`,
      and(
        eq(auditLog.resourceType, AuditResourceType.ORGANIZATION),
        eq(auditLog.resourceId, organizationId)
      )
    )
  )!
}

function currentActorCondition(orgMemberIds: string[]): SQL<unknown> {
  return orgMemberIds.length > 0
    ? or(inArray(auditLog.actorId, orgMemberIds), isNull(auditLog.actorId))!
    : isNull(auditLog.actorId)
}

/** Builds the tenant-boundary predicate for organization audit log access. */
export function buildOrgScopeCondition(params: OrgScopeParams): SQL<unknown> {
  const { organizationId, orgWorkspaceIds, orgMemberIds, includeDeparted } = params

  const orgLevel = orgLevelCondition(organizationId)
  const workspaceCondition =
    orgWorkspaceIds === undefined
      ? sql`exists (select 1 from ${workspace} where ${workspace.id} = ${auditLog.workspaceId} and ${workspace.organizationId} = ${organizationId})`
      : orgWorkspaceIds.length > 0
        ? inArray(auditLog.workspaceId, orgWorkspaceIds)
        : undefined
  const orgScope = workspaceCondition ? or(workspaceCondition, orgLevel)! : orgLevel

  if (includeDeparted) return orgScope
  return and(orgScope, currentActorCondition(orgMemberIds))!
}

/** The organization scope a listing reads: its workspace ids resolved up front. */
export interface AuditLogListScope extends OrgScopeParams {
  orgWorkspaceIds: string[]
}

const auditLogTimestamp = sql`date_trunc('milliseconds', ${auditLog.createdAt})`
const auditLogOrder = [desc(auditLogTimestamp), desc(auditLog.id)]

/**
 * Keyset position after the cursor. A row comparison is the same order as the
 * `ORDER BY` below, and it lets an index scan seek straight to the cursor
 * rather than walk every newer row and discard it.
 */
function buildCursorCondition(cursor: string): SQL<unknown> | null {
  const cursorData = decodeAuditLogCursor(cursor)
  if (!cursorData) return null
  const cursorDate = sql.param(new Date(cursorData.createdAt), auditLog.createdAt)
  return sql`(${auditLogTimestamp}, ${auditLog.id}) < (${cursorDate}::timestamp, ${cursorData.id})`
}

function conjunction(conditions: SQL<unknown>[]): SQL<unknown> {
  return sql.join(
    conditions.map((condition) => sql`(${condition})`),
    sql` and `
  )
}

/**
 * The ids of the first `take` rows in scope, newest first. The scope is a
 * disjoint union — a row either belongs to one of the organization's workspaces
 * or has no workspace and names the organization — so each part is read
 * separately: one keyset scan of `audit_log_workspace_created_at_id_idx` per
 * workspace, plus the organization-level rows, each stopping after `take`
 * matches. The first `take` rows of the union are exactly the first `take` of
 * the whole scope. Planned as one `OR`, Postgres can follow no index in order
 * and sorts every row in the scope (for a busy organization, a full scan of the
 * table) to return one page.
 */
function pageIdsQuery(scope: AuditLogListScope, conditions: SQL<unknown>[], take: number): SQL {
  const shared = scope.includeDeparted
    ? conditions
    : [...conditions, currentActorCondition(scope.orgMemberIds)]
  const branch = (part: SQL<unknown>) =>
    sql`(select ${auditLog.id}, ${auditLog.createdAt} from ${auditLog} where ${conjunction([part, ...shared])} order by ${auditLogTimestamp} desc, ${auditLog.id} desc limit ${take})`

  const parts = [branch(orgLevelCondition(scope.organizationId))]
  const workspaceIds = [...new Set(scope.orgWorkspaceIds)]
  if (workspaceIds.length > 0) {
    parts.unshift(
      sql`(select page.id, page.created_at from unnest(${textArrayLiteral(workspaceIds)}) as org_workspace(workspace_id) cross join lateral ${branch(sql`${auditLog.workspaceId} = org_workspace.workspace_id`)} as page)`
    )
  }
  return sql`(select candidate.id from (${sql.join(parts, sql` union all `)}) as candidate order by date_trunc('milliseconds', candidate.created_at) desc, candidate.id desc limit ${take})`
}

interface CursorPaginatedResult {
  data: DbAuditLog[]
  nextCursor?: string
  truncated?: boolean
}

/**
 * One page of the organization's audit log matching `conditions`, newest first.
 * An optional byte budget bounds each database page before hydration and stops
 * at oversized rows.
 */
export async function queryAuditLogs(
  scope: AuditLogListScope,
  conditions: SQL<unknown>[],
  limit: number,
  cursor?: string,
  maxBytes?: number
): Promise<CursorPaginatedResult> {
  const allConditions = [...conditions]
  if (cursor) {
    const cursorCondition = buildCursorCondition(cursor)
    if (cursorCondition) allConditions.push(cursorCondition)
  }
  const inPage = inArray(auditLog.id, pageIdsQuery(scope, allConditions, limit + 1))

  if (maxBytes !== undefined) {
    return dbReplica.transaction(
      async (tx) => {
        const candidates = await tx
          .select({
            id: auditLog.id,
            bytes: sql<number>`octet_length(row_to_json(${auditLog})::text)`.mapWith(Number),
          })
          .from(auditLog)
          .where(inPage)
          .orderBy(...auditLogOrder)
          .limit(limit + 1)
        const ids: string[] = []
        let bytes = 0
        let truncated = false
        for (const candidate of candidates.slice(0, limit)) {
          if (candidate.bytes > maxBytes) {
            truncated = true
            break
          }
          if (bytes + candidate.bytes > maxBytes) break
          ids.push(candidate.id)
          bytes += candidate.bytes
        }
        const data =
          ids.length > 0
            ? await tx
                .select()
                .from(auditLog)
                .where(inArray(auditLog.id, ids))
                .orderBy(...auditLogOrder)
                .limit(limit)
            : []
        const last = data.at(-1)
        return {
          data,
          truncated,
          nextCursor:
            candidates.length > data.length && last
              ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
              : undefined,
        }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' }
    )
  }

  const rows = await dbReplica
    .select()
    .from(auditLog)
    .where(inPage)
    .orderBy(...auditLogOrder)
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
