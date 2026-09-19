import { permissionAccessRequest, user } from '@sim/db/schema'
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { storedAccessRequestTargetSchema } from '@/ee/access-requests/lib/schemas'
import type { AccessRequestList, AccessRequestRecord } from '@/ee/access-requests/lib/types'

export type StoredAccessRequest = typeof permissionAccessRequest.$inferSelect

export async function loadStoredAccessRequest(
  executor: DbOrTx,
  organizationId: string,
  requestId: string,
  forUpdate = false
): Promise<StoredAccessRequest> {
  const query = executor
    .select()
    .from(permissionAccessRequest)
    .where(
      and(
        eq(permissionAccessRequest.id, requestId),
        eq(permissionAccessRequest.organizationId, organizationId)
      )
    )
  const [row] = forUpdate ? await query.for('update').limit(1) : await query.limit(1)
  if (!row) throw new OrchestrationError('not_found', 'Access request not found')
  return row
}

export async function presentAccessRequest(
  executor: DbOrTx,
  row: StoredAccessRequest
): Promise<AccessRequestRecord> {
  const [requester] = await executor
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, row.requesterId))
    .limit(1)
  if (!requester) throw new OrchestrationError('not_found', 'Access request not found')
  return projectAccessRequest(row, requester)
}

type AccessRequestPresentation = Pick<
  StoredAccessRequest,
  | 'id'
  | 'organizationId'
  | 'workspaceId'
  | 'target'
  | 'targetLabel'
  | 'reason'
  | 'status'
  | 'decisionReason'
  | 'createdAt'
  | 'decidedAt'
  | 'groupName'
>

function projectAccessRequest(
  row: AccessRequestPresentation,
  requester: AccessRequestRecord['requester']
): AccessRequestRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    target: storedAccessRequestTargetSchema.parse(row.target),
    targetLabel: row.targetLabel,
    reason: row.reason,
    status: row.status,
    decisionReason: row.decisionReason,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    groupName: row.groupName,
    requester,
  }
}

export async function listAccessRequestRecords(
  executor: DbOrTx,
  where: SQL,
  limit: number,
  offset: number,
  search?: string
): Promise<AccessRequestList> {
  const searchTerm = search?.trim()
  const pattern = searchTerm ? `%${escapeLikePattern(searchTerm)}%` : undefined
  const filteredWhere = and(
    where,
    pattern
      ? or(
          ilike(permissionAccessRequest.targetLabel, pattern),
          ilike(user.name, pattern),
          ilike(user.email, pattern)
        )
      : undefined
  )
  const rows = await executor
    .select({
      row: {
        id: permissionAccessRequest.id,
        organizationId: permissionAccessRequest.organizationId,
        workspaceId: permissionAccessRequest.workspaceId,
        target: permissionAccessRequest.target,
        targetLabel: permissionAccessRequest.targetLabel,
        reason: permissionAccessRequest.reason,
        status: permissionAccessRequest.status,
        decisionReason: permissionAccessRequest.decisionReason,
        createdAt: permissionAccessRequest.createdAt,
        decidedAt: permissionAccessRequest.decidedAt,
        groupName: permissionAccessRequest.groupName,
      },
      requester: { id: user.id, name: user.name, email: user.email },
    })
    .from(permissionAccessRequest)
    .innerJoin(user, eq(user.id, permissionAccessRequest.requesterId))
    .where(filteredWhere)
    .orderBy(desc(permissionAccessRequest.createdAt), desc(permissionAccessRequest.id))
    .limit(limit)
    .offset(offset)
  const [aggregate] = await executor
    .select({ total: count() })
    .from(permissionAccessRequest)
    .innerJoin(user, eq(user.id, permissionAccessRequest.requesterId))
    .where(filteredWhere)
  const total = aggregate?.total ?? 0
  return {
    requests: rows.map(({ row, requester }) => projectAccessRequest(row, requester)),
    total,
    hasMore: offset + rows.length < total,
  }
}
