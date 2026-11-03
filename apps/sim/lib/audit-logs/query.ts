import { AuditResourceType } from '@sim/audit'
import { db, dbReplica } from '@sim/db'
import { auditLog, workspace } from '@sim/db/schema'
import { escapeLikePattern } from '@sim/utils/string'
import type { InferSelectModel } from 'drizzle-orm'
import { and, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm'
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
 * The filters that narrow a listing to a subset of its scope: everything but the time range.
 *
 * `resourceType` is a comma-separated set, parsed through
 * {@link parseUnorderedList} — the same parse the v2 cursor scope fingerprints
 * through. Splitting it here independently is what let `file,workflow` and
 * `file, workflow` mean one thing to the query and another to the cursor.
 */
function narrowingConditions(params: AuditLogFilterParams): SQL<unknown>[] {
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

  return conditions
}

function timeRangeConditions(params: AuditLogFilterParams): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = []
  if (params.startDate) conditions.push(gte(auditLog.createdAt, new Date(params.startDate)))
  if (params.endDate) conditions.push(lte(auditLog.createdAt, new Date(params.endDate)))
  return conditions
}

/** Compiles the caller-supplied filters into SQL conditions. */
export function buildFilterConditions(params: AuditLogFilterParams): SQL<unknown>[] {
  return [...narrowingConditions(params), ...timeRangeConditions(params)]
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

function orgMetadataMatch(organizationId: string): SQL<unknown> {
  return sql`${auditLog.metadata}->>'organizationId' = ${organizationId}`
}

function orgResourceMatch(organizationId: string): SQL<unknown> | undefined {
  return and(
    eq(auditLog.resourceType, AuditResourceType.ORGANIZATION),
    eq(auditLog.resourceId, organizationId)
  )
}

function currentActorCondition(orgMemberIds: string[]): SQL<unknown> {
  return orgMemberIds.length > 0
    ? or(inArray(auditLog.actorId, orgMemberIds), isNull(auditLog.actorId))!
    : isNull(auditLog.actorId)
}

/** Builds the tenant-boundary predicate for organization audit log access. */
export function buildOrgScopeCondition(params: OrgScopeParams): SQL<unknown> {
  const { organizationId, orgWorkspaceIds, orgMemberIds, includeDeparted } = params

  const orgLevelCondition = and(
    isNull(auditLog.workspaceId),
    or(orgMetadataMatch(organizationId), orgResourceMatch(organizationId))
  )!

  const workspaceCondition =
    orgWorkspaceIds === undefined
      ? sql`exists (select 1 from ${workspace} where ${workspace.id} = ${auditLog.workspaceId} and ${workspace.organizationId} = ${organizationId})`
      : orgWorkspaceIds.length > 0
        ? inArray(auditLog.workspaceId, orgWorkspaceIds)
        : undefined
  const orgScope = workspaceCondition
    ? or(workspaceCondition, orgLevelCondition)!
    : orgLevelCondition

  if (includeDeparted) return orgScope
  return and(orgScope, currentActorCondition(orgMemberIds))!
}

/** The organization scope a listing reads, its workspaces resolved up front. */
export interface AuditLogListScope extends OrgScopeParams {
  orgWorkspaceIds: string[]
}

const auditLogTimestamp = sql`date_trunc('milliseconds', ${auditLog.createdAt})`
const auditLogOrder = [desc(auditLogTimestamp), desc(auditLog.id)]

function buildCursorCondition(cursorData: CursorData): SQL<unknown> | undefined {
  const cursorDate = new Date(cursorData.createdAt)
  return or(
    lt(auditLogTimestamp, sql.param(cursorDate, auditLog.createdAt)),
    and(
      eq(auditLogTimestamp, sql.param(cursorDate, auditLog.createdAt)),
      lt(auditLog.id, cursorData.id)
    )
  )
}

/**
 * {@link buildCursorCondition} as one row comparison, the same rows in the same order, spelled so
 * an index on `(…, date_trunc('milliseconds', created_at), id)` can seek straight to the cursor.
 */
function buildCursorKeyCondition(cursorData: CursorData): SQL<unknown> {
  const cursorDate = sql.param(new Date(cursorData.createdAt), auditLog.createdAt)
  return sql`(${auditLogTimestamp}, ${auditLog.id}) < (${cursorDate}::timestamp, ${cursorData.id})`
}

/**
 * The time range as bounds on the listing's sort key. `date_trunc` never decreases, so
 * `created_at >= start` implies `date_trunc(created_at) >= date_trunc(start)` and likewise for the
 * end: these bounds keep every row {@link timeRangeConditions} keeps, and let a keyset index scan
 * start and stop at the range instead of filtering its way through a workspace's whole history.
 */
function timeRangeKeyBounds(params: AuditLogFilterParams): SQL<unknown>[] {
  const bound = (date: string) =>
    sql`date_trunc('milliseconds', ${sql.param(new Date(date), auditLog.createdAt)}::timestamp)`
  const bounds: SQL<unknown>[] = []
  if (params.startDate) bounds.push(sql`${auditLogTimestamp} >= ${bound(params.startDate)}`)
  if (params.endDate) bounds.push(sql`${auditLogTimestamp} <= ${bound(params.endDate)}`)
  return bounds
}

/**
 * The ids of the first `take` rows in scope, newest first, for a listing narrowed by nothing but
 * a time range. The scope is a disjoint union: each organization workspace's rows, the
 * organization-level rows that name the organization in their metadata, and the organization
 * resource rows that do not. Each part is read newest first and limited to `take`; the first
 * `take` rows of the union are exactly the first `take` of the whole scope, and disjointness keeps
 * `union all` free of duplicates.
 *
 * A workspace's part is a keyset scan of `audit_log_workspace_created_at_id_idx` that stops after
 * a page, and the metadata part one of `audit_log_org_level_created_at_id_idx`. Planned as one
 * `OR`, the same listing reads and sorts every row of the scope inside the range. Only a part
 * whose index serves its filter in order stops after a page, which is why a listing with any
 * other filter keeps the single predicate: there the filter's own index finds the rows.
 */
function keysetPageIds(
  scope: AuditLogListScope,
  timeRange: AuditLogFilterParams,
  cursorData: CursorData | null,
  take: number
): SQL {
  const shared = [
    ...(scope.includeDeparted ? [] : [currentActorCondition(scope.orgMemberIds)]),
    ...timeRangeConditions(timeRange),
    ...timeRangeKeyBounds(timeRange),
    ...(cursorData ? [buildCursorKeyCondition(cursorData)] : []),
  ]
  const part = (scopePart: SQL<unknown> | undefined) =>
    sql`(select ${auditLog.id}, ${auditLog.createdAt} from ${auditLog} where ${and(scopePart, ...shared)} order by ${auditLogTimestamp} desc, ${auditLog.id} desc limit ${take})`

  const { organizationId } = scope
  const parts = [
    part(and(isNull(auditLog.workspaceId), orgMetadataMatch(organizationId))),
    part(
      and(
        isNull(auditLog.workspaceId),
        orgResourceMatch(organizationId),
        sql`(${orgMetadataMatch(organizationId)}) is not true`
      )
    ),
  ]
  const workspaceIds = [...new Set(scope.orgWorkspaceIds)]
  if (workspaceIds.length > 0) {
    parts.unshift(
      sql`(select page.id, page.created_at from unnest(${textArrayLiteral(workspaceIds)}) as org_workspace(workspace_id) cross join lateral ${part(sql`${auditLog.workspaceId} = org_workspace.workspace_id`)} as page)`
    )
  }
  return sql`(select candidate.id from (${sql.join(parts, sql` union all `)}) as candidate order by date_trunc('milliseconds', candidate.created_at) desc, candidate.id desc limit ${take})`
}

/**
 * Which rows a page may hold: the first `take` of the scope after the cursor. A listing narrowed
 * only by time reads them part by part through {@link keysetPageIds}; any other filter keeps the
 * single scope predicate, whose plan the filter's index drives.
 */
function pageCondition(
  scope: AuditLogListScope,
  filters: AuditLogFilterParams,
  cursorData: CursorData | null,
  take: number
): SQL<unknown> | undefined {
  const narrowing = narrowingConditions(filters)
  if (narrowing.length === 0) {
    return inArray(auditLog.id, keysetPageIds(scope, filters, cursorData, take))
  }
  return and(
    buildOrgScopeCondition(scope),
    ...narrowing,
    ...timeRangeConditions(filters),
    cursorData ? buildCursorCondition(cursorData) : undefined
  )
}

interface CursorPaginatedResult {
  data: DbAuditLog[]
  nextCursor?: string
  truncated?: boolean
}

/**
 * One page of the organization's audit log matching `filters`, newest first. An optional byte
 * budget bounds each database page before hydration and stops at oversized rows.
 */
export async function queryAuditLogs(
  scope: AuditLogListScope,
  filters: AuditLogFilterParams,
  limit: number,
  cursor?: string,
  maxBytes?: number
): Promise<CursorPaginatedResult> {
  const cursorData = cursor ? decodeAuditLogCursor(cursor) : null
  const condition = pageCondition(scope, filters, cursorData, limit + 1)
  if (maxBytes !== undefined) {
    return dbReplica.transaction(
      async (tx) => {
        const candidates = await tx
          .select({
            id: auditLog.id,
            bytes: sql<number>`octet_length(row_to_json(${auditLog})::text)`.mapWith(Number),
          })
          .from(auditLog)
          .where(condition)
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
    .where(condition)
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
