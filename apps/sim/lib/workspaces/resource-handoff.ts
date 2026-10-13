import {
  chat,
  folder,
  knowledgeBase,
  member,
  permissions,
  user,
  userTableDefinitions,
  workflow,
  workflowMcpServer,
  workspace,
  workspaceFile,
  workspaceFiles,
} from '@sim/db/schema'
import { ORG_ADMIN_ROLES } from '@sim/platform-authz/workspace'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { handoffFileCreatorsInTx } from '@/lib/uploads/contexts/workspace/creator-handoff'
import {
  findWorkspaceBillingReplacement,
  reassignWorkflowOwnershipForWorkspaceMemberRemovalTx,
} from '@/lib/workspaces/utils'

/** Private chat attachments keep their user's lifecycle even when stored under a workspace key. */
const SHARED_FILE_CONTEXTS = ['workspace', 'knowledge-base', 'execution', 'chat'] as const

/** Finds surviving containers from ownership references, including departures predating handoff. */
export async function listSharedResourceWorkspaceIdsForUser(executor: DbOrTx, userId: string) {
  const rows = await executor.execute<{ workspaceId: string }>(sql`
    SELECT DISTINCT "workspaceId" FROM (
      SELECT ${workflow.workspaceId} AS "workspaceId" FROM ${workflow} WHERE ${workflow.userId} = ${userId}
      UNION ALL SELECT ${folder.workspaceId} FROM ${folder} WHERE ${folder.userId} = ${userId}
      UNION ALL SELECT ${userTableDefinitions.workspaceId} FROM ${userTableDefinitions} WHERE ${userTableDefinitions.createdBy} = ${userId}
      UNION ALL SELECT ${knowledgeBase.workspaceId} FROM ${knowledgeBase} WHERE ${knowledgeBase.userId} = ${userId}
      UNION ALL SELECT ${workspaceFiles.workspaceId} FROM ${workspaceFiles}
        WHERE ${workspaceFiles.userId} = ${userId} AND ${workspaceFiles.context} IN ('workspace', 'knowledge-base', 'execution', 'chat') AND ${workspaceFiles.chatId} IS NULL
      UNION ALL SELECT ${workspaceFile.workspaceId} FROM ${workspaceFile} WHERE ${workspaceFile.uploadedBy} = ${userId}
      UNION ALL SELECT ${workflowMcpServer.workspaceId} FROM ${workflowMcpServer}
        WHERE ${workflowMcpServer.createdBy} = ${userId} AND NOT ${workflowMcpServer.isPublic}
      UNION ALL SELECT ${workflow.workspaceId} FROM ${chat} JOIN ${workflow} ON ${workflow.id} = ${chat.workflowId} WHERE ${chat.userId} = ${userId}
    ) owned WHERE "workspaceId" IS NOT NULL
    ORDER BY "workspaceId"
  `)
  return rows.map((row) => row.workspaceId)
}

/** Holds a real successor and their current grant through the handoff transaction. */
async function hasWorkspaceSuccessor(
  tx: DbOrTx,
  row: { id: string; organizationId: string | null; billedAccountUserId: string },
  departingUserId: string,
  hold: boolean
): Promise<boolean> {
  const successor = row.billedAccountUserId
  if (!successor || successor === departingUserId) return false
  const accountQuery = tx.select({ id: user.id }).from(user).where(eq(user.id, successor))
  const [account] = await (hold ? accountQuery.for('key share') : accountQuery)
  if (!account) return false
  const grantQuery = tx
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, row.id),
        eq(permissions.userId, successor)
      )
    )
  const [grant] = await (hold ? grantQuery.for('share') : grantQuery)
  if (grant) return true
  if (!row.organizationId) return false
  const membershipQuery = tx
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, row.organizationId),
        eq(member.userId, successor),
        inArray(member.role, ORG_ADMIN_ROLES)
      )
    )
  const [membership] = await (hold ? membershipQuery.for('share') : membershipQuery)
  return Boolean(membership)
}

/** Read-only feasibility check, including the billing replacement applied before resource handoff. */
export async function listUnresolvedSharedResourceWorkspaces(
  executor: DbOrTx,
  departingUserId: string,
  doomedWorkspaceIds: string[]
): Promise<string[]> {
  const doomed = new Set(doomedWorkspaceIds)
  const ids = (await listSharedResourceWorkspaceIdsForUser(executor, departingUserId)).filter(
    (id) => !doomed.has(id)
  )
  if (!ids.length) return []
  const rows = await executor
    .select({
      id: workspace.id,
      ownerId: workspace.ownerId,
      organizationId: workspace.organizationId,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .where(inArray(workspace.id, ids))
  const unresolved: string[] = []
  for (const row of rows) {
    const successor =
      row.billedAccountUserId === departingUserId
        ? await findWorkspaceBillingReplacement(executor, row, departingUserId)
        : row.billedAccountUserId
    if (
      !successor ||
      !(await hasWorkspaceSuccessor(
        executor,
        { ...row, billedAccountUserId: successor },
        departingUserId,
        false
      ))
    ) {
      unresolved.push(row.id)
    }
  }
  return unresolved
}

/**
 * Moves shared lifecycle references before access is revoked. No active-row filter: archived
 * resources and their children must survive the eventual user cascade too. Successor validation
 * finishes before any write, so a refusal cannot leave a partially transferred batch.
 */
export async function reassignSharedResourceOwnershipForWorkspaceMemberRemovalTx({
  tx,
  workspaceIds,
  departingUserId,
}: {
  tx: DbTransaction
  workspaceIds: string[]
  departingUserId: string
}): Promise<{ unresolved: string[] }> {
  const ids = [...new Set(workspaceIds)].sort()
  if (!ids.length) return { unresolved: [] }
  const rows = await tx
    .select({
      id: workspace.id,
      ownerId: workspace.ownerId,
      organizationId: workspace.organizationId,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .where(inArray(workspace.id, ids))
    .orderBy(asc(workspace.id))
    .for('no key update')

  const owned = new Set(await listSharedResourceWorkspaceIdsForUser(tx, departingUserId))
  const unresolved: string[] = []
  for (const row of rows) {
    if (
      (owned.has(row.id) || row.ownerId === departingUserId) &&
      !(await hasWorkspaceSuccessor(tx, row, departingUserId, true))
    )
      unresolved.push(row.id)
  }
  if (unresolved.length) return { unresolved }

  for (const row of rows) {
    if (!owned.has(row.id)) continue
    const userId = row.billedAccountUserId
    const updatedAt = new Date()
    await reassignWorkflowOwnershipForWorkspaceMemberRemovalTx({
      tx,
      workspaceIds: [row.id],
      departingUserId,
    })
    await tx
      .update(folder)
      .set({ userId, updatedAt })
      .where(and(eq(folder.workspaceId, row.id), eq(folder.userId, departingUserId)))
    await tx
      .update(userTableDefinitions)
      .set({ createdBy: userId, updatedAt })
      .where(
        and(
          eq(userTableDefinitions.workspaceId, row.id),
          eq(userTableDefinitions.createdBy, departingUserId)
        )
      )
    await tx
      .update(knowledgeBase)
      .set({ userId, updatedAt })
      .where(and(eq(knowledgeBase.workspaceId, row.id), eq(knowledgeBase.userId, departingUserId)))
    await handoffFileCreatorsInTx(
      tx,
      and(
        eq(workspaceFiles.workspaceId, row.id),
        eq(workspaceFiles.userId, departingUserId),
        inArray(workspaceFiles.context, SHARED_FILE_CONTEXTS),
        isNull(workspaceFiles.chatId)
      ),
      userId
    )
    await tx
      .update(workspaceFile)
      .set({ uploadedBy: userId })
      .where(
        and(eq(workspaceFile.workspaceId, row.id), eq(workspaceFile.uploadedBy, departingUserId))
      )
    await tx
      .update(chat)
      .set({ userId, updatedAt })
      .where(
        and(
          eq(chat.userId, departingUserId),
          inArray(
            chat.workflowId,
            tx.select({ id: workflow.id }).from(workflow).where(eq(workflow.workspaceId, row.id))
          )
        )
      )
    await tx
      .update(workflowMcpServer)
      .set({ createdBy: userId, updatedAt })
      .where(
        and(
          eq(workflowMcpServer.workspaceId, row.id),
          eq(workflowMcpServer.createdBy, departingUserId),
          eq(workflowMcpServer.isPublic, false)
        )
      )
  }
  return { unresolved: [] }
}
