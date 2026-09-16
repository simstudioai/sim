import { permissionAccessRequest, user } from '@sim/db/schema'
import { and, count, desc, eq, type SQL } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { storedAccessRequestTargetSchema } from '@/lib/permission-access-requests/schemas'
import type { AccessRequestList, AccessRequestRecord } from '@/lib/permission-access-requests/types'

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

function projectAccessRequest(
  row: StoredAccessRequest,
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
  offset: number
): Promise<AccessRequestList> {
  const rows = await executor
    .select({
      row: permissionAccessRequest,
      requester: { id: user.id, name: user.name, email: user.email },
    })
    .from(permissionAccessRequest)
    .innerJoin(user, eq(user.id, permissionAccessRequest.requesterId))
    .where(where)
    .orderBy(desc(permissionAccessRequest.createdAt), desc(permissionAccessRequest.id))
    .limit(limit)
    .offset(offset)
  const [aggregate] = await executor
    .select({ total: count() })
    .from(permissionAccessRequest)
    .where(where)
  const total = aggregate?.total ?? 0
  return {
    requests: rows.map(({ row, requester }) => projectAccessRequest(row, requester)),
    total,
    hasMore: offset + rows.length < total,
  }
}
