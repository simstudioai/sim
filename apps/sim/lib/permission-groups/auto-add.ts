import type { db } from '@sim/db'
import { permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing'

const logger = createLogger('PermissionGroupsAutoAdd')

type DbClient = typeof db
type TransactionClient = Parameters<Parameters<DbClient['transaction']>[0]>[0]
type Client = DbClient | TransactionClient

/**
 * Add `userId` to the workspace's `autoAddNewMembers` permission group if one
 * exists, the workspace is entitled to access control, and the user is not
 * already a member of a group in that workspace. Safe to call unconditionally
 * on any workspace-permission grant; no-ops when access control isn't
 * available or no auto-add group is configured.
 */
export async function applyWorkspaceAutoAddGroup(
  client: Client,
  workspaceId: string,
  userId: string
): Promise<void> {
  try {
    const entitled = await isWorkspaceOnEnterprisePlan(workspaceId)
    if (!entitled) return

    const [autoAddGroup] = await client
      .select({ id: permissionGroup.id })
      .from(permissionGroup)
      .where(
        and(
          eq(permissionGroup.workspaceId, workspaceId),
          eq(permissionGroup.autoAddNewMembers, true)
        )
      )
      .limit(1)

    if (!autoAddGroup) return

    const [existingMembership] = await client
      .select({ id: permissionGroupMember.id })
      .from(permissionGroupMember)
      .innerJoin(permissionGroup, eq(permissionGroupMember.permissionGroupId, permissionGroup.id))
      .where(
        and(eq(permissionGroupMember.userId, userId), eq(permissionGroup.workspaceId, workspaceId))
      )
      .limit(1)

    if (existingMembership) return

    await client.insert(permissionGroupMember).values({
      id: generateId(),
      permissionGroupId: autoAddGroup.id,
      workspaceId,
      userId,
      assignedBy: null,
      assignedAt: new Date(),
    })
  } catch (error) {
    logger.error('Failed to auto-assign user to workspace permission group', {
      userId,
      workspaceId,
      error,
    })
  }
}
