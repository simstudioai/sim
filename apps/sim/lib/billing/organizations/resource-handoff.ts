import {
  knowledgeBase,
  member,
  permissionGroup,
  ssoProvider,
  user,
  workspaceFiles,
} from '@sim/db/schema'
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'

/** Organization references survive even when their creator no longer has a membership row. */
export async function listSharedResourceOrganizationIdsForUser(executor: DbOrTx, userId: string) {
  const rows = await executor.execute<{ organizationId: string }>(sql`
    SELECT DISTINCT "organizationId" FROM (
      SELECT ${knowledgeBase.organizationId} AS "organizationId" FROM ${knowledgeBase}
        WHERE ${knowledgeBase.userId} = ${userId} AND ${knowledgeBase.workspaceId} IS NULL
      UNION ALL SELECT ${workspaceFiles.organizationId} FROM ${workspaceFiles}
        WHERE ${workspaceFiles.userId} = ${userId} AND ${workspaceFiles.workspaceId} IS NULL
      UNION ALL SELECT p.organization_id FROM workspace_files f JOIN project p ON p.id = f.project_id WHERE f.user_id = ${userId}
      UNION ALL SELECT p.organization_id FROM folder f JOIN project p ON p.id = f.project_id WHERE f.user_id = ${userId}
      UNION ALL SELECT ${permissionGroup.organizationId} FROM ${permissionGroup} WHERE ${permissionGroup.createdBy} = ${userId}
      UNION ALL SELECT ${ssoProvider.organizationId} FROM ${ssoProvider} WHERE ${ssoProvider.userId} = ${userId}
    ) owned WHERE "organizationId" IS NOT NULL ORDER BY "organizationId"
  `)
  return rows.map((row) => row.organizationId)
}

/** Retains organization-owned configuration without rewriting ACLs, credentials, or historical actors. */
export async function reassignOrganizationSharedResourcesTx(
  tx: DbTransaction,
  organizationId: string,
  departingUserId: string
): Promise<string | null> {
  const [successor] = await tx
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.role, 'owner'),
        ne(member.userId, departingUserId)
      )
    )
    .orderBy(asc(member.userId))
    .limit(1)
    .for('share')
  if (!successor) {
    const owned = await listSharedResourceOrganizationIdsForUser(tx, departingUserId)
    if (owned.includes(organizationId)) {
      throw new OrchestrationError(
        'conflict',
        'Shared organization resources need an active organization owner before this account can leave or be deleted.'
      )
    }
    return null
  }
  const [account] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, successor.userId))
    .for('key share')
  if (!account)
    throw new OrchestrationError(
      'conflict',
      'The organization owner changed. Nothing was changed; try again.'
    )
  const userId = successor.userId
  const updatedAt = new Date()
  await tx
    .update(knowledgeBase)
    .set({ userId, updatedAt })
    .where(
      and(
        eq(knowledgeBase.organizationId, organizationId),
        isNull(knowledgeBase.workspaceId),
        eq(knowledgeBase.userId, departingUserId)
      )
    )
  await tx
    .update(workspaceFiles)
    .set({ userId, updatedAt })
    .where(
      and(
        eq(workspaceFiles.organizationId, organizationId),
        isNull(workspaceFiles.workspaceId),
        eq(workspaceFiles.userId, departingUserId)
      )
    )
  await tx
    .update(permissionGroup)
    .set({ createdBy: userId, updatedAt })
    .where(
      and(
        eq(permissionGroup.organizationId, organizationId),
        eq(permissionGroup.createdBy, departingUserId)
      )
    )
  await tx
    .update(ssoProvider)
    .set({ userId })
    .where(
      and(eq(ssoProvider.organizationId, organizationId), eq(ssoProvider.userId, departingUserId))
    )
  return userId
}
